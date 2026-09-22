import { describe, expect, it } from 'vitest';
import { computeAverageEquityExposure } from '@/lib/equityExposureAverage';

describe('computeAverageEquityExposure', () => {
  it('media ponderata per il tempo con interpolazione lineare: ogni giorno pesa uguale', () => {
    // 20% per 10 giorni poi salto a 40%: i punti fitti non devono pesare di più
    const points = [
      { date: '2026-08-01', pct: 0.2 },
      { date: '2026-08-02', pct: 0.2 },
      { date: '2026-08-03', pct: 0.2 },
      { date: '2026-08-11', pct: 0.2 },
      { date: '2026-08-21', pct: 0.4 },
    ];
    const res = computeAverageEquityExposure(points, '2026-08-01', '2026-08-21');
    // 1-11: 0.2 (10 gg); 11-21: da 0.2 a 0.4 lineare → media 0.3 (10 gg) → 0.25
    expect(res.average).toBeCloseTo(0.25, 10);
    expect(res).toMatchObject({ from: '2026-08-01', to: '2026-08-21', missingBefore: null, missingAfter: null, min: 0.2, max: 0.4 });
  });

  it('se i dati storici partono dopo l’inizio del periodo lo segnala e media solo sui giorni coperti', () => {
    const points = [
      { date: '2026-07-08', pct: 0.18 },
      { date: '2026-09-21', pct: 0.18 },
    ];
    const res = computeAverageEquityExposure(points, '2025-09-22', '2026-09-21');
    expect(res.missingBefore).toBe('2026-07-08');
    expect(res.from).toBe('2026-07-08');
    expect(res.average).toBeCloseTo(0.18, 10);
    expect(res.gaps).toEqual([{ from: '2026-07-08', to: '2026-09-21' }]); // > 31 giorni senza snapshot
  });

  it('usa lo snapshot precedente all’inizio per il primo tratto (nessun buco segnalato)', () => {
    const points = [
      { date: '2026-08-21', pct: 0.2 },
      { date: '2026-08-31', pct: 0.3 },
    ];
    const res = computeAverageEquityExposure(points, '2026-08-26', '2026-08-31');
    expect(res.missingBefore).toBeNull();
    expect(res.from).toBe('2026-08-26');
    // da 0.25 (interpolato al 26) a 0.3 → media 0.275
    expect(res.average).toBeCloseTo(0.275, 10);
  });

  it('segnala dati mancanti dopo una certa data se l’ultimo snapshot è troppo vecchio', () => {
    const res = computeAverageEquityExposure([{ date: '2026-08-01', pct: 0.2 }, { date: '2026-08-11', pct: 0.2 }], '2026-08-01', '2026-09-21');
    expect(res.missingAfter).toBe('2026-08-11');
    expect(res.to).toBe('2026-08-11');
  });

  it('nessun dato: media nulla e primo giorno disponibile indicato', () => {
    expect(computeAverageEquityExposure([], '2026-08-01', '2026-08-31').average).toBeNull();
    const later = computeAverageEquityExposure([{ date: '2026-10-01', pct: 0.2 }], '2026-08-01', '2026-08-31');
    expect(later.average).toBeNull();
    expect(later.missingBefore).toBe('2026-10-01');
  });
});
