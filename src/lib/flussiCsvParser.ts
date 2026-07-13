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

/** Operazione su opzione dal file Movimenti Titoli (descrittore es. NVDAV7P200). */
export interface FlussiTitoliOptionTrade {
  accountId: string;
  /** Descrittore grezzo (DESC TITOLO), es. 'MUQ6P900' */
  descriptor: string;
  /** Ticker del sottostante decodificato, es. 'MU' */
  underlyingTicker: string;
  optionType: 'call' | 'put';
  strike: number;
  /** Scadenza reale (terzo venerdì, con gestione festività), ISO */
  expiryDate: string;
  /** 'ACQ' = acquisto, 'VEN' = vendita */
  side: 'ACQ' | 'VEN';
  /** Numero contratti (positivo) */
  contracts: number;
  /** Premio per azione (PREZZO SECCO), nella divisa del titolo */
  pricePerShare: number;
  currency: string;
  exchangeRate: number;
  /** Controvalore lordo in EUR */
  grossEUR: number;
  commission: number;
  /** DATA OPERAZIONE, ISO */
  tradeDate: string;
}

/** Compravendita di titoli (azioni/ETF) nel file Movimenti Titoli: righe con ISIN valorizzato. */
export interface FlussiTitoliStockTrade {
  accountId: string;
  isin: string;
  /** DESC TITOLO: denominazione del titolo */
  description: string;
  /** 'ACQ' = acquisto, 'VEN' = vendita */
  side: 'ACQ' | 'VEN';
  /** Quantità (positiva) */
  quantity: number;
  /** Prezzo per azione (PREZZO SECCO), nella divisa del titolo */
  price: number;
  currency: string;
  exchangeRate: number;
  /** Controvalore lordo in EUR */
  grossEUR: number;
  /** Commissioni (EUR) */
  commission: number;
  /** DATA OPERAZIONE, ISO */
  tradeDate: string;
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
  /** Operazioni su opzioni individuate nel file Movimenti Titoli */
  titoliOptionTrades: FlussiTitoliOptionTrade[];
  /** Compravendite di titoli (azioni/ETF, righe con ISIN) nel file Movimenti Titoli */
  titoliStockTrades: FlussiTitoliStockTrade[];
}

