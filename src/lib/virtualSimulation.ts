/**
 * Portafoglio virtuale — simulazione (logica pura).
 *
 *  1. UNIVERSO: strumenti detenuti da TUTTI i clienti nei portafogli più aggiornati
 *     (tabella positions = ultimo caricamento di ogni portafoglio). Per ogni sottostante:
 *     spot, smile di volatilità implicita ricavato dalle opzioni OTM detenute (premio
 *     snapshot + spot congelato dello stesso snapshot → IV coerente), numero di clienti.
 *  2. MIX EMPIRICO: dagli snapshot storici completi (Visualizzazione storica) la
 *     distribuzione delle put vendute per moneyness (OTM / ATM / ITM) e durata residua.
 *  3. GENERATORE: put vendute casuali su sottostanti estratti dall'universo, fino
 *     all'esposizione obiettivo (Strike × Contratti × 100 / Cambio, stessa formula delle
 *     naked put del Risk Analyzer), premio teorico Black-76 con l'IV interpolata allo strike.
 */

import { getOptionExpirationDateISO } from '@/lib/optionExpiry';
import { bsPrice, impliedVolFromPrice, rollStrikeIncrement, yearsToExpiry } from '@/lib/stressLab';
import { resolveUnderlyingTickerFromMappings, UnderlyingMappingRow } from '@/lib/underlyingTickerResolve';
import { FxRates, VirtualPositionSpec, fxFor, inferCurrency, newSpecId, OPT_MULT } from '@/lib/virtualPortfolio';

/* =============================== TIPI =============================== */

/** Posizione grezza (colonne di positions / JSONB degli snapshot) usata per l'universo. */
export interface RawPosition {
  portfolio_id: string;
  asset_type: string;
  description: string | null;
  underlying?: string | null;
  ticker?: string | null;
  option_type?: string | null;
  strike_price?: number | string | null;
  expiry_date?: string | null;
  quantity?: number | string | null;
  snapshot_price?: number | string | null;
  current_price?: number | string | null;
  currency?: string | null;
  exchange_rate?: number | string | null;
}

export interface IvPoint {
  /** Strike / spot − 1 (put: > 0 ITM, < 0 OTM). */
  m: number;
  iv: number;
  /** Anni a scadenza alla data dello snapshot. */
  T: number;
  date: string;
}

export interface UniverseUnderlying {
  ticker: string;
  /** Nome come appare nelle posizioni dei clienti. */
  name: string;
  currency: string;
  spot: number;
  spotSource: 'live' | 'snapshot';
  /** Punti dello smile (solo opzioni OTM dello snapshot più recente, ± 7 giorni). */
  ivPoints: IvPoint[];
  /** IV ATM a ~2 mesi (m = 0, T = IV_REF_T). */
  ivAtm: number;
  clients: number;
  soldPuts: number;
  latestDate: string;
}

export interface UniverseInstrument {
  key: string;
  kind: 'option' | 'stock' | 'etf';
  ticker: string;
  name: string;
  optionType?: 'call' | 'put';
  strike?: number;
  expiry?: string;
  /** Prezzo (premio per azione per le opzioni) dello snapshot più recente. */
  price: number | null;
  currency: string;
  iv: number | null;
  /** Moneyness rispetto allo spot dell'universo (opzioni). */
  moneyness: number | null;
  clients: number;
  totalQty: number;
  latestDate: string;
}

export interface UniverseInput {
  portfolios: { id: string; snapshot_date: string | null }[];
  positions: RawPosition[];
  /** Spot congelati per portafoglio alla sua data snapshot (historical_data.snapshot_underlying_prices). */
  snapshotSpots: Record<string, Record<string, number>>;
  /** Spot live per ticker (underlying_prices). */
  liveSpots: Record<string, { price: number; currency?: string }>;
  mappings: UnderlyingMappingRow[];
  riskFree: number;
}

export interface Universe {
  underlyings: UniverseUnderlying[];
  instruments: UniverseInstrument[];
}

/* =============================== UTIL =============================== */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const snapRef = (date: string) => new Date(date + 'T16:00:00Z');

