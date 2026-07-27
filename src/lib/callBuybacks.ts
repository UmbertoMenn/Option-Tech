/**
 * Tracciamento dei riacquisti di call appartenenti a Covered Call /
 * De-Risking Covered Call ("call da rivendere").
 *
 * Dal file Movimenti Titoli:
 *  - un ACQ di una call che risulta VENDUTA nelle posizioni correnti o
 *    nelle firme delle config covered_call / derisking_covered_call è un
 *    RIACQUISTO → va tracciato con il prezzo di riacquisto (serve per il
 *    gain alla rivendita) e successivamente con il prezzo di mercato
 *    corrente (serve per il patrimonio netting intrinseco mancante).
 *  - un VEN di una call con stesso descrittore di un riacquisto aperto è
 *    la RIVENDITA → chiude il riacquisto (quantità per quantità).
 *
 * Le call mai vendute e quelle scadute senza rivendita hanno valore di
 * mercato zero; la discriminazione a video è la presenza del ticker nella
 * card "Call da rivendere" (che già esclude gli archiviati).
 */
import { Position } from '@/types/portfolio';
import { StrategyConfiguration, PositionSignature } from '@/hooks/useStrategyConfigurations';
import { FlussiTitoliOptionTrade } from '@/lib/flussiCsvParser';
import { normalizeForMatching, getCanonicalKey } from '@/lib/derivativeStrategies';

export interface CallBuybackInsert {
  underlying: string; // ticker del sottostante (dal descrittore)
  descriptor: string;
  strike: number;
  expiry_date: string;
  quantity: number;
  buyback_price: number; // per azione, divisa del titolo
  currency: string;
  exchange_rate: number;
  buyback_date: string;
}

export interface CallResell {
  descriptor: string;
  strike: number;
  expiry_date: string;
  quantity: number;
  resell_price: number; // per azione
  resell_date: string;
}

export interface CallBuybackExtraction {
  buybacks: CallBuybackInsert[];
  resells: CallResell[];
}

function norm(text: string): string {
  return getCanonicalKey(text) || normalizeForMatching(text);
}

/** True se il trade combacia (sottostante, strike, scadenza) con una call VENDUTA. */
function matchesSoldCall(
  trade: FlussiTitoliOptionTrade,
  positions: Position[],
  configs: StrategyConfiguration[],
): boolean {
  const tKey = norm(trade.underlyingTicker);

  // 1) Posizioni correnti: call vendute
  const inPositions = positions.some(p => {
    if (p.asset_type !== 'derivative') return false;
    if ((p.option_type || '').toLowerCase() !== 'call') return false;
    if (p.quantity >= 0) return false;
    if (Math.abs((p.strike_price || 0) - trade.strike) > 0.01) return false;
    if ((p.expiry_date || '') !== trade.expiryDate) return false;
    const pKey = norm(p.underlying || p.description || '');
    return pKey === tKey || pKey.includes(tKey) || tKey.includes(pKey);
  });
  if (inPositions) return true;

  // 2) Firme delle config CC / de-risking (copre il caso in cui la posizione
  //    è già stata rimossa dal nuovo snapshot saldi)
  return configs.some(c => {
    if (c.strategy_type !== 'covered_call' && c.strategy_type !== 'derisking_covered_call') return false;
    const cKey = norm(c.underlying);
    if (!(cKey === tKey || cKey.includes(tKey) || tKey.includes(cKey))) return false;
    const sigs = (c.position_signatures as unknown as PositionSignature[]) || [];
    return sigs.some(s =>
      (s.option_type || '').toLowerCase() === 'call' &&
      s.quantity_sign === -1 &&
      Math.abs(s.strike - trade.strike) < 0.01 &&
      s.expiry === trade.expiryDate,
    );
  });
}

/**
 * Estrae dai movimenti titoli i riacquisti di call CC/DR-CC e le rivendite
 * che chiudono riacquisti precedenti (incluse quelle intra-file: un ACQ e
 * un VEN dello stesso descrittore nello stesso file si compensano).
 */
