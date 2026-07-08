/**
 * Parser per i nuovi flussi CSV della banca (dal 07/2026):
 *  - FlussoSaldiContiCash_*.csv   → saldi dei conti correnti
 *  - FlussoSaldiContiTitoli_*.csv → posizioni dei depositi titoli
 *  - FlussoMovContiCash_*.csv     → movimenti dei conti correnti (bonifici,
 *                                    giroconti, commissioni, POS, ecc.)
 *
 * Formato: separatore ';', decimali con virgola, valori testuali prefissati
 * da apostrofo (es. '03211, '02225971281).
 *
 * Regole conti (prefisso del NUMERO CONTO, senza apostrofo):
 *  - Deposito titoli "08..." → posizioni della Gestione Patrimoniale (GP)
 *  - Conto "B0..."           → liquidità della GP (gp_cash_value)
 *  - Conto "A9..."           → Liquidità vincolata (garanzia operatività in
 *                              derivati): concorre alla liquidità totale ma
 *                              viene esposta separatamente in dashboard se > 1 €
 *  - Altri conti             → liquidità ordinaria del portafoglio
 *
 * Le opzioni USA arrivano nel file Titoli con CODICE TITOLO = 'ND e il
 * descrittore nel campo ISIN: [TICKER][MM/YY][C|P][STRIKE]. La quantità
 * (numero contratti, con segno) è nel campo VALORE NOMINALE e il premio
 * per azione nel campo PREZZO.
 *
 * Il file Movimenti Cash riporta ogni operazione sul conto (DESCRIZIONE
 * OPERAZIONE / DESCRIZIONE CAUSALE libere, non un enum fisso). Le righe che
 * rappresentano un vero movimento di capitale del cliente — bonifico in
 * entrata/uscita o giroconto — vengono riconosciute tramite pattern
 * testuali flessibili (vedi classifyCashMovement) e proposte come
 * versamenti/prelievi candidati. Tutto il resto (commissioni, canoni,
 * acquisti POS, interessi, ecc.) viene ignorato.
 */
import { Position, AssetType } from '@/types/portfolio';
import { parseExcelNumber } from './formatters';
import { isETF } from './excelParser';
import { getOptionExpirationDateISO } from './optionExpiry';
import type { GPHolding } from './gpExcelParser';

export type ParsedPosition = Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>;

export interface FlussiCashAccount {
  accountId: string;
  value: number;
  /** true per i conti "A9..." (Liquidità vincolata) */
  restricted?: boolean;
}

/** Un movimento di capitale (bonifico o giroconto) individuato nel file Movimenti Cash. */
export interface FlussiCashMovement {
  accountId: string;
  /** true per conti GP ("B0...") — vedi note di testata */
  isGP?: boolean;
  /** true per conti vincolati ("A9...") */
  restricted?: boolean;
  /** Data valuta (usata come data del movimento ai fini versamenti/prelievi), ISO */
  movementDate: string;
  /** Data contabile, ISO */
  accountingDate: string;
  /** Importo firmato (positivo = entrata/versamento, negativo = uscita/prelievo) */
  amount: number;
  currency: string;
  operationId: string;
  description: string;
  causaleCode: string;
  causaleDescription: string;
  kind: 'bonifico' | 'giroconto';
}

/** Versamento/prelievo candidato, pronto per l'inserimento in tabella `deposits`. */
export interface DepositCandidate {
  deposit_date: string;
  amount: number;
  description: string;
  /** Movimenti sorgente aggregati in questa riga (stesso conto, stessa data valuta) */
  sourceMovements: FlussiCashMovement[];
}

export interface FlussiParseResult {
  positions: ParsedPosition[];
  /** Conti di liquidità del portafoglio (ordinari + vincolati, GP esclusa) */
  cashAccounts: FlussiCashAccount[];
  cashValue: number;
  /** Somma dei soli conti vincolati (già inclusa in cashValue) */
  restrictedCashValue: number;
  /** Posizioni dei depositi GP ("08...") già nel formato gp_holdings */
  gpHoldings: GPHolding[];
  /** Conti liquidità GP ("B0...") */
  gpCashAccounts: FlussiCashAccount[];
  snapshotDate: string | null;
  /** Movimenti di capitale (bonifici/giroconti) individuati nel file Movimenti Cash */
  cashMovements: FlussiCashMovement[];
}

export interface FlussiParseOptions {
  /**
   * Conti da escludere (match per sottostringa sul NUMERO CONTO). Applicata sia
   * alle righe di saldo (liquidità) sia alle righe di movimento (versamenti/prelievi):
   * le eccezioni cliente restano valide su entrambi i flussi.
   */
  excludedCashAccounts?: string[];
  excludedCashPatterns?: { mid: string; last: string }[];
}

