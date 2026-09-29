import { describe, expect, it } from 'vitest';
import { computeStressLabCharts, HM_D, HM_V, type StressLabChartInput } from '@/lib/stressLabCharts';
import { bsPrice, coupledDV1M, DEFAULT_ROLL_PARAMS, effIVMap, runScenario, type StressLeg } from '@/lib/stressLab';

const leg: StressLeg = { u: 'XYZ', cp: 'P', K: 90, T: 35 / 365, exp: '2026-11-20', q: -1, rollQ: -1,
  px: bsPrice(100 * Math.exp(.04 * 35 / 365), 90, 35 / 365, .4, false, .04), fl: false, mult: 100, nm: 'XYZ', iv: .4 };
const base: StressLabChartInput = {
  legs: [leg], eq: [], unders: { XYZ: { S: 100, beta: 1.3 } }, undersActive: { XYZ: { S: 100, beta: 1 } }, effIV: effIVMap([leg]),
  prm: { r: .04, days: 0, fx: { USD: 1.16, HKD: 9.04 }, netting: false, skewB: -.018, kappa: .6, pExp: .5, roll: DEFAULT_ROLL_PARAMS },
  marPrm: { r: .04, fxUSD: 1.16, kScan: 1, fxRange: .1, skewB: -.018, kappa: .6, pExp: .5, ivScan: 0, nakedPct: .2 },
  volMode: 'auto', dVman: 15, marginCover: 3000, totalPatrimony: 4000, includeHeat: false,
};

describe('background chart financial outputs', () => {
  it.each([
    { name: 'rolling auto', prm: base.prm, volMode: 'auto' as const },
    { name: 'rolling intrinsic and horizon', prm: { ...base.prm, days: 30, netting: true }, volMode: 'manual' as const },
    { name: 'no rolling', prm: { ...base.prm, roll: null }, volMode: 'auto' as const },
  ])('$name retains market beta, baseline, and crossing interpolation', ({ prm, volMode }) => {
    const input = { ...base, prm, volMode };
    const result = computeStressLabCharts(input);
    const pl = (x: number) => runScenario(input.legs, input.eq, input.unders, input.effIV, x, volMode === 'auto' ? coupledDV1M(x) : input.dVman, prm).totEUR;
    for (const point of result.curve) {
      expect(point.Totale).toBe(Math.round(pl(point.d)));
      if (prm.roll) expect(point['Totale senza roll']).toBe(Math.round(runScenario(input.legs, input.eq, input.unders, input.effIV,
        point.d, volMode === 'auto' ? coupledDV1M(point.d) : input.dVman, { ...prm, roll: null }).totEUR));
      else expect(point['Totale senza roll']).toBeUndefined();
    }
    if (result.ruinX !== null) {
      const right = Math.ceil(result.ruinX / 1.5) * 1.5, left = right - 1.5;
      const interpolated = pl(right) + ((result.ruinX - right) / (left - right)) * (pl(left) - pl(right));
      expect(interpolated).toBeCloseTo(-input.totalPatrimony, 7);
    }
    expect(result.heat).toBeNull();
  });
  it('computes heat only when requested, using active shock beta without changing other charts', () => {
    const closed = computeStressLabCharts(base);
    const open = computeStressLabCharts({ ...base, includeHeat: true });
    expect({ ...open, heat: null }).toEqual(closed);
    expect(open.heat).toHaveLength(9);
    HM_V.forEach((v, ri) => HM_D.forEach((d, ci) => {
      expect(open.heat![ri][ci]).toBe(runScenario(base.legs, base.eq, base.undersActive, base.effIV, d, v, base.prm).totEUR);
    }));
  });
});
