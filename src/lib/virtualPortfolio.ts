/**
 * Portafoglio virtuale — logica pura.
 *
 * Il portafoglio virtuale = posizioni reali del portafoglio selezionato
 *   − posizioni reali rimosse (per chiave STABILE, sopravvive ai re-upload)
 *   + posizioni aggiunte a mano (singolarmente o in blocco da testo incollato).
 *
 * Le posizioni aggiunte sono costruite nello STESSO formato canonico prodotto da
 * flussiCsvParser (descrittore opzione "[AAPL][12/26][P][180]", contratti con segno,
 * controvalore EUR in valore assoluto, exchange_rate = divisa per 1 EUR), così tutto il
 * motore a valle (Stress Lab, Risk Analyzer, netting, classificazione strategie) le tratta
 * esattamente come posizioni reali.
 */

import { Position } from '@/types/portfolio';
import { getOptionExpirationDateISO } from '@/lib/optionExpiry';

export type VirtualKind = 'stock' | 'etf' | 'option';

/** Posizione aggiunta dall'utente (persistita). */
export interface VirtualPositionSpec {
  id: string;
  kind: VirtualKind;
  /** Ticker del titolo o del sottostante dell'opzione (es. AAPL, ENI.MI). */
  ticker: string;
  /** Azioni: numero di pezzi. Opzioni: contratti con segno (negativo = venduta). */
  qty: number;
  /** Prezzo in divisa. Opzioni: premio per azione (obbligatorio). Titoli: se assente → prezzo live. */
  price?: number;
  /** Divisa esplicita; se assente si deduce dal suffisso del ticker. */
  currency?: string;
  optionType?: 'call' | 'put';
  strike?: number;
  /** Scadenza ISO 'YYYY-MM-DD'. */
  expiry?: string;
}

export interface VirtualPortfolioState {
  version: 1;
  /** Chiavi stabili (positionKey) delle posizioni reali escluse. */
  removedKeys: string[];
  added: VirtualPositionSpec[];
}

export const EMPTY_VIRTUAL_STATE: VirtualPortfolioState = { version: 1, removedKeys: [], added: [] };

export const VIRTUAL_ID_PREFIX = 'virtual:';
export const OPT_MULT = 100;

export interface FxRates {
  USD: number;
  HKD: number;
}

export const DEFAULT_FX: FxRates = { USD: 1.15, HKD: 9.043 };

/* =============================== FX =============================== */

/** Cambi (divisa per 1 EUR) dalle posizioni reali: prima posizione USD/HKD con cambio valido. */
export function deriveFxRates(positions: Position[]): FxRates {
  const order: Position['asset_type'][] = ['stock', 'etf', 'commodity', 'bond', 'derivative'];
  const sorted = order.flatMap((t) => positions.filter((p) => p.asset_type === t));
  const pick = (ccy: string) =>
    sorted.find((p) => (p.currency || '').toUpperCase() === ccy && p.exchange_rate && p.exchange_rate > 0)
      ?.exchange_rate ?? null;
  return { USD: pick('USD') ?? DEFAULT_FX.USD, HKD: pick('HKD') ?? DEFAULT_FX.HKD };
}

/** Cambio divisa→EUR (unità di divisa per 1 EUR). EUR = 1; divise ignote trattate come USD. */
export function fxFor(ccy: string, fx: FxRates): number {
  const c = ccy.toUpperCase();
  if (c === 'EUR') return 1;
  if (c === 'HKD') return fx.HKD;
  return fx.USD;
}

const EUR_SUFFIXES = ['MI', 'PA', 'DE', 'F', 'AS', 'BR', 'MC', 'LS', 'VI', 'HE', 'IR', 'MU', 'BE', 'XETRA'];

/** Divisa dedotta dal ticker: suffissi di borse euro → EUR, .HK → HKD, .L → GBP, altrimenti USD. */
export function inferCurrency(ticker: string): string {
  const t = ticker.toUpperCase();
  const dot = t.lastIndexOf('.');
  if (dot < 0) return 'USD';
  const sfx = t.slice(dot + 1);
  if (sfx === 'HK') return 'HKD';
  if (sfx === 'L') return 'GBP';
  if (sfx === 'SW') return 'CHF';
  if (EUR_SUFFIXES.includes(sfx)) return 'EUR';
  return 'USD';
}

