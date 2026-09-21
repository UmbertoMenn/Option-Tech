import { DateWindow, mergeWindows } from './movementAttribution';

export interface ResolvedAttributionPeriod {
  startDate: string;
  endDate: string;
}

/** Only continuous intervals covered by BOTH ledgers are attributable.
 * T0 may be the preceding day: movements are counted over (T0, T1].
 * Never bridge a gap, even if both endpoints have complete snapshots.
 */
export function resolveCoveredAttributionPeriod(
  attributableDates: string[],
  titoliWindows: DateWindow[],
  cashWindows: DateWindow[],
  selectedStartDate?: string | null,
  selectedEndDate?: string | null,
) {
  const intersections: DateWindow[] = [];
  for (const titoli of titoliWindows) {
    for (const cash of cashWindows) {
      const start = titoli.start > cash.start ? titoli.start : cash.start;
      const end = titoli.end < cash.end ? titoli.end : cash.end;
      if (start <= end) intersections.push({ start, end });
    }
  }
  const windows = mergeWindows(intersections);
  const dates = [...new Set(attributableDates)].sort();
  const groups = windows.map(window => {
    const previous = new Date(`${window.start}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const baseline = previous.toISOString().slice(0, 10);
    return dates.filter(date => date >= baseline && date <= window.end);
  }).filter(group => group.length >= 2);
  // An explicitly chosen T1 selects its continuous coverage window.
  const group = groups.find(group => selectedEndDate && group.slice(1).includes(selectedEndDate))
    ?? groups.find(group => selectedStartDate && group.slice(0, -1).includes(selectedStartDate))
    ?? groups.at(-1) ?? [];
  return {
    windows,
    dates: group,
    endDates: groups.flatMap(group => group.slice(1)),
    period: resolveAttributionPeriod(group, selectedStartDate, selectedEndDate),
  };
}

/**
 * Risolve il periodo di attribuzione a partire dalle date effettivamente
 * attribuibili (quelle con SIA snapshot completo SIA Netting storico).
 *
 * Sia T0 sia T1 sono selezionabili dall'utente. In assenza di selezione (o
 * con una selezione non valida: non tra le date attribuibili, o T0 non
 * precedente a T1) si ripiega rispettivamente sulla prima e sull'ultima data
 * attribuibile disponibile. La UI passa soltanto le date all'interno della
 * copertura comune continua di cash e titoli.
 *
 * Ritorna null se non ci sono almeno due date attribuibili distinte, o se
 * anche dopo il fallback non esiste un T0 valido precedente a T1 (può
 * succedere solo se T1 selezionato coincide con la prima data disponibile).
 */
export function resolveAttributionPeriod(
  attributableDates: string[],
  selectedStartDate?: string | null,
  selectedEndDate?: string | null,
): ResolvedAttributionPeriod | null {
  const dates = [...new Set(attributableDates)].sort((a, b) => a.localeCompare(b));
  if (dates.length < 2) return null;

  const endDate = selectedEndDate && dates.includes(selectedEndDate)
    ? selectedEndDate
    : dates[dates.length - 1];
  const startDate = selectedStartDate && dates.includes(selectedStartDate) && selectedStartDate < endDate
    ? selectedStartDate
    : dates[0];

  if (startDate >= endDate) return null;
  return { startDate, endDate };
}
