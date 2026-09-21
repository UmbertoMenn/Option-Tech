import { describe, expect, it } from 'vitest';
import { resolveAttributionPeriod, resolveCoveredAttributionPeriod } from '@/lib/attributionPeriod';

const DATES = [
  '2024-01-31', '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-06-30',
];

describe('resolveAttributionPeriod', () => {
  it('ritorna null con meno di due date attribuibili', () => {
    expect(resolveAttributionPeriod([])).toBeNull();
    expect(resolveAttributionPeriod(['2024-12-31'])).toBeNull();
  });

  it('senza alcuna selezione, T0 è la prima data e T1 è l’ultima (storico completo)', () => {
    expect(resolveAttributionPeriod(DATES)).toEqual({ startDate: '2024-01-31', endDate: '2025-06-30' });
  });

  it('con solo T0 selezionato, T1 resta l’ultima data', () => {
    expect(resolveAttributionPeriod(DATES, '2024-06-30')).toEqual({ startDate: '2024-06-30', endDate: '2025-06-30' });
  });

  it('con solo T1 selezionato, T0 resta la prima data', () => {
    expect(resolveAttributionPeriod(DATES, null, '2024-09-30')).toEqual({ startDate: '2024-01-31', endDate: '2024-09-30' });
  });

  it('con entrambi selezionati e coerenti (T0 < T1), usa esattamente quella coppia', () => {
    expect(resolveAttributionPeriod(DATES, '2024-03-31', '2024-12-31')).toEqual({ startDate: '2024-03-31', endDate: '2024-12-31' });
  });

  it('T0 selezionato non tra le date attribuibili → fallback sulla prima data', () => {
    expect(resolveAttributionPeriod(DATES, '2024-07-15')).toEqual({ startDate: '2024-01-31', endDate: '2025-06-30' });
  });

  it('T1 selezionato non tra le date attribuibili → fallback sull’ultima data', () => {
    expect(resolveAttributionPeriod(DATES, null, '2024-07-15')).toEqual({ startDate: '2024-01-31', endDate: '2025-06-30' });
  });

  it('T0 selezionato ≥ T1 selezionato → T0 ripiega sulla prima data', () => {
    expect(resolveAttributionPeriod(DATES, '2024-12-31', '2024-06-30')).toEqual({ startDate: '2024-01-31', endDate: '2024-06-30' });
  });

  it('T1 selezionato uguale alla prima data (nessun T0 valido possibile) → null', () => {
    expect(resolveAttributionPeriod(DATES, null, '2024-01-31')).toBeNull();
  });

  it('date duplicate vengono deduplicate prima di risolvere il periodo', () => {
    expect(resolveAttributionPeriod([...DATES, '2024-01-31', '2025-06-30']))
      .toEqual({ startDate: '2024-01-31', endDate: '2025-06-30' });
  });
});


describe('periodo coperto da cash e titoli', () => {
  const august = [{ start: '2026-08-01', end: '2026-08-31' }];
  const dates = ['2026-07-08', '2026-07-31', '2026-08-03', '2026-08-27', '2026-09-09', '2026-09-21'];

  it('silvias: T0 31 luglio e T1 27 agosto, senza usare gli snapshot di settembre', () => {
    const result = resolveCoveredAttributionPeriod(dates, august, august);
    expect(result.period).toEqual({ startDate: '2026-07-31', endDate: '2026-08-27' });
    expect(result.dates).toEqual(['2026-07-31', '2026-08-03', '2026-08-27']);
  });

  it('riallinea anche selezioni precedenti alla copertura caricata', () => {
    expect(resolveCoveredAttributionPeriod(dates, august, august, '2026-07-08', '2026-09-21').period)
      .toEqual({ startDate: '2026-07-31', endDate: '2026-08-27' });
  });

  it('include il 31 agosto se esiste uno snapshot, senza proiettare al presente', () => {
    expect(resolveCoveredAttributionPeriod([...dates, '2026-08-31'], august, august).period?.endDate).toBe('2026-08-31');
  });

  it('non inventa una baseline: se manca il 31 luglio parte dal primo snapshot di agosto', () => {
    expect(resolveCoveredAttributionPeriod(dates.filter(d => d !== '2026-07-31'), august, august).period)
      .toEqual({ startDate: '2026-08-03', endDate: '2026-08-27' });
  });

  it('usa l’intersezione e richiede due snapshot nel periodo comune', () => {
    expect(resolveCoveredAttributionPeriod(dates, august, [{ start: '2026-08-10', end: '2026-09-30' }]).period).toBeNull();
    expect(resolveCoveredAttributionPeriod(dates, august, []).period).toBeNull();
    expect(resolveCoveredAttributionPeriod(dates, [], august).period).toBeNull();
  });

  it('unisce mesi contigui ma non attraversa intervalli senza movimenti', () => {
    const september = { start: '2026-09-01', end: '2026-09-30' };
    expect(resolveCoveredAttributionPeriod(dates, [...august, september], [...august, september]).period)
      .toEqual({ startDate: '2026-07-31', endDate: '2026-09-21' });
    const gap = [...august, { start: '2026-09-09', end: '2026-09-30' }];
    expect(resolveCoveredAttributionPeriod(dates, gap, gap).period)
      .toEqual({ startDate: '2026-09-09', endDate: '2026-09-21' });
    expect(resolveCoveredAttributionPeriod(dates, gap, gap, '2026-07-31', '2026-09-21').period)
      .toEqual({ startDate: '2026-09-09', endDate: '2026-09-21' });
    expect(resolveCoveredAttributionPeriod(dates, gap, gap, '2026-09-09', '2026-08-27').period)
      .toEqual({ startDate: '2026-07-31', endDate: '2026-08-27' });
  });
});
