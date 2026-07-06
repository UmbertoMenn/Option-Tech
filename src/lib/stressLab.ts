/**
 * Stress Lab — motore puro di scenario sticky-delta e calcolo margine TIMS ibrido.
 *
 * Implementa il modello descritto nello "Stress Lab Sticky-Delta":
 *  - Full revaluation Black-76 (sui forward) per ogni gamba opzione
 *  - Shock di vol accoppiato spot↔vol (calibrazione SPX–VIX)
 *  - Damping per scadenza ∝ (1M/T)^p
 *  - Irripidimento skew κ proporzionale alla severità dello shock
 *  - Regime sticky-delta: lo smile si muove con il prezzo
 *  - Margine = max(strategy-based Reg-T, scan TIMS sui veri spread)
 *
 * Nessun riferimento a hooks/UI/DB: solo numeri in entrata e in uscita.
 */

/* ===========================================================================
 * TIPI
 * ========================================================================= */

export type OptType = 'C' | 'P';

export interface StressLeg {
  /** Ticker del sottostante (es. "AAPL", "EURUSD") */
  u: string;
  /** Call / Put */
  cp: OptType;
  /** Strike */
  K: number;
  /** Tempo a scadenza in anni */
  T: number;
  /** Data di scadenza (YYYY-MM-DD) — usato solo per display */
  exp: string;
  /** Quantità firmata: positiva = long, negativa = short */
  q: number;
  /** Prezzo di mercato nativo (valuta dell'opzione, tipicamente USD) */
  px: number;
  /** True se il prezzo di mercato è sotto il valore intrinseco (deep-ITM americane) */
  fl: boolean;
  /** Moltiplicatore contratto (100 per opzioni US standard) */
  mult: number;
  /** Descrizione/nome del sottostante */
  nm: string;
  /** Implied vol estratta dal prezzo di mercato (annualizzata, in decimali) */
  iv: number;
}

export interface StressEquity {
  /** Display name */
  nm: string;
  /** Valuta nativa */
  ccy: string;
  /** Prezzo in valuta nativa */
  px: number;
  /** Quantità */
  q: number;
  /** Controvalore già convertito in EUR */
  eur: number;
  /** Beta sul mercato di riferimento */
  beta: number;
  /** Ticker (può essere stringa vuota per ETF/oro) */
  tick: string;
  /** True se la riga è esposizione equity della Gestione Patrimoniale (mandato separato):
   *  va shockata come un titolo, ma NON deve coprire i covered call del book nel margine. */
  gp?: boolean;
}

export interface StressUnderlying {
  /** Spot in valuta nativa */
  S: number;
  /** Beta sul mercato di riferimento */
  beta: number;
}

export interface StressUnderlyingMap {
  [ticker: string]: StressUnderlying;
}

export interface ForexRates {
  /** Quante valute native servono per 1 EUR. Esempio: USD = 1.16 → 1 EUR = 1.16 USD */
  USD: number;
  /** Default HKD = 9.043 se non disponibile */
  HKD: number;
}

export interface SurfaceParams {
  /** Pendenza dello smile in punti di vol per unità di moneyness standardizzata.
   *  Default = -0.018 (= -1.8 pt/σ, tipico single-stock USA). */
  skewB: number;
  /** Irripidimento dello skew sotto shock. Default = 0.6. */
  kappa: number;
  /** Esponente di propagazione lungo la term-structure. Default = 0.5 (radice quadrata). */
  pExp: number;
}

export interface ScenarioParams extends SurfaceParams {
  /** Tasso risk-free (annualizzato, decimali) */
  r: number;
  /** Orizzonte temporale in giorni (theta) */
  days: number;
  /** Cambi valuta verso EUR */
  fx: ForexRates;
  /** Modalità "intrinseco a scadenza" per Ex Covered Call e Naked Put */
  netting: boolean;
}

export interface LegResult {
  /** Indice della gamba originale */
  i: number;
  /** P&L in EUR */
  pnlEUR: number;
  /** Vol di partenza dopo aggiustamento skew base (decimali) */
  sig0: number;
  /** Vol nello scenario */
  sig1: number;
  /** Prezzo di partenza effettivo (mark o intrinseco se netting) */
  p0: number;
  /** Prezzo nello scenario */
  p1: number;
  /** ΔIV in punti di vol (sig1 - sig0) * 100 */
  dIV: number;
  /** Maturità della gamba (anni) — utile per filtri */
  T: number;
  /** True se questa gamba è stata trattata "a intrinseco" (netting attivo, short) */
  netted: boolean;
  /** True se la gamba è valutata a intrinseco puro (fl=prezzo sotto intrinseco, oppure netting) */
  atIntrinsic: boolean;
}