/** Rimuove l'apostrofo iniziale usato come marcatore testuale. */
function stripQuote(v: string): string {
  return v.replace(/^'/, '').trim();
}

/** DD/MM/YYYY → YYYY-MM-DD */
function parseItalianDate(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function splitCsvLine(line: string): string[] {
  return line.replace(/\r$/, '').split(';').map(c => c.trim());
}

export type FlussiCsvType = 'cash' | 'titoli' | 'mov_cash';

/** Riconosce dal testo di quale dei flussi CSV si tratta. */
export function detectFlussiCsvType(text: string): FlussiCsvType | null {
  const firstLine = text.slice(0, 400).split(/\r?\n/)[0]?.toUpperCase() ?? '';
  if (firstLine.startsWith('DATA RIFERIMENTO;')) {
    if (firstLine.includes('SALDO EURO')) return 'cash';
    if (firstLine.includes('CODICE TITOLO')) return 'titoli';
    return null;
  }
  if (firstLine.startsWith('DATA INIZIO PERIODO;') && firstLine.includes('DESCRIZIONE OPERAZIONE')) {
    return 'mov_cash';
  }
  return null;
}

/** Descrittore opzione nel campo ISIN: [AAPL][12/27][C][300] (strike anche decimale: 82.5) */
const OPTION_DESCRIPTOR_RE = /^\[([A-Z0-9.\-]+)\]\[(\d{2})\/(\d{2})\]\[([CP])\]\[(\d+(?:\.\d+)?)\]$/i;

function isExcludedAccount(accountId: string, options?: FlussiParseOptions): boolean {
  const byList = options?.excludedCashAccounts?.some(acc => accountId.includes(acc));
  const byPattern = options?.excludedCashPatterns?.some(p => {
    const midStart = Math.floor((accountId.length - p.mid.length) / 2);
    const mid = accountId.slice(midStart, midStart + p.mid.length);
    return mid === p.mid && accountId.endsWith(p.last);
  });
  return !!byList || !!byPattern;
}

/** Word-boundary "ETC" (es. "ETC-INVESCO PHYSICAL") → commodity. */
function isETC(description: string): boolean {
  return /\bETC\b/.test(description.toUpperCase());
}

/**
 * Parsa il testo di UNO dei due CSV. I risultati dei due file vanno poi
 * uniti dal chiamante (stessa logica dei 2 file Excel attuali).
 */
export function parseFlussiCsvText(text: string, options?: FlussiParseOptions): FlussiParseResult {
  const type = detectFlussiCsvType(text);
  const result: FlussiParseResult = {
    positions: [],
    cashAccounts: [],
    cashValue: 0,
    restrictedCashValue: 0,
    gpHoldings: [],
    gpCashAccounts: [],
    snapshotDate: null,
    cashMovements: [],
  };
  if (!type) return result;

  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  // Riga 0 = intestazione
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 6) continue;

    if (!result.snapshotDate) {
      result.snapshotDate = parseItalianDate(cells[0]);
    }

    if (type === 'cash') {
      parseCashRow(cells, result, options);
    } else if (type === 'titoli') {
      parseTitoliRow(cells, result);
    } else {
      parseMovCashRow(cells, result, options);
    }
  }

  result.cashValue = result.cashAccounts.reduce((s, a) => s + a.value, 0);
  result.restrictedCashValue = result.cashAccounts
    .filter(a => a.restricted)
    .reduce((s, a) => s + a.value, 0);

  return result;
}

// ============================================================================
// File Cash: DATA;ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN
// ============================================================================
function parseCashRow(cells: string[], result: FlussiParseResult, options?: FlussiParseOptions): void {
  const accountId = stripQuote(cells[2] || '');
  if (!accountId) return;

  const sign = (cells[4] || '+').trim() === '-' ? -1 : 1;
  const value = sign * parseExcelNumber(cells[5]);

  // Conto GP ("B0...") → liquidità della Gestione Patrimoniale
  if (accountId.toUpperCase().startsWith('B0')) {
    result.gpCashAccounts.push({ accountId, value });
    return;
  }

  // Esclusioni configurate (stessa semantica del parser Excel)
  if (isExcludedAccount(accountId, options)) {
    console.log('[FlussiCsv] Conto liquidità escluso da regola');
    return;
  }

  // Conto vincolato ("A9...") → Liquidità vincolata (garanzia derivati)
  const restricted = accountId.toUpperCase().startsWith('A9');
  result.cashAccounts.push({ accountId, value, restricted });
}

