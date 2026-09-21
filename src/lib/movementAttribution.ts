/**
 * Traduce il ledger movimenti (file FlussoMovContiCash / FlussoMovContiTit)
 * negli input del motore di attribuzione:
 *  - trades: compravendite per classe (azioni/ETF/obbligazioni/opzioni) e
 *    assegnazioni/esercizi (ASG) ricostruiti appaiando l'esercizio
 *    dell'opzione con l'acquisto/vendita a strike del sottostante;
 *  - cashEvents: proventi (dividendi, cedole) e costi (commissioni, spese,
 *    commissioni valutarie, ritenute, bolli, imposta capital gain);
 *  - positionEvents: scadenze/esercizi che spiegano la sparizione delle opzioni.
 *
 * Funzione pura: nessun accesso a DB o rete.
 */
import { FullSnapshot } from './fullSnapshot';
import { optionBasisKey } from './costBasis';
import { isETF } from './excelParser';
import { AttributionPriceSource } from './optionTradeAttribution';
import type {
  AttributionCashEvent,
  AttributionCategory,
  AttributionMovementCoverage,
  AttributionPositionEvent,
  AttributionTradeRow,
} from './performanceAttribution';
import type { MovementLedgerRow, MovementSource } from './movementLedger';
import { OptionPremiumSplit, TimeValueMethod, resolveOptionPremiumSplits } from './optionPremiumSplit';

export interface StoredMovementRow extends MovementLedgerRow {
  /** Chiave canonica del sottostante (opzioni) o del titolo (azioni). */
  underlyingKey: string | null;
  underlyingPrice: number | null;
  intrinsicPerShare: number | null;
  timeValuePerShare: number | null;
  attributionPriceSource: AttributionPriceSource | null;
  /** Premio temporale per azione impostato a mano (null = automatico). */
  manualTimeValuePerShare: number | null;
}

/** Riga per la verifica/correzione dei premi temporali in UI. */
export interface OptionPremiumReviewRow {
  rowKey: string;
  date: string;
  descriptor: string;
  side: 'ACQ' | 'VEN';
  contracts: number;
  premiumPerShare: number;
  currency: string;
  exchangeRate: number;
  method: TimeValueMethod;
  referenceSpot: number | null;
  reference: string | null;
  intrinsicPerShare: number | null;
  timeValuePerShare: number | null;
  automaticTimeValuePerShare: number | null;
  manualTimeValuePerShare: number | null;
}

const METHOD_SOURCE: Partial<Record<TimeValueMethod, AttributionPriceSource>> = {
  manual: 'manual',
  assignment_resale: 'assignment_sale',
  roll_same_strike: 'roll_implied',
  roll_new_strike: 'roll_implied',
  close_itm_estimate: 'close_itm_estimate',
};

export interface MovementUploadRecord {
  source: MovementSource;
  periodStart: string;
  periodEnd: string;
}

export interface DateWindow {
  start: string;
  end: string;
}

export interface MovementNote {
  date: string;
  amount: number;
  description: string;
}

export interface MovementAttributionInputs {
  trades: AttributionTradeRow[];
  cashEvents: AttributionCashEvent[];
  positionEvents: AttributionPositionEvent[];
  titoliWindows: DateWindow[];
  cashWindows: DateWindow[];
  /** Bonifici/giroconti del conto in perimetro: confronto con il registro versamenti. */
  externalTransfers: MovementNote[];
  /** Movimenti cash non classificati: restano nella riga Liquidità. */
  unclassifiedCash: MovementNote[];
  /** Movimenti titoli con causale non gestita. */
  unhandledTitoli: MovementNote[];
  /** Esercizi di opzioni senza il corrispondente acquisto/vendita a strike. */
  unmatchedExercises: MovementNote[];
  /** Movimenti interni alla GP: già inclusi nel valore della gestione. */
  gpInternal: MovementNote[];
  /**
   * Righe cash che replicano un evento titoli il cui file non è stato caricato
   * (es. coda del mese precedente). Compravendite, proventi, ritenute e spese
   * vengono ricostruiti dalla riga cash; i premi opzioni restano solo avviso.
   */
  orphanCash: MovementNote[];
  orphanOptionPremiums: MovementNote[];
  /** All option trades, including OTM closing-price estimates, for review. */
  premiumReview: OptionPremiumReviewRow[];
}

