import { describe, expect, it } from 'vitest';
import { cutoffForRange, resolveAttributionPeriod } from '@/lib/attributionPeriod';

const DATES = [
  '2024-01-31', '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-06-30',
];

describe('resolveAttributionPeriod', () => {
  it('ritorna null con meno di due date attribuibili', () => {
    expect(resolveAttributionPeriod({ attributableDates: [], range: 'MAX' })).toBeNull();
    expect(resolveAttributionPeriod({ attributableDates: ['2024-12-31'], range: 'MAX' })).toBeNull();
  });

  it('MAX usa la prima e l’ultima data disponibile', () => {
    expect(resolveAttributionPeriod({ attributableDates: DATES, range: 'MAX' }))
      .toEqual({ startDate: '2024-01-31', endDate: '2025-06-30' });
  });

  it('preset relativo prende il miglior T0 alla o prima della soglia, mai il successivo', () => {
    // 6 mesi prima di 2025-06-30 = 2024-12-30: il miglior T0 ≤ soglia è 2024-09-30,
    // NON 2024-12-31 (che è successivo alla soglia e troncherebbe il periodo).
    expect(resolveAttributionPeriod({ attributableDates: DATES, range: '6M' }))
      .toEqual({ startDate: '2024-09-30', endDate: '2025-06-30' });
  });

  it('YTD parte dal primo snapshot dell’anno di T1', () => {
    expect(resolveAttributionPeriod({ attributableDates: DATES, range: 'YTD' }))
      .toEqual({ startDate: '2024-12-31', endDate: '2025-06-30' });
  });

  it('selezione manuale (CUSTOM) rispetta entrambi gli estremi scelti', () => {
    expect(resolveAttributionPeriod({
      attributableDates: DATES, range: 'CUSTOM',
      customStart: '2024-03-31', customEnd: '2024-09-30',
    })).toEqual({ startDate: '2024-03-31', endDate: '2024-09-30' });
  });

  it('CUSTOM con solo T0 deduce il T1 come data attribuibile successiva', () => {
    expect(resolveAttributionPeriod({
      attributableDates: DATES, range: 'CUSTOM', customStart: '2024-06-30', customEnd: null,
    })).toEqual({ startDate: '2024-06-30', endDate: '2024-09-30' });
  });

  it('CUSTOM con solo T1 deduce il T0 come data attribuibile precedente', () => {
    expect(resolveAttributionPeriod({
      attributableDates: DATES, range: 'CUSTOM', customStart: null, customEnd: '2024-06-30',
    })).toEqual({ startDate: '2024-03-31', endDate: '2024-06-30' });
  });

  it('periodo invertito (T0 ≥ T1) è invalido → null', () => {
    expect(resolveAttributionPeriod({
      attributableDates: DATES, range: 'CUSTOM',
      customStart: '2024-09-30', customEnd: '2024-03-31',
    })).toBeNull();
    expect(resolveAttributionPeriod({
      attributableDates: DATES, range: 'CUSTOM',
      customStart: '2024-06-30', customEnd: '2024-06-30',
    })).toBeNull();
  });

  it('cutoffForRange: MAX nessun taglio, YTD inizio anno', () => {
    expect(cutoffForRange('MAX', '2025-06-30')).toBeNull();
    expect(cutoffForRange('YTD', '2025-06-30')).toBe('2025-01-01');
    expect(cutoffForRange('1Y', '2025-06-30')).toBe('2024-06-30');
  });
});
