import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { bsPrice, impliedVolatility } from '@/lib/blackScholes';
import { parseBondPartial, bondYTM, bondCleanPrice, BondInfo } from '@/lib/bondMath';

const MS_YEAR = 365.25 * 24 * 3600 * 1000;
const DEFAULT_RATE = 0.04;        // risk-free di base per il pricing opzioni
const DEFAULT_OPT_VOL = 0.30;     // vol di fallback quando l'IV non è risolvibile
const DEFAULT_EQUITY_VOL = 0.20;  // vol annua per lo shock aggregato azioni/ETF (MC titoli)
const INFLATION_TARGET = 0.02;    // target BCE per i bond indicizzati all'inflazione

/** Filtro di analisi: tutto, solo azionario+derivati, solo bond+commodities. */
export type ProjectionScope = 'all' | 'equity' | 'bond_commodity';

function yearFrac(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_YEAR;
}

// ───────────────────────── Inputs precomputati ─────────────────────────

interface DerivInput {
  description: string;
  underlying: string;
  type: 'call' | 'put';
  S0: number;            // prezzo sottostante corrente
  K: number;
  T0: number;            // anni a scadenza da t0
  iv: number;            // IV implicita (o fallback)
  ivResolved: boolean;
  qtyMult: number;       // quantity * 100 / fx  (segno incluso)
  anchorPerShare: number;// prezzo opzione corrente (per decadimento lineare di fallback)
  hasUnderlying: boolean;
  mvT0: number;          // market value EUR a t0
}

interface BondInput {
  description: string;
  info: BondInfo;
  currentClean: number;  // prezzo % corrente
  ytm: number;
  mvT0: number;          // market value EUR a t0
  couponCashPerPeriod: number; // EUR per cedola (0 se cedola non modellata o ZC)
  couponsModeled: boolean;
  inflationLinked: boolean;
}

/** Override risolto per ISIN, chiave `${portfolio_id}::${isin}`. */
export interface ResolvedBondOverride {
  couponRatePct: number | null;
  maturityMs: number | null;
  frequency: number;
}

export interface DerivSummaryLeg {
  description: string;
  underlying: string;
  type: 'call' | 'put';
  qty: number;
  strike: number;
  mvT0: number;
  hasUnderlying: boolean;
}

export interface ProjectionInputs {
  t0: Date;
  horizon: Date;
  // bucket costanti (EUR)
  equityFlat: number;        // azioni + ETF — shockabili nel MC titoli
  gpEquityFlat: number;      // GP azionaria (gp_total - gp_cash) — piatta, in bucket Equity
  commodityFlat: number;     // materie prime — piatte
  cashResidual: number;      // cash + arrotondamenti — piatto
  unparsedBondFlat: number;  // bond senza scadenza → tenuti al valore corrente (bucket bond)
  derivs: DerivInput[];
  bonds: BondInput[];
  unparsedBonds: string[];   // bond senza scadenza deducibile → tenuti piatti
  partialBonds: string[];    // bond con scadenza ma senza cedola → pull-to-par, cedole non modellate
  derivsNoUnderlying: string[];
  derivMVT0: number;         // somma MV derivati a t0 (con segno)
  derivativesNettingT0: number; // valore "netting derivati" signed a t0 (= derivMVT0 se non override)
  equityDerivOffset: number; // (derivativesNettingT0 - derivMVT0): offset costante aggiunto al sleeve equity
  derivSummary: DerivSummaryLeg[]; // dettaglio gambe per UI
  patrimonyT0: number;       // 'all'
  equityT0: number;          // azionario + GP equity + netting derivati a t0
  bondCommodityT0: number;   // bond + commodities a t0
}


