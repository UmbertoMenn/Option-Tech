import { describe, it, expect } from 'vitest';
import {
  bsPrice,
  normCdf,
  coupledDV1M,
  termFactor,
  T0M,
  impliedVolFromPrice,
  runScenario,
  occMargin,
  effIVMap,
  nettingPatrimonialDelta,
  StressLeg,
  StressEquity,
  StressUnderlyingMap,
  ScenarioParams,
  MarginParams,
} from '@/lib/stressLab';

const FX = { USD: 1.16, HKD: 9.04 };
const R = 0.04;

const surf = { skewB: -0.018, kappa: 0.6, pExp: 0.5 };
const baseParams: ScenarioParams = {
  ...surf,
  r: R,
  days: 0,
  fx: FX,
  netting: false,
};

describe('stressLab — basics', () => {
  it('normCdf(0) ≈ 0.5', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
  });

  it('normCdf is monotonic and bounded', () => {
    expect(normCdf(-5)).toBeLessThan(0.001);
    expect(normCdf(5)).toBeGreaterThan(0.999);
  });

  it('bsPrice is positive for OTM call', () => {
    const p = bsPrice(100, 110, 0.5, 0.3, true, R);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(110);
  });

  it('bsPrice respects intrinsic at T=0', () => {
    // Call ITM at T=0 → S-K
    expect(bsPrice(110, 100, 0, 0.3, true, R)).toBeCloseTo(10, 4);
    // Put OTM at T=0 → 0
    expect(bsPrice(110, 100, 0, 0.3, false, R)).toBeCloseTo(0, 4);
  });

  it('coupledDV1M: ribasso genera vol positiva crescente', () => {
    expect(coupledDV1M(-10)).toBeGreaterThan(0);
    expect(coupledDV1M(-30)).toBeGreaterThan(coupledDV1M(-10));
  });

  it('coupledDV1M: rialzo comprime la vol', () => {
    expect(coupledDV1M(10)).toBeLessThan(0);
  });

  it('termFactor decresce con T', () => {
    expect(termFactor(T0M, 0.5)).toBeCloseTo(1.0, 2);
    expect(termFactor(1, 0.5)).toBeLessThan(1);
    expect(termFactor(2, 0.5)).toBeLessThan(termFactor(1, 0.5));
  });
});

describe('stressLab — implied vol round-trip', () => {
  it('IV implicita ricostruisce il prezzo originale', () => {
    const S = 100,
      K = 105,
      T = 0.25;
    const sigTrue = 0.32;
    const F = S * Math.exp(R * T);
    const priceCall = bsPrice(F, K, T, sigTrue, true, R);
    const ivRecovered = impliedVolFromPrice(priceCall, S, K, T, R, true);
    expect(ivRecovered).toBeCloseTo(sigTrue, 2);
  });

  it('IV ritorna NaN se sotto intrinseco', () => {
    const iv = impliedVolFromPrice(0.5, 100, 70, 0.25, R, true); // call deep-ITM a prezzo sotto intrinseco
    expect(Number.isNaN(iv)).toBe(true);
  });
});

describe('stressLab — runScenario shock=0', () => {
  const legs: StressLeg[] = [
    {
      u: 'AAPL',
      cp: 'C',
      K: 200,
      T: 0.5,
      exp: '2026-12-18',
      q: -1,
      px: 10,
      fl: false,
      mult: 100,
      nm: 'Apple',
      iv: 0.3,
    },
    {
      u: 'AAPL',
      cp: 'P',
      K: 180,
      T: 0.5,
      exp: '2026-12-18',
      q: 1,
      px: 5,
      fl: false,
      mult: 100,
      nm: 'Apple',
      iv: 0.32,
    },
  ];
  const eq: StressEquity[] = [
    { nm: 'Apple', ccy: 'USD', px: 200, q: 100, eur: 17241, beta: 1.1, tick: 'AAPL' },
  ];
  const unders: StressUnderlyingMap = { AAPL: { S: 200, beta: 1.1 } };
  const effIV = effIVMap(legs);

  it('shock 0 + vol 0 + days 0 → P&L = 0 (entro tolleranza)', () => {
    const res = runScenario(legs, eq, unders, effIV, 0, 0, baseParams);
    expect(Math.abs(res.totEUR)).toBeLessThan(1); // < 1 EUR di rumore numerico
  });

  it('shock -10% → P&L equity < 0', () => {
    const res = runScenario(legs, eq, unders, effIV, -10, 0, baseParams);
    expect(res.eqEUR).toBeLessThan(0);
  });

  it('shock +10% → P&L equity > 0', () => {
    const res = runScenario(legs, eq, unders, effIV, 10, 0, baseParams);
    expect(res.eqEUR).toBeGreaterThan(0);
  });
});