// ============================================================================
// File Titoli: DATA;ABI;CONTO;COD TITOLO;DESCRIZIONE;ISIN;DIVISA;
//              VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO
// ============================================================================
function parseTitoliRow(cells: string[], result: FlussiParseResult): void {
  const accountId = stripQuote(cells[2] || '');
  const codiceTitolo = stripQuote(cells[3] || '');
  const description = (cells[4] || '').trim();
  const isinField = (cells[5] || '').trim();
  const currency = (cells[6] || 'EUR').trim() || 'EUR';
  const nominale = parseExcelNumber(cells[7]);
  const quantita = parseExcelNumber(cells[8]);
  const controvalore = parseExcelNumber(cells[9]);
  const cambioRaw = parseExcelNumber(cells[10]);
  const cambio = cambioRaw > 0 ? cambioRaw : 1;
  const prezzo = parseExcelNumber(cells[11]);
  const rateo = parseExcelNumber(cells[12]);

  const isGP = accountId.toUpperCase().startsWith('08');
  const optionMatch = isinField.match(OPTION_DESCRIPTOR_RE);

  // ---- Opzioni (derivati) ----
  if (optionMatch) {
    if (isGP) {
      // Il modello gp_holdings non prevede derivati: riga ignorata con log.
      console.log('[FlussiCsv] Opzione su deposito GP ignorata (non supportata in gp_holdings)');
      return;
    }
    const [, tickerRaw, mm, yy, cp, strikeRaw] = optionMatch;
    const ticker = tickerRaw.toUpperCase();
    const year = 2000 + parseInt(yy, 10);
    // Scadenza reale (terzo venerdì, holiday-adjusted): vedi optionExpiry.ts
    const expiryDate = getOptionExpirationDateISO(year, parseInt(mm, 10) - 1);
    const strikePrice = parseFloat(strikeRaw);
    const optionType: 'call' | 'put' = cp.toUpperCase() === 'C' ? 'call' : 'put';
    const contracts = nominale; // con segno: negativo = venduta
    const marketValueEUR = (Math.abs(contracts) * 100 * prezzo) / cambio;

    result.positions.push({
      isin: undefined,
      ticker: undefined,
      description: isinField, // es. "[AAPL][12/27][C][300]"
      asset_type: 'derivative',
      currency,
      quantity: contracts,
      current_price: prezzo || undefined,
      avg_cost: undefined,
      market_value: marketValueEUR || undefined,
      profit_loss: undefined,
      profit_loss_pct: undefined,
      weight_pct: undefined,
      option_type: optionType,
      strike_price: Number.isFinite(strikePrice) ? strikePrice : undefined,
      expiry_date: expiryDate,
      underlying: ticker,
      exchange_rate: cambio,
      snapshot_price: prezzo || undefined,
      snapshot_market_value: marketValueEUR || undefined,
    } as ParsedPosition);
    return;
  }

  if (!description && !codiceTitolo) return;

  // ---- Classificazione titoli cash-securities ----
  const isBond = nominale > 0 && quantita === 0;
  // Controvalore in divisa locale → EUR; per i bond il rateo (interessi
  // maturati) fa parte del valore patrimoniale e viene sommato.
  const marketValueEUR = (controvalore + (isBond ? rateo : 0)) / cambio;
  const quantity = isBond ? nominale : quantita;

  // ---- Deposito GP ("08...") → gp_holdings ----
  if (isGP) {
    result.gpHoldings.push({
      asset_type: isBond ? 'bond' : 'stock', // gp_holdings non distingue gli ETF
      description: description || codiceTitolo,
      quantity,
      market_value: marketValueEUR,
      price: prezzo || null,
      currency,
      exchange_rate: cambio,
      weight_pct: null,
      ticker_code: codiceTitolo || null,
      price_date: parseItalianDate(cells[0]) || null,
    });
    return;
  }

  // ---- Posizione di portafoglio ----
  let assetType: AssetType = 'stock';
  if (isBond) assetType = 'bond';
  else if (isETC(description)) assetType = 'commodity';
  else if (isETF(description, isinField || undefined)) assetType = 'etf';

  result.positions.push({
    isin: isinField || undefined,
    ticker: undefined,
    description: description || 'Posizione senza descrizione',
    asset_type: assetType,
    currency,
    quantity,
    current_price: prezzo || undefined,
    avg_cost: undefined,
    market_value: marketValueEUR || undefined,
    profit_loss: undefined,
    profit_loss_pct: undefined,
    weight_pct: undefined,
    option_type: undefined,
    strike_price: undefined,
    expiry_date: undefined,
    underlying: undefined,
    exchange_rate: cambio,
    snapshot_price: prezzo || undefined,
    snapshot_market_value: marketValueEUR || undefined,
  } as ParsedPosition);
}