/* =============================== CHIAVI =============================== */

/**
 * Chiave STABILE di una posizione reale: non usa l'id (che cambia a ogni upload) ma
 * tipo + ISIN + descrizione + campi opzione. Così una posizione rimossa resta rimossa
 * anche dopo il caricamento di un nuovo snapshot.
 */
export function positionKey(p: Position): string {
  return [
    p.asset_type,
    (p.isin || '').toUpperCase(),
    (p.description || '').toUpperCase().trim(),
    p.option_type || '',
    p.strike_price ?? '',
    p.expiry_date || '',
  ].join('|');
}

export const isVirtualPosition = (p: Position) => p.id.startsWith(VIRTUAL_ID_PREFIX);

/* =============================== COSTRUZIONE POSIZIONI =============================== */

/** Descrittore opzione nel formato dei flussi bancari: [AAPL][12/26][P][180]. */
export function optionDescriptor(ticker: string, expiryISO: string, type: 'call' | 'put', strike: number): string {
  const [y, m] = expiryISO.split('-');
  return `[${ticker.toUpperCase()}][${m}/${y.slice(2)}][${type === 'call' ? 'C' : 'P'}][${strike}]`;
}

/**
 * Converte una spec in Position canonica. `livePrice` serve ai titoli senza prezzo
 * inserito. Ritorna null se manca un dato indispensabile (prezzo non ancora disponibile).
 */
export function specToPosition(
  spec: VirtualPositionSpec,
  portfolioId: string,
  fx: FxRates,
  livePrice?: { price: number; currency?: string } | null,
): Position | null {
  const ticker = spec.ticker.toUpperCase().trim();
  const now = new Date().toISOString();
  const base = {
    id: VIRTUAL_ID_PREFIX + spec.id,
    portfolio_id: portfolioId,
    isin: null,
    avg_cost: null,
    profit_loss: null,
    profit_loss_pct: null,
    weight_pct: null,
    created_at: now,
    updated_at: now,
  };

  if (spec.kind === 'option') {
    if (!spec.optionType || !spec.strike || !spec.expiry || !(spec.price! > 0)) return null;
    const ccy = (spec.currency || inferCurrency(ticker)).toUpperCase();
    const rate = fxFor(ccy, fx);
    const mv = (Math.abs(spec.qty) * OPT_MULT * spec.price!) / rate;
    return {
      ...base,
      ticker: null,
      description: optionDescriptor(ticker, spec.expiry, spec.optionType, spec.strike),
      asset_type: 'derivative',
      currency: ccy,
      exchange_rate: rate,
      quantity: spec.qty,
      current_price: spec.price!,
      market_value: mv,
      option_type: spec.optionType,
      strike_price: spec.strike,
      expiry_date: spec.expiry,
      underlying: ticker,
      snapshot_price: spec.price!,
      snapshot_market_value: mv,
    };
  }

  const px = spec.price && spec.price > 0 ? spec.price : livePrice?.price && livePrice.price > 0 ? livePrice.price : null;
  if (!px) return null;
  const ccy = (
    spec.currency ||
    (spec.price && spec.price > 0 ? undefined : livePrice?.currency) ||
    inferCurrency(ticker)
  ).toUpperCase();
  const rate = fxFor(ccy, fx);
  const mv = (spec.qty * px) / rate;
  return {
    ...base,
    ticker,
    description: ticker,
    asset_type: spec.kind,
    currency: ccy,
    exchange_rate: rate,
    quantity: spec.qty,
    current_price: px,
    market_value: mv,
    option_type: null,
    strike_price: null,
    expiry_date: null,
    underlying: null,
    snapshot_price: px,
    snapshot_market_value: mv,
  };
}

/** Posizioni del portafoglio virtuale: reali non rimosse + aggiunte risolte. */
export function buildVirtualPositions(
  real: Position[],
  state: VirtualPortfolioState,
  portfolioId: string,
  fx: FxRates,
  livePrices: Record<string, { price: number; currency?: string }>,
): { positions: Position[]; pending: VirtualPositionSpec[] } {
  const removed = new Set(state.removedKeys);
  const kept = real.filter((p) => !removed.has(positionKey(p)));
  const pending: VirtualPositionSpec[] = [];
  const added: Position[] = [];
  for (const s of state.added) {
    const p = specToPosition(s, portfolioId, fx, livePrices[s.ticker.toUpperCase()]);
    if (p) added.push(p);
    else pending.push(s);
  }
  return { positions: [...kept, ...added], pending };
}