export interface EquityResult {
  key: string;
  nm: string;
  tick: string;
  beta: number;
  pnl: number;
  ctv: number;
}

export interface ScenarioResult {
  rows: LegResult[];
  eqRows: EquityResult[];
  optEUR: number;
  eqEUR: number;
  totEUR: number;
}

/* ===========================================================================
 * MATH BASICS
 * ========================================================================= */

/** CDF Normale standard (approssimazione Abramowitz–Stegun) */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Black-76 sui forward, premio scontato */
export function bsPrice(
  F: number,
  K: number,
  T: number,
  sig: number,
  isCall: boolean,
  r: number,
): number {
  if (T <= 1e-9 || sig <= 1e-9) {
    const intr = isCall ? Math.max(0, F - K) : Math.max(0, K - F);
    return intr * Math.exp(-r * T);
  }
  const sq = sig * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sig * sig * T) / sq;
  const d2 = d1 - sq;
  const df = Math.exp(-r * T);
  return isCall
    ? df * (F * normCdf(d1) - K * normCdf(d2))
    : df * (K * normCdf(-d2) - F * normCdf(-d1));
}

/* ===========================================================================
 * SHOCK DI VOL ACCOPPIATO
 * ========================================================================= */

/** Maturità di riferimento per la term-structure: 1 mese */
export const T0M = 1 / 12;

/**
 * Shock di vol ATM a 1M accoppiato al mercato.
 * Calibrazione empirica SPX–VIX:
 *  - Ribassi: lineare + convessità nei crash
 *  - Rialzi: la vol comprime ~0.55 pt per +1%
 *
 * @param d  Shock di mercato in % (es. -10 = mercato -10%)
 * @returns Shock di vol ATM a 1M in punti di vol
 */
export function coupledDV1M(d: number): number {
  if (d <= 0) return Math.abs(d) * 1.0 + 0.025 * d * d;
  return -0.55 * d;
}

/** Damping per scadenza: shock ∝ (1M/T)^p, cap a 1.45 sul front */
export function termFactor(T: number, p: number): number {
  return Math.min(1.45, Math.pow(T0M / Math.max(T, 0.01), p));
}

/** Moltiplicatore di irripidimento dello skew sotto shock */
export function skewMult(T: number, dV1M: number, kappa: number): number {
  const w = Math.min(1.35, Math.sqrt(T0M / Math.max(T, 0.02)));
  return Math.max(0.4, Math.min(3.5, 1 + kappa * (dV1M / 10) * w));
}

/* ===========================================================================
 * IMPLIED VOLATILITY
 * ========================================================================= */

/**
 * Calcola IV via bisezione (robust, niente Newton-Raphson).
 * Ritorna NaN se il prezzo è sotto l'intrinseco (deep-ITM americane).
 */
