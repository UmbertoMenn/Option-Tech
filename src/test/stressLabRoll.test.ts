import { describe, it, expect } from 'vitest';
import {
  bsPrice,
  coupledDV1M,
  runScenario,
  occMargin,
  effIVMap,
  applyRolls,
  simulatePutRolls,
  DEFAULT_ROLL_PARAMS,
  StressLeg,
  StressUnderlyingMap,
  ScenarioParams,
  RollParams,
} from '@/lib/stressLab';
import { rollableShortPutQty, rollQForLeg, rawPositionId } from '@/lib/stressLabRollEligibility';
import type { Position } from '@/types/portfolio';

const FX = { USD: 1.16, HKD: 9.04 };
const R = 0.04;
const base: ScenarioParams = { skewB: -0.018, kappa: 0.6, pExp: 0.5, r: R, days: 30, fx: FX, netting: false };
// Parametri espliciti (indipendenti dai default UI, che possono cambiare).
const ROLL: RollParams = {
  triggerPct: 2,
  maxMonthsForward: 12,
  minNetCreditPct: 0,
  strikeStepPct: 2,
  maxRolls: 4,
  pathStepPct: 1,
};
const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };

function putLeg(K: number, T: number, q: number, rollQ?: number): StressLeg {
  const iv = 0.4;
  const px = bsPrice(100 * Math.exp(R * T), K, T, iv, false, R);
  return { u: 'XYZ', cp: 'P', K, T, exp: '2026-11-20', q, px, fl: false, mult: 100, nm: 'XYZ', iv, rollQ };
}

const run = (legs: StressLeg[], d: number, prm: ScenarioParams) =>
  runScenario(legs, [], unders, effIVMap(legs), d, coupledDV1M(d), prm);

