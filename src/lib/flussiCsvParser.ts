/**
 * Parser per i nuovi flussi CSV della banca (dal 07/2026):
 *  - FlussoSaldiContiCash_*.csv   → saldi dei conti correnti
 *  - FlussoSaldiContiTitoli_*.csv → posizioni dei depositi titoli
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
}

export interface FlussiParseOptions {
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

/** Riconosce dal testo se si tratta di uno dei due flussi CSV. */
export function detectFlussiCsvType(text: string): 'cash' | 'titoli' | null {
  const firstLine = text.slice(0, 400).split(/\r?\n/)[0]?.toUpperCase() ?? '';
  if (!firstLine.startsWith('DATA RIFERIMENTO;')) return null;
  if (firstLine.includes('SALDO EURO')) return 'cash';
  if (firstLine.includes('CODICE TITOLO')) return 'titoli';
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
    } else {
      parseTitoliRow(cells, result);
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
