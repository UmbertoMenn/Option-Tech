export type AttributionTimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';
export type AttributionRangeSelection = AttributionTimeRange | 'CUSTOM';

export interface ResolvedAttributionPeriod {
  startDate: string;
  endDate: string;
}

function dateMonthsBefore(date: string, months: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setMonth(value.getMonth() - months);
  return value.toISOString().slice(0, 10);
}

export function cutoffForRange(range: AttributionTimeRange, endDate: string): string | null {
  if (range === 'MAX') return null;
  if (range === 'YTD') return `${endDate.slice(0, 4)}-01-01`;
  const months: Record<Exclude<AttributionTimeRange, 'MAX' | 'YTD'>, number> = {
    '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36,
  };
  return dateMonthsBefore(endDate, months[range]);
}

function startForCutoff(dates: string[], cutoff: string | null): string | null {
  if (!cutoff) return dates[0] ?? null;
  // Miglior T0 disponibile alla o prima della data richiesta: il primo
  // snapshot successivo troncherebbe il rendimento del periodo.
  return dates.filter(date => date <= cutoff).at(-1) ?? dates[0] ?? null;
}

/**
 * Risolve il periodo di attribuzione a partire dalle date effettivamente
 * attribuibili (quelle con SIA snapshot completo SIA Netting storico).
 *
 * - preset relativi (1M…MAX/YTD): T1 è l'ultima data disponibile, T0 il miglior
 *   snapshot alla o prima della soglia del preset;
 * - selezione manuale ('CUSTOM' con customStart/customEnd): l'utente fissa
 *   esplicitamente uno o entrambi gli estremi; l'estremo mancante viene dedotto
 *   dalla data attribuibile adiacente.
 *
 * Ritorna null se non ci sono almeno due date attribuibili o se il periodo
 * risultante non è valido (T0 non precede T1).
 */
export function resolveAttributionPeriod(input: {
  attributableDates: string[];
  range: AttributionRangeSelection;
  customStart?: string | null;
  customEnd?: string | null;
}): ResolvedAttributionPeriod | null {
  const dates = [...new Set(input.attributableDates)].sort((a, b) => a.localeCompare(b));
  if (dates.length < 2) return null;

  const { range, customStart, customEnd } = input;
  let startDate: string;
  let endDate: string;

  if (range === 'CUSTOM' && customStart && customEnd) {
    startDate = customStart;
    endDate = customEnd;
  } else if (range === 'CUSTOM' && customEnd) {
    endDate = customEnd;
    startDate = dates.filter(d => d < endDate).at(-1) ?? dates[0];
  } else if (range === 'CUSTOM' && customStart) {
    startDate = customStart;
    endDate = dates.filter(d => d > startDate).at(0) ?? dates[dates.length - 1];
  } else {
    endDate = dates[dates.length - 1];
    const preset: AttributionTimeRange = range === 'CUSTOM' ? 'MAX' : range;
    const cutoff = cutoffForRange(preset, endDate);
    startDate = startForCutoff(dates.filter(d => d < endDate), cutoff) ?? dates[0];
  }

  if (!startDate || !endDate || startDate >= endDate) return null;
  return { startDate, endDate };
}
