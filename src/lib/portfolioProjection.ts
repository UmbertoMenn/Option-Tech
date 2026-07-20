import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { bsPrice, impliedVolatility } from '@/lib/blackScholes';
import { parseBondPartial, bondYTM, couponDates, BondInfo } from '@/lib/bondMath';

const MS_YEAR = 365.25 * 24 * 3600 * 1000;
const DEFAULT_RATE = 0.04;        // risk-free di base per il pricing opzioni e lo sconto dei bond
const DEFAULT_OPT_VOL = 0.30;     // vol di fallback quando l'IV non è risolvibile
export const INFLATION_TARGET = 0.02; // target BCE per i bond indicizzati all'inflazione

/** Filtro di analisi: tutto, solo azionario+derivati, solo bond+commodities. */
export type ProjectionScope = 'all' | 'equity' | 'bond_commodity';

function yearFrac(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_YEAR;
}

// ───────────────────────── Inputs precomputati ─────────────────────────

/** Fonte con cui è stato risolto lo spot del sottostante (per diagnostica). */
export type SpotSource = 'mappa' | 'mappa_norm' | 'portafoglio' | 'nessuna';

interface DerivInput {
  description: string;
  underlying: string;    // nome grezzo (chiave in underlyingPrices)
  type: 'call' | 'put';
  S0: number;            // prezzo sottostante corrente
  spotSource: SpotSource;
  K: number;
  T0: number;            // anni a scadenza da t0
  iv: number;            // IV implicita (o fallback)
  ivResolved: boolean;
  qtyMult: number;       // quantity * 100 / fx  (segno incluso)
  anchorPerShare: number;// prezzo opzione corrente
  basisPerShare: number; // anchor − prezzoBS(t0): correzione additiva che decade a 0 a scadenza.
                         // Garantisce che la curva parta ESATTAMENTE dal patrimonio a t0 anche
                         // quando il solver IV non riproduce il prezzo (deep ITM, vega ≈ 0).
  hasUnderlying: boolean;
  mvT0: number;          // market value EUR a t0
}

interface BondInput {
  description: string;
  info: BondInfo;
  ytm: number;
  currentClean: number;        // prezzo di mercato corrente (%) usato come base
  mvT0: number;                // market value EUR a t0
  cleanT0Model: number;        // prezzo modello a t0 (denominatore del ratio: ancora la curva a t0)
  couponCashPerPeriod: number; // EUR per cedola (0 se cedola non modellata o ZC)
  couponsModeled: boolean;
  inflationLinked: boolean;
  overridden: boolean;         // true se cedola/scadenza vengono da un override manuale
  maturityT: number;           // anni a scadenza da t0
  // flussi precomputati (evita Date math dentro patrimonyAt / bondCleanPrice):
  flowT: number[];             // anni da t0 di ogni flusso futuro (cedole; l'ultimo coincide con la scadenza)
  flowAmt: number[];           // importo % del face per flusso (cedola; +100 sull'ultimo per il rimborso)
}

/** Riepilogo di un bond modellato, per la UI (mostra i valori usati per la rivalutazione). */
export interface BondSummaryLeg {
  description: string;
  couponRatePct: number;   // cedola annua % usata nel modello (0 = zero coupon / non modellata)
  couponsModeled: boolean; // false = cedola sconosciuta → pull-to-par senza flussi cedolari
  frequency: number;
  maturity: string;        // ISO yyyy-mm-dd
  ytmPct: number;          // rendimento a scadenza implicito dal prezzo corrente (%), 0 per indicizzati
  inflationLinked: boolean;
  overridden: boolean;     // valori inseriti manualmente (editor "Risolvi bond") vs dedotti dalla description
  currentClean: number;    // prezzo corrente (%) usato come base del ratio
  mvT0: number;
}

