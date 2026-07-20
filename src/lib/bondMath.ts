// Bond math + resolver dei metadati (cedola / scadenza / frequenza).
//
// Cedola e scadenza NON sono colonne strutturate nello schema `positions`: vengono
// dedotte dalla `description` del broker (formati IT/EU molto eterogenei) e, dove non
// deducibili, da un override manuale per ISIN (tabella `bond_overrides`).
//
// Convenzione robusta rispetto a quantità/face: la proiezione lavora sul RAPPORTO del
// prezzo clean (price(t)/price(t0)) applicato al market value corrente, e calcola le
// cedole in cassa come frazione del nominale derivato dal prezzo corrente. Vedi
// portfolioProjection.ts — qui produciamo solo i metadati e il pricing teorico.

export interface BondInfo {
  couponRatePct: number;   // cedola annua in % del nominale (es. 3.5)
  maturity: Date;
  frequency: number;       // pagamenti/anno (>=1 per il calcolo; 0 = zero coupon a livello UI)
  parsedFrom: string;      // debug: cosa è stato riconosciuto
}

// ── Mesi ────────────────────────────────────────────────────────────────────
// Copre: italiano 3 lettere (GEN..DIC), inglese 3 lettere (JAN..DEC) e i codici
// Directa a 2 lettere (GE FE MZ AP MG GN LU AG ST OT NO DC). Le forme più lunghe
// vengono provate PRIMA nella regex per non far vincere un match parziale (es. "SET"
// non deve degradare a "ST").
const MONTH_MAP: Record<string, number> = {
  // IT 3 lettere
  GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6, LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12,
  // EN 3 lettere (FEB/MAR/APR/NOV coincidono)
  JAN: 1, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, DEC: 12,
  // IT 2 lettere (Directa)
  GE: 1, FE: 2, MZ: 3, AP: 4, MG: 5, GN: 6, LU: 7, AG: 8, ST: 9, OT: 10, NO: 11, DC: 12,
};
// Alternation ordinata per lunghezza decrescente (3 lettere prima delle 2).
const MONTH_ALT = Object.keys(MONTH_MAP)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join('|');

function mkDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d)); // m: 1-12
}
function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 2020 || y > 2085) return false;
  return true;
}
function yy2yyyy(s: string): number {
  return s.length <= 2 ? 2000 + parseInt(s, 10) : parseInt(s, 10);
}

/**
 * Estrae la scadenza dalla description provando, in ordine, tutti i formati che
 * compaiono nei descrittori bancari italiani. Primo match valido vince.
 */
function parseMaturity(descUpper: string): { date: Date; how: string } | null {
  const up = descUpper;
  let m: RegExpMatchArray | null;

  // 1) ISO YYYY-MM-DD
  m = up.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m && validDate(+m[1], +m[2], +m[3])) return { date: mkDate(+m[1], +m[2], +m[3]), how: 'YYYY-MM-DD' };

  // 2) DD/MM/YYYY  (anche - o .)
  m = up.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
  if (m && validDate(+m[3], +m[2], +m[1])) return { date: mkDate(+m[3], +m[2], +m[1]), how: 'DD/MM/YYYY' };

  // 3) DD/MM/YY  (anno a 2 cifre → 20YY)  es. 12/02/27, 01/03/32
  m = up.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})\b/);
  if (m) { const y = yy2yyyy(m[3]); if (validDate(y, +m[2], +m[1])) return { date: mkDate(y, +m[2], +m[1]), how: 'DD/MM/YY' }; }

  // 4) DD<MESE>YY|YYYY  (mese a lettere, giorno attaccato, code trailing ammesso)
  //    es. 14GIU28, 16OTT42, 15FEB28, 16FEB31MWC, 15DC30
  m = up.match(new RegExp(String.raw`\b(\d{1,2})\s*(${MONTH_ALT})\s*(\d{2,4})`));
  if (m) { const mo = MONTH_MAP[m[2]]; const y = yy2yyyy(m[3]); if (mo && validDate(y, mo, +m[1])) return { date: mkDate(y, mo, +m[1]), how: 'DD<MESE>YY' }; }

  // 5) <MESE>YY|YYYY  (senza giorno → giorno 1)  es. APR27, FEB29, ST33, AP27, OCT31
  m = up.match(new RegExp(String.raw`\b(${MONTH_ALT})\s*(\d{2,4})`));
  if (m) { const mo = MONTH_MAP[m[1]]; const y = yy2yyyy(m[2]); if (mo && validDate(y, mo, 1)) return { date: mkDate(y, mo, 1), how: '<MESE>YY' }; }

  // 6) DDMMYYYY concatenato  es. 28062030
  m = up.match(/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})\b/);
  if (m && validDate(+m[3], +m[2], +m[1])) return { date: mkDate(+m[3], +m[2], +m[1]), how: 'DDMMYYYY' };

  // 7) DDMMYY concatenato  es. 140328, 280630, 050330, 281032, 221128, 130627
  m = up.match(/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(\d{2})\b/);
  if (m) { const y = yy2yyyy(m[3]); if (validDate(y, +m[2], +m[1])) return { date: mkDate(y, +m[2], +m[1]), how: 'DDMMYY' }; }

  // 8) MM/YYYY → giorno 1 del mese
  m = up.match(/\b(0?[1-9]|1[0-2])[/.\-](\d{4})\b/);
  if (m && validDate(+m[2], +m[1], 1)) return { date: mkDate(+m[2], +m[1], 1), how: 'MM/YYYY' };

  // 9) anno a 4 cifre nudo (2020..2079) → 31/12
  m = up.match(/\b(20[2-7]\d)\b/);
  if (m) { const y = +m[1]; if (validDate(y, 12, 31)) return { date: mkDate(y, 12, 31), how: 'YYYY' }; }

  // 10) anno a 2 cifre nudo (26..75) → 31/12. Last resort: si scansiona la stringa
  //     PRIVATA della cedola (la cedola può contenere cifre a 2 posizioni) e si prende
  //     l'ULTIMO token a 2 cifre in range anno. es. "BON Y OBL 0.10% 31" → 2031.
  const stripped = up.replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
  const twoDigit = [...stripped.matchAll(/\b(\d{2})\b/g)].map(x => +x[1]).filter(n => n >= 26 && n <= 75);
  if (twoDigit.length > 0) {
    const y = 2000 + twoDigit[twoDigit.length - 1];
    if (validDate(y, 12, 31)) return { date: mkDate(y, 12, 31), how: 'YY-bare' };
  }

  return null;
}

