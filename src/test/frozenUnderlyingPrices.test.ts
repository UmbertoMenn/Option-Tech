import { describe, it, expect } from 'vitest';
import { mergeFrozenUnderlyingPrices, resolveOptionSpot } from '@/lib/frozenUnderlyingPrices';

const live = {
  'AppLovin Corp': { price: 410, currency: 'USD' },
  'NVIDIA CORP': { price: 178.67, currency: 'USD' },
  'Vertiv Holdings Co': { price: 250, currency: 'USD' },
};
// historical_data.snapshot_underlying_prices al 27/10/2026 (dati reali)
const frozen27Oct = { 'AppLovin Corp': 260.74, 'NVIDIA CORP': 216 } as Record<string, number>;

describe('resolveOptionSpot', () => {
  it('bug: in vista storica lo spot NON deve essere quello live di oggi', () => {
    // Prima del fix: spot = 410 (live) su una put K350 prezzata 91,9 il 27/10 → put "OTM" con premio 91,9.
    const s = resolveOptionSpot('AppLovin Corp', frozen27Oct, live, false);
    expect(s).toEqual({ S: 260.74, src: 'congelato' });
  });

  it('il prezzo congelato prevale sul live anche nella vista corrente', () => {
    expect(resolveOptionSpot('NVIDIA CORP', frozen27Oct, live, true)).toEqual({ S: 216, src: 'congelato' });
  });

  it('vista corrente: sottostante non ancora congelato → fallback live marcato', () => {
    expect(resolveOptionSpot('Vertiv Holdings Co', frozen27Oct, live, true)).toEqual({ S: 250, src: 'live' });
  });

  it('vista storica: sottostante non congelato → nessuno spot (mai il live)', () => {
    expect(resolveOptionSpot('Vertiv Holdings Co', frozen27Oct, live, false)).toBeNull();
  });

  it('ignora prezzi congelati non validi', () => {
    expect(resolveOptionSpot('X', { X: 0 }, {}, false)).toBeNull();
    expect(resolveOptionSpot('X', { X: '12.5' as unknown as number }, {}, false)).toEqual({ S: 12.5, src: 'congelato' });
    expect(resolveOptionSpot(null, frozen27Oct, live, true)).toBeNull();
  });
});

describe('mergeFrozenUnderlyingPrices', () => {
  it('vista corrente: live + congelati, i congelati vincono', () => {
    const m = mergeFrozenUnderlyingPrices(live, frozen27Oct, true);
    expect(m['AppLovin Corp'].price).toBe(260.74);
    expect(m['NVIDIA CORP'].price).toBe(216);
    expect(m['Vertiv Holdings Co'].price).toBe(250);
  });

  it('vista storica: solo congelati, nessun prezzo live', () => {
    const m = mergeFrozenUnderlyingPrices(live, frozen27Oct, false);
    expect(Object.keys(m).sort()).toEqual(['AppLovin Corp', 'NVIDIA CORP']);
    expect(m['Vertiv Holdings Co']).toBeUndefined();
  });
});