const EQUITY_LIKE: AttributionCategory[] = ['stock', 'etf', 'bond', 'commodity'];

function isEquityLike(category: string | undefined): category is AttributionCategory {
  return !!category && (EQUITY_LIKE as string[]).includes(category);
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

/** Classe dei titoli per ISIN dagli snapshot (fonte primaria, coerente con i valori T0/T1). */
function snapshotCategoryByIsin(snapshots: FullSnapshot[]): Map<string, AttributionCategory> {
  const map = new Map<string, AttributionCategory>();
  for (const snapshot of snapshots) {
    for (const position of snapshot.positions) {
      if (position.asset_type === 'derivative' || !position.isin) continue;
      if (isEquityLike(position.asset_type)) map.set(position.isin.toUpperCase(), position.asset_type);
    }
  }
  return map;
}

/**
 * Classe di un titolo mai presente negli snapshot (es. comprato e venduto
 * nello stesso periodo). Obbligazione se il controvalore è quantità × prezzo
 * / 100 (quotazione in percentuale del nominale) o se ha staccato cedole.
 */
function heuristicCategory(row: StoredMovementRow, couponIsins: Set<string>): AttributionCategory {
  const description = row.description.toUpperCase();
  if (/\bETC\b/.test(description)) return 'commodity';
  if (isETF(row.description, row.isin ?? undefined)) return 'etf';
  if (row.isin && couponIsins.has(row.isin)) return 'bond';
  const quantity = Number(row.quantity || 0);
  const price = Number(row.price || 0);
  const grossLocal = row.grossEur * Number(row.exchangeRate || 1);
  if (quantity > 0 && price > 0 && grossLocal > 0) {
    const asPercent = Math.abs(grossLocal - quantity * price / 100);
    const asUnits = Math.abs(grossLocal - quantity * price);
    if (asPercent < asUnits) return 'bond';
  }
  return 'stock';
}

function windowsFor(
  source: MovementSource,
  uploads: MovementUploadRecord[],
  rows: StoredMovementRow[],
): DateWindow[] {
  const fromUploads = uploads
    .filter(upload => upload.source === source && upload.periodStart && upload.periodEnd)
    .map(upload => ({ start: upload.periodStart, end: upload.periodEnd }));
  if (fromUploads.length > 0) return mergeWindows(fromUploads);
  // Fallback: periodo dichiarato nelle righe stesse.
  const fromRows = rows
    .filter(row => row.source === source && row.periodStart && row.periodEnd)
    .map(row => ({ start: row.periodStart as string, end: row.periodEnd as string }));
  return mergeWindows(fromRows);
}

export function mergeWindows(windows: DateWindow[]): DateWindow[] {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const merged: DateWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    // Finestre sovrapposte o contigue (fine 31/08, inizio 01/09) si fondono.
    const touches = !!last && (window.start <= last.end || dayDiff(last.end, window.start) <= 1);
    if (last && touches) {
      if (window.end > last.end) last.end = window.end;
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

export function isDateCovered(date: string, windows: DateWindow[]): boolean {
  return windows.some(window => date >= window.start && date <= window.end);
}

/** Copertura del periodo (T0, T1] da parte delle finestre dei file caricati. */
export function periodCoverage(windows: DateWindow[], startDate: string, endDate: string): 'full' | 'partial' | 'none' {
  if (windows.length === 0) return 'none';
  let covered = 0;
  let total = 0;
  const cursor = new Date(`${startDate}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (cursor <= end) {
    total += 1;
    if (isDateCovered(cursor.toISOString().slice(0, 10), windows)) covered += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (total === 0 || covered === 0) return 'none';
  return covered === total ? 'full' : 'partial';
}

export function buildMovementCoverage(
  inputs: Pick<MovementAttributionInputs, 'titoliWindows' | 'cashWindows'>,
  startDate: string,
  endDate: string,
): AttributionMovementCoverage {
  return {
    hasUploads: inputs.titoliWindows.length > 0 || inputs.cashWindows.length > 0,
    titoli: periodCoverage(inputs.titoliWindows, startDate, endDate),
    cash: periodCoverage(inputs.cashWindows, startDate, endDate),
  };
}

/**
 * Le operazioni del vecchio ledger (`cost_basis_trades`) con data dentro una
 * finestra coperta dai movimenti titoli sono sostituite dai movimenti: tenerle
 * entrambe raddoppierebbe i flussi (es. assegnazione rilevata dallo snapshot
 * e acquisto a strike del file movimenti).
 */
export function mergeLegacyTrades(
  movementTrades: AttributionTradeRow[],
  legacyTrades: AttributionTradeRow[],
  titoliWindows: DateWindow[],
): AttributionTradeRow[] {
  return [
    ...movementTrades,
    ...legacyTrades.filter(trade => !isDateCovered(trade.trade_date, titoliWindows)),
  ];
}

function note(row: StoredMovementRow, amount: number): MovementNote {
  return { date: row.effectiveDate, amount, description: row.description || row.causaleDescription || row.causale };
}

export function buildMovementAttributionInputs(input: {
  rows: StoredMovementRow[];
  uploads: MovementUploadRecord[];
  snapshots: FullSnapshot[];
}): MovementAttributionInputs {
  const { rows, uploads, snapshots } = input;
  const result: MovementAttributionInputs = {
    trades: [],
    cashEvents: [],
    positionEvents: [],
    titoliWindows: windowsFor('titoli', uploads, rows),
    cashWindows: windowsFor('cash', uploads, rows),
    externalTransfers: [],
    unclassifiedCash: [],
    unhandledTitoli: [],
    unmatchedExercises: [],
    gpInternal: [],
    orphanCash: [],
    orphanOptionPremiums: [],
    premiumReview: [],
  };
  const splits: Map<string, OptionPremiumSplit> = resolveOptionPremiumSplits(rows);

  const categoryByIsin = snapshotCategoryByIsin(snapshots);
  const couponIsins = new Set(
    rows.filter(row => row.kind === 'coupon' && row.isin).map(row => row.isin as string),
  );
  const categoryOf = (row: StoredMovementRow): AttributionCategory =>
    (row.isin && categoryByIsin.get(row.isin)) || heuristicCategory(row, couponIsins);

  const portfolioRows = rows.filter(row => row.scope === 'portfolio');
  for (const row of rows) {
    if (row.scope === 'gp' && (row.netEur !== 0 || row.grossEur !== 0)) {
      result.gpInternal.push(note(row, row.netEur));
    }
  }

  // ---- Esercizi/assegnazioni: appaiamento con la compravendita a strike ----
  const stockTrades = portfolioRows.filter(row =>
    (row.kind === 'buy' || row.kind === 'sell') && !!row.isin,
  );
  const consumedStockTrades = new Set<StoredMovementRow>();
  const assignmentTrades: AttributionTradeRow[] = [];
  for (const exercise of portfolioRows.filter(row => row.kind === 'option_exercise')) {
    const strike = Number(exercise.strike || 0);
    const shares = Number(exercise.quantity || 0) * 100;
    const isShort = exercise.positionSide !== 'long';
    const isPut = exercise.optionType === 'put';
    // put venduta / call acquistata → acquisto azioni; call venduta / put acquistata → vendita
    const expectedKind = isPut === isShort ? 'buy' : 'sell';
    const candidates = stockTrades.filter(trade =>
      !consumedStockTrades.has(trade)
      && trade.kind === expectedKind
      && Math.abs(Number(trade.quantity || 0) - shares) < 1e-6
      && Math.abs(Number(trade.price || 0) - strike) <= Math.max(0.005, strike * 1e-4)
      && dayDiff(trade.effectiveDate, exercise.effectiveDate) <= 3,
    );
    const sameUnderlying = candidates.filter(trade =>
      !!trade.underlyingKey && trade.underlyingKey === exercise.underlyingKey,
    );
    const pool = sameUnderlying.length > 0 ? sameUnderlying : candidates;
    const match = pool.sort((a, b) =>
      dayDiff(a.effectiveDate, exercise.effectiveDate) - dayDiff(b.effectiveDate, exercise.effectiveDate),
    )[0];
    result.positionEvents.push({ date: exercise.effectiveDate, categories: ['option_time', 'option_intrinsic'] });
    if (!match) {
      result.unmatchedExercises.push(note(exercise, 0));
      continue;
    }
    consumedStockTrades.add(match);
    const category = categoryOf(match);
    assignmentTrades.push({
      basis_key: (match.isin as string).toUpperCase(),
      trade_date: match.effectiveDate,
      side: 'ASG',
      quantity: shares,
      price: strike,
      kind: 'movement_exercise',
      asset_type: category,
      underlying_key: exercise.underlyingKey ?? match.underlyingKey,
      option_type: exercise.optionType,
      strike,
      expiry_date: exercise.expiryDate,
      currency: match.currency,
      exchange_rate: match.exchangeRate,
      gross_eur: match.grossEur,
      underlying_price: exercise.underlyingPrice,
      attribution_price_source: exercise.attributionPriceSource,
      position_side: exercise.positionSide ?? 'short',
    });
  }
  result.trades.push(...assignmentTrades);

  for (const row of portfolioRows) {
    switch (row.kind) {
      case 'buy':
      case 'sell': {
        const side = row.kind === 'buy' ? 'ACQ' : 'VEN';
        const isOption = !!row.descriptor && !!row.optionType && row.strike != null && !!row.expiryDate;
        if (isOption) {
          const underlyingKey = row.underlyingKey || row.underlyingTicker || row.descriptor || '';
          const split = splits.get(row.rowKey);
          const hasSplit = split?.intrinsicPerShare != null && split?.timeValuePerShare != null;
          // Include OTM trades too: they also use the closing-price fallback.
          if (split) {
            result.premiumReview.push({
              rowKey: row.rowKey,
              date: row.effectiveDate,
              descriptor: row.descriptor as string,
              side,
              contracts: Number(row.quantity || 0),
              premiumPerShare: Number(row.price || 0),
              currency: row.currency,
              exchangeRate: Number(row.exchangeRate || 1) || 1,
              method: split.method,
              referenceSpot: split.referenceSpot,
              reference: split.reference,
              intrinsicPerShare: split.intrinsicPerShare,
              timeValuePerShare: split.timeValuePerShare,
              automaticTimeValuePerShare: split.automaticTimeValuePerShare,
              manualTimeValuePerShare: row.manualTimeValuePerShare,
            });
          }
          result.trades.push({
            basis_key: optionBasisKey(underlyingKey, row.optionType as 'call' | 'put', Number(row.strike), row.expiryDate as string),
            trade_date: row.effectiveDate,
            side,
            quantity: Number(row.quantity || 0),
            price: Number(row.price || 0),
            kind: 'movement',
            asset_type: 'derivative',
            underlying_key: underlyingKey,
            option_type: row.optionType,
            strike: row.strike,
            expiry_date: row.expiryDate,
            currency: row.currency,
            exchange_rate: row.exchangeRate,
            gross_eur: row.grossEur,
            underlying_price: row.underlyingPrice,
            // Split risolto con il contesto (roll/assegnazione/manuale); senza
            // prezzo del sottostante il motore ripiega sugli snapshot.
            intrinsic_per_share: hasSplit ? split!.intrinsicPerShare : null,
            time_value_per_share: hasSplit ? split!.timeValuePerShare : null,
            attribution_price_source: (split ? METHOD_SOURCE[split.method] : undefined) ?? row.attributionPriceSource,
          });
          pushTradeCosts(result, row, 'Commissioni opzioni');
          break;
        }
        if (!row.isin) {
          result.unhandledTitoli.push(note(row, row.netEur));
          break;
        }
        pushTradeCosts(result, row, 'Commissioni compravendita titoli');
        if (consumedStockTrades.has(row)) break; // già rappresentata come ASG
        result.trades.push({
          basis_key: row.isin.toUpperCase(),
          trade_date: row.effectiveDate,
          side,
          quantity: Number(row.quantity || 0),
          price: Number(row.price || 0),
          kind: 'movement',
          asset_type: categoryOf(row),
          currency: row.currency,
          exchange_rate: row.exchangeRate,
          // Il rateo pagato/incassato fa parte del valore dell'obbligazione negli snapshot.
          gross_eur: row.grossEur + row.accruedEur,
        });
        break;
      }
      case 'option_expiry':
        result.positionEvents.push({ date: row.effectiveDate, categories: ['option_time', 'option_intrinsic'] });
        break;
      case 'option_exercise':
        break; // gestito sopra
      case 'dividend':
      case 'coupon': {
        const category = row.isin && categoryByIsin.get(row.isin)
          ? categoryByIsin.get(row.isin) as AttributionCategory
          : row.kind === 'coupon' ? 'bond' : categoryOf(row);
        result.cashEvents.push({
          date: row.effectiveDate,
          kind: 'income',
          category,
          amount: row.grossEur,
          label: row.kind === 'dividend' ? 'Dividendi (lordi)' : 'Cedole (lorde)',
        });
        pushIncomeCosts(result, row);
        break;
      }
      case 'titoli_other':
        result.unhandledTitoli.push(note(row, row.netEur));
        break;
      case 'bolli':
        result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'taxes', amount: -row.netEur, label: 'Imposta di bollo' });
        break;
      case 'capital_gain_tax':
        result.cashEvents.push({
          date: row.effectiveDate,
          kind: 'cost',
          category: 'capital_gain_tax',
          amount: -row.netEur,
          label: row.netEur < 0 ? 'Addebiti imposta capital gain' : 'Accrediti imposta capital gain',
        });
        break;
      case 'fee':
        result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'fees', amount: -row.netEur, label: 'Canoni e commissioni di conto' });
        break;
      case 'external_transfer':
        result.externalTransfers.push(note(row, row.netEur));
        break;
      case 'cash_other':
        result.unclassifiedCash.push(note(row, row.netEur));
        break;
      case 'interest':
      case 'internal_transfer':
      case 'covered_by_titoli':
      default:
        break;
    }
  }

  applyOrphanCashFallback(result, portfolioRows, snapshots, categoryByIsin);
  return result;
}

// ============================================================================
// Righe cash "coperte" senza il corrispondente movimento titoli
// ============================================================================

const CAUSALE = {
  buySecurities: '71000019',
  sellSecurities: '71000027',
  optionExercise: '71000030',
  dividend: '71000023',
  coupon: '71000014',
  withholding: '71000012',
  incomeFees: '71000066',
  fxFees: '71000015',
  derivativeFees: '76000005',
  derivativeCredit: '76000008',
  derivativeDebit: '76000010',
};

const near = (a: number, b: number, tolerance = 0.05) => Math.abs(Math.abs(a) - Math.abs(b)) <= tolerance;

/** "ACQUISTO TITOLI - META PLATFORMS INC" → "META PLATFORMS INC" */
function tailName(description: string): string {
  const parts = description.split(' - ');
  return normalizeName(parts[parts.length - 1] || description);
}

function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/^AZ\./, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function daysBefore(later: string, earlier: string): number {
  return (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / 86_400_000;
}

/** Posizione degli snapshot con lo stesso nome (per le righe cash senza ISIN). */
function findSnapshotPositionByName(
  snapshots: FullSnapshot[],
  name: string,
  date: string,
): { isin: string | null; category: AttributionCategory } | null {
  if (!name) return null;
  const ordered = [...snapshots].sort((a, b) =>
    Math.abs(daysBefore(a.snapshot_date, date)) - Math.abs(daysBefore(b.snapshot_date, date)),
  );
  for (const snapshot of ordered) {
    for (const position of snapshot.positions) {
      if (position.asset_type === 'derivative' || !isEquityLike(position.asset_type)) continue;
      const candidate = normalizeName(position.description || '');
      if (candidate && (candidate === name || candidate.startsWith(name) || name.startsWith(candidate))) {
        return { isin: position.isin ? position.isin.toUpperCase() : null, category: position.asset_type };
      }
    }
  }
  return null;
}

function applyOrphanCashFallback(
  result: MovementAttributionInputs,
  rows: StoredMovementRow[],
  snapshots: FullSnapshot[],
  categoryByIsin: Map<string, AttributionCategory>,
): void {
  const covered = rows.filter(row => row.source === 'cash' && row.kind === 'covered_by_titoli');
  if (covered.length === 0) return;
  const titoli = rows.filter(row => row.source === 'titoli');
  const trades = titoli.filter(row => (row.kind === 'buy' || row.kind === 'sell') && !!row.isin);
  const income = titoli.filter(row => row.kind === 'dividend' || row.kind === 'coupon');
  const optionTrades = titoli.filter(row => (row.kind === 'buy' || row.kind === 'sell') && !!row.descriptor);

  // Premi e commissioni opzioni: la banca li addebita per data operazione, in
  // un'unica riga giornaliera (netto dei premi / totale commissioni).
  const premiumByOpDate = new Map<string, number>();
  const feesByOpDate = new Map<string, number>();
  for (const row of optionTrades) {
    const date = row.operationDate || row.effectiveDate;
    premiumByOpDate.set(date, (premiumByOpDate.get(date) ?? 0) + (row.kind === 'sell' ? row.grossEur : -row.grossEur));
    feesByOpDate.set(date, (feesByOpDate.get(date) ?? 0) + row.commissionEur + row.fxCommissionEur);
  }
  const usedPremiumDates = new Set<string>();
  const usedFeeDates = new Set<string>();
  const matchDaily = (map: Map<string, number>, used: Set<string>, amount: number, date: string) => {
    for (const [opDate, value] of map) {
      if (used.has(opDate)) continue;
      const lag = daysBefore(date, opDate);
      if (lag < 0 || lag > 10) continue;
      if (Math.abs(value - amount) <= 0.05) {
        used.add(opDate);
        return true;
      }
    }
    return false;
  };

  const usedTitoli = new Set<StoredMovementRow>();
  const takeTitoli = (candidates: StoredMovementRow[], predicate: (row: StoredMovementRow) => boolean) => {
    const match = candidates.find(row => !usedTitoli.has(row) && predicate(row));
    if (match) usedTitoli.add(match);
    return !!match;
  };

  for (const row of covered) {
    const date = row.bookingDate || row.effectiveDate;
    const amount = row.netEur;
    const withinDays = (other: StoredMovementRow, days: number) =>
      dayDiff(other.bookingDate || other.effectiveDate, date) <= days;
    switch (row.causale) {
      case CAUSALE.buySecurities:
      case CAUSALE.sellSecurities:
      case CAUSALE.optionExercise: {
        if (takeTitoli(trades, other => near(other.netEur, amount) && withinDays(other, 7))) break;
        const match = findSnapshotPositionByName(snapshots, tailName(row.description), date);
        const side = amount < 0 ? 'ACQ' : 'VEN';
        result.trades.push({
          basis_key: match?.isin ?? `NAME:${tailName(row.description)}`,
          trade_date: date,
          side,
          quantity: 0,
          price: 0,
          kind: 'movement_cash_fallback',
          asset_type: match?.category ?? 'unclassified',
          exchange_rate: 1,
          // Importo netto: le commissioni non sono separabili dalla sola riga cash.
          gross_eur: Math.abs(amount),
        });
        result.orphanCash.push(note(row, amount));
        break;
      }
      case CAUSALE.dividend:
      case CAUSALE.coupon: {
        if (takeTitoli(income, other => other.isin === row.isin && near(other.grossEur, amount) && withinDays(other, 15))) break;
        const isCoupon = row.causale === CAUSALE.coupon;
        result.cashEvents.push({
          date,
          kind: 'income',
          category: (row.isin && categoryByIsin.get(row.isin)) || (isCoupon ? 'bond' : 'stock'),
          amount,
          label: isCoupon ? 'Cedole (lorde)' : 'Dividendi (lordi)',
        });
        result.orphanCash.push(note(row, amount));
        break;
      }
      case CAUSALE.withholding: {
        const matched = income.some(other => other.isin === row.isin && near(other.taxEur, amount) && withinDays(other, 15));
        if (matched) break;
        result.cashEvents.push({ date, kind: 'cost', category: 'taxes', amount: -amount, label: 'Ritenute su dividendi e cedole' });
        result.orphanCash.push(note(row, amount));
        break;
      }
      case CAUSALE.incomeFees:
      case CAUSALE.fxFees: {
        const name = tailName(row.description);
        const matched = income.some(other =>
          withinDays(other, 3)
          && (row.causale === CAUSALE.incomeFees ? near(other.commissionEur, amount) : near(other.fxCommissionEur, amount))
          && (!name || normalizeName(other.description).startsWith(name) || name.startsWith(normalizeName(other.description))),
        );
        if (matched) break;
        result.cashEvents.push({ date, kind: 'cost', category: 'fees', amount: -amount, label: 'Spese e commissioni su proventi' });
        result.orphanCash.push(note(row, amount));
        break;
      }
      case CAUSALE.derivativeFees: {
        if (matchDaily(feesByOpDate, usedFeeDates, Math.abs(amount), date)) break;
        result.cashEvents.push({ date, kind: 'cost', category: 'fees', amount: -amount, label: 'Commissioni opzioni' });
        result.orphanCash.push(note(row, amount));
        break;
      }
      case CAUSALE.derivativeCredit:
      case CAUSALE.derivativeDebit: {
        if (matchDaily(premiumByOpDate, usedPremiumDates, amount, date)) break;
        result.orphanOptionPremiums.push(note(row, amount));
        break;
      }
      default:
        break;
    }
  }
}

function pushTradeCosts(result: MovementAttributionInputs, row: StoredMovementRow, label: string): void {
  const fees = row.commissionEur + row.fxCommissionEur + row.unexplainedChargeEur;
  if (fees) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'fees', amount: fees, label });
  if (row.taxEur) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'taxes', amount: row.taxEur, label: 'Imposte su operazioni' });
  if (row.bolliEur) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'taxes', amount: row.bolliEur, label: 'Imposta di bollo' });
}

function pushIncomeCosts(result: MovementAttributionInputs, row: StoredMovementRow): void {
  const fees = row.commissionEur + row.fxCommissionEur + row.unexplainedChargeEur;
  if (fees) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'fees', amount: fees, label: 'Spese e commissioni su proventi' });
  if (row.taxEur) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'taxes', amount: row.taxEur, label: 'Ritenute su dividendi e cedole' });
  if (row.bolliEur) result.cashEvents.push({ date: row.effectiveDate, kind: 'cost', category: 'taxes', amount: row.bolliEur, label: 'Imposta di bollo' });
}

/** Avvisi del periodo legati ai movimenti (copertura, bonifici, voci non classificate). */
export function movementPeriodWarnings(
  inputs: MovementAttributionInputs,
  startDate: string,
  endDate: string,
  depositsInPeriod: number,
): string[] {
  const warnings: string[] = [];
  const hasUploads = inputs.titoliWindows.length > 0 || inputs.cashWindows.length > 0;
  if (!hasUploads) return warnings;
  const inPeriod = (date: string) => date > startDate && date <= endDate;
  const sum = (notes: MovementNote[]) => notes.filter(n => inPeriod(n.date)).reduce((s, n) => s + n.amount, 0);
  const count = (notes: MovementNote[]) => notes.filter(n => inPeriod(n.date)).length;
  const eur = (value: number) => `${value.toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`;

  const titoli = periodCoverage(inputs.titoliWindows, startDate, endDate);
  const cash = periodCoverage(inputs.cashWindows, startDate, endDate);
  if (titoli !== 'full') {
    warnings.push(titoli === 'none'
      ? 'Movimenti titoli non caricati per il periodo: flussi per classe ricostruiti solo dal ledger storico'
      : 'I movimenti titoli caricati coprono solo una parte del periodo');
  }
  if (cash !== 'full') {
    warnings.push(cash === 'none'
      ? 'Movimenti cash non caricati per il periodo: bolli e imposta capital gain non ricostruiti'
      : 'I movimenti cash caricati coprono solo una parte del periodo');
  }

  const external = sum(inputs.externalTransfers);
  if (count(inputs.externalTransfers) > 0 && Math.abs(external - depositsInPeriod) >= 1) {
    warnings.push(`Bonifici/giroconti nei movimenti cash: ${eur(external)}; versamenti/prelievi registrati: ${eur(depositsInPeriod)}`);
  }
  if (count(inputs.unclassifiedCash) > 0) {
    warnings.push(`${count(inputs.unclassifiedCash)} movimenti cash non classificati (${eur(sum(inputs.unclassifiedCash))}) restano nella Liquidità`);
  }
  if (count(inputs.unhandledTitoli) > 0) {
    warnings.push(`${count(inputs.unhandledTitoli)} movimenti titoli con causale non gestita`);
  }
  if (count(inputs.orphanCash) > 0) {
    warnings.push(`${count(inputs.orphanCash)} movimenti cash senza il movimento titoli corrispondente (file titoli di un altro mese?): ricostruiti dalla sola riga cash`);
  }
  if (count(inputs.orphanOptionPremiums) > 0) {
    warnings.push(`Premi opzioni per ${eur(sum(inputs.orphanOptionPremiums))} (tempo + intrinseco, non separabili) registrati in cash senza movimento titoli: carica il file titoli del periodo per attribuirli`);
  }
  if (count(inputs.unmatchedExercises) > 0) {
    warnings.push(`${count(inputs.unmatchedExercises)} esercizi di opzioni senza acquisto/vendita a strike corrispondente`);
  }
  return warnings;
}