describe('stressLab — rolling put in discesa', () => {
  it('rolling spento o gamba non idonea → P&L identico al modello statico', () => {
    const idonea = [putLeg(90, 35 / 365, -1, -1)];
    const nonIdonea = [putLeg(90, 35 / 365, -1)];
    const off = run(idonea, -30, base).totEUR;
    expect(run(idonea, -30, { ...base, roll: null }).totEUR).toBeCloseTo(off, 9);
    expect(run(nonIdonea, -30, { ...base, roll: ROLL }).totEUR).toBeCloseTo(off, 9);
    expect(run(nonIdonea, -30, { ...base, roll: ROLL }).rows[0].rolls).toBeUndefined();
  });

  it('shock -30%: roll con discesa minima 2% (griglia fine 0,5%), credito ≥ 0, max 4, cap 12 mesi', () => {
    const res = run([putLeg(90, 35 / 365, -1, -1)], -30, { ...base, roll: ROLL });
    const row = res.rows[0];
    expect(row.rolls!.length).toBeGreaterThan(0);
    expect(row.rolls!.length).toBeLessThanOrEqual(4);
    expect(row.finalK!).toBeLessThan(90);
    for (const ev of row.rolls!) {
      expect(ev.S).toBeLessThanOrEqual(ev.fromK * 1.02 + 1e-9); // trigger 2%
      expect(ev.toK).toBeLessThan(ev.fromK);
      expect(ev.toK).toBeLessThan(ev.S);
      // discesa minima 2% dello strike corrente, poi griglia fine 0,5%
      expect(ev.toK).toBeLessThanOrEqual(ev.fromK * 0.98 + 1e-9);
      const j = (1 - ev.toK / ev.fromK - 0.02) / 0.005;
      expect(Math.abs(j - Math.round(j))).toBeLessThan(1e-9);
      expect(ev.sell - ev.buy).toBeGreaterThanOrEqual(-1e-12); // credito netto ≥ 0
      expect(ev.toT).toBeGreaterThan(ev.fromT);
      const m = (ev.toT - ev.fromT) * 12; // scadenze di mese in mese
      expect(Math.abs(m - Math.round(m))).toBeLessThan(1e-9);
    }
  });

  it('strike più basso tra i candidati a credito: il gradino successivo della griglia fine è a debito', () => {
    const leg = putLeg(90, 35 / 365, -1, -1);
    // Pricer semplice (vol piatta + shock): lo strike successivo (−2% ulteriore) sulla
    // stessa scadenza deve essere a debito, altrimenti il motore avrebbe scelto quello.
    const sim = simulatePutRolls({
      K0: 90, T0: leg.T, S0: 100, beta: 1, d: -30, dV1M: coupledDV1M(-30), days: 30,
      roll: { ...ROLL, maxRolls: 1 },
      priceAt: (K, T, dd, dv, dy) => {
        const Tx = Math.max(T - dy / 365, 0);
        const S = 100 * (1 + dd / 100);
        const sig = 0.4 + (dv * Math.min(1.45, Math.pow(1 / 12 / Math.max(T, 0.01), 0.5))) / 100;
        return { p: bsPrice(S * Math.exp(R * Tx), K, Tx, sig, false, R), sig };
      },
    });
    const e = sim.rolls[0];
    const next = e.toK - e.fromK * 0.005;
    const Tx = e.toT - (30 * (e.d / -30)) / 365;
    const S = 100 * (1 + e.d / 100);
    const dv = coupledDV1M(e.d);
    const sig = 0.4 + (dv * Math.min(1.45, Math.pow(1 / 12 / Math.max(e.toT, 0.01), 0.5))) / 100;
    const sellNext = bsPrice(S * Math.exp(R * Tx), next, Tx, sig, false, R);
    expect(sellNext - e.buy).toBeLessThan(0);
    expect(e.sell - e.buy).toBeGreaterThanOrEqual(0);
  });

  it('roll eseguito nello stato finale (percorso a un solo step) è MTM-neutro', () => {
    const legs = [putLeg(90, 35 / 365, -1, -1)];
    const stat = run(legs, -12, base).totEUR;
    const rolled = run(legs, -12, { ...base, roll: { ...ROLL, pathStepPct: 50 } });
    expect(rolled.rows[0].rolls!.length).toBe(1);
    expect(rolled.totEUR).toBeCloseTo(stat, 6);
  });

  it('discesa graduale -30%: il rolling riduce la perdita, soprattutto a intrinseco (netting)', () => {
    const legs = [putLeg(90, 35 / 365, -1, -1)];
    const mtmOff = run(legs, -30, base).totEUR;
    const mtmOn = run(legs, -30, { ...base, roll: ROLL }).totEUR;
    expect(mtmOn).toBeGreaterThan(mtmOff);
    const nOff = run(legs, -30, { ...base, netting: true }).totEUR;
    const nRes = run(legs, -30, { ...base, netting: true, roll: ROLL });
    const nOn = nRes.totEUR;
    // Regressione: a intrinseco la put finale vale max(0, K_finale − S1), non lo strike originale.
    expect(nRes.rows[0].pFinal).toBeCloseTo(Math.max(0, nRes.rows[0].finalK! - 70), 9);
    expect(nOn).toBeGreaterThan(nOff);
    expect(nOn - nOff).toBeGreaterThan(mtmOn - mtmOff);
  });

  it('nessun roll su shock al rialzo, put lunghe o call', () => {
    const up = run([putLeg(90, 35 / 365, -1, -1)], 10, { ...base, roll: ROLL });
    expect(up.rows[0].rolls).toBeUndefined();
    const long = run([putLeg(90, 35 / 365, 1, -1)], -30, { ...base, roll: ROLL });
    expect(long.rows[0].rolls).toBeUndefined();
    const call: StressLeg = { ...putLeg(90, 35 / 365, -1, -1), cp: 'C' };
    expect(run([call], -30, { ...base, roll: ROLL }).rows[0].rolls).toBeUndefined();
  });

  it('rollQ parziale: P&L = combinazione lineare di parte statica e parte rollata', () => {
    const prm = { ...base, roll: ROLL };
    const full = run([putLeg(90, 35 / 365, -2, -2)], -30, prm).totEUR;
    const none = run([putLeg(90, 35 / 365, -2)], -30, prm).totEUR;
    const half = run([putLeg(90, 35 / 365, -2, -1)], -30, prm);
    expect(half.totEUR).toBeCloseTo((full + none) / 2, 6);
    // p1 di riga coerente con la formula q·mult·(p1 − p0)
    const row = half.rows[0];
    expect((-2 * 100 * (row.p1 - row.p0)) / FX.USD).toBeCloseTo(row.pnlEUR, 6);
  });

  it('credito minimo irraggiungibile → nessun roll', () => {
    const res = run([putLeg(90, 35 / 365, -1, -1)], -30, { ...base, roll: { ...ROLL, minNetCreditPct: 50 } });
    expect(res.rows[0].rolls).toHaveLength(0);
  });

  it('cap mesi: la nuova scadenza non supera maxMonthsForward dalla data del roll', () => {
    const res = run([putLeg(90, 35 / 365, -1, -1)], -30, { ...base, roll: { ...ROLL, maxMonthsForward: 2 } });
    for (const ev of res.rows[0].rolls!) {
      const elapsed = (30 * (ev.d / -30)) / 365;
      expect(ev.toT - elapsed).toBeLessThanOrEqual(2 / 12 + 1e-9);
    }
  });

  it('applyRolls: margine a scenario sulle gambe rollate (split parte statica/rollata)', () => {
    const legs = [putLeg(90, 35 / 365, -3, -2), putLeg(80, 35 / 365, 1)];
    const res = run(legs, -30, { ...base, roll: ROLL });
    const { legs: after, sig } = applyRolls(legs, res, unders, R);
    expect(after).toHaveLength(3);
    const rolledLeg = after.find((l) => l.q === -2)!;
    expect(rolledLeg.K).toBe(res.rows[0].finalK);
    expect(rolledLeg.T).toBe(res.rows[0].finalT);
    expect(rolledLeg.px).toBeGreaterThan(0);
    expect(after.find((l) => l.q === -1)!.K).toBe(90);
    const mPrm = { r: R, fxUSD: FX.USD, kScan: 0.7, fxRange: 0.03, skewB: -0.018, kappa: 0.6, pExp: 0.5 };
    const mar = occMargin(after, [], unders, -30, sig, 30, mPrm);
    expect(Number.isFinite(mar.total)).toBe(true);
    expect(mar.total).toBeGreaterThan(0);
    // Senza roll applyRolls è l'identità
    const noRoll = applyRolls(legs, run(legs, -30, base), unders, R);
    expect(noRoll.legs).toEqual(legs);
  });
});


