/**
 * Esposizione azionaria media in un periodo, dai dati della Visualizzazione
 * Storica.
 *
 * Ogni snapshot storico congela, insieme al portafoglio completo, la sua
 * esposizione azionaria (stessa formula del Risk Analyzer: azioni, ETF,
 * commodity, put nude, LEAP, strategie, CC sintetiche e azioni GP sul
 * netting totale). La media è ponderata per il tempo con interpolazione
 * lineare tra snapshot consecutivi: ogni giorno del periodo pesa uguale,
 * indipendentemente da quanti snapshot sono stati salvati.
 *
 * Il periodo effettivo è limitato ai giorni coperti da snapshot: se la
 * Visualizzazione Storica parte dopo l'inizio del periodo (o si ferma prima
 * della fine) la media lo dichiara, senza inventare i giorni mancanti.
 */

export interface ExposurePoint {
  date: string; // YYYY-MM-DD
  /** Quota 0-1 */
  pct: number;
}

export interface AverageExposureResult {
  /** Media 0-1 sul periodo coperto, null se non ci sono dati. */
  average: number | null;
  /** Estremi effettivi della media (giorni coperti). */
  from: string | null;
  to: string | null;
  /** Snapshot usati (compreso l'eventuale ancoraggio precedente all'inizio). */
  points: number;
  min: number | null;
  max: number | null;
  requestedStart: string;
  requestedEnd: string;
  /** Primo giorno con dati se il periodo inizia prima: prima di questa data mancano i dati. */
  missingBefore: string | null;
  /** Ultimo giorno con dati se il periodo termina molto dopo: oltre questa data mancano i dati. */
  missingAfter: string | null;
  /** Intervalli senza snapshot più lunghi di GAP_DAYS dentro il periodo coperto. */
  gaps: { from: string; to: string }[];
}

const DAY = 86_400_000;
/** Oltre questo intervallo tra due snapshot il buco viene segnalato. */
export const GAP_DAYS = 31;
/** Tolleranza sulla fine: l'ultimo snapshot può essere di qualche giorno prima di oggi. */
export const END_TOLERANCE_DAYS = 7;

const toTime = (date: string) => Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function computeAverageEquityExposure(
  rawPoints: ExposurePoint[],
  requestedStart: string,
  requestedEnd: string,
): AverageExposureResult {
  const empty: AverageExposureResult = {
    average: null, from: null, to: null, points: 0, min: null, max: null,
    requestedStart, requestedEnd, missingBefore: null, missingAfter: null, gaps: [],
  };
  const byDate = new Map<string, number>();
  for (const point of rawPoints) {
    if (!point.date || !Number.isFinite(point.pct)) continue;
    byDate.set(point.date.slice(0, 10), point.pct);
  }
  const series = [...byDate.entries()]
    .map(([date, pct]) => ({ date, pct, t: toTime(date) }))
    .sort((a, b) => a.t - b.t);

  const startT = toTime(requestedStart);
  const endT = toTime(requestedEnd);
  if (series.length === 0 || endT < startT) return empty;

  // Ancoraggio: l'ultimo snapshot prima dell'inizio serve a interpolare il
  // primo tratto del periodo; lo snapshot dopo la fine non serve (la fine è ≤ oggi).
  const anchorIndex = series.reduce((idx, point, i) => (point.t <= startT ? i : idx), -1);
  const relevant = series.filter((point, i) => i >= Math.max(0, anchorIndex) && point.t <= endT);
  if (relevant.length === 0) {
    return { ...empty, missingBefore: series[0].date };
  }

  const fromT = Math.max(startT, relevant[0].t);
  const toT = Math.min(endT, relevant[relevant.length - 1].t);

  const valueAt = (t: number): number => {
    if (t <= relevant[0].t) return relevant[0].pct;
    for (let i = 1; i < relevant.length; i++) {
      const left = relevant[i - 1];
      const right = relevant[i];
      if (t <= right.t) {
        const span = right.t - left.t;
        return span > 0 ? left.pct + (right.pct - left.pct) * (t - left.t) / span : right.pct;
      }
    }
    return relevant[relevant.length - 1].pct;
  };

  let average: number;
  if (toT <= fromT) {
    average = valueAt(fromT);
  } else {
    // Integrale trapezoidale sui nodi interni a [from, to].
    const knots = [fromT, ...relevant.map(p => p.t).filter(t => t > fromT && t < toT), toT];
    let area = 0;
    for (let i = 1; i < knots.length; i++) {
      area += (valueAt(knots[i - 1]) + valueAt(knots[i])) / 2 * (knots[i] - knots[i - 1]);
    }
    average = area / (toT - fromT);
  }

  const inWindow = relevant.filter(p => p.t >= fromT && p.t <= toT);
  const values = inWindow.length > 0 ? inWindow.map(p => p.pct) : [valueAt(fromT)];
  const gaps: { from: string; to: string }[] = [];
  for (let i = 1; i < relevant.length; i++) {
    const a = Math.max(relevant[i - 1].t, fromT);
    const b = Math.min(relevant[i].t, toT);
    if (b - a > GAP_DAYS * DAY) gaps.push({ from: toDate(a), to: toDate(b) });
  }

  return {
    average,
    from: toDate(fromT),
    to: toDate(toT),
    points: relevant.length,
    min: Math.min(...values),
    max: Math.max(...values),
    requestedStart,
    requestedEnd,
    missingBefore: fromT > startT + DAY / 2 ? toDate(fromT) : null,
    missingAfter: endT - toT > END_TOLERANCE_DAYS * DAY ? toDate(toT) : null,
    gaps,
  };
}