// ============================================================================
// File Movimenti Cash: DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;
//   DATA CONTABILE;DATA VALUTA;ANNO;NUMERO CONTO;NUMERO OPERAZIONE;
//   DESCRIZIONE OPERAZIONE;SEGNO;IMPORTO ORIGINARIO;DIVISA IMPORTO ORIGINARIO;
//   IMPORTO MOVIMENTO CONTO;DIVISA IMPORTO;CODICE CAUSALE;DESCRIZIONE CAUSALE;IBAN;
// ============================================================================

/**
 * Riconoscimento flessibile di bonifici e giroconti: la banca non usa un
 * codice causale stabile per queste operazioni, quindi si matcha sul testo
 * libero (DESCRIZIONE OPERAZIONE + DESCRIZIONE CAUSALE), case-insensitive e
 * a "word boundary" per tollerare varianti (es. "BONIFICO A VOSTRO FAVORE",
 * "BONIFICO DISPOSTO", "VS BONIFICO ESTERO", "GIROCONTO INTERNO", ecc.).
 */
const BONIFICO_RE = /\bBONIFIC[OI]\b/i;
const GIROCONTO_RE = /\bGIROCONT[OI]\b/i;
// Spese/commissioni *relative* a un bonifico (es. "COMMISSIONI PER BONIFICO
// ESTERO") non sono il movimento di capitale in sé: vanno escluse per non
// generare un falso prelievo che duplica quello reale.
const FEE_ON_TRANSFER_RE = /\b(COMMISSION[EI]|SPES[AE]|COMPETENZ[EA]|ADDEBITO PER)\b/i;

function classifyCashMovement(description: string, causaleDescription: string): 'bonifico' | 'giroconto' | null {
  const haystack = `${description} ${causaleDescription}`.toUpperCase();
  const isBonifico = BONIFICO_RE.test(haystack);
  const isGiroconto = GIROCONTO_RE.test(haystack);
  if (!isBonifico && !isGiroconto) return null;
  if (FEE_ON_TRANSFER_RE.test(haystack)) return null; // spesa/commissione, non il movimento stesso
  return isBonifico ? 'bonifico' : 'giroconto';
}

function parseMovCashRow(cells: string[], result: FlussiParseResult, options?: FlussiParseOptions): void {
  const accountId = stripQuote(cells[6] || '');
  if (!accountId) return;

  // Stesse eccezioni cliente (silvias, maurog, ...) già usate per la liquidità.
  if (isExcludedAccount(accountId, options)) {
    console.log('[FlussiCsv] Movimento escluso da regola conto cliente');
    return;
  }

  const description = (cells[8] || '').trim();
  const causaleCode = stripQuote(cells[14] || '');
  const causaleDescription = (cells[15] || '').trim();

  const kind = classifyCashMovement(description, causaleDescription);
  if (!kind) return;

  const amount = parseExcelNumber(cells[12]); // già firmato (+ entrata / - uscita)
  if (!amount) return;

  const movementDate = parseItalianDate(cells[4]) || parseItalianDate(cells[3]);
  if (!movementDate) return;

  const upperAccount = accountId.toUpperCase();

  result.cashMovements.push({
    accountId,
    isGP: upperAccount.startsWith('B0'),
    restricted: upperAccount.startsWith('A9'),
    movementDate,
    accountingDate: parseItalianDate(cells[3]) || movementDate,
    amount,
    currency: (cells[13] || 'EUR').trim() || 'EUR',
    operationId: stripQuote(cells[7] || ''),
    description,
    causaleCode,
    causaleDescription,
    kind,
  });
}

/**
 * Aggrega i movimenti (bonifici/giroconti) individuati in candidati
 * versamento/prelievo, uno per data valuta (netting infragiornaliero).
 *
 * Nota: la tabella `deposits` ha oggi il vincolo UNIQUE(portfolio_id,
 * deposit_date), quindi più movimenti nello stesso giorno DEVONO confluire
 * in un'unica riga: l'aggregazione per data qui non è un'approssimazione
 * ma un requisito dello schema attuale. Se in futuro serve tracciare ogni
 * bonifico separatamente, va prima rimosso/modificato quel vincolo.
 */
export function buildDepositCandidates(movements: FlussiCashMovement[]): DepositCandidate[] {
  const byDate = new Map<string, FlussiCashMovement[]>();
  for (const m of movements) {
    const list = byDate.get(m.movementDate) ?? [];
    list.push(m);
    byDate.set(m.movementDate, list);
  }

  const candidates: DepositCandidate[] = [];
  for (const [deposit_date, sourceMovements] of byDate) {
    const amount = sourceMovements.reduce((s, m) => s + m.amount, 0);
    const description = sourceMovements
      .map(m => m.description || m.causaleDescription)
      .filter(Boolean)
      .join(' | ');
    candidates.push({ deposit_date, amount, description, sourceMovements });
  }

  return candidates.sort((a, b) => a.deposit_date.localeCompare(b.deposit_date));
}