/** Prezzo modello (face=100) a tYears da t0 con rendimento y — usa i flussi precomputati. */
function bondModelPrice(b: BondInput, tYears: number, y: number): number {
  const f = b.info.frequency;
  const periodRate = y / f;
  let pv = 0;
  for (let i = 0; i < b.flowT.length; i++) {
    const dt = b.flowT[i] - tYears;
    if (dt <= 0) continue;
    pv += b.flowAmt[i] * Math.pow(1 + periodRate, -dt * f);
  }
  return pv;
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
  spot: number;              // spot usato (0 se non risolto)
  spotSource: SpotSource;    // come è stato risolto
  intrinsicAtExpiryEUR: number; // intrinseco EUR realizzato a scadenza (con spot costante); = mvT0 se spot non risolto
}

export interface ProjectionInputs {
  t0: Date;
  horizon: Date;
  // bucket costanti (EUR)
  equityFlat: number;        // azioni + ETF — shock aggregato (bucket Equity)
  gpEquityFlat: number;      // GP azionaria (gp_total - gp_cash) — piatta, in bucket Equity
  commodityFlat: number;     // materie prime — piatte
  cashResidual: number;      // cash + arrotondamenti — piatto
  unparsedBondFlat: number;  // bond senza scadenza → tenuti al valore corrente (bucket bond)
  derivs: DerivInput[];
  bonds: BondInput[];
  unparsedBonds: string[];   // bond senza scadenza deducibile → tenuti piatti
  partialBonds: string[];    // bond con scadenza ma senza cedola → pull-to-par, cedole non modellate
  bondSummary: BondSummaryLeg[]; // valori (cedola, scadenza, YTM...) usati per ogni bond modellato — per UI
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

  // ── Risoluzione spot: catena completa, MAI lasciare una gamba senza prezzo se
  // il sottostante è risolvibile in QUALSIASI fonte disponibile ──
  //  1) mappa prezzi per chiave esatta (dopo il fix Dashboard è la mappa CONGELATA
  //     dello snapshot, con fallback live) — stessa fonte del Netting Intrinseco A;
  //  2) posizione stock/ETF in portafoglio il cui ticker/descrizione matcha il nome
  //     del sottostante → snapshot_price (come il resolver del Risk Analyzer e come
  //     l'associatedUnderlying del netting per le covered call);
  //  3) mappa prezzi per nome normalizzato (maiuscole, punteggiatura, spazi).
  const normKey = (s: string) => s.toUpperCase().replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stocksIdx = positions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
  const normalizedPriceMap = new Map<string, number>();
  if (underlyingPrices) {
    for (const [k, v] of Object.entries(underlyingPrices)) {
      if (v.price > 0) {
        const nk = normKey(k);
        if (!normalizedPriceMap.has(nk)) normalizedPriceMap.set(nk, v.price);
      }
    }
  }
  const resolveSpot = (underlyingName: string): { spot: number; source: SpotSource } => {
    // 1) mappa esatta
    const exact = underlyingPrices?.[underlyingName]?.price ?? 0;
    if (exact > 0) return { spot: exact, source: 'mappa' };
    // 2) posizione in portafoglio (prezzo snapshot, congelato per natura)
    const target = underlyingName.toUpperCase();
    const match = stocksIdx.find(s => {
      const t = (s.ticker || '').toUpperCase();
      const d = (s.description || '').toUpperCase();
      return (t.length > 0 && target.includes(t)) || (d.length > 0 && (target.includes(d) || d.includes(target)));
    });
    if (match) {
      const px = match.snapshot_price ?? match.current_price ?? 0;
      if (px > 0) return { spot: px, source: 'portafoglio' };
    }
    // 3) mappa per nome normalizzato
    const norm = normalizedPriceMap.get(normKey(underlyingName));
    if (norm && norm > 0) return { spot: norm, source: 'mappa_norm' };
    return { spot: 0, source: 'nessuna' };
  };

  const derivs: DerivInput[] = [];
  const derivSummary: DerivSummaryLeg[] = [];
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
    const underlyingName = p.underlying || p.description || '';
    const { spot: S0, source: spotSource } = resolveSpot(underlyingName);
    const hasUnderlying = S0 > 0;
    if (!hasUnderlying) derivsNoUnderlying.push(p.description);