const DAY_MS = 24 * 3600 * 1000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

/** PRNG deterministico (mulberry32): stesso seed → stessa estrazione. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Banda del kernel: strike relativo (5 punti di moneyness) e durata (fattore ~1,65 su T). */
export const IV_KERNEL_M = 0.05;
export const IV_KERNEL_LNT = 0.5;
/** Opzioni con meno di 10 giorni residui: IV rumorosa, usate solo se non c'è altro. */
export const IV_MIN_T = 10 / 365.25;
/** Durata di riferimento per l'"IV ATM" mostrata (≈ 2 mesi). */
export const IV_REF_T = 60 / 365.25;

/**
 * IV allo strike relativo m (K/S − 1) e, se indicata, alla durata T (anni).
 *  - senza T: interpolazione lineare in m fra i punti dello smile (duplicati mediati), piatta
 *    oltre gli estremi;
 *  - con T: media pesata a kernel gaussiano su moneyness (banda 5%) e log-durata (banda 0,5),
 *    così una put a 2 mesi usa soprattutto l'IV delle opzioni a 1–3 mesi dello stesso
 *    strike relativo, non quella delle settimanali o dei LEAPS. Escluse le opzioni a meno di
 *    10 giorni se ce ne sono altre.
 * null se nessun punto valido.
 */
export function ivAtMoneyness(points: IvPoint[], m: number, T?: number): number | null {
  const valid = points.filter((p) => Number.isFinite(p.iv) && p.iv > 0);
  if (!valid.length) return null;
  if (T != null && T > 0) {
    const longer = valid.filter((p) => p.T >= IV_MIN_T);
    const pts = longer.length ? longer : valid;
    const lw = pts.map((p) => {
      const dm = (m - p.m) / IV_KERNEL_M;
      const dt = Math.log(T / Math.max(p.T, 1e-4)) / IV_KERNEL_LNT;
      return -0.5 * (dm * dm + dt * dt);
    });
    const mx = Math.max(...lw);
    let sw = 0;
    let siv = 0;
    pts.forEach((p, i) => {
      const w = Math.exp(lw[i] - mx);
      sw += w;
      siv += w * p.iv;
    });
    return sw > 0 ? siv / sw : null;
  }
  const byM = new Map<number, number[]>();
  for (const p of valid) {
    const k = Math.round(p.m * 10000) / 10000;
    (byM.get(k) ?? byM.set(k, []).get(k)!).push(p.iv);
  }
  const pts = [...byM.entries()]
    .map(([mm, ivs]) => ({ m: mm, iv: ivs.reduce((a, b) => a + b, 0) / ivs.length }))
    .sort((a, b) => a.m - b.m);
  if (m <= pts[0].m) return pts[0].iv;
  if (m >= pts[pts.length - 1].m) return pts[pts.length - 1].iv;
  for (let i = 1; i < pts.length; i++) {
    if (m <= pts[i].m) {
      const a = pts[i - 1];
      const b = pts[i];
      const w = (m - a.m) / (b.m - a.m);
      return a.iv + w * (b.iv - a.iv);
    }
  }
  return pts[pts.length - 1].iv;
}

/** Fascia di moneyness di una put: |K/S − 1| ≤ banda → ATM; sopra → ITM; sotto → OTM. */
export type MoneynessBucket = 'otm' | 'atm' | 'itm';
export function putBucket(m: number, atmBand: number): MoneynessBucket {
  if (Math.abs(m) <= atmBand + 1e-12) return 'atm';
  return m > 0 ? 'itm' : 'otm';
}

/* =============================== UNIVERSO =============================== */

interface OptRow {
  pid: string;
  date: string;
  ticker: string;
  name: string;
  type: 'call' | 'put';
  K: number;
  exp: string;
  q: number;
  px: number;
  ccy: string;
  snapSpot: number | null;
}

