// Bond math best-effort: cedola e scadenza non sono colonne strutturate nello schema,
// quindi vengono dedotte dalla `description` (formati broker IT/EU). Dove non deducibili,
// il bond viene tenuto piatto (nessun pull-to-par, nessuna cedola) e segnalato.
//
// Convenzione robusta rispetto a quantità/face: la proiezione lavora sul RAPPORTO del
// prezzo clean (price(t)/price(t0)) applicato al market value corrente, e calcola le
// cedole in cassa come frazione del valore nominale derivato dal prezzo corrente. Così
// non serve conoscere units/face: vedi portfolioProjection.ts.

export interface BondInfo {
  couponRatePct: number;   // cedola annua in % del nominale (es. 3.5)
  maturity: Date;
  frequency: number;       // pagamenti/anno (default 1)
  parsedFrom: string;      // debug: cosa è stato riconosciuto
}

const IT_MONTH: Record<string, number> = {
  GE: 1, FE: 2, MZ: 3, AP: 4, MG: 5, GN: 6, LU: 7, AG: 8, ST: 9, OT: 10, NO: 11, DC: 12,
};
const EN_MONTH: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function mkDate(y: number, m: number, d: number): Date {
  // m: 1-12
  return new Date(Date.UTC(y, m - 1, d));
}

function parseMaturity(descUpper: string): { date: Date; how: string } | null {
  // 1) DD/MM/YYYY | DD-MM-YYYY | DD.MM.YYYY
  let m = descUpper.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (m) return { date: mkDate(+m[3], +m[2], +m[1]), how: 'DD/MM/YYYY' };
  // 2) YYYY-MM-DD
  m = descUpper.match(/\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (m) return { date: mkDate(+m[1], +m[2], +m[3]), how: 'YYYY-MM-DD' };
  // 3) DDMMYYYY concatenato (es. BTP ITA 28062030)
  m = descUpper.match(/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d{2})\b/);
  if (m) return { date: mkDate(+m[3], +m[2], +m[1]), how: 'DDMMYYYY' };
  // 4) DD<MeseIT 2 lettere>YY  (Directa, es. 01MZ30, 15DC28)
  m = descUpper.match(/\b(\d{1,2})(GE|FE|MZ|AP|MG|GN|LU|AG|ST|OT|NO|DC)(\d{2})\b/);
  if (m) return { date: mkDate(2000 + +m[3], IT_MONTH[m[2]], +m[1]), how: 'DDMMMit/YY' };
  // 5) <MeseIT 2 lettere>YY senza giorno (es. ST33 = settembre 2033) -> giorno 1
  m = descUpper.match(/\b(GE|FE|MZ|AP|MG|GN|LU|AG|ST|OT|NO|DC)(\d{2})\b/);
  if (m) return { date: mkDate(2000 + +m[2], IT_MONTH[m[1]], 1), how: 'MMMit/YY' };
  // 6) DD MMM(EN) YYYY  (es. 15 NOV 2034 / 15NOV34)
  m = descUpper.match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})\b/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return { date: mkDate(yr, EN_MONTH[m[2]], +m[1]), how: 'DDMMMen/YYYY' };
  }
  // 6b) MMM(EN)YY senza giorno (es. BOT ZC JUN27) -> giorno 1
  m = descUpper.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2})\b/);
  if (m) return { date: mkDate(2000 + +m[2], EN_MONTH[m[1]], 1), how: 'MMMen/YY' };
  // 7) MM/YYYY -> fine mese
  m = descUpper.match(/\b(\d{1,2})[/\-.](\d{4})\b/);
  if (m) return { date: mkDate(+m[2], +m[1] % 12 + 1, 1), how: 'MM/YYYY' };
  // 8) anno nudo plausibile (2024..2070) -> 31/12
  m = descUpper.match(/\b(20[2-6]\d|2070)\b/);
  if (m) return { date: mkDate(+m[1], 12, 31), how: 'YYYY' };
  return null;
}

/** Frequenza cedolare di default per i govvie italiani (semestrale) vs resto (annuale). */
function defaultFrequency(descUpper: string): number {
  if (/\bBTP\b|\bCCT\b|\bCTZ\b|\bBOT\b/.test(descUpper)) return 2;
  return 1;
}

export interface BondPartial {
  couponRatePct: number | null; // null = cedola non deducibile (es. step-up); 0 = zero coupon noto
  maturity: Date | null;
  frequency: number;
  inflationLinked: boolean;     // BTP Italia / €i / indicizzati: NON convergono a 100, accreditano sull'inflazione
}

/** Bond indicizzato all'inflazione? (BTP Italia, BTP€i, TIPS, ecc.) */
function isInflationLinked(descUpper: string): boolean {
  return /\bINFL\b|INFLAZ|INDICIZZAT|INFLATION|\bTII\b|€I\b|BTP\s*ITAL/.test(descUpper);
}

