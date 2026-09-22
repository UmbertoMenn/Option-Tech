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
 *  4. Operazione sulle azioni dello stesso sottostante entro un giorno (es.
 *     vendita delle azioni e vendita della put ITM): spot = prezzo delle azioni.
 *  5. De-risking di covered call sintetica, riconosciuto dalla put comprata
 *     sullo stesso sottostante: split dalla chiusura, senza segnalazione.
 *  6. Unico caso non determinabile: put ITM venduta come covered call
 *     sintetica su un titolo non posseduto, senza roll/assegnazione/put
 *     comprata. Split dalla chiusura, SEGNALATO e correggibile a mano.
 *
 * Un roll richiede che la gamba ricomprata fosse davvero short (snapshot
 * precedente o vendita nel ledger): una put comprata "da nuova" è una
 * copertura (de-risking), non la chiusura di un roll.
 *
 * Le call (covered call rollate ITM, riacquisto azioni dopo assegnazione della
 * call) seguono le regole di roll e assegnazione in modo simmetrico.
 *
 * Precedenza: correzione manuale > assegnazione > roll > operazione azioni > chiusura.
 */
import { splitOptionPremium } from './optionTradeAttribution';
import type { MovementLedgerRow } from './movementLedger';

export type TimeValueMethod =
  | 'manual'
  | 'assignment_resale'
  | 'roll_same_strike'
  | 'roll_new_strike'
  | 'stock_trade'
  | 'close'
  | 'close_derisking'
  | 'close_itm_estimate'
  | 'missing';

/** Both OTM and ITM splits based on a daily close are estimates, not executions. */
export const isClosingPriceMethod = (method: TimeValueMethod): boolean =>
  method === 'close' || method === 'close_derisking' || method === 'close_itm_estimate';

/**
 * Unico caso da segnalare: put ITM venduta come covered call sintetica su un
 * titolo non posseduto, senza roll, assegnazione, operazione sulle azioni o
 * put comprata di riferimento. Tutto il resto è determinato dalle regole.
 */
export const needsTimeValueReview = (method: TimeValueMethod): boolean => method === 'close_itm_estimate';