export function buildUniverse(inp: UniverseInput): Universe {
  const snapDate = new Map(inp.portfolios.map((p) => [p.id, p.snapshot_date]));
  const tickerOf = (p: RawPosition) =>
    resolveUnderlyingTickerFromMappings(p.underlying || p.ticker || p.description, inp.mappings);

  const opts: OptRow[] = [];
  const equities: { pid: string; date: string; ticker: string; name: string; kind: 'stock' | 'etf'; q: number; px: number; ccy: string }[] = [];

  for (const p of inp.positions) {
    const date = snapDate.get(p.portfolio_id);
    if (!date) continue;
    const px = num(p.snapshot_price) ?? num(p.current_price);
    if (p.asset_type === 'derivative') {
      const K = num(p.strike_price);
      const type = p.option_type === 'call' || p.option_type === 'put' ? p.option_type : null;
      if (!K || K <= 0 || !type || !p.expiry_date || !(px! > 0)) continue;
      if (yearsToExpiry(p.expiry_date, snapRef(date)) <= 0) continue;
      const ticker = tickerOf(p);
      if (!ticker) continue;
      const name = p.underlying || p.description || ticker;
      const spots = inp.snapshotSpots[p.portfolio_id] ?? {};
      const snapSpot = num(spots[name]) ?? null;
      opts.push({
        pid: p.portfolio_id,
        date,
        ticker,
        name,
        type,
        K,
        exp: p.expiry_date,
        q: num(p.quantity) ?? 0,
        px: px!,
        ccy: (p.currency || 'USD').toUpperCase(),
        snapSpot: snapSpot && snapSpot > 0 ? snapSpot : null,
      });
    } else if (p.asset_type === 'stock' || p.asset_type === 'etf') {
      const t = (p.ticker || '').toUpperCase().trim() || tickerOf(p);
      if (!t || !(px! > 0)) continue;
      equities.push({
        pid: p.portfolio_id,
        date,
        ticker: t,
        name: p.description || t,
        kind: p.asset_type,
        q: num(p.quantity) ?? 0,
        px: px!,
        ccy: (p.currency || 'EUR').toUpperCase(),
      });
    }
  }

  // Spot congelato di un ticker alla data più recente in cui è noto (fallback del live).
  const snapSpotByTicker = new Map<string, { S: number; date: string }>();
  for (const o of opts) {
    if (!o.snapSpot) continue;
    const cur = snapSpotByTicker.get(o.ticker);
    if (!cur || o.date > cur.date) snapSpotByTicker.set(o.ticker, { S: o.snapSpot, date: o.date });
  }
  for (const e of equities) {
    const cur = snapSpotByTicker.get(e.ticker);
    if (!cur || e.date > cur.date) snapSpotByTicker.set(e.ticker, { S: e.px, date: e.date });
  }

  // IV di ogni opzione: premio snapshot vs spot congelato dello STESSO snapshot.
  const ivOf = (o: OptRow): number | null => {
    const S = o.snapSpot ?? snapSpotByTicker.get(o.ticker)?.S ?? null;
    if (!S) return null;
    const T = yearsToExpiry(o.exp, snapRef(o.date));
    const iv = impliedVolFromPrice(o.px, S, o.K, T, inp.riskFree, o.type === 'call');
    return Number.isFinite(iv) && iv >= 0.03 && iv <= 3 ? iv : null;
  };

  const byTicker = new Map<string, OptRow[]>();
  for (const o of opts) (byTicker.get(o.ticker) ?? byTicker.set(o.ticker, []).get(o.ticker)!).push(o);

  const underlyings: UniverseUnderlying[] = [];
  const spotOf = new Map<string, number>();
  for (const [ticker, rows] of byTicker) {
    const live = inp.liveSpots[ticker];
    const snap = snapSpotByTicker.get(ticker);
    const spot = live?.price && live.price > 0 ? live.price : snap?.S ?? null;
    if (!spot) continue;
    spotOf.set(ticker, spot);
    const latestDate = rows.reduce((d, r) => (r.date > d ? r.date : d), rows[0].date);
    // Smile: solo opzioni OTM (put K<S, call K>S) ± 2% ATM, dagli snapshot entro 7 giorni dal più recente.
    const ivPoints: IvPoint[] = [];
    for (const r of rows) {
      if (daysBetween(r.date, latestDate) > 7) continue;
      const S = r.snapSpot ?? snap?.S;
      if (!S) continue;
      const m = r.K / S - 1;
      const otm = r.type === 'put' ? m <= 0.02 : m >= -0.02;
      if (!otm) continue;
      const iv = ivOf(r);
      if (iv == null) continue;
      ivPoints.push({ m, iv, T: yearsToExpiry(r.exp, snapRef(r.date)), date: r.date });
    }
    const ivAtm = ivAtMoneyness(ivPoints, 0, IV_REF_T);
    if (ivAtm == null) continue;
    underlyings.push({
      ticker,
      name: rows.find((r) => r.date === latestDate)?.name ?? rows[0].name,
      currency: rows[0].ccy,
      spot,
      spotSource: live?.price && live.price > 0 ? 'live' : 'snapshot',
      ivPoints,
      ivAtm,
      clients: new Set(rows.map((r) => r.pid)).size,
      soldPuts: rows.filter((r) => r.type === 'put' && r.q < 0).length,
      latestDate,
    });
  }
  underlyings.sort((a, b) => a.ticker.localeCompare(b.ticker));

  // Strumenti attuali (dedup tra clienti): opzioni per ticker/tipo/strike/scadenza, titoli per ticker.
  const inst = new Map<string, UniverseInstrument & { pids: Set<string> }>();
  for (const o of opts) {
    const key = `option|${o.ticker}|${o.type}|${o.K}|${o.exp}`;
    const cur = inst.get(key);
    const S = spotOf.get(o.ticker) ?? null;
    if (!cur) {
      inst.set(key, {
        key, kind: 'option', ticker: o.ticker, name: o.name, optionType: o.type, strike: o.K, expiry: o.exp,
        price: o.px, currency: o.ccy, iv: ivOf(o), moneyness: S ? o.K / S - 1 : null,
        clients: 0, totalQty: 0, latestDate: o.date, pids: new Set(),
      });
    } else if (o.date > cur.latestDate) {
      cur.price = o.px;
      cur.iv = ivOf(o);
      cur.latestDate = o.date;
    }
    const it = inst.get(key)!;
    it.pids.add(o.pid);
    it.totalQty += o.q;
  }
  for (const e of equities) {
    const key = `${e.kind}|${e.ticker}`;
    const cur = inst.get(key);
    if (!cur) {
      inst.set(key, {
        key, kind: e.kind, ticker: e.ticker, name: e.name, price: e.px, currency: e.ccy, iv: null, moneyness: null,
        clients: 0, totalQty: 0, latestDate: e.date, pids: new Set(),
      });
    } else if (e.date > cur.latestDate) {
      cur.price = e.px;
      cur.latestDate = e.date;
    }
    const it = inst.get(key)!;
    it.pids.add(e.pid);
    it.totalQty += e.q;
  }
  const instruments: UniverseInstrument[] = [...inst.values()].map(({ pids, ...rest }) => ({ ...rest, clients: pids.size }));

  return { underlyings, instruments };
}