export interface FlussiParseOptions {
  /**
   * Conti da escludere (match per sottostringa sul NUMERO CONTO). Applicata sia
   * alle righe di saldo (liquidità) sia alle righe di movimento (versamenti/prelievi):
   * le eccezioni cliente restano valide su entrambi i flussi.
   */
  excludedCashAccounts?: string[];
  /**
   * Pattern sul NUMERO CONTO: `last` è il suffisso richiesto (es. '452' →
   * "il conto che finisce per 452"); `mid` è OPZIONALE e, se presente, deve
   * comparire anche al centro del numero conto.
   */
  excludedCashPatterns?: { mid?: string; last: string }[];
  /** Descrizioni titolo da non includere nelle posizioni o holdings GP. */
  excludedPositionDescriptions?: string[];
  /** Include i conti B0 nella liquidità ordinaria invece di classificarli come GP. */
  includeGpCashInCash?: boolean;
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

export type FlussiCsvType = 'cash' | 'titoli' | 'mov_cash' | 'mov_titoli';

/** Riconosce dal testo di quale dei flussi CSV si tratta. */
export function detectFlussiCsvType(text: string): FlussiCsvType | null {
  const firstLine = text.slice(0, 600).split(/\r?\n/)[0]?.toUpperCase() ?? '';
  if (firstLine.startsWith('DATA RIFERIMENTO;')) {
    if (firstLine.includes('SALDO EURO')) return 'cash';
    if (firstLine.includes('CODICE TITOLO')) return 'titoli';
    return null;
  }
  if (firstLine.startsWith('DATA INIZIO PERIODO;')) {
    if (firstLine.includes('DESCRIZIONE OPERAZIONE')) return 'mov_cash';
    if (firstLine.includes('DESC TITOLO') && firstLine.includes('CAUSALE')) return 'mov_titoli';
    return null;
  }
  return null;
}

/** Descrittore opzione nel campo ISIN: [AAPL][12/27][C][300] (strike anche decimale: 82.5) */
const OPTION_DESCRIPTOR_RE = /^\[([A-Z0-9.\-]+)\]\[(\d{2})\/(\d{2})\]\[([CP])\]\[(\d+(?:\.\d+)?)\]$/i;

function isExcludedAccount(accountId: string, options?: FlussiParseOptions): boolean {
  const byList = options?.excludedCashAccounts?.some(acc => accountId.includes(acc));
  const byPattern = options?.excludedCashPatterns?.some(p => {
    if (!accountId.endsWith(p.last)) return false;
    if (!p.mid) return true; // solo suffisso (es. "il conto che finisce per 452")
    const midStart = Math.floor((accountId.length - p.mid.length) / 2);
    const mid = accountId.slice(midStart, midStart + p.mid.length);
    return mid === p.mid;
  });
  return !!byList || !!byPattern;
}

function isExcludedPosition(description: string, options?: FlussiParseOptions): boolean {
  const normalized = description.trim().replace(/\s+/g, ' ').toUpperCase();
  return options?.excludedPositionDescriptions?.some(
    excluded => excluded.trim().replace(/\s+/g, ' ').toUpperCase() === normalized,
  ) ?? false;
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
    titoliOptionTrades: [],
    titoliStockTrades: [],
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
      parseTitoliRow(cells, result, options);
    } else if (type === 'mov_cash') {
      parseMovCashRow(cells, result, options);
    } else {
      parseMovTitoliRow(cells, result, options);
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

  // Esclusioni configurate (stessa semantica del parser Excel)
  if (isExcludedAccount(accountId, options)) {
    console.log('[FlussiCsv] Conto liquidità escluso da regola');
    return;
  }

  // Conto GP ("B0...") → liquidità della Gestione Patrimoniale
  if (accountId.toUpperCase().startsWith('B0') && !options?.includeGpCashInCash) {
    result.gpCashAccounts.push({ accountId, value });
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
function parseTitoliRow(cells: string[], result: FlussiParseResult, options?: FlussiParseOptions): void {
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

  if (isExcludedPosition(description, options)) return;

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
/**
 * Accoppia i GIROCONTI interni tra conti del cliente: due giroconti su conti
 * DIVERSI, con importo uguale e segno opposto, sono uno spostamento interno
 * (es. conto cash ↔ conto GP "B0...") e NON un movimento di capitale del
 * cliente. Vanno esclusi entrambi dal registro versamenti/prelievi: la GP
 * entra nel total_value del portafoglio, quindi un travaso interno non
 * cambia il capitale investito ma — se contato — corrompe contributi e TWR.
 *
 * Appaiamento deterministico: stessa data valuta prima, poi tolleranza fino
 * a 5 giorni di calendario (le due gambe possono avere valute diverse).
 * I giroconti NON appaiati (controparte esterna) e tutti i bonifici restano
 * movimenti di capitale a tutti gli effetti, GP inclusa.
 */
export function pairInternalTransfers(movements: FlussiCashMovement[]): {
  external: FlussiCashMovement[];
  internalPairs: [FlussiCashMovement, FlussiCashMovement][];
} {
  const giroconti = movements
    .map((m, idx) => ({ m, idx }))
    .filter(x => x.m.kind === 'giroconto');
  const pairedIdx = new Set<number>();
  const internalPairs: [FlussiCashMovement, FlussiCashMovement][] = [];

  const dayDiff = (a: string, b: string) =>
    Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

  const negatives = giroconti.filter(x => x.m.amount < 0)
    .sort((a, b) => a.m.movementDate.localeCompare(b.m.movementDate));
  const positives = giroconti.filter(x => x.m.amount > 0)
    .sort((a, b) => a.m.movementDate.localeCompare(b.m.movementDate));

  for (const neg of negatives) {
    let best: { idx: number; dist: number } | null = null;
    for (const pos of positives) {
      if (pairedIdx.has(pos.idx)) continue;
      if (pos.m.accountId === neg.m.accountId) continue;
      if (Math.abs(pos.m.amount + neg.m.amount) > 0.005) continue;
      const dist = dayDiff(pos.m.movementDate, neg.m.movementDate);
      if (dist > 5) continue;
      if (!best || dist < best.dist) best = { idx: pos.idx, dist };
      if (dist === 0) break; // stessa data valuta: non può esserci di meglio
    }
    if (best) {
      pairedIdx.add(neg.idx);
      pairedIdx.add(best.idx);
      const posMov = giroconti.find(x => x.idx === best!.idx)!.m;
      internalPairs.push([neg.m, posMov]);
    }
  }

  const external = movements.filter((_, idx) => !pairedIdx.has(idx));
  return { external, internalPairs };
}

export function buildDepositCandidates(movements: FlussiCashMovement[]): DepositCandidate[] {
  const { external } = pairInternalTransfers(movements);
  const byDate = new Map<string, FlussiCashMovement[]>();
  for (const m of external) {
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

// ============================================================================
// File Movimenti Titoli: DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;
//   NUMERO CONTO;CODICE ISIN;DESC TITOLO;DATA CONTABILE;DATA VALUTA;
//   DATA OPERAZIONE;DATA REGISTRAZIONE;CAUSALE;QUANTITA;PREZZO SECCO;
//   DIVISA DEL TITOLO;LORDO EMITTENTE;...;CAMBIO;...;COMMISSIONI;...;
//   CTV LORDO DIVISA;CTV LORDO EUR;CTV NETTO DIVISA CONTO;...
//
// Le operazioni in derivati hanno ISIN vuoto e il descrittore in DESC TITOLO:
//   [TICKER][CODICE MESE][CIFRA ANNO][C|P][STRIKE]   es. NVDAV7P200
// Codici mese (standard futures): F=gen G=feb H=mar J=apr K=mag M=giu
//                                  N=lug Q=ago U=set V=ott X=nov Z=dic
// ============================================================================

const MONTH_CODES: Record<string, number> = {
  F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
};

const MOV_TITOLI_DESCRIPTOR_RE = /^([A-Z0-9.]+?)([FGHJKMNQUVXZ])(\d)([CP])(\d+(?:[.,]\d+)?)$/;

export interface DecodedOptionDescriptor {
  underlyingTicker: string;
  optionType: 'call' | 'put';
  strike: number;
  /** Scadenza reale (terzo venerdì con festività), ISO */
  expiryDate: string;
  month: number;
  year: number;
}

/**
 * Decodifica il descrittore opzione dei movimenti titoli (es. 'NVDAV7P200'
 * = put NVDA strike 200 scadenza ottobre 2027). La cifra singola dell'anno
 * viene risolta rispetto alla data operazione: il primo anno >= anno
 * operazione con quell'ultima cifra; se la scadenza risultante è già
 * passata alla data operazione, si salta al decennio successivo.
 */
export function decodeOptionDescriptor(descriptor: string, tradeDateISO: string): DecodedOptionDescriptor | null {
  const desc = (descriptor || '').trim().toUpperCase();
  const m = desc.match(MOV_TITOLI_DESCRIPTOR_RE);
  if (!m) return null;

  const [, ticker, monthCode, yearDigitStr, cpFlag, strikeStr] = m;
  const month = MONTH_CODES[monthCode];
  if (!month) return null;

  const tradeDate = new Date(tradeDateISO);
  if (isNaN(tradeDate.getTime())) return null;
  const tradeYear = tradeDate.getFullYear();
  const yearDigit = parseInt(yearDigitStr, 10);

  // Primo anno >= anno operazione con ultima cifra combaciante
  let year = tradeYear + ((yearDigit - (tradeYear % 10)) + 10) % 10;
  let expiryISO = getOptionExpirationDateISO(year, month - 1); // mese 0-based (convenzione JS)
  // Un'opzione non può essere negoziata dopo la propria scadenza
  if (new Date(expiryISO).getTime() < tradeDate.getTime() - 24 * 3600 * 1000) {
    year += 10;
    expiryISO = getOptionExpirationDateISO(year, month - 1);
  }

  return {
    underlyingTicker: ticker,
    optionType: cpFlag === 'C' ? 'call' : 'put',
    strike: parseFloat(strikeStr.replace(',', '.')),
    expiryDate: expiryISO,
    month,
    year,
  };
}

function parseMovTitoliRow(cells: string[], result: FlussiParseResult, options?: FlussiParseOptions): void {
  const accountId = stripQuote(cells[3] || '');
  if (!accountId) return;

  // Stesse eccezioni cliente già usate per liquidità e movimenti cash.
  if (isExcludedAccount(accountId, options)) return;

  const causale = (cells[10] || '').trim().toUpperCase();
  if (causale !== 'ACQ' && causale !== 'VEN') return; // DIV, cedole, ecc. esclusi

  const isin = stripQuote(cells[4] || '').trim();
  const tradeDate = parseItalianDate(cells[8]) || parseItalianDate(cells[6]);
  if (!tradeDate) return;

  if (isin) {
    // Riga con ISIN = compravendita titoli (azioni/ETF): alimenta il calcolo
    // del PMC. Le opzioni USA hanno ISIN vuoto e vengono gestite sotto.
    const quantity = Math.abs(parseExcelNumber(cells[11]));
    const price = parseExcelNumber(cells[12]);
    if (!quantity || !price) return;
    result.titoliStockTrades.push({
      accountId,
      isin,
      description: stripQuote(cells[5] || '').trim(),
      side: causale as 'ACQ' | 'VEN',
      quantity,
      price,
      currency: (cells[13] || 'USD').trim() || 'USD',
      exchangeRate: parseExcelNumber(cells[16]) || 1,
      grossEUR: parseExcelNumber(cells[23]),
      commission: parseExcelNumber(cells[19]),
      tradeDate,
    });
    return;
  }

  const decoded = decodeOptionDescriptor(cells[5] || '', tradeDate);
  if (!decoded) return; // non è un descrittore opzione riconoscibile

  const contracts = Math.abs(parseExcelNumber(cells[11]));
  const pricePerShare = parseExcelNumber(cells[12]);
  if (!contracts || !pricePerShare) return;

  result.titoliOptionTrades.push({
    accountId,
    descriptor: (cells[5] || '').trim().toUpperCase(),
    underlyingTicker: decoded.underlyingTicker,
    optionType: decoded.optionType,
    strike: decoded.strike,
    expiryDate: decoded.expiryDate,
    side: causale as 'ACQ' | 'VEN',
    contracts,
    pricePerShare,
    currency: (cells[13] || 'USD').trim() || 'USD',
    exchangeRate: parseExcelNumber(cells[16]) || 1,
    grossEUR: parseExcelNumber(cells[23]),
    commission: parseExcelNumber(cells[19]),
    tradeDate,
  });
}