const pos = (id: string, type: 'put' | 'call', q: number): Position =>
  ({ id, option_type: type, quantity: q, asset_type: 'derivative' }) as unknown as Position;

describe('stressLab — idoneità al rolling', () => {
  it('naked put, put spread e diagonal put spread idonei; IC/sintetiche/call escluse', () => {
    const m = rollableShortPutQty({
      nakedPuts: [{ option: pos('np', 'put', -2), underlying: null, contracts: 2 }],
      groupedOtherStrategies: [
        { underlying: 'A', options: [{ option: pos('ps__opt_slot_0', 'put', -1), underlying: null }, { option: pos('ps-long', 'put', 1), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Put Spread', configStrategyType: 'put_spread' },
        { underlying: 'B', options: [{ option: pos('dps', 'put', -3), underlying: null }, { option: pos('dps-l', 'put', 3), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Diagonal Put Spread' },
        { underlying: 'C', options: [{ option: pos('bull', 'put', -1), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Bull Put Spread' },
        { underlying: 'D', options: [{ option: pos('strangle-p', 'put', -1), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Short Strangle' },
        { underlying: 'E', options: [{ option: pos('ic-p', 'put', -1), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Iron Condor', configStrategyType: 'iron_condor' },
        { underlying: 'F', options: [{ option: pos('cfg-other', 'put', -1), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: 'Bull Put Spread', configStrategyType: 'other' },
      ],
    });
    expect(Object.fromEntries(m)).toEqual({ np: 2, ps: 1, dps: 3, bull: 1 });
  });

  it('slot virtuali sommati sull\'id raw; rollQ limitato a |q| e nullo per long', () => {
    expect(rawPositionId('abc__opt_slot_3')).toBe('abc');
    expect(rawPositionId('abc__slot_1')).toBe('abc');
    const m = rollableShortPutQty({
      nakedPuts: [{ option: pos('x__opt_slot_0', 'put', -1), underlying: null, contracts: 1 }],
      groupedOtherStrategies: [
        { underlying: 'A', options: [{ option: pos('x__opt_slot_1', 'put', -2), underlying: null }], totalPremium: 0, totalProfitLoss: 0, strategyName: null, configStrategyType: 'diagonal_put_spread' },
      ],
    });
    expect(m.get('x')).toBe(3);
    expect(rollQForLeg(-5, 3)).toBe(-3);
    expect(rollQForLeg(-2, 3)).toBe(-2);
    expect(rollQForLeg(2, 3)).toBe(0);
    expect(rollQForLeg(-2, undefined)).toBe(0);
  });
});

describe('stressLab — discesa minima strike per roll', () => {
  const leg = () => putLeg(90, 35 / 365, -1, -1);
  it('scadenza più vicina prima: con discesa minima piccola il primo roll va a +1 mese', () => {
    const ev = run([leg()], -30, { ...base, roll: { ...ROLL, strikeStepPct: 1 } }).rows[0].rolls![0];
    expect(Math.round((ev.toT - ev.fromT) * 12)).toBe(1);
  });

  it('discesa minima ampia: ogni roll scende almeno di quella % e deve allungare la scadenza', () => {
    const small = run([leg()], -30, { ...base, roll: { ...ROLL, strikeStepPct: 1 } }).rows[0].rolls![0];
    const big = run([leg()], -30, { ...base, roll: { ...ROLL, strikeStepPct: 10 } }).rows[0];
    for (const ev of big.rolls!) expect(ev.toK).toBeLessThanOrEqual(ev.fromK * 0.9 + 1e-9);
    expect(big.rolls![0].toT - big.rolls![0].fromT).toBeGreaterThan(small.toT - small.fromT);
  });

  it('MTM − netting = − valore temporale della put finale (stessi roll)', () => {
    const prm = { ...base, roll: { ...ROLL, strikeStepPct: 6 } };
    const mtm = run([leg()], -30, prm);
    const net = run([leg()], -30, { ...prm, netting: true });
    const row = mtm.rows[0];
    expect(net.rows[0].rolls!.length).toBe(row.rolls!.length);
    const intrF = Math.max(0, row.finalK! - 70);
    const tvF = row.pFinal! - intrF;
    expect(tvF).toBeGreaterThan(0);
    // p0 MTM (premio originale) vs p0 netting (intrinseco 0): la differenza residua è il premio iniziale
    const p0 = row.p0;
    expect((mtm.totEUR - net.totEUR) * FX.USD / 100).toBeCloseTo(p0 - tvF, 6);
  });
});

describe('stressLab — default rolling', () => {
  it('trigger 2%, scadenza max 12 mesi, discesa minima 5%, credito ≥ 0, 11 roll', () => {
    expect(DEFAULT_ROLL_PARAMS).toMatchObject({
      triggerPct: 2,
      maxMonthsForward: 12,
      strikeStepPct: 5,
      minNetCreditPct: 0,
      maxRolls: 11,
    });
  });
});