export const TIME_VALUE_METHOD_LABELS: Record<TimeValueMethod, string> = {
  manual: 'Correzione manuale',
  assignment_resale: 'Da vendita azioni assegnate',
  roll_same_strike: 'Roll stesso strike',
  roll_new_strike: 'Roll su strike diverso',
  stock_trade: 'Da operazione sulle azioni',
  close: 'Chiusura del sottostante',
  close_derisking: 'De-risking con put comprata: chiusura del sottostante',
  close_itm_estimate: 'Put ITM venduta senza sottostante in portafoglio: chiusura del sottostante',
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

export interface SnapshotShortOption {
  key: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string | null;
}

/** Contesto di portafoglio dagli snapshot (chiavi canoniche del sottostante). */
export interface SplitPortfolioContext {
  snapshots: {
    date: string;
    /** Azioni/ETF possedute (quantità > 0). */
    heldKeys: Set<string>;
    /** Opzioni short aperte. */
    shortOptions: SnapshotShortOption[];
  }[];
  /** ISIN azione → chiave canonica del sottostante. */
  isinToKey: Map<string, string>;
}

function latestSnapshot(context: SplitPortfolioContext | undefined, date: string, inclusive: boolean) {
  if (!context) return null;
  let best: SplitPortfolioContext['snapshots'][number] | null = null;
  for (const snapshot of context.snapshots) {
    const ok = inclusive ? snapshot.date <= date : snapshot.date < date;
    if (ok && (!best || snapshot.date > best.date)) best = snapshot;
  }
  return best;
}

/**
 * Risolve lo split intrinseco/tempo di ogni compravendita di opzioni del ledger.
 * `context` (facoltativo) distingue roll e coperture e riconosce se il
 * sottostante è in portafoglio.
 */
export function resolveOptionPremiumSplits(
  rows: OptionLegInput[],
  context?: SplitPortfolioContext,
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
  const resolvedLegs = new Set<string>();
  const assignmentStockTrades = new Set<string>();
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
    assignmentStockTrades.add(assignedTrade.rowKey);
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
      resolvedLegs.add(sell.rowKey);
      assign(sell, spot, 'assignment_resale', `${offset.description} @ ${spot}`);
    }
  }

  // ---- Roll: ricompra della vecchia ITM + vendita della nuova ----
  // La gamba ricomprata deve chiudere uno short: visibile nello snapshot
  // precedente o come vendita precedente nel ledger. Senza snapshot
  // precedenti non si può escludere, e si assume il roll.
  const wasShortBefore = (buy: OptionLegInput): boolean => {
    const date = legDate(buy);
    const soldBefore = legs.some(other =>
      other.kind === 'sell' && other.descriptor === buy.descriptor && legDate(other) < date,
    );
    if (soldBefore) return true;
    const snapshot = latestSnapshot(context, date, false);
    if (!snapshot) return true;
    const key = buy.underlyingKey || buy.underlyingTicker;
    return snapshot.shortOptions.some(option =>
      option.key === key
      && option.optionType === buy.optionType
      && Math.abs(option.strike - Number(buy.strike)) < 1e-6
      && (!option.expiry || !buy.expiryDate || Math.abs(dayDiff(option.expiry, buy.expiryDate)) <= 3),
    );
  };
  const pairedBuys = new Set<string>();
  for (const sell of legs.filter(leg => leg.kind === 'sell' && !pairedSells.has(leg.rowKey))) {
    const candidates = legs.filter(buy =>
      buy.kind === 'buy'
      && !pairedBuys.has(buy.rowKey)
      && buy.optionType === sell.optionType
      && sameUnderlying(buy, sell)
      && buy.descriptor !== sell.descriptor
      && Math.abs(dayDiff(legDate(buy), legDate(sell))) <= 1
      && (!buy.expiryDate || !sell.expiryDate || buy.expiryDate <= sell.expiryDate)
      && wasShortBefore(buy),
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
    resolvedLegs.add(buy.rowKey);
    resolvedLegs.add(sell.rowKey);
    // Vecchia gamba tutta intrinseco → spot implicito.
    const impliedSpot = buy.optionType === 'call' ? buyStrike + buyPremium : buyStrike - buyPremium;
    const method: TimeValueMethod = Number(sell.strike) === buyStrike ? 'roll_same_strike' : 'roll_new_strike';
    result.set(buy.rowKey, {
      rowKey: buy.rowKey, intrinsicPerShare: buyPremium, timeValuePerShare: 0,
      method, referenceSpot: impliedSpot, reference: sell.descriptor, automaticTimeValuePerShare: 0,
    });
    assign(sell, Math.max(0, impliedSpot), method, buy.descriptor as string);
  }

  // ---- Operazione sulle azioni dello stesso sottostante entro un giorno ----
  const stockKey = (trade: OptionLegInput) =>
    (trade.isin && context?.isinToKey.get(trade.isin)) || trade.underlyingKey;
  for (const leg of legs) {
    if (resolvedLegs.has(leg.rowKey)) continue;
    const key = leg.underlyingKey || leg.underlyingTicker;
    const trade = stockTrades
      .filter(candidate =>
        !assignmentStockTrades.has(candidate.rowKey)
        && Number(candidate.price || 0) > 0
        && !!key && stockKey(candidate) === key
        && Math.abs(dayDiff(candidate.effectiveDate, legDate(leg))) <= 1,
      )
      .sort((a, b) =>
        Math.abs(dayDiff(a.effectiveDate, legDate(leg))) - Math.abs(dayDiff(b.effectiveDate, legDate(leg))),
      )[0];
    if (!trade) continue;
    resolvedLegs.add(leg.rowKey);
    const spot = Number(trade.price);
    assign(leg, spot, 'stock_trade', `${trade.kind === 'buy' ? 'Acquisto' : 'Vendita'} ${trade.description} @ ${spot}`);
  }

  // ---- Vendite ITM rimaste sulla chiusura: segnalare solo il caso indeterminabile ----
  for (const leg of legs) {
    const split = result.get(leg.rowKey);
    if (!split || split.method !== 'close_itm_estimate') continue;
    if (leg.optionType !== 'put') {
      result.set(leg.rowKey, { ...split, method: 'close' });
      continue;
    }
    const key = leg.underlyingKey || leg.underlyingTicker;
    // De-risking: put comprata sullo stesso sottostante entro un giorno.
    const hedge = legs.find(other =>
      other.kind === 'buy'
      && other.optionType === 'put'
      && !pairedBuys.has(other.rowKey)
      && sameUnderlying(other, leg)
      && Math.abs(dayDiff(legDate(other), legDate(leg))) <= 1,
    );
    if (hedge) {
      result.set(leg.rowKey, { ...split, method: 'close_derisking', reference: hedge.descriptor });
      continue;
    }
    // Sottostante già in portafoglio: non è una covered call sintetica "nuda".
    const snapshot = latestSnapshot(context, legDate(leg), true);
    if (key && snapshot?.heldKeys.has(key)) {
      result.set(leg.rowKey, { ...split, method: 'close', reference: 'Sottostante in portafoglio' });
    }
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