/** Zero coupon? (BOT, ZC, "zero coupon"). */
function isZeroCoupon(up: string): boolean {
  return /\bBOT\b|\bZ\.?C\.?\b|ZERO\s*COUPON|\bZERO\b/.test(up);
}

/** Indicizzato all'inflazione? (BTP Italia, BTP€i, TIPS, "INFL...", "INF C"). */
function isInflationLinked(up: string): boolean {
  // "INFL" copre INFL/INFLC/INFLAZ/INFLATION; "\bINF\b" copre "INF C"; "BTP ITA" = BTP Italia.
  return /INFL|INDICIZZAT|\bINF\b|INFLATION|\bTII\b|\bTIPS\b|€\s*I\b|\bBTP\s*ITA/.test(up);
}

/** Cedola step-up / non fissa? (BTP Valore, BTP Più, "ST UP"/"STEP UP"). */
function isStepUp(up: string): boolean {
  return /STEP\s*UP|\bST\.?\s*UP\b|\bBTP\s*VAL|\bBTP\s*PI(U|Ù)\b/.test(up);
}

/** Frequenza cedolare di default: govvie/BTP-Italia/Valore semestrale, resto annuale, ZC = 0. */
function defaultFrequency(up: string): number {
  if (isZeroCoupon(up)) return 0;
  if (/\bBTP\b|\bCCT\b|\bCTZ\b|\bBTP\s*ITA|\bBTP\s*VAL|\bBTP\s*PI(U|Ù)\b/.test(up)) return 2;
  return 1;
}

/** Cedola annua in % dalla description. null se non presente e non ZC. */
function parseCouponPct(up: string): number | null {
  const cm = up.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (cm) return parseFloat(cm[1].replace(',', '.'));
  if (isZeroCoupon(up)) return 0;
  return null;
}

export interface BondPartial {
  couponRatePct: number | null; // null = cedola non deducibile; 0 = zero coupon noto
  maturity: Date | null;
  frequency: number;
  inflationLinked: boolean;
  stepUp: boolean;              // cedola variabile nota (BTP Valore/Più): pull-to-par senza cedole modellate
  zeroCoupon: boolean;
}

/**
 * Parsing parziale: estrae separatamente cedola, scadenza, tipo. Nessun lancio, sempre
 * un oggetto (i campi null indicano "non deducibile").
 */
export function parseBondPartial(description: string | null | undefined): BondPartial {
  if (!description) {
    return { couponRatePct: null, maturity: null, frequency: 1, inflationLinked: false, stepUp: false, zeroCoupon: false };
  }
  const up = description.toUpperCase();
  const mat = parseMaturity(up);
  return {
    couponRatePct: parseCouponPct(up),
    maturity: mat && isFinite(mat.date.getTime()) ? mat.date : null,
    frequency: defaultFrequency(up),
    inflationLinked: isInflationLinked(up),
    stepUp: isStepUp(up),
    zeroCoupon: isZeroCoupon(up),
  };
}

/** Deduce cedola/scadenza dalla description. Null se cedola o scadenza mancano (retro-compat). */
export function parseBondInfo(description: string | null | undefined): BondInfo | null {
  const p = parseBondPartial(description);
  if (p.couponRatePct === null || !p.maturity) return null;
  return {
    couponRatePct: p.couponRatePct,
    maturity: p.maturity,
    frequency: Math.max(1, p.frequency || 1),
    parsedFrom: `coupon=${p.couponRatePct}% maturity ok`,
  };
}