export function buildProjectionInputs(
  positions: Position[],
  baseValue: number,
  underlyingPrices?: Record<string, UnderlyingPrice>,
  bondOverrides?: Record<string, ResolvedBondOverride>,
  gpEquityValue: number = 0,
  derivativesNettingT0Override: number | null = null,
): ProjectionInputs {
  const t0 = new Date();
  const fxOf = (p: Position) => (p.exchange_rate && p.exchange_rate > 0 ? p.exchange_rate : 1);
  const upx = (key: string) => underlyingPrices?.[key]?.price ?? 0;

  const derivs: DerivInput[] = [];
  const derivsNoUnderlying: string[] = [];
  let maxExpiry = 0;

  for (const p of positions) {
    if (p.asset_type !== 'derivative' || !p.option_type) continue;
    const anchor = p.snapshot_price ?? p.current_price ?? 0;
    const qty = p.quantity;
    const fx = fxOf(p);
    const qtyMult = (qty * 100) / fx;
    const mvT0 = anchor * qtyMult;
    const K = p.strike_price ?? 0;
    const expiry = p.expiry_date ? new Date(p.expiry_date) : null;
    const T0 = expiry ? Math.max(0, yearFrac(t0, expiry)) : 0;
    if (expiry && expiry.getTime() > maxExpiry) maxExpiry = expiry.getTime();
    const S0 = upx(p.underlying || p.description || '');
    const hasUnderlying = S0 > 0;
    if (!hasUnderlying) derivsNoUnderlying.push(p.description);

    let iv = DEFAULT_OPT_VOL;
    let ivResolved = false;
    if (hasUnderlying && T0 > 0 && anchor > 0) {
      const solved = impliedVolatility(anchor, S0, K, T0, DEFAULT_RATE, p.option_type);
      if (isFinite(solved) && solved > 0) { iv = solved; ivResolved = true; }
    }

    derivs.push({
      description: p.description,
      underlying: p.underlying || p.description || '',
      type: p.option_type,
      S0, K, T0, iv, ivResolved,
      qtyMult, anchorPerShare: anchor, hasUnderlying, mvT0,
    });
  }

  const derivSummary: DerivSummaryLeg[] = positions
    .filter(p => p.asset_type === 'derivative' && p.option_type)
    .map(p => ({
      description: p.description,
      underlying: p.underlying || p.description || '',
      type: p.option_type as 'call' | 'put',
      qty: p.quantity,
      strike: p.strike_price ?? 0,
      mvT0: (p.snapshot_price ?? p.current_price ?? 0) * ((p.quantity * 100) / (p.exchange_rate && p.exchange_rate > 0 ? p.exchange_rate : 1)),
      hasUnderlying: !!(underlyingPrices?.[p.underlying || p.description || '']?.price ?? 0),
    }));

  const bonds: BondInput[] = [];
  const unparsedBonds: string[] = [];
  const partialBonds: string[] = [];
  let parsedBondMV = 0;       // bond proiettati (sottratti dal flat, riaggiunti via bonds[])
  let unparsedBondFlat = 0;   // bond senza scadenza → bucket bond ma piatti
  let equityFlat = 0;
  let commodityFlat = 0;

  for (const p of positions) {
    const mvEUR = p.snapshot_market_value ?? p.market_value ?? 0;
    if (p.asset_type === 'bond') {
      const ov = p.isin ? bondOverrides?.[`${p.portfolio_id}::${p.isin}`] : undefined;
      const partial = parseBondPartial(p.description);
      const maturity = ov?.maturityMs != null ? new Date(ov.maturityMs) : partial.maturity;
      const couponRatePct = ov ? ov.couponRatePct : partial.couponRatePct; // override vince (anche null)
      const frequency = ov?.frequency ?? partial.frequency;
      const currentClean = p.snapshot_price ?? p.current_price ?? 0;
      const inflationLinked = partial.inflationLinked;

      // serve la scadenza (per orizzonte/pull-to-par/accredito). Gli indicizzati possono
      // essere proiettati anche senza cedola (accreditano sull'inflazione, no pull-to-par).
      if (maturity && isFinite(maturity.getTime()) && currentClean > 0 && mvEUR !== 0) {
        parsedBondMV += mvEUR;
        if (maturity.getTime() > maxExpiry) maxExpiry = maturity.getTime();
        const info: BondInfo = { couponRatePct: couponRatePct ?? 0, maturity, frequency, parsedFrom: ov ? 'override' : 'auto' };
        const ytm = inflationLinked ? 0 : bondYTM(info, currentClean, t0);
        const couponsModeled = couponRatePct != null && couponRatePct > 0;
        const couponCashPerPeriod = couponsModeled ? (mvEUR * (couponRatePct as number)) / (currentClean * frequency) : 0;
        bonds.push({ description: p.description, info, currentClean, ytm, mvT0: mvEUR, couponCashPerPeriod, couponsModeled, inflationLinked });
        // "parziale" solo se NON indicizzato e cedola sconosciuta (null). ZC (0) è modellato.
        if (!inflationLinked && couponRatePct == null) partialBonds.push(p.description);
      } else {
        unparsedBonds.push(p.description);
        unparsedBondFlat += mvEUR;
      }
    } else if (p.asset_type === 'stock' || p.asset_type === 'etf') {
      equityFlat += mvEUR;
    } else if (p.asset_type === 'commodity') {
      commodityFlat += mvEUR;
    }
  }

  // baseValue = non-derivati a MV + cash. Sottraiamo i bucket espliciti; ciò che resta è cash + arrotondamenti.
  const cashResidual = baseValue - parsedBondMV - unparsedBondFlat - equityFlat - commodityFlat;

  const horizon = maxExpiry > 0 ? new Date(maxExpiry) : new Date(t0.getTime() + MS_YEAR);

  const derivMVT0 = derivs.reduce((s, d) => s + d.mvT0, 0);
  const parsedBondT0 = bonds.reduce((s, b) => s + b.mvT0, 0);
  const patrimonyT0 = baseValue + derivMVT0;
  const equityT0 = equityFlat + derivMVT0;
  const bondCommodityT0 = parsedBondT0 + unparsedBondFlat + commodityFlat;

  return {
    t0, horizon,
    equityFlat, commodityFlat, cashResidual, unparsedBondFlat,
    derivs, bonds, unparsedBonds, partialBonds, derivsNoUnderlying,
    derivMVT0, derivSummary,
    patrimonyT0, equityT0, bondCommodityT0,
  };
}