/* =============================== MIX EMPIRICO =============================== */

export interface EmpiricalSample {
  m: number;
  dte: number;
  w: number;
}

export interface EmpiricalStats {
  samples: EmpiricalSample[];
  pct: Record<MoneynessBucket, number>;
  /** Moneyness media ponderata per fascia. */
  meanM: Record<MoneynessBucket, number | null>;
  medianDte: number | null;
  legs: number;
  snapshots: number;
  portfolios: number;
  firstDate: string | null;
  lastDate: string | null;
  atmBand: number;
}

export interface HistoricalSnapshotInput {
  portfolio_id: string;
  snapshot_date: string;
  positions: RawPosition[];
}

/**
 * Distribuzione empirica delle put VENDUTE negli snapshot storici. Pesi: ogni portafoglio
 * pesa uguale, ogni suo snapshot pesa uguale, dentro lo snapshot pesa l'esposizione
 * (Strike × Contratti × 100 / Cambio). Così un cliente con molti caricamenti o con un
 * patrimonio grande non domina il mix. Gambe senza spot congelato escluse.
 */
export function buildEmpiricalPutStats(
  snapshots: HistoricalSnapshotInput[],
  /** Spot congelati per chiave `${portfolio_id}|${snapshot_date}` → nome sottostante → prezzo. */
  snapshotSpots: Record<string, Record<string, number>>,
  atmBand: number,
  sinceDate?: string | null,
): EmpiricalStats {
  type Leg = { pid: string; key: string; m: number; dte: number; exp: number };
  const legs: Leg[] = [];
  for (const s of snapshots) {
    if (sinceDate && s.snapshot_date < sinceDate) continue;
    const spots = snapshotSpots[`${s.portfolio_id}|${s.snapshot_date}`] ?? {};
    for (const p of s.positions || []) {
      if (p.asset_type !== 'derivative' || p.option_type !== 'put') continue;
      const q = num(p.quantity) ?? 0;
      const K = num(p.strike_price);
      if (q >= 0 || !K || !p.expiry_date) continue;
      const name = p.underlying || p.description || '';
      const S = num(spots[name]);
      if (!S || S <= 0) continue;
      const dte = Math.round(daysBetween(s.snapshot_date, p.expiry_date));
      if (dte < 0) continue;
      const fx = num(p.exchange_rate) || 1;
      legs.push({ pid: s.portfolio_id, key: `${s.portfolio_id}|${s.snapshot_date}`, m: K / S - 1, dte, exp: (K * Math.abs(q) * OPT_MULT) / fx });
    }
  }
  const snapExp = new Map<string, number>();
  const pfSnaps = new Map<string, Set<string>>();
  for (const l of legs) {
    snapExp.set(l.key, (snapExp.get(l.key) ?? 0) + l.exp);
    (pfSnaps.get(l.pid) ?? pfSnaps.set(l.pid, new Set()).get(l.pid)!).add(l.key);
  }
  const nPf = pfSnaps.size;
  const samples: EmpiricalSample[] = legs.map((l) => ({
    m: l.m,
    dte: l.dte,
    w: nPf ? (1 / nPf) * (1 / pfSnaps.get(l.pid)!.size) * (l.exp / (snapExp.get(l.key) || 1)) : 0,
  }));
  const pct: Record<MoneynessBucket, number> = { otm: 0, atm: 0, itm: 0 };
  const mSum: Record<MoneynessBucket, number> = { otm: 0, atm: 0, itm: 0 };
  for (const s of samples) {
    const b = putBucket(s.m, atmBand);
    pct[b] += s.w;
    mSum[b] += s.w * s.m;
  }
  const tot = pct.otm + pct.atm + pct.itm;
  const meanM = {
    otm: pct.otm > 0 ? mSum.otm / pct.otm : null,
    atm: pct.atm > 0 ? mSum.atm / pct.atm : null,
    itm: pct.itm > 0 ? mSum.itm / pct.itm : null,
  };
  if (tot > 0) (Object.keys(pct) as MoneynessBucket[]).forEach((k) => (pct[k] /= tot));
  const sortedDte = [...samples].sort((a, b) => a.dte - b.dte);
  let medianDte: number | null = null;
  let acc = 0;
  for (const s of sortedDte) {
    acc += s.w;
    if (acc >= (tot || 1) / 2) {
      medianDte = s.dte;
      break;
    }
  }
  const keys = [...snapExp.keys()];
  const dates = keys.map((k) => k.split('|')[1]).sort();
  return {
    samples,
    pct,
    meanM,
    medianDte,
    legs: legs.length,
    snapshots: keys.length,
    portfolios: nPf,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    atmBand,
  };
}