// ── Risoluzione unificata description + override ────────────────────────────
export interface BondOverrideLike {
  couponRatePct: number | null;
  maturity: Date | null;
  frequency: number | null;
}
export type BondFixStatus = 'resolved' | 'partial' | 'unresolved';

export interface ResolvedBond {
  couponRatePct: number | null;
  maturity: Date | null;
  frequency: number;
  inflationLinked: boolean;
  stepUp: boolean;
  zeroCoupon: boolean;
  overridden: boolean;
  status: BondFixStatus;   // resolved = ok; partial = pull-to-par senza cedole; unresolved = manca la scadenza
  needsFix: boolean;       // va mostrato nell'editor "Risolvi bond"
}

/**
 * Fonde description + override manuale e classifica lo stato del bond.
 * - unresolved: manca la scadenza → NON proiettabile (va risolto a mano)
 * - partial:    scadenza nota ma cedola ignota su bond ordinario → pull-to-par senza cedole
 * - resolved:   scadenza nota + (cedola nota | ZC | inflation | step-up)
 *
 * `needsFix` è true per unresolved e per i "partial ordinari" (cedola davvero mancante,
 * es. corporate senza % nella description). NON è true per ZC/inflation/step-up, che sono
 * modellati correttamente anche senza una singola cedola fissa.
 */
export function resolveBond(description: string | null | undefined, override?: BondOverrideLike | null): ResolvedBond {
  const p = parseBondPartial(description);
  const ov = override ?? null;

  const maturity = ov?.maturity ?? p.maturity;
  const couponRatePct = ov ? ov.couponRatePct : p.couponRatePct; // override vince (anche null esplicito)
  const frequency = ov?.frequency ?? p.frequency;
  const overridden = !!ov && (ov.maturity != null || ov.couponRatePct != null);

  let status: BondFixStatus;
  let needsFix: boolean;
  if (!maturity) {
    status = 'unresolved';
    needsFix = true;
  } else if (couponRatePct == null && !p.inflationLinked && !p.stepUp && !p.zeroCoupon) {
    status = 'partial';
    needsFix = true; // cedola davvero mancante su bond ordinario
  } else {
    status = couponRatePct == null && !p.zeroCoupon ? 'partial' : 'resolved';
    needsFix = false; // inflation/step-up/ZC/cedola nota → ok
  }

  return {
    couponRatePct, maturity, frequency,
    inflationLinked: p.inflationLinked, stepUp: p.stepUp, zeroCoupon: p.zeroCoupon,
    overridden, status, needsFix,
  };
}

// ── Pricing teorico ─────────────────────────────────────────────────────────
/** Date dei flussi cedolari dalla maturity a ritroso. Frequenza clampata a >=1. */
export function couponDates(info: BondInfo): Date[] {
  const out: Date[] = [];
  const f = Math.max(1, info.frequency || 1);
  const stepMonths = Math.round(12 / f);
  let d = new Date(info.maturity.getTime());
  for (let i = 0; i < 200; i++) {
    out.push(new Date(d.getTime()));
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - stepMonths, d.getUTCDate()));
    if (d.getUTCFullYear() < 1990) break;
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

function yearFrac(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** Prezzo clean teorico (face=100) dato un rendimento annuo `ytm`, valutato a `asOf`. */
export function bondCleanPrice(info: BondInfo, ytm: number, asOf: Date, face = 100): number {
  const f = Math.max(1, info.frequency || 1);
  const couponPmt = (info.couponRatePct / 100) * face / f;
  const periodRate = ytm / f;
  let pv = 0;
  for (const cd of couponDates(info)) {
    if (cd.getTime() <= asOf.getTime()) continue; // cedola già staccata
    const t = yearFrac(asOf, cd);
    if (t <= 0) continue;
    const n = t * f;
    const df = Math.pow(1 + periodRate, -n);
    pv += couponPmt * df;
    if (Math.abs(cd.getTime() - info.maturity.getTime()) < 24 * 3600 * 1000) {
      pv += face * df; // rimborso a scadenza con l'ultima cedola
    }
  }
  return pv;
}

/** Rendimento annuo (YTM) che riproduce il prezzo clean corrente. Bisezione. */
export function bondYTM(info: BondInfo, cleanPrice: number, asOf: Date, face = 100): number {
  let lo = -0.5, hi = 1.5;
  let pLo = bondCleanPrice(info, lo, asOf, face) - cleanPrice;
  const pHi = bondCleanPrice(info, hi, asOf, face) - cleanPrice;
  if (pLo === 0) return lo;
  if (pHi === 0) return hi;
  if (pLo * pHi > 0) {
    return (info.couponRatePct / 100) * face / cleanPrice; // fuori range: fallback grezzo
  }
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pm = bondCleanPrice(info, mid, asOf, face) - cleanPrice;
    if (Math.abs(pm) < 1e-7) return mid;
    if (pLo * pm < 0) { hi = mid; } else { lo = mid; pLo = pm; }
  }
  return (lo + hi) / 2;
}