export function extractCallBuybacks(
  trades: FlussiTitoliOptionTrade[],
  positions: Position[],
  configs: StrategyConfiguration[],
): CallBuybackExtraction {
  const buybacks: CallBuybackInsert[] = [];
  const resells: CallResell[] = [];

  const callTrades = trades
    .filter(t => t.optionType === 'call')
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  for (const t of callTrades) {
    if (t.side === 'ACQ') {
      if (!matchesSoldCall(t, positions, configs)) continue; // apertura long (LEAP), non un riacquisto
      buybacks.push({
        underlying: t.underlyingTicker,
        descriptor: t.descriptor,
        strike: t.strike,
        expiry_date: t.expiryDate,
        quantity: t.contracts,
        buyback_price: t.pricePerShare,
        currency: t.currency,
        exchange_rate: t.exchangeRate,
        buyback_date: t.tradeDate,
      });
    } else {
      // VEN: chiude riacquisti aperti con lo stesso descrittore (prima intra-file)
      let remaining = t.contracts;
      for (const b of buybacks) {
        if (remaining <= 0) break;
        if (b.descriptor !== t.descriptor) continue;
        const take = Math.min(b.quantity, remaining);
        b.quantity -= take;
        remaining -= take;
      }
      if (remaining > 0) {
        resells.push({
          descriptor: t.descriptor,
          strike: t.strike,
          expiry_date: t.expiryDate,
          quantity: remaining,
          resell_price: t.pricePerShare,
          resell_date: t.tradeDate,
        });
      }
    }
  }

  return {
    buybacks: buybacks.filter(b => b.quantity > 0),
    resells,
  };
}

/**
 * Chiave naturale di una TRANCHE di riacquisto: descrittore + data + prezzo.
 * Corrisponde al vincolo univoco (portfolio_id, descriptor, buyback_date,
 * buyback_price): due tranche dello stesso giorno a prezzi diversi sono righe
 * distinte, lo stesso lotto ricaricato dal medesimo file collassa su sé stesso.
 */
export function trancheKey(b: { descriptor: string; buyback_date: string; buyback_price: number }): string {
  return `${b.descriptor}|${b.buyback_date}|${b.buyback_price}`;
}

/**
 * Somma le tranche perfettamente identiche (stesso descrittore, data e prezzo)
 * mantenendo separate quelle a prezzo diverso.
 *
 * Serve prima dell'upsert: Postgres rifiuta un ON CONFLICT che colpisce due
 * volte la stessa riga ("command cannot affect row a second time"), quindi un
 * file con due movimenti identici farebbe fallire l'intero caricamento.
 */
export function mergeIdenticalTranches(buybacks: CallBuybackInsert[]): CallBuybackInsert[] {
  const byKey = new Map<string, CallBuybackInsert>();
  for (const b of buybacks) {
    const key = trancheKey(b);
    const prev = byKey.get(key);
    if (prev) prev.quantity += b.quantity;
    else byKey.set(key, { ...b });
  }
  return Array.from(byKey.values());
}

export interface AvailableCallTicker {
  ticker: string;
  availableContracts: number;
}

export interface AvailableCallResidual extends AvailableCallTicker {
  /** Contratti già registrati come "call da rivendere" (somma delle tranche aperte). */
  registeredContracts: number;
  /** Contratti ancora da registrare: availableContracts − registrati, mai sotto zero. */
  residualContracts: number;
}

/**
 * Scala i contratti disponibili per sottostante di quelli già registrati come
 * "call da rivendere", così la quantità mostrata a video (e prefillata nel form)
 * scende fino a zero mano a mano che si registrano le tranche.
 *
 * Il matching sottostante↔riacquisto usa lo stesso criterio della tabella dei
 * riacquisti visibili (chiave canonica con fallback su inclusione), per evitare
 * che il residuo e la lista mostrata divergano.
 */
export function computeAvailableCallResiduals(
  items: AvailableCallTicker[],
  buybacks: Array<{ underlying: string; quantity: number }>,
  keyOf: (text: string) => string = norm,
): AvailableCallResidual[] {
  return items.map(item => {
    const itemKey = keyOf(item.ticker);
    const registeredContracts = buybacks.reduce((sum, b) => {
      const bKey = keyOf(b.underlying);
      // Chiavi vuote non devono matchare tutto (''.includes('') è true).
      const matches = itemKey && bKey
        ? (itemKey === bKey || itemKey.includes(bKey) || bKey.includes(itemKey))
        : false;
      return matches ? sum + Math.max(0, b.quantity) : sum;
    }, 0);
    return {
      ...item,
      registeredContracts,
      residualContracts: Math.max(0, item.availableContracts - registeredContracts),
    };
  });
}
