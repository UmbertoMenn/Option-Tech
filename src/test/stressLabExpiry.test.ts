import { describe, it, expect } from 'vitest';
import {
  bsPrice,
  coupledDV1M,
  runScenario,
  effIVMap,
  StressLeg,
  StressUnderlyingMap,
  ScenarioParams,
  RollParams,
} from '@/lib/stressLab';
import { weightedAvgExpiry, shortExpirySummary, rolledExpiryISO, DAYS_PER_YEAR } from '@/lib/stressLabExpiry';

const R = 0.04;
const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
const base: ScenarioParams = { skewB: -0.018, kappa: 0.6, pExp: 0.5, r: R, days: 30, fx: { USD: 1.16, HKD: 9.04 }, netting: false };
const ROLL: RollParams = { triggerPct: 2, maxMonthsForward: 12, minNetCreditPct: 0, strikeStepPct: 2, maxRolls: 4, pathStepPct: 1 };

function leg(cp: 'C' | 'P', K: number, T: number, q: number, rollQ?: number): StressLeg {
  const iv = 0.4;
  const px = bsPrice(100 * Math.exp(R * T), K, T, iv, cp === 'C', R);
  return { u: 'XYZ', cp, K, T, exp: '2026-11-20', q, px, fl: false, mult: 100, nm: 'XYZ', iv, rollQ };
}

describe('stressLab — scadenza media portafoglio derivati', () => {
  it('media pesata per nozionale |q|·mult·K, in giorni', () => {
    // 1 contratto K100 a 0,1 anni + 3 contratti K100 a 0,5 anni → (0,1 + 1,5)/4 = 0,4 anni
    const r = weightedAvgExpiry([
      { T: 0.1, K: 100, q: -1, mult: 100 },
      { T: 0.5, K: 100, q: -3, mult: 100 },
    ]);
    expect(r.days!).toBeCloseTo(0.4 * DAYS_PER_YEAR, 9);
    expect(r.contracts).toBe(4);
    // lo strike pesa: K200 a 1 anno vs K100 a 0 → 2/3 anno
    const k = weightedAvgExpiry([
      { T: 0, K: 100, q: -1, mult: 100 },
      { T: 1, K: 200, q: -1, mult: 100 },
    ]);
    expect(k.days!).toBeCloseTo((2 / 3) * DAYS_PER_YEAR, 9);
  });

  it('nessuna gamba → days null', () => {
    expect(weightedAvgExpiry([]).days).toBeNull();
  });

  it('call e put vendute separate; gambe comprate escluse', () => {
    const legs = [leg('C', 110, 0.2, -2), leg('P', 90, 0.1, -1), leg('P', 80, 0.1, +1), leg('C', 120, 1, +1)];
    const s = shortExpirySummary(legs, null);
    expect(s.calls.days!).toBeCloseTo(0.2 * DAYS_PER_YEAR, 9);
    expect(s.puts.days!).toBeCloseTo(0.1 * DAYS_PER_YEAR, 9);
    expect(s.putsAfter.days).toBeCloseTo(s.puts.days!, 9);
    expect(s.rolledLegs).toBe(0);
  });

  it('rolling allunga la scadenza media delle put vendute (put di arrivo), le call restano ferme', () => {
    const legs = [leg('P', 90, 35 / 365, -2, -2), leg('P', 60, 0.5, -1), leg('C', 110, 0.2, -1)];
    const res = runScenario(legs, [], unders, effIVMap(legs), -30, coupledDV1M(-30), { ...base, roll: ROLL });
    const s = shortExpirySummary(legs, res.rows);
    const row = res.rows[0];
    expect(row.rolls!.length).toBeGreaterThan(0);
    expect(s.rolledLegs).toBe(1);
    expect(s.putsAfter.days!).toBeGreaterThan(s.puts.days!);
    expect(s.eligibleAfter.days!).toBeCloseTo(row.finalT! * DAYS_PER_YEAR, 9);
    expect(s.calls.days!).toBeCloseTo(0.2 * DAYS_PER_YEAR, 9);
    // media dopo i roll = pesata fra put di arrivo (strike nuovo) e put non idonea
    const wA = 2 * 100 * row.finalK!;
    const wB = 1 * 100 * 60;
    expect(s.putsAfter.days!).toBeCloseTo(((wA * row.finalT! + wB * 0.5) / (wA + wB)) * DAYS_PER_YEAR, 9);
  });

  it('rollata solo in parte: la parte statica resta sulla scadenza originale', () => {
    const legs = [leg('P', 90, 35 / 365, -4, -1)];
    const res = runScenario(legs, [], unders, effIVMap(legs), -30, coupledDV1M(-30), { ...base, roll: ROLL });
    const row = res.rows[0];
    const s = shortExpirySummary(legs, res.rows);
    const wS = 3 * 100 * 90;
    const wR = 1 * 100 * row.finalK!;
    expect(s.putsAfter.days!).toBeCloseTo(((wS * (35 / 365) + wR * row.finalT!) / (wS + wR)) * DAYS_PER_YEAR, 9);
    expect(s.putsAfter.contracts).toBe(4);
  });

  it('shock al rialzo o rolling spento → dopo = prima', () => {
    const legs = [leg('P', 90, 35 / 365, -2, -2)];
    const up = runScenario(legs, [], unders, effIVMap(legs), 10, coupledDV1M(10), { ...base, roll: ROLL });
    expect(shortExpirySummary(legs, up.rows).putsAfter.days).toBeCloseTo(shortExpirySummary(legs).puts.days!, 9);
    const off = runScenario(legs, [], unders, effIVMap(legs), -30, coupledDV1M(-30), { ...base, roll: null });
    expect(shortExpirySummary(legs, off.rows).putsAfter.days).toBeCloseTo(shortExpirySummary(legs).puts.days!, 9);
  });

  it('data della put di arrivo: +mesi interi sulla scadenza mensile (terzo venerdì, festivi)', () => {
    expect(rolledExpiryISO('2026-11-20', 0.1, 0.1 + 3 / 12)).toBe('2027-02-19');
    expect(rolledExpiryISO('2026-11-20', 0.1, 0.1 + 14 / 12)).toBe('2028-01-21');
    // aprile 2025: terzo venerdì 18/04 = Good Friday → giovedì 17/04
    expect(rolledExpiryISO('2025-01-17', 0.2, 0.2 + 3 / 12)).toBe('2025-04-17');
    expect(rolledExpiryISO('bad', 0, 1)).toBeNull();
  });
});