    let iv = DEFAULT_OPT_VOL;
    let ivResolved = false;
    if (hasUnderlying && T0 > 0 && anchor > 0) {
      const solved = impliedVolatility(anchor, S0, K, T0, DEFAULT_RATE, p.option_type);
      if (isFinite(solved) && solved > 0) { iv = solved; ivResolved = true; }
    }
    // Correzione di base: il modello a t0 DEVE valere anchor. La differenza residua
    // (solver impreciso, prezzi sotto intrinseco, ecc.) decade linearmente a 0 a scadenza.
    const basisPerShare = (ivResolved && T0 > 0)
      ? anchor - bsPrice(S0, K, T0, DEFAULT_RATE, iv, p.option_type)
      : 0;

    // Intrinseco realizzato a scadenza (spot costante): è ciò che l'esercizio materializza
    // nel bucket equity. Se lo spot non è risolvibile la gamba resta al MV corrente.
    const intrinsicAtExpiryEUR = hasUnderlying && T0 > 0
      ? (p.option_type === 'call' ? Math.max(0, S0 - K) : Math.max(0, K - S0)) * qtyMult
      : mvT0;

    derivs.push({
      description: p.description,
      underlying: underlyingName,
      type: p.option_type,
      S0, spotSource, K, T0, iv, ivResolved,
      qtyMult, anchorPerShare: anchor, basisPerShare, hasUnderlying, mvT0,
    });
    derivSummary.push({
      description: p.description,
      underlying: underlyingName,
      type: p.option_type,
      qty,
      strike: K,
      mvT0,
      hasUnderlying,
      spot: S0,
      spotSource,
      intrinsicAtExpiryEUR,
    });
  }

  const bonds: BondInput[] = [];
  const bondSummary: BondSummaryLeg[] = [];
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
        // Frequenza per la MATEMATICA: >=1 (0 = zero coupon a livello UI, ma serve un
        // passo cedolare valido per generare le date; le cedole restano 0 per gli ZC).
        const freqMath = Math.max(1, frequency || 1);
        const info: BondInfo = { couponRatePct: couponRatePct ?? 0, maturity, frequency: freqMath, parsedFrom: ov ? 'override' : 'auto' };
        const ytm = inflationLinked ? 0 : bondYTM(info, currentClean, t0);
        const couponsModeled = couponRatePct != null && couponRatePct > 0;
        const couponCashPerPeriod = couponsModeled ? (mvEUR * (couponRatePct as number)) / (currentClean * freqMath) : 0;

        // Flussi futuri precomputati una volta sola (niente Date math in patrimonyAt).
        const maturityT = Math.max(0, yearFrac(t0, maturity));
        const futureDates = couponDates(info).filter(d => d.getTime() > t0.getTime());
        const cpnPct = (info.couponRatePct / freqMath); // % del face per periodo (0 per ZC)
        const flowT: number[] = [];
        const flowAmt: number[] = [];
        for (const d of futureDates) {
          const ft = yearFrac(t0, d);
          const isMat = Math.abs(d.getTime() - maturity.getTime()) < 24 * 3600 * 1000;
          flowT.push(ft);
          flowAmt.push(cpnPct + (isMat ? 100 : 0));
        }
        if (flowT.length === 0) { // scadenza a ridosso: solo rimborso
          flowT.push(maturityT);
          flowAmt.push(100);
        }

        const bTmp: BondInput = {
          description: p.description, info, ytm, currentClean, mvT0: mvEUR,
          cleanT0Model: 0, couponCashPerPeriod, couponsModeled, inflationLinked,
          overridden: !!ov, maturityT, flowT, flowAmt,
        };
        // Denominatore del ratio = prezzo MODELLO a t0: garantisce ratio(0) = 1, cioè la
        // curva parte esattamente dal MV corrente anche se il solve YTM è ricaduto sul fallback.
        bTmp.cleanT0Model = inflationLinked ? currentClean : bondModelPrice(bTmp, 0, ytm);
        if (!(bTmp.cleanT0Model > 0)) bTmp.cleanT0Model = currentClean;
        bonds.push(bTmp);
        bondSummary.push({
          description: p.description,
          couponRatePct: info.couponRatePct,
          couponsModeled,
          frequency,
          maturity: maturity.toISOString().slice(0, 10),
          ytmPct: ytm * 100,
          inflationLinked,
          overridden: !!ov,
          currentClean,
          mvT0: mvEUR,
        });

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
  // Bond più vicini a scadenza per primi: rende leggibile il tooltip riassuntivo in UI.
  bondSummary.sort((a, b) => a.maturity.localeCompare(b.maturity));

  // GP equity (gp_total - gp_cash) viene scorporata dal cashResidual e messa nel bucket Equity.
  const gpEquityFlat = Math.max(0, gpEquityValue);
  // baseValue = non-derivati a MV + cash (include anche la GP totale). Sottraiamo i bucket espliciti
  // e la quota GP equity; ciò che resta è cash + GP cash + arrotondamenti.
  const cashResidual = baseValue - parsedBondMV - unparsedBondFlat - equityFlat - commodityFlat - gpEquityFlat;

  const horizon = maxExpiry > 0 ? new Date(maxExpiry) : new Date(t0.getTime() + MS_YEAR);

  const derivMVT0 = derivs.reduce((s, d) => s + d.mvT0, 0);
  const derivativesNettingT0 = derivativesNettingT0Override ?? derivMVT0;
  const equityDerivOffset = derivativesNettingT0 - derivMVT0;
  const parsedBondT0 = bonds.reduce((s, b) => s + b.mvT0, 0);
  const patrimonyT0 = baseValue + derivativesNettingT0;
  const equityT0 = equityFlat + gpEquityFlat + derivativesNettingT0;
  const bondCommodityT0 = parsedBondT0 + unparsedBondFlat + commodityFlat;

  return {
    t0, horizon,
    equityFlat, gpEquityFlat, commodityFlat, cashResidual, unparsedBondFlat,
    derivs, bonds, unparsedBonds, partialBonds, bondSummary, derivsNoUnderlying,
    derivMVT0, derivativesNettingT0, equityDerivOffset, derivSummary,
    patrimonyT0, equityT0, bondCommodityT0,
  };
}

