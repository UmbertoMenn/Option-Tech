import { applyRolls, coupledDV1M, marginCallShock, occMargin, runScenario } from './stressLab';
import type { MarginParams, ScenarioParams, StressEquity, StressLeg, StressUnderlyingMap } from './stressLab';

export const HM_D = [-30, -25, -20, -15, -10, -5, 0, 5, 10];
export const HM_V = [40, 30, 20, 15, 10, 5, 0, -5, -10];

export interface StressLabChartInput {
  legs: StressLeg[];
  eq: StressEquity[];
  unders: StressUnderlyingMap;
  undersActive: StressUnderlyingMap;
  effIV: Record<number, number>;
  prm: ScenarioParams;
  marPrm: MarginParams;
  volMode: 'auto' | 'manual';
  dVman: number;
  marginCover: number;
  totalPatrimony: number;
  includeHeat: boolean;
}

export interface StressLabChartResult {
  marCurve: { d: number; Margine: number; 'Senza roll'?: number }[];
  marginCallX: number | null;
  ruinX: number | null;
  curveMin: number;
  curve: { d: number; Totale: number; 'Azioni/ETF': number; Opzioni: number; 'Totale senza roll'?: number }[];
  heat: number[][] | null;
}

/** Same grids and pricing model as the page, executed off the UI thread. */
export function computeStressLabCharts(input: StressLabChartInput): StressLabChartResult {
  const { legs, eq, unders, undersActive, effIV, prm, marPrm, volMode, dVman, marginCover, totalPatrimony, includeHeat } = input;
  const volAt = (x: number) => volMode === 'auto' ? coupledDV1M(x) : dVman;
  const noRoll = { ...prm, roll: null };
  const marginPrm = { ...prm, netting: false };
  const all: StressLabChartResult['marCurve'] = [];
  const marAt = (x: number, rolling: boolean) => {
    const s = runScenario(legs, eq, undersActive, effIV, x, volAt(x), { ...marginPrm, roll: rolling ? prm.roll : null });
    if (rolling && prm.roll) {
      const ar = applyRolls(legs, s, undersActive, prm.r);
      return occMargin(ar.legs, eq, undersActive, x, ar.sig, prm.days, marPrm).total;
    }
    const sig: Record<number, number> = {};
    s.rows.forEach((row) => (sig[row.i] = row.sig1));
    return occMargin(legs, eq, undersActive, x, sig, prm.days, marPrm).total;
  };
  for (let x = -95; x <= 15.01; x += 2.5) {
    const point: (typeof all)[number] = { d: x, Margine: Math.round(marAt(x, !!prm.roll)) };
    if (prm.roll) point['Senza roll'] = Math.round(marAt(x, false));
    all.push(point);
  }
  const marginCallX = marginCallShock(
    all.filter((p) => p.d <= 0.01).sort((a, b) => b.d - a.d).map((p) => ({ x: p.d, margin: p.Margine })),
    marginCover,
  );
  const marginMin = marginCallX != null ? Math.max(-95, Math.min(-35, Math.floor((marginCallX - 6) / 5) * 5)) : -35;

  let ruinX: number | null = null;
  if (totalPatrimony) {
    const target = -totalPatrimony;
    let prev: { x: number; tot: number } | null = null;
    for (let x = 0; x >= -95.01; x -= 1.5) {
      const tot = runScenario(legs, eq, unders, effIV, x, volAt(x), prm).totEUR;
      if (prev && prev.tot > target && tot <= target) {
        ruinX = prev.x + ((target - prev.tot) / (tot - prev.tot)) * (x - prev.x);
        break;
      }
      prev = { x, tot };
    }
  }
  const leftMost = Math.min(ruinX ?? Infinity, marginCallX ?? Infinity);
  const curveMin = Number.isFinite(leftMost) ? Math.max(-95, Math.min(-35, Math.floor((leftMost - 6) / 5) * 5)) : -35;
  const curve: StressLabChartResult['curve'] = [];
  for (let x = curveMin; x <= 15.01; x += 2.5) {
    const s = runScenario(legs, eq, unders, effIV, x, volAt(x), prm);
    const point: (typeof curve)[number] = {
      d: x, Totale: Math.round(s.totEUR), 'Azioni/ETF': Math.round(s.eqEUR), Opzioni: Math.round(s.optEUR),
    };
    if (prm.roll) point['Totale senza roll'] = Math.round(runScenario(legs, eq, unders, effIV, x, volAt(x), noRoll).totEUR);
    curve.push(point);
  }
  return {
    marCurve: all.filter((p) => p.d >= marginMin - 0.01), marginCallX, ruinX, curveMin, curve,
    heat: includeHeat ? HM_V.map((v) => HM_D.map((x) => runScenario(legs, eq, undersActive, effIV, x, v, prm).totEUR)) : null,
  };
}