export function impliedVolFromPrice(
  marketPx: number,
  S: number,
  K: number,
  T: number,
  r: number,
  isCall: boolean,
): number {
  if (T <= 1e-6 || marketPx <= 0 || S <= 0 || K <= 0) return NaN;
  const F = S * Math.exp(r * T);
  const intrinsic = isCall
    ? Math.max(0, F - K) * Math.exp(-r * T)
    : Math.max(0, K - F) * Math.exp(-r * T);
  if (marketPx < intrinsic * 0.995) return NaN;

  let lo = 0.005;
  let hi = 5.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice(F, K, T, mid, isCall, r);
    if (Math.abs(p - marketPx) < 1e-4) return mid;
    if (p > marketPx) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Mappa indice gamba → IV "effettiva":
 *  - se il prezzo è sotto l'intrinseco (fl=true) usa la mediana del sottostante
 *  - altrimenti usa l'IV implicita dalla gamba
 */
export function effIVMap(legs: StressLeg[]): Record<number, number> {
  const byU: Record<string, number[]> = {};
  for (const l of legs) {
    if (!l.fl) (byU[l.u] = byU[l.u] || []).push(l.iv);
  }
  const median = (a: number[]): number => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const out: Record<number, number> = {};
  legs.forEach((l, i) => {
    out[i] = l.fl ? (byU[l.u] && byU[l.u].length ? median(byU[l.u]) : 0.45) : l.iv;
  });
  return out;
}

/* ===========================================================================
 * MOTORE DI SCENARIO
 * ========================================================================= */

/**
 * Ripreziamento full-revaluation di tutte le gambe opzione + P&L lineare per le azioni/ETF.
 *
 * @param legs    Posizioni opzione del portafoglio
 * @param eq      Posizioni equity / ETF / commodity (con beta)
 * @param unders  Mappa ticker → {S, beta}; deve includere "EURUSD" se presente
 * @param effIV   Output di effIVMap(legs) (cache: stabile rispetto a shock)
 * @param d       Shock di mercato in %
 * @param dV1M    Shock di vol ATM 1M in punti
 * @param prm     Parametri scenario (r, days, fx, skewB, kappa, pExp, netting)
 */
export function runScenario(
  legs: StressLeg[],
  eq: StressEquity[],
  unders: StressUnderlyingMap,
  effIV: Record<number, number>,
  d: number,
  dV1M: number,
  prm: ScenarioParams,
): ScenarioResult {
  const { r, skewB, kappa, pExp, days, fx, netting } = prm;
  let optEUR = 0;
  const rows: LegResult[] = [];

  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const und = unders[l.u];
    if (!und) {
      // Underlying mancante: salta la gamba ma logga 0 per non rompere la UI
      rows.push({
        i, pnlEUR: 0, sig0: 0, sig1: 0, p0: l.px, p1: l.px, dIV: 0, T: l.T, netted: false, atIntrinsic: false,
      });
      continue;
    }
    const isFX = l.u === 'EURUSD';
    const S0 = und.S;
    const beta = und.beta;
    const sig0Base = effIV[i];
    const isCall = l.cp === 'C';
    const F0 = S0 * Math.exp(r * l.T);
    // NETTING Ex CC e NP (hold-to-expiry, intrinseco DIREZIONALE): ogni gamba — long e short
    // allo stesso modo — è valutata a intrinseco sul lato che conta per la DIREZIONE dello
    // shock, e a ZERO sull'altro lato (premio/costo già contabilizzato nel patrimonio base):
    //   shock giù (d<=0): PUT → intrinseco, CALL → zero
    //   shock su  (d>0):  CALL → intrinseco, PUT → zero
    // Il segno (long/short) entra solo via q nel P&L (q·mult·Δ), dando il verso corretto.

    // Decomposizione base: sigma0 = sigmaATM0 + skewB * m0
    // (m0 standardizzata, 2-3 iterazioni di punto fisso)
    let sATM0 = sig0Base;
    for (let k = 0; k < 3; k++) {
      const m = Math.log(l.K / F0) / (Math.max(sATM0, 0.03) * Math.sqrt(l.T));
      sATM0 = Math.max(0.03, sig0Base - skewB * m);
    }

    const volScale = isFX ? 0.25 : 1; // la vol FX non segue il modello equity

    const price = (dd: number, dv: number, dy: number) => {
      const dL = dv * termFactor(l.T, pExp) * volScale;
      const sATM = Math.max(0.04, sATM0 + dL / 100);
      const sb = isFX ? skewB : skewB * skewMult(l.T, dv, kappa);
      const Tx = Math.max(l.T - dy / 365, 0);
      const Sx = S0 * Math.max(0.02, 1 + (beta * dd) / 100);
      const Fx = Sx * Math.exp(r * Tx);
      let sig: number;
      if (Tx <= 1e-9) {
        sig = sATM;
      } else {
        // STICKY-DELTA: smile riletto alla nuova moneyness
        const m = Math.log(l.K / Fx) / (sATM * Math.sqrt(Tx));
        sig = Math.max(0.03, Math.min(4, sATM + sb * m));
      }
      return { p: bsPrice(Fx, l.K, Tx, sig, isCall, r), sig };
    };

    const base = price(0, 0, 0);
    const str = price(d, dV1M, days);

    let p0eff = base.p;
    let p1eff = str.p;
    let netted = false;
    let atIntrinsic = false;
    const S1 = S0 * Math.max(0.02, 1 + (beta * d) / 100);
    const intrAt = (S: number) => (isCall ? Math.max(0, S - l.K) : Math.max(0, l.K - S));

    if (netting) {
      // Ex CC e NP (hold to expiry): OGNI gamba vale il suo INTRINSECO allo spot, base e shock.
      // Niente "zero direzionale": una covered call ITM, scendendo, guadagna intrinseco e
      // compensa le azioni FINCHÉ si resta sopra lo strike; si comincia a perdere solo sotto
      // lo strike (dove l'intrinseco della call è 0). L'OTM dà intrinseco 0 in modo naturale.
      netted = true;
      atIntrinsic = true;
      p0eff = intrAt(S0);
      p1eff = intrAt(S1);
    } else if (l.fl) {
      // Prezzo di riferimento (mid/bid) sotto l'intrinseco (deep-ITM americana): si quota
      // ESATTAMENTE all'intrinseco, sia long sia short. Delta 1, niente vega/gamma fittizia.
      atIntrinsic = true;
      p0eff = intrAt(S0);
      p1eff = intrAt(S1);
    }

    // Tutti i derivati quotano in USD nel modello
    const pnlEUR = (l.q * l.mult * (p1eff - p0eff)) / fx.USD;
    optEUR += pnlEUR;

    rows.push({
      i,
      pnlEUR,
      sig0: base.sig,
      sig1: str.sig,
      p0: p0eff,
      p1: p1eff,
      dIV: (str.sig - base.sig) * 100,
      T: l.T,
      netted,
      atIntrinsic,
    });
  }

  // Azioni / ETF / commodity: lineare via beta
  let eqEUR = 0;
  const eqRows: EquityResult[] = [];
  for (const s of eq) {
    const beta = s.tick && unders[s.tick] ? unders[s.tick].beta : s.beta;
    const fxr = s.ccy === 'USD' ? fx.USD : s.ccy === 'HKD' ? fx.HKD : 1;
    const pnl = (s.q * s.px * Math.max(-0.98, (beta * d) / 100)) / fxr;
    eqEUR += pnl;
    eqRows.push({
      key: s.tick || s.nm,
      nm: s.nm,
      tick: s.tick,
      beta,
      pnl,
      ctv: s.eur,
    });
  }

  return { rows, eqRows, optEUR, eqEUR, totEUR: optEUR + eqEUR };
}