/**
 * Parsing parziale: prova a estrarre cedola e scadenza separatamente.
 * - inflation-linked          → accredito su target inflazione (no pull-to-par)
 * - maturity nota + coupon noto (anche 0 = zero coupon) → proiezione completa (pull-to-par)
 * - maturity nota + coupon null → pull-to-par senza cedole modellate
 * - maturity null               → bond tenuto piatto
 */
export function parseBondPartial(description: string | null | undefined): BondPartial {
  if (!description) return { couponRatePct: null, maturity: null, frequency: 1, inflationLinked: false };
  const up = description.toUpperCase();
  let couponRatePct: number | null = null;
  const cm = up.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (cm) couponRatePct = parseFloat(cm[1].replace(',', '.'));
  // BOT e zero-coupon: cedola NOTA = 0 (convergono a 100, nessuna cedola)
  else if (/\bBOT\b|\bZ\.?C\.?\b|\bZERO\b|ZERO\s*COUPON/.test(up)) couponRatePct = 0;
  const mat = parseMaturity(up);
  return {
    couponRatePct,
    maturity: mat && isFinite(mat.date.getTime()) ? mat.date : null,
    frequency: defaultFrequency(up),
    inflationLinked: isInflationLinked(up),
  };
}

/** Deduce cedola/scadenza dalla description del bond. Null se non sufficiente. */
export function parseBondInfo(description: string | null | undefined): BondInfo | null {
  if (!description) return null;
  const up = description.toUpperCase();

  // cedola: primo "x.yy%" (anche con virgola). Zero coupon -> 0 se "ZC"/"ZERO".
  let couponRatePct: number | null = null;
  const cm = up.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (cm) couponRatePct = parseFloat(cm[1].replace(',', '.'));
  else if (/\bZ\.?C\.?\b|\bZERO\b/.test(up)) couponRatePct = 0;

  const mat = parseMaturity(up);
  if (couponRatePct === null || !mat) return null;
  if (!isFinite(mat.date.getTime())) return null;

  return {
    couponRatePct,
    maturity: mat.date,
    frequency: 1, // default annuale (govvie EUR); modificabile a monte se necessario
    parsedFrom: `coupon=${couponRatePct}% maturity=${mat.how}`,
  };
}

/** Date dei flussi cedolari da `from` (escluso) alla maturity (incluso), a ritroso. */
export function couponDates(info: BondInfo, fromInclusiveOk = false): Date[] {
  const out: Date[] = [];
  const stepMonths = Math.round(12 / info.frequency);
  const m = info.maturity;
  let d = new Date(m.getTime());
  // genera all'indietro finché > epoch ragionevole
  for (let i = 0; i < 200; i++) {
    out.push(new Date(d.getTime()));
    const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - stepMonths, d.getUTCDate()));
    d = nd;
    if (d.getUTCFullYear() < 1990) break;
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

function yearFrac(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** Prezzo clean teorico (face=100) dato un rendimento annuo `y`, valutato a `asOf`. */
export function bondCleanPrice(info: BondInfo, ytm: number, asOf: Date, face = 100): number {
  const f = info.frequency;
  const couponPmt = (info.couponRatePct / 100) * face / f;
  const periodRate = ytm / f;
  let pv = 0;
  const dates = couponDates(info);
  for (const cd of dates) {
    if (cd.getTime() <= asOf.getTime()) continue; // cedola già staccata
    const t = yearFrac(asOf, cd);
    if (t <= 0) continue;
    const n = t * f; // numero di periodi (frazionario)
    const df = Math.pow(1 + periodRate, -n);
    pv += couponPmt * df;
    if (Math.abs(cd.getTime() - info.maturity.getTime()) < 24 * 3600 * 1000) {
      pv += face * df; // rimborso a scadenza insieme all'ultima cedola
    }
  }
  return pv;
}

/** Rendimento annuo (YTM) che riproduce il prezzo clean corrente. Bisezione. */
export function bondYTM(info: BondInfo, cleanPrice: number, asOf: Date, face = 100): number {
  let lo = -0.5, hi = 1.5;
  let pLo = bondCleanPrice(info, lo, asOf, face) - cleanPrice;
  let pHi = bondCleanPrice(info, hi, asOf, face) - cleanPrice;
  if (pLo === 0) return lo;
  if (pHi === 0) return hi;
  if (pLo * pHi > 0) {
    // prezzo fuori range plausibile: fallback grezzo coupon/price
    return (info.couponRatePct / 100) * face / cleanPrice;
  }
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const pm = bondCleanPrice(info, mid, asOf, face) - cleanPrice;
    if (Math.abs(pm) < 1e-7) return mid;
    if (pLo * pm < 0) { hi = mid; pHi = pm; } else { lo = mid; pLo = pm; }
  }
  return (lo + hi) / 2;
}
