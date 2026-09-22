/**
 * Ledger movimenti per la "Scomposizione Rendimento".
 *
 * Normalizza i due flussi banca (FlussoMovContiCash / FlussoMovContiTit) in
 * righe con una chiave naturale stabile, così il caricamento è idempotente
 * anche con file sovrapposti o ricaricati.
 *
 * Regola di non-doppio-conteggio: ogni evento economico arriva da UNA sola
 * fonte.
 *  - Movimenti TITOLI: compravendite (azioni, ETF, obbligazioni, opzioni),
 *    esercizi/abbandoni di opzioni, dividendi e cedole con le relative
 *    commissioni, commissioni valutarie, spese e ritenute.
 *  - Movimenti CASH: solo gli addebiti/accrediti che non hanno un titolo di
 *    riferimento (bolli, imposta capital gain, canoni e commissioni di conto,
 *    interessi, bonifici/giroconti). Le righe cash che replicano un evento
 *    titoli (acquisto/vendita titoli, esercizio opzioni, variazione giornaliera
 *    derivati, commissioni derivati, dividendi, cedole, ritenute e spese su
 *    proventi) vengono conservate come `covered_by_titoli` e non producono
 *    flussi.
 *
 * Perimetro: conti "B0..." (liquidità GP) e depositi "08..." (titoli GP) sono
 * interni alla Gestione Patrimoniale: il loro effetto è già nel valore GP e
 * non genera flussi tra classi (scope = 'gp').
 */
import { parseExcelNumber } from './formatters';
import {
  FlussiParseOptions,
  classifyCashMovement,
  decodeOptionDescriptor,
  detectFlussiCsvType,
  isExcludedAccount,
  isExcludedPosition,
  parseItalianDate,
  splitCsvLine,
  stripQuote,
} from './flussiCsvParser';

export type MovementSource = 'cash' | 'titoli';

export type MovementKind =
  // ---- titoli ----
  | 'buy'
  | 'sell'
  | 'option_exercise'
  | 'option_expiry'
  | 'dividend'
  | 'coupon'
  | 'titoli_other'
  // ---- cash ----
  | 'bolli'
  | 'capital_gain_tax'
  | 'fee'
  | 'interest'
  | 'external_transfer'
  | 'internal_transfer'
  | 'covered_by_titoli'
  | 'cash_other';