/* ===========================================================================
 * NETTING: PATRIMONIO A INTRINSECO (gambe corte)
 * ========================================================================= */

/**
 * Delta patrimoniale derivante dal sostituire il MTM delle gambe corte
 * con il loro intrinseco (modalità "hold to expiry" per Ex CC e NP).
 *
 * @returns delta da SOMMARE al patrimonio MTM base.
 */
export function nettingPatrimonialDelta(
  legs: StressLeg[],
  unders: StressUnderlyingMap,
  fxUSD: number,
): number {
  let dlt = 0;
  for (const l of legs) {
    if (l.q >= 0) continue; // solo gambe corte
    const und = unders[l.u];
    if (!und) continue;
    const S0 = und.S;
    const mtmEUR = (l.q * l.mult * l.px) / fxUSD;
    const intr = l.cp === 'C' ? Math.max(0, S0 - l.K) : Math.max(0, l.K - S0);
    const intrEUR = (l.q * l.mult * intr) / fxUSD;
    dlt += intrEUR - mtmEUR;
  }
  return dlt;
}

/* ===========================================================================
 * MARGINE TIMS IBRIDO
 * ========================================================================= */

export interface MarginParams extends SurfaceParams {
  /** Risk-free */
  r: number;
  /** Cambio EUR/USD (USD per 1 EUR) */
  fxUSD: number;
  /** Moltiplicatore vol per il range di scan PREZZO TIMS (R = clip(k·σ, 10%, 80%)) */
  kScan: number;
  /** Range sweep FX (decimali: 0.03 = ±3%) */
  fxRange: number;
  /**
   * RANGE DI SCAN DELLA VOLATILITÀ IMPLICITA (TIMS), come frazione del livello di
   * vol. Il TIMS reale, a ogni punto di prezzo, sposta la IV su e giù di
   * `ivScan · σ` e prende lo scenario peggiore. È ciò che cattura il rischio di
   * net-vega dei calendar/diagonal (gamba lunga lontana) che il solo scan di
   * prezzo ignora. Es. 0,40 = ±40% del livello di vol. Default 0,40.
   */
  ivScan?: number;
  /**
   * Requisito di mantenimento Reg-T sulle short NUDE (frazione del sottostante).
   * 0,20 = minimo regolamentare textbook; il broker/banca lo alza sui nomi
   * volatili (small/mid-cap: 0,25–0,35). È il parametro che governa la base
   * strategy-based (il "302k" della banca). Default 0,20.
   */
  nakedPct?: number;
}