// ───────────────────────── Time grid ─────────────────────────

export interface TimePoint { date: Date; tYears: number; label: string; }

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function labelOf(d: Date): string {
  return `${MONTHS_IT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/**
 * Punti mensili da t0 a horizon (incluso), monotoni e mai oltre l'orizzonte;
 * se l'orizzonte è lungo, dirada per non superare maxPoints.
 */
export function buildTimeGrid(t0: Date, horizon: Date, maxPoints = 60): TimePoint[] {
  const totalMonths = Math.max(1, Math.ceil(yearFrac(t0, horizon) * 12));
  const step = Math.max(1, Math.ceil(totalMonths / maxPoints));
  const points: TimePoint[] = [];
  for (let m = 0; ; m += step) {
    const d = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + m, t0.getUTCDate()));
    if (d.getTime() >= horizon.getTime()) break; // l'orizzonte viene aggiunto sotto, esatto
    points.push({ date: d, tYears: Math.max(0, yearFrac(t0, d)), label: labelOf(d) });
    if (points.length > maxPoints + 2) break; // guardia
  }
  points.push({ date: horizon, tYears: Math.max(0, yearFrac(t0, horizon)), label: labelOf(horizon) });
  return points;
}

// ───────────────────────── Valutazione a data fissa ─────────────────────────

/** Valore patrimonio a una data (senza shock: proiezione deterministica). */
function patrimonyAt(inp: ProjectionInputs, tp: TimePoint, scope: ProjectionScope = 'all'): number {
  const r = DEFAULT_RATE;

  // ── bucket EQUITY: azioni/ETF (piatte) + derivati (decadimento + esercizio) ──
  let derivVal = 0;
  let equityAdjAtExpiry = 0; // P/L da esercizio: spostato dal bucket derivati al bucket equity
  for (const d of inp.derivs) {
    if (!d.hasUnderlying) {
      // Spot non risolvibile da NESSUNA fonte (mappa congelata, portafoglio, mappa
      // normalizzata): fallback prudente al MV corrente COSTANTE, identico al fallback
      // del Netting Intrinseco A. Mai azzerare la gamba: distruggerebbe l'intrinseco
      // delle comprate ITM e cancellerebbe la passività delle vendute ITM.
      derivVal += d.mvT0;
      continue;
    }
    if (d.T0 <= 0) {
      // Opzione già scaduta nello snapshot (dato stantio): tenuta al MV corrente per non
      // disancorare t0 (l'esercizio con l'intrinseco creerebbe un salto artificiale).
      derivVal += d.mvT0;
      continue;
    }
    const Tt = Math.max(0, d.T0 - tp.tYears);
    const S = d.S0;
    const expired = tp.tYears >= d.T0;
    if (expired) {
      // Esercizio a scadenza: il P/L intrinseco si materializza nel bucket equity (azioni
      // consegnate/acquistate al strike). Il bucket derivati si azzera.
      const intrinsic = d.type === 'call' ? Math.max(0, S - d.K) : Math.max(0, d.K - S);
      equityAdjAtExpiry += intrinsic * d.qtyMult;
    } else if (d.ivResolved) {
      // BS + basis: la correzione decade linearmente a 0 → a t0 il valore è ESATTAMENTE
      // il MV corrente, a scadenza è l'intrinseco puro.
      const basis = d.basisPerShare * (Tt / d.T0);
      derivVal += (bsPrice(S, d.K, Tt, r, d.iv, d.type) + basis) * d.qtyMult;
    } else {
      // Interpolazione lineare prezzo corrente → intrinseco a scadenza. NIENTE clamp sul
      // premio temporale: per quote sotto l'intrinseco (deep ITM) il clamp disancorerebbe t0.
      const intrinsic = d.type === 'call' ? Math.max(0, S - d.K) : Math.max(0, d.K - S);
      const frac = Tt / d.T0;
      const px = intrinsic + (d.anchorPerShare - intrinsic) * frac;
      derivVal += px * d.qtyMult;
    }
  }
  const equitySleeve = inp.equityFlat + inp.gpEquityFlat + derivVal + equityAdjAtExpiry + inp.equityDerivOffset;

  // ── bucket BOND + COMMODITY ──
  let bondVal = 0;
  let coupons = 0;
  for (const b of inp.bonds) {
    const tCapYears = Math.min(tp.tYears, b.maturityT);
    if (b.inflationLinked) {
      // NON converge a 100: accredita sul target inflazione BCE.
      bondVal += b.mvT0 * Math.pow(1 + INFLATION_TARGET, tCapYears);
    } else if (tp.tYears >= b.maturityT) {
      bondVal += b.mvT0 * (100 / b.cleanT0Model); // rimborso a par
    } else {
      const clean = bondModelPrice(b, tp.tYears, b.ytm);
      bondVal += b.mvT0 * (clean / b.cleanT0Model);
    }
    // cedole staccate in (t0, tp] — flussi precomputati, niente Date math
    if (b.couponCashPerPeriod !== 0) {
      let n = 0;
      for (let i = 0; i < b.flowT.length; i++) {
        if (b.flowT[i] <= tp.tYears) n++;
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

// ───────────────────────── Proiezione ─────────────────────────

export interface ProjectionRow {
  label: string;
  tYears: number;
  patrimony: number;
  pnlPct: number;
}

// ───────────────────────── Scomposizione all'orizzonte (diagnostica) ─────────────────────────

export interface HorizonDecomposition {
  tYears: number;
  equityFlat: number;          // azioni + ETF (costanti)
  gpEquityFlat: number;        // GP azionaria (costante)
  derivIntrinsic: number;      // Σ intrinseci esercitati (gambe con spot risolto e vita residua > 0)
  derivNoSpotFlat: number;     // gambe senza spot risolvibile: MV corrente mantenuto
  derivStaleFlat: number;      // gambe già scadute nello snapshot: MV corrente mantenuto
  equityDerivOffset: number;   // offset costante = netting totale − Σ MV derivati locali
  bondValue: number;           // bond a rimborso / accredito inflazione all'orizzonte
  coupons: number;             // cedole staccate cumulate fino all'orizzonte
  unparsedBondFlat: number;
  commodityFlat: number;
  cashResidual: number;
  total: number;               // = patrimonyAt(orizzonte, 'all')
}

/**
 * Scompone il valore della proiezione all'orizzonte (ultima scadenza) nei suoi bucket.
 * Serve a confrontare, voce per voce, la curva con "patrimonio a Netting Intrinseco A":
 *   base + Σ intrinseci  vs  base + rivalutazione bond + cedole + gambe non risolte.
 * total coincide per costruzione con l'ultimo punto di projectDeterministic (scope 'all').
 */
export function decomposeAtHorizon(inp: ProjectionInputs): HorizonDecomposition {
  const tYears = Math.max(0, yearFrac(inp.t0, inp.horizon));

  let derivIntrinsic = 0;
  let derivNoSpotFlat = 0;
  let derivStaleFlat = 0;
  for (const d of inp.derivs) {
    if (!d.hasUnderlying) { derivNoSpotFlat += d.mvT0; continue; }
    if (d.T0 <= 0) { derivStaleFlat += d.mvT0; continue; }
    const intrinsic = d.type === 'call' ? Math.max(0, d.S0 - d.K) : Math.max(0, d.K - d.S0);
    derivIntrinsic += intrinsic * d.qtyMult;
  }

  let bondValue = 0;
  let coupons = 0;
  for (const b of inp.bonds) {
    const tCapYears = Math.min(tYears, b.maturityT);
    if (b.inflationLinked) {
      bondValue += b.mvT0 * Math.pow(1 + INFLATION_TARGET, tCapYears);
    } else {
      bondValue += b.mvT0 * (100 / b.cleanT0Model); // all'orizzonte ogni bond è scaduto → par
    }
    if (b.couponCashPerPeriod !== 0) {
      let n = 0;
      for (let i = 0; i < b.flowT.length; i++) if (b.flowT[i] <= tYears) n++;
      coupons += n * b.couponCashPerPeriod;
    }
  }

  const total = inp.equityFlat + inp.gpEquityFlat
    + derivIntrinsic + derivNoSpotFlat + derivStaleFlat + inp.equityDerivOffset
    + bondValue + coupons + inp.unparsedBondFlat + inp.commodityFlat + inp.cashResidual;

  return {
    tYears,
    equityFlat: inp.equityFlat,
    gpEquityFlat: inp.gpEquityFlat,
    derivIntrinsic, derivNoSpotFlat, derivStaleFlat,
    equityDerivOffset: inp.equityDerivOffset,
    bondValue, coupons,
    unparsedBondFlat: inp.unparsedBondFlat,
    commodityFlat: inp.commodityFlat,
    cashResidual: inp.cashResidual,
    total,
  };
}

/** Proiezione deterministica del patrimonio dal mese corrente all'orizzonte. */
export function projectDeterministic(inp: ProjectionInputs, grid: TimePoint[], scope: ProjectionScope = 'all'): ProjectionRow[] {
  const base = baseForScope(inp, scope);
  return grid.map(tp => {
    const v = patrimonyAt(inp, tp, scope);
    return { label: tp.label, tYears: tp.tYears, patrimony: v, pnlPct: base !== 0 ? ((v - base) / base) * 100 : 0 };
  });
}