describe('stressLab — netting', () => {
  const legs: StressLeg[] = [
    {
      u: 'TEST',
      cp: 'P',
      K: 100,
      T: 0.25,
      exp: '2026-09-18',
      q: -1, // short
      px: 5,
      fl: false,
      mult: 100,
      nm: 'Test',
      iv: 0.4,
    },
  ];
  const unders: StressUnderlyingMap = { TEST: { S: 100, beta: 1 } };

  it('netting delta è positivo per una put corta OTM (rimuove time value)', () => {
    // px=5, intrinseco=0 (S=K=100, OTM) → time value = -5 per la posizione corta
    // togliendolo, il patrimonio sale di 5*100/fx = 5*100/1.16 ≈ 431
    const d = nettingPatrimonialDelta(legs, unders, FX.USD);
    expect(d).toBeCloseTo((1 * 100 * 5) / FX.USD, 0);
  });
});

describe('stressLab — occMargin', () => {
  const legs: StressLeg[] = [
    {
      u: 'XYZ',
      cp: 'P',
      K: 100,
      T: 0.25,
      exp: '2026-09-18',
      q: -1, // naked short put
      px: 5,
      fl: false,
      mult: 100,
      nm: 'XYZ',
      iv: 0.4,
    },
  ];
  const eq: StressEquity[] = [];
  const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
  const sig: Record<number, number> = { 0: 0.4 };
  const marPrm: MarginParams = {
    ...surf,
    r: R,
    fxUSD: FX.USD,
    kScan: 0.7,
    fxRange: 0.03,
  };

  it('short naked put: margine > 0', () => {
    const m = occMargin(legs, eq, unders, 0, sig, 0, marPrm);
    expect(m.total).toBeGreaterThan(0);
  });

  it('short naked put: margine ≈ premio + 20% (con ATM, OTM=0)', () => {
    // px=5, S=100, K=100 → 5*100 + max(20*100 - 0, 10*100) = 500 + 2000 = 2500 USD = 2155 EUR
    const m = occMargin(legs, eq, unders, 0, sig, 0, marPrm);
    expect(m.total).toBeGreaterThan(2000);
    expect(m.total).toBeLessThan(2300);
  });

  it('covered call (azioni in portafoglio): nCov > 0', () => {
    const legsCC: StressLeg[] = [
      {
        u: 'XYZ',
        cp: 'C',
        K: 110,
        T: 0.25,
        exp: '2026-09-18',
        q: -1, // short call
        px: 2,
        fl: false,
        mult: 100,
        nm: 'XYZ',
        iv: 0.4,
      },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sigCC: Record<number, number> = { 0: 0.4 };
    const m = occMargin(legsCC, eqCov, unders, 0, sigCC, 0, marPrm);
    expect(m.nCov).toBe(1);
    // call coperta → margine 0
    expect(m.total).toBe(0);
  });

  it('CASO 1: collar (titoli + call corta coperta + put lunga) → margine 0', () => {
    const collar: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 110, T: 0.25, exp: '2026-09-18', q: -1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 90, T: 0.25, exp: '2026-09-18', q: 1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(collar, eqCov, unders, 0, sig, 0, marPrm);
    expect(m.nCov).toBe(1);
    expect(m.total).toBe(0);
  });

  it('CASO 1b: titoli + call corta COPERTA + call lunga orfana → margine 0 (no addebito sulla long)', () => {
    // Questo era il BUG: la call lunga residua veniva addebitata dallo scan.
    const legsBug: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 105, T: 0.25, exp: '2026-09-18', q: -1, px: 3, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 130, T: 1.0, exp: '2027-06-18', q: 1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(legsBug, eqCov, unders, 0, sig, 0, marPrm);
    expect(m.nCov).toBe(1);
    expect(m.total).toBe(0); // la call lunga NON deve generare margine
  });

  it('CASO 2: put comprata + put venduta (vertical) → scan TIMS attivo', () => {
    const putSpread: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 90, T: 0.25, exp: '2026-09-18', q: 1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(putSpread, [], unders, 0, sig, 0, marPrm);
    expect(m.total).toBeGreaterThan(0);
    // C'è uno spread vero → lo scan contribuisce (totScan tracciato)
    const bdXYZ = m.bd.find((b) => b.u === 'XYZ');
    expect(bdXYZ).toBeDefined();
  });

  it('CASO 3: call venduta + call comprata SENZA titoli → scan TIMS attivo', () => {
    const callSpread: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 115, T: 0.25, exp: '2026-09-18', q: 1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(callSpread, [], unders, 0, sig, 0, marPrm);
    expect(m.total).toBeGreaterThan(0);
  });

  it('long option singola → margine 0 (mai addebitata)', () => {
    const lone: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 100, T: 0.5, exp: '2026-12-18', q: 1, px: 8, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4 };
    const m = occMargin(lone, [], unders, 0, sig, 0, marPrm);
    expect(m.total).toBe(0);
  });
});