export interface MarginBreakdown {
  u: string;
  mar: number;
  strat: number;
  scan: number;
  R: number;
}

export interface MarginResult {
  total: number;
  totStrat: number;
  totScan: number;
  /** Margine in Reg-T puro (strategy-based su tutto, diagonali creditati = banca) */
  totRegT: number;
  bd: MarginBreakdown[];
  /** Numero di gambe call corte coperte da azioni in portafoglio (margine 0) */
  nCov: number;
}

/**
 * Margine naked (Reg-T): premio + max(pct·U − OTM, floor 10%).
 * `pct` è il requisito di mantenimento sulle short nude: 20% è il minimo
 * regolamentare Reg-T (textbook), ma il broker/banca lo alza sui nomi volatili
 * (small/mid-cap tech tipicamente 25-35%). Il floor del 10% resta fisso.
 */
function nakedMar(
  K: number,
  px: number,
  isCall: boolean,
  S: number,
  mult: number,
  pct: number,
): number {
  if (isCall) {
    const otm = Math.max(0, K - S);
    return px * mult + Math.max(pct * S * mult - otm * mult, 0.1 * S * mult);
  }
  const otm = Math.max(0, S - K);
  return px * mult + Math.max(pct * S * mult - otm * mult, 0.1 * K * mult);
}

/** Margine spread strategy-based (debit/net-long → 0; credit → ampiezza − credito) */
function pairStrat(
  s: { cp: OptType; K: number; px: number },
  l: { K: number; px: number },
  mult: number,
): number {
  if (s.cp === 'C') {
    if (l.K <= s.K) return 0;
    return Math.max(0, (l.K - s.K) * mult - (s.px - l.px) * mult);
  }
  if (l.K >= s.K) return 0;
  return Math.max(0, (s.K - l.K) * mult - (s.px - l.px) * mult);
}

interface PreparedLeg {
  K: number;
  cp: OptType;
  T: number;
  iv: number;
  px: number;
  scanPx: number;
  q1: 1 | -1;
  nk?: number;
  rq?: number;
}

/**
 * Margine cassa con metodologia ibrida (Reg-T strategy + scan TIMS di classe):
 *  - Per sottostante:
 *    1) STRATEGY-BASED (Reg-T): short nuda con floor; credito di spread SOLO sui
 *       VERTICALI a stessa scadenza (debit/net-long → 0, credit → ampiezza−premio).
 *       I diagonali/calendar (scadenze diverse) NON ricevono il credito verticale:
 *       sono margiati dallo scan TIMS.
 *    2) SCAN TIMS DI CLASSE: applicato SOLO ai sottostanti con un VERO spread
 *       (short residua + long stesso lato). Rivaluta INSIEME tutte le gambe del
 *       nome (call+put, short+long) sulla griglia di prezzo ±R in 10 passi e,
 *       a ogni passo, sposta la IV di ±ivScan·σ (su/giù, indipendente): il
 *       requisito è la perdita peggiore, con minimo $0,375/contratto. Call e
 *       put sono NETTATE a ogni prezzo (regola TIMS), non per lato separato.
 *  - Margine del nome = max(strategy-based, scan TIMS).
 *  - Priorità ai titoli: call corte coperte dalle azioni → margine 0.
 *  - EUR/USD: scan-only con range FX dedicato.
 *
 * INVARIANTE: posizioni semplici (nude, coperte da titoli) → lo scan NON gira,
 * quindi il margine = Reg-T strategy-based, in linea con l'overnight del broker.
 * Solo i veri spread/diagonal vengono "morsi" dallo scan TIMS.
 */
