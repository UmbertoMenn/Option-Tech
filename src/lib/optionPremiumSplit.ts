/**
 * Premio temporale delle opzioni dai movimenti.
 *
 * Il premio che conta è SOLO il valore temporale. Le vendite di opzioni ITM
 * non nascono mai "a freddo": sono quasi sempre la prosecuzione di una
 * posizione andata ITM, e in quei casi lo spot di riferimento si ricava
 * dagli eseguiti, non dal prezzo di chiusura:
 *
 *  1. Assegnazione → vendita azioni → nuova put: spot = prezzo di vendita
 *     delle azioni assegnate. Tempo = premio nuova put − (strike − prezzo vendita).
 *  2. Roll stesso strike (vecchia ITM ricomprata, nuova venduta): la vecchia è
 *     tutto intrinseco, spot implicito = strike − premio vecchia.
 *     Tempo = premio nuova − premio vecchia.
 *  3. Roll su strike diverso: stesso spot implicito.
 *     Put: tempo = (premio nuova + (strike vecchio − strike nuovo)) − premio vecchia.
 *  4. Vendita ITM senza riferimento (es. covered call sintetica con put ITM):
 *     split dalla chiusura del sottostante, SEGNALATO e correggibile a mano.
 *
 * Le call (covered call rollate ITM, riacquisto azioni dopo assegnazione della
 * call) seguono le stesse regole in modo simmetrico.
 *
 * Ordine di precedenza: correzione manuale > assegnazione > roll > chiusura.
 */
import { splitOptionPremium } from './optionTradeAttribution';
import type { MovementLedgerRow } from './movementLedger';

export type TimeValueMethod =
  | 'manual'
  | 'assignment_resale'
  | 'roll_same_strike'
  | 'roll_new_strike'
  | 'close'
  | 'close_itm_estimate'
  | 'missing';

/** Both OTM and ITM splits based on a daily close are estimates, not executions. */
export const isClosingPriceMethod = (method: TimeValueMethod): boolean =>
  method === 'close' || method === 'close_itm_estimate';

/**
 * Unico caso da segnalare: vendita ITM "da nuova" (senza roll né assegnazione
 * di riferimento), dove il premio temporale viene dalla chiusura. Per tutto il
 * resto il premio temporale è determinato dalle regole (OTM: tutto il premio).
 */
export const needsTimeValueReview = (method: TimeValueMethod): boolean => method === 'close_itm_estimate';

export const TIME_VALUE_METHOD_LABELS: Record<TimeValueMethod, string> = {
  manual: 'Correzione manuale',
  assignment_resale: 'Da vendita azioni assegnate',
  roll_same_strike: 'Roll stesso strike',
  roll_new_strike: 'Roll su strike diverso',
  close: 'Chiusura del sottostante',
  close_itm_estimate: 'Vendita ITM senza roll/assegnazione: chiusura del sottostante',
  missing: 'Prezzo del sottostante mancante',
};

export interface OptionLegInput extends MovementLedgerRow {
  underlyingKey: string | null;
  /** Chiusura del sottostante alla data operazione (o precedente). */
  underlyingPrice: number | null;
  /** Premio temporale per azione impostato a mano (sovrascrive tutto). */
  manualTimeValuePerShare: number | null;
}

export interface OptionPremiumSplit {
  rowKey: string;
  intrinsicPerShare: number | null;
  timeValuePerShare: number | null;
  method: TimeValueMethod;
  /** Spot usato per l'intrinseco (chiusura, implicito dal roll o prezzo di vendita azioni). */
  referenceSpot: number | null;
  /** Descrittore della gamba o del titolo che ha fornito il riferimento. */
  reference: string | null;
  /** Split calcolato senza la correzione manuale (per confronto in UI). */
  automaticTimeValuePerShare: number | null;
}

const EPS = 1e-9;