export interface MovementLedgerRow {
  source: MovementSource;
  /** Chiave naturale: stessa riga banca → stessa chiave, anche tra file diversi. */
  rowKey: string;
  accountId: string;
  scope: 'portfolio' | 'gp';
  kind: MovementKind;
  /** Data con cui il movimento entra nel periodo di attribuzione. */
  effectiveDate: string;
  bookingDate: string | null;
  valueDate: string | null;
  operationDate: string | null;
  causale: string;
  causaleDescription: string | null;
  /** NUMERO OPERAZIONE (solo cash) */
  operationId: string | null;
  description: string;
  isin: string | null;
  /** Descrittore opzione (es. 'MUQ6P780') */
  descriptor: string | null;
  underlyingTicker: string | null;
  optionType: 'call' | 'put' | null;
  strike: number | null;
  expiryDate: string | null;
  /** Esercizio/abbandono: posizione venduta (short) o acquistata (long). */
  positionSide: 'short' | 'long' | null;
  quantity: number | null;
  price: number | null;
  currency: string;
  exchangeRate: number | null;
  /** Controvalore lordo in EUR (titoli) o |importo| (cash). Sempre >= 0. */
  grossEur: number;
  /** Rateo in EUR (obbligazioni). */
  accruedEur: number;
  /** Effetto firmato sul conto cash in EUR (+ entrata, − uscita). */
  netEur: number;
  /** Commissioni di negoziazione/incasso + altri oneri + spese (EUR, >= 0 = costo). */
  commissionEur: number;
  /** Commissioni valutarie (EUR). */
  fxCommissionEur: number;
  /** Ritenute/imposte (EUR, positivo = pagate; negativo = credito). */
  taxEur: number;
  /** Bolli (EUR). */
  bolliEur: number;
  /** Differenza tra netto banca e ricostruzione, trattata come costo. */
  unexplainedChargeEur: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface MovementFileParseResult {
  source: MovementSource | null;
  periodStart: string | null;
  periodEnd: string | null;
  rows: MovementLedgerRow[];
  /** Righe scartate per regola conto cliente (es. silvias: conti ≠ 453). */
  excludedByAccountRule: number;
  /** Righe scartate per esclusione titolo (es. Bio-On, fondi/SICAV). */
  excludedByPositionRule: number;
  /**
   * Giroconti tra un conto del perimetro e la liquidità GP ("B0..."), anche
   * quando il conto GP è fuori dal perimetro cash del cliente (es. silvias):
   * la riga GP serve solo a riconoscere il travaso, non viene salvata.
   * Coppie [addebito, accredito].
   */
  gpTransferPairs: [MovementLedgerRow, MovementLedgerRow][];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function isGpAccount(source: MovementSource, accountId: string): boolean {
  const upper = accountId.toUpperCase();
  return source === 'cash' ? upper.startsWith('B0') : upper.startsWith('08');
}

/**
 * Chiave naturale con indice di occorrenza: due righe identiche nello stesso
 * file (es. due eseguiti uguali) restano distinte, mentre ricaricare lo
 * stesso file produce le stesse chiavi.
 */
function withOccurrence(baseKeys: string[]): string[] {
  const seen = new Map<string, number>();
  return baseKeys.map(key => {
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return `${key}#${count}`;
  });
}

// ============================================================================
// Movimenti CASH
// ============================================================================

/** Causali cash che replicano un evento già presente nei movimenti titoli. */
const COVERED_CAUSALI = new Set([
  '71000019', // ACQUISTO TITOLI
  '71000027', // VENDITA TITOLI
  '71000030', // ESERCIZIO OPZIONI
  '71000023', // DIVIDENDI
  '71000014', // CEDOLE
  '71000012', // RITENUTA (su dividendi/cedole)
  '71000066', // SPESE (su proventi)
  '71000015', // COMMISSIONI VALUTARIE (su proventi)
  '76000005', // ADDEBITO PER COMMISSIONI SU DERIVATI
  '76000008', // ACCREDITO VARIAZIONE GIORNALIERA DERIVATI
  '76000010', // ADDEBITO VARIAZIONE GIORNALIERA DERIVATI
]);

const ISIN_RE = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/;
const COVERED_TEXT_RE = [
  /VARIAZ(?:IONE|\.)?\s*GIORN/i,
  /COMMISS\w*\s+(?:SU\s+)?DERIVATI/i,
  /\b(?:ACQUISTO|VENDITA)\s+TITOLI\b/i,
  /\bESERCIZIO\s+OPZIONI\b/i,
];
const INCOME_RELATED_RE = /\b(DIVIDEND\w*|CEDOL\w*|RITENUT\w*|SPES[AE]|COMMISSIONI\s+VALUTARIE)\b/i;

export function classifyCashKind(
  causaleCode: string,
  description: string,
  causaleDescription: string,
  amount: number,
): MovementKind {
  const text = `${description} ${causaleDescription}`;
  if (COVERED_CAUSALI.has(causaleCode)) return 'covered_by_titoli';
  if (COVERED_TEXT_RE.some(re => re.test(text))) return 'covered_by_titoli';
  if (INCOME_RELATED_RE.test(text) && ISIN_RE.test(description.toUpperCase())) return 'covered_by_titoli';
  if (/CAPITAL\s*GAIN/i.test(text)) return 'capital_gain_tax';
  if (causaleCode === '71000074' || causaleCode === '00005027' || /\bBOLL[IO]\b/i.test(text)) return 'bolli';
  if (classifyCashMovement(description, causaleDescription)) return 'external_transfer';
  if (/\bINTERESS\w*/i.test(text) && amount > 0) return 'interest';
  if (/\bCOMPETENZ[EA]\b/i.test(text)) return amount > 0 ? 'interest' : 'fee';
  if (/\b(CANON[EI]|COMMISSION[EI]|SPES[AE])\b/i.test(text)) return 'fee';
  return 'cash_other';
}

function parseMovCashRows(
  lines: string[],
  options: FlussiParseOptions | undefined,
  result: MovementFileParseResult,
): void {
  const pending: { row: Omit<MovementLedgerRow, 'rowKey'>; baseKey: string }[] = [];
  const gpCounterparts: MovementLedgerRow[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    if (cells.length < 15) continue;
    const accountId = stripQuote(cells[6] || '');
    if (!accountId) continue;
    const excluded = isExcludedAccount(accountId, options, 'cash');
    if (excluded) result.excludedByAccountRule += 1;
    // Fuori perimetro: si tiene solo il giroconto sul conto GP, come
    // controparte per riconoscere i travasi con la gestione.
    if (excluded && !isGpAccount('cash', accountId)) continue;
    const bookingDate = parseItalianDate(cells[3]);
    const valueDate = parseItalianDate(cells[4]);
    const effectiveDate = bookingDate || valueDate;
    if (!effectiveDate) continue;

    const amount = parseExcelNumber(cells[12]);
    const description = (cells[8] || '').trim();
    const causaleCode = stripQuote(cells[14] || '');
    const causaleDescription = (cells[15] || '').trim() || null;
    const operationId = stripQuote(cells[7] || '');
    const kind = classifyCashKind(causaleCode, description, causaleDescription ?? '', amount);

    const row: Omit<MovementLedgerRow, 'rowKey'> = {
      source: 'cash',
      accountId,
      scope: isGpAccount('cash', accountId) ? 'gp' : 'portfolio',
      kind,
      effectiveDate,
      bookingDate,
      valueDate,
      operationDate: null,
      causale: causaleCode,
      causaleDescription,
      operationId: operationId || null,
      description,
      isin: description.toUpperCase().match(ISIN_RE)?.[0] ?? null,
      descriptor: null,
      underlyingTicker: null,
      optionType: null,
      strike: null,
      expiryDate: null,
      positionSide: null,
      quantity: null,
      price: null,
      currency: (cells[13] || 'EUR').trim() || 'EUR',
      exchangeRate: null,
      grossEur: Math.abs(amount),
      accruedEur: 0,
      netEur: amount,
      commissionEur: 0,
      fxCommissionEur: 0,
      taxEur: 0,
      bolliEur: 0,
      unexplainedChargeEur: 0,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
    };
    if (excluded) {
      if (kind === 'external_transfer') gpCounterparts.push({ ...row, rowKey: `GP-CP|${accountId}|${operationId}|${amount.toFixed(2)}` });
      continue;
    }
    const baseKey = [
      'C',
      accountId,
      operationId,
      bookingDate ?? '',
      valueDate ?? '',
      causaleCode,
      amount.toFixed(2),
      description.replace(/\s+/g, ' ').toUpperCase(),
    ].join('|');
    pending.push({ row, baseKey });
  }

  const keys = withOccurrence(pending.map(p => p.baseKey));
  pending.forEach((p, i) => result.rows.push({ ...p.row, rowKey: keys[i] }));

  // Giroconti tra conto ordinario e conto GP ("B0...") nello stesso file:
  // sono travasi interni, non apporti/prelievi del cliente.
  result.gpTransferPairs = markInternalGpTransfers(result.rows, gpCounterparts);
}

/**
 * Appaia giroconti di segno opposto e stesso importo tra un conto del
 * portafoglio e un conto GP entro 5 giorni: diventano `internal_transfer`.
 */
export function markInternalGpTransfers(
  rows: MovementLedgerRow[],
  counterparts: MovementLedgerRow[] = [],
): [MovementLedgerRow, MovementLedgerRow][] {
  const pairs: [MovementLedgerRow, MovementLedgerRow][] = [];
  const transfers = [...rows, ...counterparts].filter(r => r.kind === 'external_transfer' || r.kind === 'internal_transfer');
  const used = new Set<MovementLedgerRow>();
  const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  for (const debit of transfers.filter(r => r.netEur < 0)) {
    let best: MovementLedgerRow | null = null;
    for (const credit of transfers) {
      if (credit.netEur <= 0 || used.has(credit) || credit === debit) continue;
      if (credit.scope === debit.scope) continue;
      if (Math.abs(credit.netEur + debit.netEur) > 0.005) continue;
      const dist = dayDiff(credit.effectiveDate, debit.effectiveDate);
      if (dist > 5) continue;
      if (!best || dist < dayDiff(best.effectiveDate, debit.effectiveDate)) best = credit;
    }
    if (best) {
      used.add(best);
      used.add(debit);
      best.kind = 'internal_transfer';
      debit.kind = 'internal_transfer';
      pairs.push([debit, best]);
    }
  }
  return pairs;
}

// ============================================================================
// Movimenti TITOLI
// ============================================================================

function titoliKind(causale: string): { kind: MovementKind; positionSide: 'short' | 'long' | null } {
  switch (causale) {
    case 'ACQ': return { kind: 'buy', positionSide: null };
    case 'VEN': return { kind: 'sell', positionSide: null };
    case 'DIV': return { kind: 'dividend', positionSide: null };
    case 'CED': return { kind: 'coupon', positionSide: null };
    case 'EPV': return { kind: 'option_exercise', positionSide: 'short' };
    case 'EPA': return { kind: 'option_exercise', positionSide: 'long' };
    case 'APV': return { kind: 'option_expiry', positionSide: 'short' };
    case 'APA': return { kind: 'option_expiry', positionSide: 'long' };
    default: return { kind: 'titoli_other', positionSide: null };
  }
}

function parseMovTitoliRows(
  lines: string[],
  options: FlussiParseOptions | undefined,
  result: MovementFileParseResult,
): void {
  const pending: { row: Omit<MovementLedgerRow, 'rowKey'>; baseKey: string }[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    if (cells.length < 25) continue;
    const accountId = stripQuote(cells[3] || '');
    if (!accountId) continue;
    if (isExcludedAccount(accountId, options, 'titoli')) {
      result.excludedByAccountRule += 1;
      continue;
    }
    const isin = stripQuote(cells[4] || '').toUpperCase() || null;
    const description = stripQuote(cells[5] || '').trim();
    if (isExcludedPosition(description, isin ?? '', options)) {
      result.excludedByPositionRule += 1;
      continue;
    }

    const causale = (cells[10] || '').trim().toUpperCase();
    const { kind, positionSide } = titoliKind(causale);
    const bookingDate = parseItalianDate(cells[6]);
    const valueDate = parseItalianDate(cells[7]);
    const operationDate = parseItalianDate(cells[8]) || parseItalianDate(cells[9]);
    const isTradeLike = kind === 'buy' || kind === 'sell' || kind === 'option_exercise' || kind === 'option_expiry';
    // Compravendite ed eventi su opzioni: data operazione (le posizioni degli
    // snapshot riflettono l'eseguito). Proventi: data contabile (incasso).
    const effectiveDate = isTradeLike
      ? (operationDate || bookingDate)
      : (bookingDate || operationDate);
    if (!effectiveDate) continue;

    const decoded = !isin ? decodeOptionDescriptor(description, operationDate || effectiveDate) : null;

    const quantity = Math.abs(parseExcelNumber(cells[11]));
    const price = parseExcelNumber(cells[12]);
    const currency = (cells[13] || 'EUR').trim() || 'EUR';
    const fxRaw = parseExcelNumber(cells[16]);
    const exchangeRate = fxRaw > 0 ? fxRaw : 1;
    const accruedRaw = parseExcelNumber(cells[17]);
    const bolli = parseExcelNumber(cells[18]);
    const commission = parseExcelNumber(cells[19]);
    const fxCommission = parseExcelNumber(cells[20]);
    const withholding = parseExcelNumber(cells[21]);
    const grossLocal = parseExcelNumber(cells[22]);
    const grossEurRaw = parseExcelNumber(cells[23]);
    const netEurAbs = Math.abs(parseExcelNumber(cells[24]));
    const spese = parseExcelNumber(cells[25]);
    const altriOneri = parseExcelNumber(cells[26]);
    const imposte = parseExcelNumber(cells[27]);
    const imposteSgr = parseExcelNumber(cells[28]);

    const grossEur = Math.abs(grossEurRaw || (grossLocal ? grossLocal / exchangeRate : 0));
    const accruedEur = currency === 'EUR' ? accruedRaw : accruedRaw / exchangeRate;
    const commissionEur = commission + spese + altriOneri;
    // RITENUTE e IMPOSTE riportano spesso lo stesso importo (es. cedola BTP):
    // si usa la ritenuta e, solo in sua assenza, le imposte.
    const taxEur = withholding !== 0 ? withholding : imposte + imposteSgr;

    // Effetto cash firmato e quadratura con il netto banca.
    let netEur = 0;
    let unexplained = 0;
    if (kind === 'buy') {
      const expected = grossEur + accruedEur + commissionEur + fxCommission + taxEur + bolli;
      netEur = -(netEurAbs || expected);
      if (netEurAbs > 0) unexplained = round2(netEurAbs - expected);
    } else if (kind === 'sell' || kind === 'dividend' || kind === 'coupon') {
      const expected = grossEur + accruedEur - commissionEur - fxCommission - taxEur - bolli;
      netEur = netEurAbs || expected;
      if (netEurAbs > 0) unexplained = round2(expected - netEurAbs);
    } else if (kind === 'titoli_other') {
      netEur = 0; // segno ignoto: esposto come avviso, nessun flusso inventato
    }
    if (Math.abs(unexplained) < 0.05) unexplained = 0;

    const row: Omit<MovementLedgerRow, 'rowKey'> = {
      source: 'titoli',
      accountId,
      scope: isGpAccount('titoli', accountId) ? 'gp' : 'portfolio',
      kind,
      effectiveDate,
      bookingDate,
      valueDate,
      operationDate,
      causale,
      causaleDescription: null,
      operationId: null,
      description,
      isin,
      descriptor: decoded ? description.toUpperCase() : null,
      underlyingTicker: decoded?.underlyingTicker ?? null,
      optionType: decoded?.optionType ?? null,
      strike: decoded?.strike ?? null,
      expiryDate: decoded?.expiryDate ?? null,
      positionSide,
      quantity,
      price,
      currency,
      exchangeRate,
      grossEur: round2(grossEur),
      accruedEur: round2(accruedEur),
      netEur: round2(netEur),
      commissionEur: round2(commissionEur),
      fxCommissionEur: round2(fxCommission),
      taxEur: round2(taxEur),
      bolliEur: round2(bolli),
      unexplainedChargeEur: unexplained,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
    };
    const baseKey = [
      'T',
      accountId,
      isin || description.toUpperCase(),
      causale,
      operationDate ?? '',
      bookingDate ?? '',
      quantity.toString(),
      price.toString(),
      grossEur.toFixed(2),
      netEurAbs.toFixed(2),
    ].join('|');
    pending.push({ row, baseKey });
  }
  const keys = withOccurrence(pending.map(p => p.baseKey));
  pending.forEach((p, i) => result.rows.push({ ...p.row, rowKey: keys[i] }));
}

/** Parsa uno dei due file movimenti (cash o titoli). */
export function parseMovementFile(text: string, options?: FlussiParseOptions): MovementFileParseResult {
  const type = detectFlussiCsvType(text);
  const result: MovementFileParseResult = {
    source: type === 'mov_cash' ? 'cash' : type === 'mov_titoli' ? 'titoli' : null,
    periodStart: null,
    periodEnd: null,
    rows: [],
    excludedByAccountRule: 0,
    excludedByPositionRule: 0,
    gpTransferPairs: [],
  };
  if (!result.source) return result;

  const lines = text.split(/\r?\n/).slice(1).filter(line => line.trim().length > 0);
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const start = parseItalianDate(cells[0] || '');
    const end = parseItalianDate(cells[1] || '');
    if (start && (!result.periodStart || start < result.periodStart)) result.periodStart = start;
    if (end && (!result.periodEnd || end > result.periodEnd)) result.periodEnd = end;
  }

  if (result.source === 'cash') parseMovCashRows(lines, options, result);
  else parseMovTitoliRows(lines, options, result);
  return result;
}