export function occMargin(
  legs: StressLeg[],
  eq: StressEquity[],
  unders: StressUnderlyingMap,
  d: number,
  sigByLeg: Record<number, number>,
  days: number,
  prm: MarginParams,
): MarginResult {
  const { r, fxUSD, kScan, fxRange, skewB, kappa, pExp } = prm;
  // Range di scan della volatilità implicita TIMS (frazione del livello di vol).
  // A ogni punto di prezzo la IV viene spostata di ±ivScan·σ e si prende il
  // peggiore: è lo scan-vol standard del TIMS. Default 0,40 (±40% del livello).
  const ivScan = prm.ivScan ?? 0.4;
  // Requisito di mantenimento Reg-T sulle short nude. 0,20 = textbook; più alto
  // sui nomi volatili (è il parametro che taratura la base strategy = "302k banca").
  const nakedPct = prm.nakedPct ?? 0.2;
  const eff = effIVMap(legs);

  const legsByU: Record<string, number[]> = {};
  legs.forEach((l, i) => (legsByU[l.u] = legsByU[l.u] || []).push(i));

  const sharesByU: Record<string, number> = {};
  eq.forEach((s) => {
    // Le azioni della Gestione Patrimoniale NON coprono i covered call del book
    // (mandato separato): non entrano nel conteggio coperture del margine.
    if (s.gp) return;
    if (s.tick && unders[s.tick]) sharesByU[s.tick] = (sharesByU[s.tick] || 0) + s.q;
  });
  const cap: Record<string, number> = {};
  Object.keys(sharesByU).forEach((u) => {
    cap[u] = Math.floor(sharesByU[u] / 100);
  });

  let total = 0;
  let totStrat = 0;
  let totScan = 0;
  let totRegT = 0;
  let nCov = 0;
  const bd: MarginBreakdown[] = [];

  for (const u of Object.keys(legsByU)) {
    const idxs = legsByU[u];
    const und = unders[u];
    if (!und) continue;
    const isFX = u === 'EURUSD';
    const beta = und.beta;
    const S0 = und.S;
    const S = S0 * Math.max(0.02, 1 + (beta * d) / 100);
    const mult = legs[idxs[0]].mult;

    // Costruzione gambe con premio ANCORATO al file a stato base
    const buildLeg = (i: number): PreparedLeg => {
      const l = legs[i];
      const sig0 = eff[i];
      const sigd = sigByLeg[i] != null ? sigByLeg[i] : sig0;
      const T0 = Math.max(l.T, 1e-4);
      const Td = Math.max(l.T - days / 365, 1e-4);
      const markBase = bsPrice(S0 * Math.exp(r * T0), l.K, T0, sig0, l.cp === 'C', r);
      const markShock = bsPrice(S * Math.exp(r * Td), l.K, Td, sigd, l.cp === 'C', r);
      const anc = Math.max(0, l.px + (markShock - markBase));
      return {
        K: l.K,
        cp: l.cp,
        T: Td,
        iv: sig0,
        px: anc,
        scanPx: markShock,
        q1: l.q < 0 ? -1 : 1,
      };
    };

    const Sx: { C: PreparedLeg[]; P: PreparedLeg[] } = { C: [], P: [] };
    const Lx: { C: PreparedLeg[]; P: PreparedLeg[] } = { C: [], P: [] };

    idxs.forEach((i) => {
      const n = Math.round(Math.abs(legs[i].q));
      const cp = legs[i].cp;
      const dst = legs[i].q < 0 ? Sx : Lx;
      const lg = buildLeg(i);
      for (let t = 0; t < n; t++) dst[cp].push({ ...lg });
    });

    // Priorità titoli: call corte più ITM coperte → margine 0
    if (!isFX && (cap[u] || 0) > 0) {
      Sx.C.sort((a, b) => a.K - b.K);
      const nc = Math.min(cap[u], Sx.C.length);
      nCov += nc;
      Sx.C = Sx.C.slice(nc);
    }

    // Range di scan per nome (FX a parte) + IV ATM per lo scan di volatilità
    let R: number;
    let ivAtm = 0.4;
    if (isFX) {
      R = fxRange;
    } else {
      let atm = idxs[0];
      let best = Infinity;
      idxs.forEach((i) => {
        const dd = Math.abs(legs[i].K - S);
        if (dd < best) {
          best = dd;
          atm = i;
        }
      });
      R = Math.min(Math.max(kScan * eff[atm], 0.1), 0.8);
      ivAtm = eff[atm];
    }

    const stratSide = (cp: OptType, regt: boolean): number => {
      if (isFX) return 0;
      const shorts = Sx[cp];
      const longs = Lx[cp];
      shorts.forEach((x) => {
        x.nk = nakedMar(x.K, x.px, cp === 'C', S, mult, nakedPct);
        x.rq = undefined; // ricalcolo pulito a ogni passata (ibrido vs Reg-T puro)
      });
      const sd = shorts.map(() => false);
      const ul = longs.map(() => false);
      if (shorts.length && longs.length) {
        const prs: [number, number, number, number][] = [];
        shorts.forEach((x, si) =>
          longs.forEach((l, li) => {
            // Reg-T puro (regt=true): credito di spread a qualunque long con
            // scadenza ≥ short (verticali E diagonali/calendar) — è la metodologia
            // della banca. Ibrido (regt=false): credito SOLO ai verticali a stessa
            // scadenza; i diagonali sono margiati dallo scan TIMS.
            if (regt ? l.T + 1e-9 < x.T : Math.abs(l.T - x.T) > 0.02) return;
            const rr = pairStrat(x, l, mult);
            const ben = (x.nk ?? 0) - rr;
            if (ben > 0) prs.push([ben, si, li, rr]);
          }),
        );
        prs.sort((a, b) => b[0] - a[0]);
        prs.forEach(([_ben, si, li, rr]) => {
          if (sd[si] || ul[li]) return;
          sd[si] = true;
          ul[li] = true;
          shorts[si].rq = rr;
        });
      }
      let out = 0;
      // Short non appaiata: nel Reg-T puro è sempre addebitata a nudo. Nell'ibrido,
      // se sul lato esiste una long (gamba di diagonale/calendar) NON si addebita a
      // nudo — il margine lo determina lo scan TIMS; a nudo solo se non c'è long.
      shorts.forEach((x) => {
        if (x.rq !== undefined) out += x.rq;
        else if (regt || longs.length === 0) out += x.nk ?? 0;
        // else (ibrido): diagonale → deferito allo scan TIMS (contributo 0)
      });
      return out / fxUSD;
    };

    // SCAN TIMS DI CLASSE: rivaluta INSIEME tutte le gambe del sottostante (call e
    // put, short e long) a ogni punto di prezzo della griglia ±R, spostando anche la
    // IV su/giù di ±ivScan·σ in modo indipendente. Il requisito è la perdita peggiore
    // tra tutti gli scenari, con minimo $0,375/contratto. Call e put sono NETTATE a
    // ogni prezzo (regola TIMS reale), non addebitate per lato separatamente.
    const classGroupScan = (): number => {
      const units: {
        q: 1 | -1;
        K: number;
        px: number;
        T: number;
        iv: number;
        isC: boolean;
      }[] = [];
      (['C', 'P'] as OptType[]).forEach((cp) => {
        Sx[cp].forEach((x) =>
          units.push({ q: -1, K: x.K, px: x.scanPx, T: x.T, iv: x.iv, isC: cp === 'C' }),
        );
        Lx[cp].forEach((x) =>
          units.push({ q: 1, K: x.K, px: x.scanPx, T: x.T, iv: x.iv, isC: cp === 'C' }),
        );
      });
      if (!units.length) return 0;
      // Un insieme di sole gambe LONG è un attivo già pagato → nessun margine.
      if (!units.some((u) => u.q < 0)) return 0;

      // Range di scan della IV (TIMS): ±ivScan·σ in punti di vol, indipendente dal
      // prezzo. È ciò che fa "mordere" i calendar/diagonal con net vega.
      const volMax = (isFX ? 0.25 : 1) * ivScan * ivAtm * 100;

      const plAt = (mv: number, dv: number): number => {
        let pl = 0;
        units.forEach((un) => {
          const T = un.T;
          const F0 = S * Math.exp(r * T);
          let sATM0 = un.iv;
          for (let it = 0; it < 3; it++) {
            const mm = Math.log(un.K / F0) / (Math.max(sATM0, 0.03) * Math.sqrt(T));
            sATM0 = Math.max(0.03, un.iv - skewB * mm);
          }
          const sATM = Math.max(0.04, sATM0 + (dv * termFactor(T, pExp)) / 100);
          const sb = isFX ? skewB : skewB * skewMult(T, dv, kappa);
          const Sx2 = S * (1 + mv);
          const Fx = Sx2 * Math.exp(r * T);
          const mm2 = Math.log(un.K / Fx) / (sATM * Math.sqrt(T));
          const sig = Math.max(0.03, Math.min(4, sATM + sb * mm2));
          pl += un.q * mult * (bsPrice(Fx, un.K, T, sig, un.isC, r) - un.px);
        });
        return pl;
      };

      let worst = 0;
      for (let kk = 0; kk <= 10; kk++) {
        const mv = -R + (2 * R * kk) / 10;
        const dvCoupled = (isFX ? 0.25 : 1) * coupledDV1M(mv * 100);
        // A ogni punto di prezzo: vol accoppiata + scan IV su/giù (TIMS).
        for (const dv of [dvCoupled, volMax, -volMax]) {
          const pl = plAt(mv, dv);
          if (pl < worst) worst = pl;
        }
      }
      const shortCtr = Sx.C.length + Sx.P.length;
      // Minimo TIMS reale: $0,375/azione = $37,5/contratto sulle short residue.
      return Math.max(-worst, 37.5 * shortCtr) / fxUSD;
    };

    const stratU = stratSide('C', false) + stratSide('P', false);
    // Reg-T puro del nome (diagonali creditati come verticali, = metodologia banca).
    const stratRegT = stratSide('C', true) + stratSide('P', true);

    // Gate ibrido: lo scan TIMS gira SOLO se sul sottostante esiste un VERO spread
    // (short residua + long sullo stesso lato) — verticale, calendar o diagonale.
    // Le posizioni semplici (short nude, call coperte da titoli) NON entrano nello
    // scan: restano strategy-based Reg-T, in linea con l'overnight del broker.
    const isTrueSpread = (cp: OptType) => Sx[cp].length > 0 && Lx[cp].length > 0;
    const hasResidualShort = Sx.C.length > 0 || Sx.P.length > 0;
    const runScan =
      isTrueSpread('C') || isTrueSpread('P') || (isFX && hasResidualShort);

    const sc = runScan ? classGroupScan() : 0;
    // Margine del sottostante = max(strategy-based Reg-T, scan TIMS di classe).
    const mar = Math.max(stratU, sc);

    if (mar > 0) {
      const strat = Math.min(stratU, mar);
      const scan = Math.max(0, mar - strat);
      total += mar;
      totStrat += strat;
      totScan += scan;
      totRegT += stratRegT;
      bd.push({ u, mar, strat, scan, R });
    }
  }

  bd.sort((a, b) => b.mar - a.mar);
  return { total, totStrat, totScan, totRegT, bd, nCov };
}