// ───────────────────────── Time grid ─────────────────────────

export interface TimePoint { date: Date; tYears: number; label: string; }

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** Punti mensili da t0 a horizon; se l'orizzonte è lungo, dirada per non superare maxPoints. */
export function buildTimeGrid(t0: Date, horizon: Date, maxPoints = 60): TimePoint[] {
  const totalMonths = Math.max(1, Math.ceil(yearFrac(t0, horizon) * 12));
  const step = Math.max(1, Math.ceil(totalMonths / maxPoints));
  const points: TimePoint[] = [];
  for (let m = 0; m <= totalMonths; m += step) {
    const d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + m, t0.getUTCDate()));
    points.push({ date: d, tYears: Math.max(0, yearFrac(t0, d)), label: `${MONTHS_IT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
  }
  // assicura che l'ultimo punto sia esattamente l'orizzonte
  const last = points[points.length - 1];
  if (!last || Math.abs(last.date.getTime() - horizon.getTime()) > 20 * 24 * 3600 * 1000) {
    points.push({ date: horizon, tYears: Math.max(0, yearFrac(t0, horizon)), label: `${MONTHS_IT[horizon.getUTCMonth()]} ${String(horizon.getUTCFullYear()).slice(2)}` });
  }
  return points;
}

// ───────────────────────── Shock set ─────────────────────────

export interface ShockSet {
  volMult: number;     // moltiplicatore IV (1 = invariata)
  rateBump: number;    // +/- assoluto su tassi (es. 0.01 = +100bp)
  equityMult: number;  // moltiplicatore prezzi azioni/ETF e sottostanti (1 = invariato)
  underlyingMult: Record<string, number>; // override per singolo sottostante (MC titoli)
}

const NO_SHOCK: ShockSet = { volMult: 1, rateBump: 0, equityMult: 1, underlyingMult: {} };

/** Valore patrimonio a una data sotto un set di shock. */
function patrimonyAt(inp: ProjectionInputs, tp: TimePoint, sh: ShockSet, scope: ProjectionScope = 'all'): number {
  const r = DEFAULT_RATE + sh.rateBump;

  // ── bucket EQUITY: azioni/ETF (shockabili) + derivati (decadimento + esercizio) ──
  let derivVal = 0;
  let equityAdjAtExpiry = 0; // P/L da esercizio: spostato dal bucket derivati al bucket equity
  for (const d of inp.derivs) {
    if (!d.hasUnderlying) {
      // Senza prezzo sottostante: decadimento lineare del MV verso 0 sulla vita residua.
      const frac = d.T0 > 0 ? Math.max(0, (d.T0 - tp.tYears) / d.T0) : 0;
      derivVal += d.mvT0 * frac;
      continue;
    }
    const Tt = Math.max(0, d.T0 - tp.tYears);
    const sMult = sh.underlyingMult[d.underlying] ?? sh.equityMult;
    const S = d.S0 * sMult;
    const expired = tp.tYears >= d.T0;
    if (expired) {
      // Esercizio a scadenza: il P/L intrinseco si materializza nel bucket equity (azioni
      // consegnate/acquistate al strike). Il bucket derivati si azzera.
      const intrinsic = d.type === 'call' ? Math.max(0, S - d.K) : Math.max(0, d.K - S);
      equityAdjAtExpiry += intrinsic * d.qtyMult;
    } else if (d.ivResolved) {
      derivVal += bsPrice(S, d.K, Tt, r, d.iv * sh.volMult, d.type) * d.qtyMult;
    } else {
      const intrinsic = d.type === 'call' ? Math.max(0, S - d.K) : Math.max(0, d.K - S);
      const frac = d.T0 > 0 ? Tt / d.T0 : 0;
      const px = intrinsic + Math.max(0, d.anchorPerShare - intrinsic) * frac;
      derivVal += px * d.qtyMult;
    }
  }
  const equitySleeve = inp.equityFlat * sh.equityMult + derivVal + equityAdjAtExpiry;

  // ── bucket BOND + COMMODITY ──
  let bondVal = 0;
  let coupons = 0;
  for (const b of inp.bonds) {
    const tCapYears = Math.min(tp.tYears, Math.max(0, (b.info.maturity.getTime() - inp.t0.getTime()) / MS_YEAR));
    if (b.inflationLinked) {
      // NON converge a 100: accredita sul target inflazione BCE (shockabile dai tassi).
      const inflation = Math.max(0, INFLATION_TARGET + sh.rateBump);
      bondVal += b.mvT0 * Math.pow(1 + inflation, tCapYears);
    } else {
      const matured = tp.date.getTime() >= b.info.maturity.getTime();
      if (matured) {
        bondVal += b.mvT0 * (100 / b.currentClean); // rimborso a par
      } else {
        const clean = bondCleanPrice(b.info, b.ytm + sh.rateBump, tp.date);
        bondVal += b.mvT0 * (clean / b.currentClean);
      }
    }
    // cedole staccate in (t0, tp]
    if (b.couponCashPerPeriod !== 0) {
      const stepMonths = Math.round(12 / b.info.frequency);
      let cd = new Date(b.info.maturity.getTime());
      let n = 0;
      for (let i = 0; i < 400; i++) {
        if (cd.getTime() <= inp.t0.getTime()) break;
        if (cd.getTime() <= tp.date.getTime()) n++;
        cd = new Date(Date.UTC(cd.getUTCFullYear(), cd.getUTCMonth() - stepMonths, cd.getUTCDate()));
      }
      coupons += n * b.couponCashPerPeriod;
    }
  }
  const bondCommoditySleeve = bondVal + coupons + inp.unparsedBondFlat + inp.commodityFlat;

  if (scope === 'equity') return equitySleeve;
  if (scope === 'bond_commodity') return bondCommoditySleeve;
  return equitySleeve + bondCommoditySleeve + inp.cashResidual;
}

function baseForScope(inp: ProjectionInputs, scope: ProjectionScope): number {
  if (scope === 'equity') return inp.equityT0;
  if (scope === 'bond_commodity') return inp.bondCommodityT0;
  return inp.patrimonyT0;
}

// ───────────────────────── Proiezione deterministica ─────────────────────────

export interface ProjectionRow {
  label: string;
  tYears: number;
  patrimony: number;
  pnlPct: number;
  // bande MC (opzionali)
  p5?: number; p50?: number; p95?: number;
}

export function projectDeterministic(inp: ProjectionInputs, grid: TimePoint[], scope: ProjectionScope = 'all'): ProjectionRow[] {
  const base = baseForScope(inp, scope);
  return grid.map(tp => {
    const v = patrimonyAt(inp, tp, NO_SHOCK, scope);
    return { label: tp.label, tYears: tp.tYears, patrimony: v, pnlPct: base !== 0 ? ((v - base) / base) * 100 : 0 };
  });
}

// ───────────────────────── Monte Carlo ─────────────────────────

// RNG deterministico (mulberry32) + Box-Muller per normali.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface MonteCarloConfig {
  enableVolRates: boolean;
  enableUnderlying: boolean;
  volSigma: number;   // dev std relativa della vol (es. 0.25 = ±25%)
  rateSigma: number;  // dev std assoluta tassi (es. 0.01 = ±100bp)
  paths: number;
}

export const DEFAULT_MC: MonteCarloConfig = {
  enableVolRates: true,
  enableUnderlying: false,
  volSigma: 0.25,
  rateSigma: 0.01,
  paths: 300,
};

/** Per ogni punto temporale calcola p5/p50/p95 del patrimonio simulando shock indipendenti. */
export function projectMonteCarlo(
  inp: ProjectionInputs,
  grid: TimePoint[],
  cfg: MonteCarloConfig,
  scope: ProjectionScope = 'all',
): ProjectionRow[] {
  const rand = mulberry32(0xC0FFEE);
  const base = baseForScope(inp, scope);
  const underlyings = Array.from(new Set(inp.derivs.map(d => d.underlying).filter(Boolean)));

  // matrice [point][path]
  const samples: number[][] = grid.map(() => []);

  for (let p = 0; p < cfg.paths; p++) {
    // shock costanti per path (vol/tassi), e drift GBM per i sottostanti (titoli)
    const volMult = cfg.enableVolRates ? Math.max(0.05, 1 + cfg.volSigma * gauss(rand)) : 1;
    const rateBump = cfg.enableVolRates ? cfg.rateSigma * gauss(rand) : 0;

    // per il MC titoli: un fattore browniano per sottostante e per l'azionario aggregato
    const uZ: Record<string, number> = {};
    underlyings.forEach(u => { uZ[u] = gauss(rand); });
    const eqZ = gauss(rand);

    for (let i = 0; i < grid.length; i++) {
      const tp = grid[i];
      let underlyingMult: Record<string, number> = {};
      let equityMult = 1;
      if (cfg.enableUnderlying) {
        const t = Math.max(0, tp.tYears);
        const sq = Math.sqrt(t);
        underlyingMult = {};
        underlyings.forEach(u => {
          const sigma = (inp.derivs.find(d => d.underlying === u)?.iv) || DEFAULT_OPT_VOL;
          underlyingMult[u] = Math.exp((DEFAULT_RATE - 0.5 * sigma * sigma) * t + sigma * sq * uZ[u]);
        });
        equityMult = Math.exp((DEFAULT_RATE - 0.5 * DEFAULT_EQUITY_VOL * DEFAULT_EQUITY_VOL) * t + DEFAULT_EQUITY_VOL * sq * eqZ);
      }
      const sh: ShockSet = { volMult, rateBump, equityMult, underlyingMult };
      samples[i].push(patrimonyAt(inp, tp, sh, scope));
    }
  }

  const pct = (arr: number[], q: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
    return s[idx];
  };

  return grid.map((tp, i) => {
    const arr = samples[i];
    const p50 = pct(arr, 0.5);
    return {
      label: tp.label,
      tYears: tp.tYears,
      patrimony: p50,
      pnlPct: base !== 0 ? ((p50 - base) / base) * 100 : 0,
      p5: pct(arr, 0.05),
      p50,
      p95: pct(arr, 0.95),
    };
  });
}