describe('stressLab — minimo opzione corta (shortFloorPct)', () => {
  const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
  const base = { ...surf, r: R, fxUSD: FX.USD, kScan: 0.7, fxRange: 0.03 };
  const withFloor = (p: number): MarginParams => ({ ...base, shortFloorPct: p });

  // Spread verticale call: short K=100 + long K=115, nessun titolo → lo scan gira.
  const callSpread: StressLeg[] = [
    { u: 'XYZ', cp: 'C', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    { u: 'XYZ', cp: 'C', K: 115, T: 0.25, exp: '2026-09-18', q: 1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
  ];
  const sigSpread: Record<number, number> = { 0: 0.4, 1: 0.4 };

  it('floor più alto → margine ≥ (monotòno) sul vero spread', () => {
    const m0 = occMargin(callSpread, [], unders, 0, sigSpread, 0, withFloor(0)).total;
    const m55 = occMargin(callSpread, [], unders, 0, sigSpread, 0, withFloor(0.55)).total;
    const m90 = occMargin(callSpread, [], unders, 0, sigSpread, 0, withFloor(0.9)).total;
    expect(m55).toBeGreaterThanOrEqual(m0);
    expect(m90).toBeGreaterThanOrEqual(m55);
    // a floor 0.9 il minimo opzione corta deve MORDERE oltre lo scan puro
    expect(m90).toBeGreaterThan(m0);
  });

  it('lo spread con floor resta ≤ del nudo pieno della short', () => {
    // requisito nudo della sola short call K=100 (ATM, S=100): 6*100 + 20%*100*100 = 2600 USD
    const nakedShortOnly: StressLeg[] = [callSpread[0]];
    const sigShort: Record<number, number> = { 0: 0.4 };
    const nudo = occMargin(nakedShortOnly, [], unders, 0, sigShort, 0, withFloor(0.55)).total;
    const spread = occMargin(callSpread, [], unders, 0, sigSpread, 0, withFloor(0.55)).total;
    // lo spread (short coperta da una long) non può costare più della short nuda
    expect(spread).toBeLessThanOrEqual(nudo + 1);
    // ma con il minimo opzione corta costa più di zero / più del solo debit
    expect(spread).toBeGreaterThan(0);
  });

  it('INVARIANTE: short nuda NON è toccata dal floor (nessuna long sul lato)', () => {
    const naked: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4 };
    const m0 = occMargin(naked, [], unders, 0, sig, 0, withFloor(0)).total;
    const m90 = occMargin(naked, [], unders, 0, sig, 0, withFloor(0.9)).total;
    expect(m90).toBeCloseTo(m0, 6); // identico: lo scan non gira sulle nude
  });

  it('INVARIANTE: covered call resta 0 anche con floor alto', () => {
    const cc: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 110, T: 0.25, exp: '2026-09-18', q: -1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4 };
    const m = occMargin(cc, eqCov, unders, 0, sig, 0, withFloor(0.9));
    expect(m.total).toBe(0);
  });

  it('INVARIANTE: covered call + long orfana resta 0 anche con floor alto', () => {
    const legsBug: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 105, T: 0.25, exp: '2026-09-18', q: -1, px: 3, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 130, T: 1.0, exp: '2027-06-18', q: 1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(legsBug, eqCov, unders, 0, sig, 0, withFloor(0.9));
    expect(m.total).toBe(0); // la long pagata non genera mai margine
  });

  it('diagonal stretto (long copre quasi del tutto): il minimo opzione corta morde', () => {
    // short near-dated + long far-dated PROFONDA, stesso lato: lo scan worst-case è
    // piccolo (la long copre quasi la short) → è qui che il minimo opzione corta
    // deve far salire il margine verso il nudo parziale.
    const diag: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 100, T: 0.15, exp: '2026-08-18', q: -1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 102, T: 1.5, exp: '2027-12-18', q: 1, px: 20, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m0 = occMargin(diag, [], unders, 0, sig, 0, withFloor(0)).total;
    const m60 = occMargin(diag, [], unders, 0, sig, 0, withFloor(0.6)).total;
    const m95 = occMargin(diag, [], unders, 0, sig, 0, withFloor(0.95)).total;
    expect(m60).toBeGreaterThanOrEqual(m0);
    expect(m95).toBeGreaterThan(m0); // il minimo opzione corta morde dove lo scan è basso
  });
});