/* ===========================================================================
 * UTILITIES PER LA UI
 * ========================================================================= */

/** Calcola il tempo a scadenza in anni a partire da una data ISO YYYY-MM-DD */
export function yearsToExpiry(expiry: string, refDate: Date = new Date()): number {
  const exp = new Date(expiry + 'T16:00:00Z'); // close US
  const ms = exp.getTime() - refDate.getTime();
  return Math.max(0, ms / (365.25 * 24 * 3600 * 1000));
}

/** Verifica se un prezzo opzione è sotto il valore intrinseco (deep-ITM americana) */
export function isPriceBelowIntrinsic(
  px: number,
  S: number,
  K: number,
  isCall: boolean,
): boolean {
  const intr = isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  return px < intr * 0.99;
}

/* ===========================================================================
 * MARGIN CALL
 * ========================================================================= */

/** Haircut prudenziale sui bond a copertura del margine: valorizzati al 95%. */
export const BOND_MARGIN_HAIRCUT = 0.95;

/**
 * Trova lo shock di mercato a cui scatta la margin call: primo punto in cui il
 * margine richiesto supera la copertura disponibile (cash + bond × 0,95).
 *
 * `points` è la scansione del margine da x = 0 verso shock più negativi
 * (ordine di severità crescente). Ritorna la x del primo attraversamento
 * margine > cover, interpolata linearmente tra i due punti a cavallo della
 * soglia; la x del primo punto se già in margin call in partenza; null se la
 * soglia non viene mai superata o se cover ≤ 0.
 */
export function marginCallShock(
  points: { x: number; margin: number }[],
  cover: number,
): number | null {
  if (!points.length || cover <= 0) return null;
  if (points[0].margin > cover) return points[0].x;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.margin <= cover && b.margin > cover) {
      const t = (cover - a.margin) / (b.margin - a.margin);
      return a.x + t * (b.x - a.x);
    }
  }
  return null;
}