/* =============================== PARSER TESTO =============================== */

export interface ParseError {
  line: number;
  text: string;
  reason: string;
}

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;
const CCY_SET = new Set(['EUR', 'USD', 'HKD', 'GBP', 'CHF']);
const BANK_DESC_RE = /^\[([A-Z0-9.\-]+)\]\[(\d{1,2})\/(\d{2})\]\[([CP])\]\[([\d.,]+)\]$/i;

/** Numero con virgola o punto decimale ("5,30" · "1.234,5" · "1,234.5" · "-2"). */
export function parseNum(tok: string): number | null {
  let t = tok.trim().replace(/[€$]/g, '');
  if (!/^[+-]?[\d.,]+$/.test(t)) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // separatore decimale = l'ultimo dei due
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    t = t.replace(',', '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Data → ISO. Accetta YYYY-MM-DD, DD/MM/YYYY, DD/MM/YY, DD.MM.YYYY, e MM/YY (mensile: terzo venerdì). */
export function parseExpiry(tok: string): string | null {
  const t = tok.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  m = t.match(/^(\d{1,2})\/(\d{2})$/);
  if (m) {
    const mo = +m[1];
    if (mo < 1 || mo > 12) return null;
    return getOptionExpirationDateISO(2000 + +m[2], mo - 1);
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

let idSeq = 0;
export function newSpecId(): string {
  idSeq = (idSeq + 1) % 1e6;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idSeq}`;
}

/**
 * Parser del testo incollato (una posizione per riga). Separatori: spazi, tab, ';', '|'.
 *
 * Titoli:   TICKER QTA [PREZZO] [DIVISA]           es. "AAPL 100", "ENI.MI 500 14,2 EUR"
 *           prefisso/suffisso "ETF" per gli ETF    es. "ETF SPY 50"
 * Opzioni:  TICKER C|P STRIKE SCADENZA QTA PREMIO   es. "NVDA P 150 2026-12-18 -2 7,40"
 *           descrittore banca + QTA PREMIO         es. "[NVDA][12/26][P][150] -2 7,40"
 *           SCADENZA: 2026-12-18 · 18/12/2026 · 12/26 (mensile = terzo venerdì)
 * Righe vuote, che iniziano con '#' o intestazioni senza numeri vengono ignorate.
 */
export function parseVirtualPositionsText(text: string): { specs: VirtualPositionSpec[]; errors: ParseError[] } {
  const specs: VirtualPositionSpec[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const toks = line.split(/[\s;|]+/).filter(Boolean);
    const fail = (reason: string) => errors.push({ line: i + 1, text: line, reason });
    // intestazione (nessun numero) → ignorata
    if (!toks.some((t) => /\d/.test(t))) return;

    // --- descrittore banca ---
    const bank = toks[0].match(BANK_DESC_RE);
    if (bank) {
      const [, tk, mm, yy, cp, kRaw] = bank;
      const mo = +mm;
      const strike = parseNum(kRaw);
      const nums = toks.slice(1).map(parseNum);
      if (mo < 1 || mo > 12) return fail('mese scadenza non valido');
      if (!strike || strike <= 0) return fail('strike non valido');
      if (nums.length < 2 || nums.some((n) => n === null)) return fail('servono QTA e PREMIO dopo il descrittore');
      const [qty, price] = nums as number[];
      if (!qty || !Number.isInteger(qty)) return fail('quantità contratti non valida (intero ≠ 0)');
      if (!(price > 0)) return fail('premio mancante o ≤ 0');
      specs.push({
        id: newSpecId(),
        kind: 'option',
        ticker: tk.toUpperCase(),
        qty,
        price,
        optionType: cp.toUpperCase() === 'C' ? 'call' : 'put',
        strike,
        expiry: getOptionExpirationDateISO(2000 + +yy, mo - 1),
      });
      return;
    }

    let rest = toks.map((t) => t.toUpperCase());
    let isEtf = false;
    if (rest.includes('ETF')) {
      isEtf = true;
      rest = rest.filter((t) => t !== 'ETF');
    }
    const ticker = rest[0];
    if (!ticker || !TICKER_RE.test(ticker)) return fail('ticker non riconosciuto');
    rest = rest.slice(1);

    const cpIdx = rest.findIndex((t) => ['C', 'P', 'CALL', 'PUT'].includes(t));
    if (cpIdx >= 0) {
      const optionType: 'call' | 'put' = rest[cpIdx].startsWith('C') ? 'call' : 'put';
      const others = rest.filter((_, j) => j !== cpIdx);
      const dateIdx = others.findIndex((t) => parseExpiry(t) !== null);
      if (dateIdx < 0) return fail('scadenza mancante (es. 2026-12-18, 18/12/2026, 12/26)');
      const expiry = parseExpiry(others[dateIdx])!;
      const nums = others.filter((_, j) => j !== dateIdx).map(parseNum);
      if (nums.some((n) => n === null)) return fail('valore numerico non valido');
      if (nums.length < 3) return fail('servono STRIKE, QTA e PREMIO');
      const [strike, qty, price] = nums as number[];
      if (!(strike > 0)) return fail('strike non valido');
      if (!qty || !Number.isInteger(qty)) return fail('quantità contratti non valida (intero ≠ 0)');
      if (!(price > 0)) return fail('premio mancante o ≤ 0');
      specs.push({ id: newSpecId(), kind: 'option', ticker, qty, price, optionType, strike, expiry });
      return;
    }

    let currency: string | undefined;
    const ccyIdx = rest.findIndex((t) => CCY_SET.has(t));
    if (ccyIdx >= 0) {
      currency = rest[ccyIdx];
      rest = rest.filter((_, j) => j !== ccyIdx);
    }
    const nums = rest.map(parseNum);
    if (nums.length === 0 || nums.some((n) => n === null)) return fail('quantità mancante o non valida');
    const [qty, price] = nums as number[];
    if (!qty) return fail('quantità = 0');
    if (price !== undefined && !(price > 0)) return fail('prezzo ≤ 0');
    specs.push({
      id: newSpecId(),
      kind: isEtf ? 'etf' : 'stock',
      ticker,
      qty,
      ...(price !== undefined ? { price } : {}),
      ...(currency ? { currency } : {}),
    });
  });
  return { specs, errors };
}

/* =============================== PERSISTENZA =============================== */

export const storageKey = (portfolioId: string) => `virtual-portfolio:v1:${portfolioId}`;

/** Legge lo stato salvato tollerando JSON corrotto o formati inattesi. */
export function parseStoredState(raw: string | null): VirtualPortfolioState {
  if (!raw) return EMPTY_VIRTUAL_STATE;
  try {
    const o = JSON.parse(raw);
    if (!o || o.version !== 1) return EMPTY_VIRTUAL_STATE;
    const removedKeys = Array.isArray(o.removedKeys) ? o.removedKeys.filter((k: unknown) => typeof k === 'string') : [];
    const added = Array.isArray(o.added)
      ? o.added.filter(
          (s: any) =>
            s && typeof s.id === 'string' && typeof s.ticker === 'string' && typeof s.qty === 'number' &&
            ['stock', 'etf', 'option'].includes(s.kind),
        )
      : [];
    return { version: 1, removedKeys, added };
  } catch {
    return EMPTY_VIRTUAL_STATE;
  }
}

/* =============================== VALIDAZIONE (form singolo) =============================== */

/** Valida una spec inserita dal form singolo. Ritorna il motivo dell'errore o null. */
export function validateSpec(spec: Omit<VirtualPositionSpec, 'id'>): string | null {
  const t = (spec.ticker || '').toUpperCase().trim();
  if (!t || !TICKER_RE.test(t)) return 'Ticker non valido';
  if (!Number.isFinite(spec.qty) || spec.qty === 0) return 'Quantità non valida';
  if (spec.kind === 'option') {
    if (!Number.isInteger(spec.qty)) return 'I contratti devono essere un numero intero';
    if (spec.optionType !== 'call' && spec.optionType !== 'put') return 'Tipo opzione mancante';
    if (!(spec.strike! > 0)) return 'Strike non valido';
    if (!spec.expiry || !parseExpiry(spec.expiry)) return 'Scadenza non valida';
    if (!(spec.price! > 0)) return 'Premio obbligatorio (> 0)';
    return null;
  }
  if (spec.price !== undefined && !(spec.price > 0)) return 'Prezzo non valido';
  return null;
}