describe('stressLab — pricing a intrinseco (gambe fl)', () => {
  const unders: StressUnderlyingMap = { DEEP: { S: 650, beta: 1 } };

  it('gamba call deep-ITM flaggata: P&L = variazione di intrinseco (delta 1)', () => {
    // Call K=400, S=650, prezzo di riferimento 245 (sotto intrinseco 250) → fl=true
    const legs: StressLeg[] = [
      { u: 'DEEP', cp: 'C', K: 400, T: 0.02, exp: '2026-06-30', q: 1, px: 245, fl: true, mult: 100, nm: 'DEEP', iv: 0.45 },
    ];
    const effIV = effIVMap(legs);
    // Shock -10% → S passa da 650 a 585; intrinseco da 250 a 185 → ΔP = -65
    const res = runScenario(legs, [], unders, effIV, -10, 0, baseParams);
    const expectedPnlUSD = 1 * 100 * (Math.max(0, 585 - 400) - Math.max(0, 650 - 400));
    const expectedEUR = expectedPnlUSD / FX.USD;
    expect(res.optEUR).toBeCloseTo(expectedEUR, 0);
    expect(res.rows[0].atIntrinsic).toBe(true);
  });

  it('gamba fl: a shock 0 il P&L è esattamente 0', () => {
    const legs: StressLeg[] = [
      { u: 'DEEP', cp: 'C', K: 400, T: 0.02, exp: '2026-06-30', q: 1, px: 245, fl: true, mult: 100, nm: 'DEEP', iv: 0.45 },
    ];
    const effIV = effIVMap(legs);
    const res = runScenario(legs, [], unders, effIV, 0, 0, baseParams);
    expect(res.optEUR).toBe(0);
  });
});
