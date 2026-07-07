import { describe, it, expect } from 'vitest';
import { realOptionValue, premiumDecomposition } from '@/lib/optionEdge';
import { bsPrice, impliedVolatility } from '@/lib/blackScholes';

const S = 100, K = 90, T = 0.25, r = 0.04;

describe('realOptionValue', () => {
  it('con deriva m = r coincide con Black-Scholes (CALL e PUT)', () => {
    for (const sigma of [0.2, 0.5, 0.9]) {
      expect(realOptionValue(S, K, T, r, r, sigma, 'CALL')).toBeCloseTo(bsPrice(S, K, T, r, sigma, 'call'), 10);
      expect(realOptionValue(S, K, T, r, r, sigma, 'PUT')).toBeCloseTo(bsPrice(S, K, T, r, sigma, 'put'), 10);
    }
  });

  it('deriva positiva più alta aumenta la CALL e riduce la PUT', () => {
    const sigma = 0.4;
    const cLow = realOptionValue(S, K, T, r, 0.02, sigma, 'CALL');
    const cHigh = realOptionValue(S, K, T, r, 0.15, sigma, 'CALL');
    const pLow = realOptionValue(S, K, T, r, 0.02, sigma, 'PUT');
    const pHigh = realOptionValue(S, K, T, r, 0.15, sigma, 'PUT');
    expect(cHigh).toBeGreaterThan(cLow);
    expect(pHigh).toBeLessThan(pLow);
  });

  it('a T = 0 restituisce il valore intrinseco', () => {
    expect(realOptionValue(S, K, 0, r, 0.1, 0.4, 'CALL')).toBeCloseTo(Math.max(S - K, 0), 10);
    expect(realOptionValue(S, K, 0, r, 0.1, 0.4, 'PUT')).toBeCloseTo(Math.max(K - S, 0), 10);
  });
});

describe('premiumDecomposition', () => {
  const iv = 0.55, rv = 0.42, m = 0.11;
  const marketPremium = bsPrice(S, K, T, r, iv, 'put');
  const base = { S, K, T, r, m, iv, rv, type: 'PUT' as const, marketPremium };

  it("identità: edgeTotal = edgeVol + edgeDrift + interaction", () => {
    const d = premiumDecomposition(base);
    expect(d.edgeVol + d.edgeDrift + d.interaction).toBeCloseTo(d.edgeTotal, 10);
  });

  it('edgeTotal = premio di mercato − valore reale (deriva reale, vol reale)', () => {
    const d = premiumDecomposition(base);
    expect(d.realDriftRealVol).toBeCloseTo(realOptionValue(S, K, T, r, m, rv, 'PUT'), 10);
    expect(d.edgeTotal).toBeCloseTo(marketPremium - d.realDriftRealVol, 10);
  });

  it('con IV = RV la componente vol si annulla (premio prezzato alla IV)', () => {
    const d = premiumDecomposition({ ...base, rv: iv });
    expect(d.edgeVol).toBeCloseTo(0, 8);
    expect(d.edgeTotal).toBeCloseTo(d.edgeDrift, 8);
    expect(d.interaction).toBeCloseTo(0, 8);
  });

  it('con deriva reale m = r la componente deriva si annulla', () => {
    const d = premiumDecomposition({ ...base, m: r });
    expect(d.edgeDrift).toBeCloseTo(0, 8);
    expect(d.edgeTotal).toBeCloseTo(d.edgeVol, 8);
    expect(d.interaction).toBeCloseTo(0, 8);
  });

  it('IV > RV produce edge da volatilità positivo per il venditore', () => {
    const d = premiumDecomposition(base);
    expect(d.edgeVol).toBeGreaterThan(0);
  });

  it('deriva reale μ > r produce edge da deriva positivo per chi vende PUT e negativo per chi vende CALL', () => {
    const dPut = premiumDecomposition(base);
    expect(dPut.edgeDrift).toBeGreaterThan(0);
    const callPremium = bsPrice(S, 110, T, r, iv, 'call');
    const dCall = premiumDecomposition({ ...base, K: 110, type: 'CALL', marketPremium: callPremium });
    expect(dCall.edgeDrift).toBeLessThan(0);
  });

  it('IV non risolvibile (NaN): componente deriva NaN ma vol e totale restano finite', () => {
    const d = premiumDecomposition({ ...base, iv: NaN });
    expect(Number.isNaN(d.edgeDrift)).toBe(true);
    expect(isFinite(d.edgeVol)).toBe(true);
    expect(isFinite(d.edgeTotal)).toBe(true);
  });

  it('coerenza round-trip: IV invertita dal premio riproduce il premio di mercato', () => {
    const ivBack = impliedVolatility(marketPremium, S, K, T, r, 'put');
    expect(ivBack).toBeCloseTo(iv, 4);
    const d = premiumDecomposition({ ...base, iv: ivBack });
    expect(marketPremium - d.realDriftImplVol).toBeCloseTo(d.edgeDrift, 6);
  });
});