function intrinsicAt(optionType: 'call' | 'put', strike: number, spot: number): number {
  return optionType === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

function dayDiff(a: string, b: string): number {
  return (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

function legDate(row: MovementLedgerRow): string {
  return row.operationDate || row.effectiveDate;
}

function sameUnderlying(a: OptionLegInput, b: { underlyingKey: string | null; underlyingTicker?: string | null }): boolean {
  const left = a.underlyingKey || a.underlyingTicker;
  const right = b.underlyingKey || b.underlyingTicker;
  return !!left && !!right && left === right;
}

function splitFromSpot(leg: OptionLegInput, spot: number): { intrinsic: number; time: number } {
  const premium = Math.max(0, Number(leg.price || 0));
  const intrinsic = Math.min(premium, intrinsicAt(leg.optionType as 'call' | 'put', Number(leg.strike), spot));
  return { intrinsic, time: Math.max(0, premium - intrinsic) };
}

/**
 * Risolve lo split intrinseco/tempo di ogni compravendita di opzioni del ledger.
 * `stockTrades`: compravendite di azioni del ledger (servono per il caso 1).
 */
export function resolveOptionPremiumSplits(
  rows: OptionLegInput[],
): Map<string, OptionPremiumSplit> {
  const result = new Map<string, OptionPremiumSplit>();
  const legs = rows
    .filter(row =>
      row.scope === 'portfolio'
      && (row.kind === 'buy' || row.kind === 'sell')
      && !!row.descriptor && !!row.optionType && row.strike != null,
    )
    .sort((a, b) => legDate(a).localeCompare(legDate(b)) || a.rowKey.localeCompare(b.rowKey));

  // ---- Base: chiusura del sottostante ----
  for (const leg of legs) {
    const spot = Number(leg.underlyingPrice || 0);
    if (!(spot > 0)) {
      result.set(leg.rowKey, {
        rowKey: leg.rowKey, intrinsicPerShare: null, timeValuePerShare: null,
        method: 'missing', referenceSpot: null, reference: null, automaticTimeValuePerShare: null,
      });
      continue;
    }
    const { intrinsic, time } = splitFromSpot(leg, spot);
    result.set(leg.rowKey, {
      rowKey: leg.rowKey,
      intrinsicPerShare: intrinsic,
      timeValuePerShare: time,
      method: leg.kind === 'sell' && intrinsic > EPS ? 'close_itm_estimate' : 'close',
      referenceSpot: spot,
      reference: null,
      automaticTimeValuePerShare: time,
    });
  }

  const assign = (leg: OptionLegInput, spot: number, method: TimeValueMethod, reference: string) => {
    const { intrinsic, time } = splitFromSpot(leg, spot);
    result.set(leg.rowKey, {
      rowKey: leg.rowKey, intrinsicPerShare: intrinsic, timeValuePerShare: time,
      method, referenceSpot: spot, reference, automaticTimeValuePerShare: time,
    });
  };

  const pairedSells = new Set<string>();
  // ---- Assegnazione → vendita (put) / riacquisto (call) azioni → nuova opzione ----
  const exercises = rows.filter(row =>
    row.scope === 'portfolio' && row.kind === 'option_exercise' && row.positionSide !== 'long'
    && !!row.optionType && row.strike != null,
  );
  const stockTrades = rows.filter(row =>
    row.scope === 'portfolio' && (row.kind === 'buy' || row.kind === 'sell') && !!row.isin,
  );
  for (const exercise of exercises) {
    const isPut = exercise.optionType === 'put';
    const shares = Number(exercise.quantity || 0) * 100;
    const strike = Number(exercise.strike);
    // Azioni entrate/uscite a strike con l'assegnazione → ISIN del sottostante.
    const assignedTrade = stockTrades.find(trade =>
      trade.kind === (isPut ? 'buy' : 'sell')
      && Math.abs(Number(trade.quantity || 0) - shares) < 1e-6
      && Math.abs(Number(trade.price || 0) - strike) <= Math.max(0.005, strike * 1e-4)
      && Math.abs(dayDiff(trade.effectiveDate, exercise.effectiveDate)) <= 3,
    );
    if (!assignedTrade) continue;
    // Operazione opposta sulle azioni nei giorni successivi: il suo prezzo è lo spot.
    const offset = stockTrades
      .filter(trade =>
        trade !== assignedTrade
        && trade.isin === assignedTrade.isin
        && trade.kind === (isPut ? 'sell' : 'buy')
        && dayDiff(trade.effectiveDate, assignedTrade.effectiveDate) >= 0
        && dayDiff(trade.effectiveDate, assignedTrade.effectiveDate) <= 7,
      )
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0];
    if (!offset) continue;
    const spot = Number(offset.price || 0);
    if (!(spot > 0)) continue;
    for (const sell of legs) {
      if (sell.kind !== 'sell' || pairedSells.has(sell.rowKey)) continue;
      if (sell.optionType !== exercise.optionType || !sameUnderlying(sell, exercise)) continue;
      const fromAssignment = dayDiff(legDate(sell), exercise.effectiveDate);
      const fromOffset = dayDiff(legDate(sell), offset.effectiveDate);
      if (fromAssignment < 0 || fromOffset > 3) continue;
      pairedSells.add(sell.rowKey);
      assign(sell, spot, 'assignment_resale', `${offset.description} @ ${spot}`);
    }
  }

  // ---- Roll: ricompra della vecchia ITM + vendita della nuova ----
  const pairedBuys = new Set<string>();
  for (const sell of legs.filter(leg => leg.kind === 'sell' && !pairedSells.has(leg.rowKey))) {
    const candidates = legs.filter(buy =>
      buy.kind === 'buy'
      && !pairedBuys.has(buy.rowKey)
      && buy.optionType === sell.optionType
      && sameUnderlying(buy, sell)
      && buy.descriptor !== sell.descriptor
      && Math.abs(dayDiff(legDate(buy), legDate(sell))) <= 1
      && (!buy.expiryDate || !sell.expiryDate || buy.expiryDate <= sell.expiryDate),
    );
    if (candidates.length === 0) continue;
    const buy = candidates.sort((a, b) =>
      Math.abs(Number(a.quantity || 0) - Number(sell.quantity || 0)) - Math.abs(Number(b.quantity || 0) - Number(sell.quantity || 0))
      || Math.abs(dayDiff(legDate(a), legDate(sell))) - Math.abs(dayDiff(legDate(b), legDate(sell))),
    )[0];
    // Il roll "ITM" si riconosce dalla vecchia gamba: se alla chiusura era OTM
    // il suo premio è tutto tempo e vale la stima standard.
    const buyClose = Number(buy.underlyingPrice || 0);
    const buyPremium = Math.max(0, Number(buy.price || 0));
    const buyStrike = Number(buy.strike);
    const oldItm = buyClose > 0 && intrinsicAt(buy.optionType as 'call' | 'put', buyStrike, buyClose) > EPS;
    if (!oldItm) continue;
    pairedBuys.add(buy.rowKey);
    pairedSells.add(sell.rowKey);
    // Vecchia gamba tutta intrinseco → spot implicito.
    const impliedSpot = buy.optionType === 'call' ? buyStrike + buyPremium : buyStrike - buyPremium;
    const method: TimeValueMethod = Number(sell.strike) === buyStrike ? 'roll_same_strike' : 'roll_new_strike';
    result.set(buy.rowKey, {
      rowKey: buy.rowKey, intrinsicPerShare: buyPremium, timeValuePerShare: 0,
      method, referenceSpot: impliedSpot, reference: sell.descriptor, automaticTimeValuePerShare: 0,
    });
    assign(sell, Math.max(0, impliedSpot), method, buy.descriptor as string);
  }

  // ---- Correzione manuale: prevale su tutto ----
  for (const leg of legs) {
    if (leg.manualTimeValuePerShare == null || !Number.isFinite(leg.manualTimeValuePerShare)) continue;
    const premium = Math.max(0, Number(leg.price || 0));
    const time = Math.min(premium, Math.max(0, leg.manualTimeValuePerShare));
    const previous = result.get(leg.rowKey);
    result.set(leg.rowKey, {
      rowKey: leg.rowKey,
      intrinsicPerShare: premium - time,
      timeValuePerShare: time,
      method: 'manual',
      referenceSpot: previous?.referenceSpot ?? null,
      reference: previous ? TIME_VALUE_METHOD_LABELS[previous.method] : null,
      automaticTimeValuePerShare: previous?.automaticTimeValuePerShare ?? null,
    });
  }

  return result;
}