/** Estrazione ponderata di un campione (opzionalmente solo di una fascia). */
export function drawSample(
  samples: EmpiricalSample[],
  rnd: () => number,
  bucket?: MoneynessBucket,
  atmBand = 0.02,
): EmpiricalSample | null {
  const pool = bucket ? samples.filter((s) => putBucket(s.m, atmBand) === bucket) : samples;
  const tot = pool.reduce((a, s) => a + s.w, 0);
  if (!pool.length || tot <= 0) return null;
  let x = rnd() * tot;
  for (const s of pool) {
    x -= s.w;
    if (x <= 0) return s;
  }
  return pool[pool.length - 1];
}

/* =============================== SCADENZE / STRIKE =============================== */

/** Scadenze mensili (terzo venerdì, festività USA) dei prossimi `months` mesi con DTE ≥ minDte. */
export function monthlyExpiries(today: Date, months = 24, minDte = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i <= months; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
    const e = getOptionExpirationDateISO(d.getUTCFullYear(), d.getUTCMonth());
    if (yearsToExpiry(e, today) * 365.25 >= minDte) out.push(e);
  }
  return out;
}

/** Scadenza mensile più vicina a oggi + dte giorni. */
export function nearestMonthly(today: Date, dte: number, expiries: string[]): string | null {
  if (!expiries.length) return null;
  const target = today.getTime() + dte * DAY_MS;
  let best = expiries[0];
  let bd = Infinity;
  for (const e of expiries) {
    const d = Math.abs(Date.parse(e + 'T16:00:00Z') - target);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export interface ListedChain {
  expiry: string;
  strikes: number[];
}

/**
 * Strike quotato più vicino al target: catena reale della scadenza più vicina
 * (option_listed_strikes, entro 45 giorni); altrimenti regola 2,5 / 5 / 10 sullo spot.
 * L'arrotondamento non cambia lato: un target sotto lo spot resta sotto (OTM per una put),
 * uno sopra resta sopra (ITM); un target = spot prende lo strike più vicino.
 */
export function pickListedStrike(
  target: number,
  spot: number,
  expiry: string,
  chains: ListedChain[] | undefined,
): { K: number; source: 'chain' | 'rule' } {
  const eps = spot * 1e-9;
  const side = target < spot - eps ? 'below' : target > spot + eps ? 'above' : 'any';
  const okSide = (k: number) => side === 'any' || (side === 'below' ? k < spot : k > spot);
  const nearest = (ks: number[]) =>
    ks.filter(okSide).reduce<number | null>((a, b) => (a == null || Math.abs(b - target) < Math.abs(a - target) ? b : a), null);

  const usable = (chains ?? []).filter((c) => (c.strikes ?? []).filter((k) => k > 0).length >= 2);
  if (usable.length) {
    const t = Date.parse(expiry);
    const ch = usable.reduce((a, b) => (Math.abs(Date.parse(b.expiry) - t) < Math.abs(Date.parse(a.expiry) - t) ? b : a));
    if (Math.abs(Date.parse(ch.expiry) - t) <= 45 * DAY_MS) {
      const ks = ch.strikes.filter((k) => k > 0);
      if (target >= Math.min(...ks) && target <= Math.max(...ks)) {
        const K = nearest(ks);
        if (K != null) return { K, source: 'chain' };
      }
    }
  }
  const step = rollStrikeIncrement(spot);
  const lo = Math.floor(target / step) * step;
  const cands = [lo, lo + step, lo + 2 * step, lo - step].filter((k) => k > 0).map((k) => Math.round(k * 100) / 100);
  const K = nearest(cands) ?? Math.max(step, Math.round(target / step) * step);
  return { K: Math.round(K * 100) / 100, source: 'rule' };
}

/* =============================== PREMIO TEORICO =============================== */

/**
 * Premio teorico per azione (Black-76, IV dei clienti allo strike relativo e alla durata,
 * vedi ivAtMoneyness). Mai sotto
 * l'intrinseco (americane). Arrotondato al centesimo, minimo 0,01. null se manca l'IV.
 */
export function theoreticalPremium(
  u: Pick<UniverseUnderlying, 'spot' | 'ivPoints'>,
  type: 'call' | 'put',
  K: number,
  expiry: string,
  r: number,
  today: Date,
): { price: number; iv: number; T: number } | null {
  const T = yearsToExpiry(expiry, today);
  if (T <= 0 || !(K > 0) || !(u.spot > 0)) return null;
  const iv = ivAtMoneyness(u.ivPoints, K / u.spot - 1, T);
  if (iv == null) return null;
  const F = u.spot * Math.exp(r * T);
  const bs = bsPrice(F, K, T, iv, type === 'call', r);
  const intr = type === 'call' ? Math.max(0, u.spot - K) : Math.max(0, K - u.spot);
  const price = Math.max(0.01, Math.ceil(Math.max(bs, intr) * 100) / 100);
  return { price, iv, T };
}

/* =============================== GENERATORE =============================== */

export type MixMode = 'single' | 'empirical' | 'manual';

export interface ManualMix {
  otmPct: number;
  atmPct: number;
  itmPct: number;
  /** Moneyness per fascia (K/S − 1): es. −0,10 OTM, 0 ATM, +0,05 ITM. */
  otmM: number;
  atmM: number;
  itmM: number;
}

export interface GenerateParams {
  targetExposureEUR: number;
  nUnderlyings: number;
  mode: MixMode;
  /** Livello unico (mode 'single'): K/S − 1, negativo = OTM, positivo = ITM. */
  singleM: number;
  manual: ManualMix;
  empirical: EmpiricalStats | null;
  expiryMode: 'fixed' | 'empirical';
  fixedExpiry: string | null;
  seed: number;
  today: Date;
  riskFree: number;
  fx: FxRates;
  chains: Record<string, ListedChain[]>;
}

export interface GeneratedRow {
  ticker: string;
  bucket: MoneynessBucket;
  targetM: number;
  m: number;
  K: number;
  strikeSource: 'chain' | 'rule';
  expiry: string;
  spot: number;
  iv: number;
  premium: number;
  contracts: number;
  exposureEUR: number;
  premiumEUR: number;
}

export interface GenerateResult {
  specs: VirtualPositionSpec[];
  rows: GeneratedRow[];
  warnings: string[];
  exposureEUR: number;
  premiumEUR: number;
}

/** Ripartizione di n slot per quote (resto maggiore); ogni quota > 0 riceve ≥ 1 slot se n lo consente. */
export function apportion(n: number, pcts: number[]): number[] {
  const tot = pcts.reduce((a, b) => a + Math.max(0, b), 0);
  if (n <= 0 || tot <= 0) return pcts.map(() => 0);
  const raw = pcts.map((p) => (Math.max(0, p) / tot) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  // quote positive rimaste a 0: prendono uno slot dalla quota più grande
  const positive = pcts.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0);
  if (n >= positive.length) {
    for (const i of positive) {
      if (out[i] > 0) continue;
      const big = out.indexOf(Math.max(...out));
      if (out[big] > 1) {
        out[big]--;
        out[i]++;
      }
    }
  }
  return out;
}

const BUCKETS: MoneynessBucket[] = ['otm', 'atm', 'itm'];

export function generateRandomPuts(universe: UniverseUnderlying[], p: GenerateParams): GenerateResult {
  const warnings: string[] = [];
  const rnd = mulberry32(p.seed);
  const empty: GenerateResult = { specs: [], rows: [], warnings, exposureEUR: 0, premiumEUR: 0 };
  if (!(p.targetExposureEUR > 0)) {
    warnings.push('Esposizione da generare nulla: imposta un obiettivo superiore all’esposizione già presente.');
    return empty;
  }
  if (!universe.length) {
    warnings.push('Universo vuoto: nessun sottostante con spot e volatilità implicita disponibili.');
    return empty;
  }
  const n = Math.max(1, Math.min(Math.round(p.nUnderlyings), universe.length));
  if (p.nUnderlyings > universe.length) warnings.push(`Solo ${universe.length} sottostanti nell'universo: generate ${n} put.`);
  if ((p.mode === 'empirical' || p.expiryMode === 'empirical') && !p.empirical?.samples.length) {
    warnings.push('Dati storici non disponibili per il mix empirico.');
    return empty;
  }

  // Quote ed esposizione per fascia
  // Livello unico: tutti gli slot in un solo gruppo (il livello lo dà singleM; la fascia
  // effettiva di ogni riga è ricalcolata dallo strike scelto).
  const pcts: number[] =
    p.mode === 'single'
      ? [1, 0, 0]
      : p.mode === 'manual'
        ? [p.manual.otmPct, p.manual.atmPct, p.manual.itmPct]
        : BUCKETS.map((b) => p.empirical!.pct[b]);
  const totPct = pcts.reduce((a, b) => a + Math.max(0, b), 0);
  if (totPct <= 0) {
    warnings.push('Ripartizione percentuale nulla.');
    return empty;
  }
  const slotsPerBucket = apportion(n, pcts);
  const picks = shuffle(universe, rnd).slice(0, n);
  const expiries = monthlyExpiries(p.today);
  const atmBand = p.empirical?.atmBand ?? 0.02;

  const rows: GeneratedRow[] = [];
  const specs: VirtualPositionSpec[] = [];
  let idx = 0;
  BUCKETS.forEach((bucketName, bi) => {
    const slots = slotsPerBucket[bi];
    if (!slots) return;
    const bucketExp = (p.targetExposureEUR * Math.max(0, pcts[bi])) / totPct;
    const perSlot = bucketExp / slots;
    for (let s = 0; s < slots; s++) {
      const u = picks[idx++];
      if (!u) break;
      const sample =
        p.mode === 'empirical'
          ? drawSample(p.empirical!.samples, rnd, bucketName, atmBand)
          : p.expiryMode === 'empirical'
            ? drawSample(p.empirical!.samples, rnd)
            : null;
      const targetM =
        p.mode === 'single'
          ? p.singleM
          : p.mode === 'manual'
            ? bucketName === 'otm' ? p.manual.otmM : bucketName === 'atm' ? p.manual.atmM : p.manual.itmM
            : sample?.m ?? 0;
      const expiry =
        p.expiryMode === 'empirical'
          ? nearestMonthly(p.today, sample?.dte ?? p.empirical!.medianDte ?? 30, expiries)
          : p.fixedExpiry;
      if (!expiry || yearsToExpiry(expiry, p.today) <= 0) {
        warnings.push(`${u.ticker}: scadenza non valida, saltata.`);
        continue;
      }
      const { K, source } = pickListedStrike(u.spot * (1 + targetM), u.spot, expiry, p.chains[u.ticker]);
      const th = theoreticalPremium(u, 'put', K, expiry, p.riskFree, p.today);
      if (!th) {
        warnings.push(`${u.ticker}: IV non disponibile, saltata.`);
        continue;
      }
      const rate = fxFor(u.currency, p.fx);
      const contracts = Math.max(1, Math.round((perSlot * rate) / (K * OPT_MULT)));
      const exposureEUR = (K * contracts * OPT_MULT) / rate;
      const premiumEUR = (th.price * contracts * OPT_MULT) / rate;
      if (contracts === 1 && exposureEUR > perSlot * 1.5)
        warnings.push(`${u.ticker}: 1 contratto (${Math.round(exposureEUR).toLocaleString('it-IT')} €) supera la quota per titolo.`);
      rows.push({
        ticker: u.ticker,
        bucket: putBucket(K / u.spot - 1, atmBand),
        targetM,
        m: K / u.spot - 1,
        K,
        strikeSource: source,
        expiry,
        spot: u.spot,
        iv: th.iv,
        premium: th.price,
        contracts,
        exposureEUR,
        premiumEUR,
      });
      specs.push({
        id: newSpecId(),
        kind: 'option',
        ticker: u.ticker,
        qty: -contracts,
        price: th.price,
        currency: u.currency,
        optionType: 'put',
        strike: K,
        expiry,
        origin: 'random',
      });
    }
  });

  return {
    specs,
    rows,
    warnings,
    exposureEUR: rows.reduce((a, r) => a + r.exposureEUR, 0),
    premiumEUR: rows.reduce((a, r) => a + r.premiumEUR, 0),
  };
}

/** Esposizione naked-put di una spec (put vendute): Strike × |Contratti| × 100 / Cambio. */
export function specPutExposureEUR(s: VirtualPositionSpec, fx: FxRates): number {
  if (s.kind !== 'option' || s.optionType !== 'put' || s.qty >= 0 || !s.strike) return 0;
  const ccy = s.currency || inferCurrency(s.ticker);
  return (s.strike * Math.abs(s.qty) * OPT_MULT) / fxFor(ccy, fx);
}
