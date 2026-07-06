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
  marginCallShock,
  BOND_MARGIN_HAIRCUT,
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

  it('nakedPct più alto → margine nudo più alto (mantenimento di casa)', () => {
    const m20 = occMargin(legs, eq, unders, 0, sig, 0, { ...marPrm, nakedPct: 0.2 }).total;
    const m30 = occMargin(legs, eq, unders, 0, sig, 0, { ...marPrm, nakedPct: 0.3 }).total;
    expect(m30).toBeGreaterThan(m20);
    // +10 punti di mantenimento su S=100, 1 contratto = +10*100 USD = +1000 USD ≈ +862 EUR
    expect(m30 - m20).toBeCloseTo((0.1 * 100 * 100) / FX.USD, 0);
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

describe('stressLab — diagonali governate dallo scan TIMS, non Reg-T', () => {
  const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
  const prm: MarginParams = { ...surf, r: R, fxUSD: FX.USD, kScan: 0.7, fxRange: 0.03 };

  it('verticale put STESSA scadenza: credito Reg-T riconosciuto (strat > 0)', () => {
    const vert: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 85, T: 0.25, exp: '2026-09-18', q: 1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(vert, [], unders, 0, sig, 0, prm);
    const bd = m.bd.find((b) => b.u === 'XYZ')!;
    // credito di spread Reg-T riconosciuto → componente strategy presente e
    // limitata: la short NON è addebitata a nudo pieno
    expect(bd.strat).toBeGreaterThan(0);
    const nakedShort = occMargin([vert[0]], [], unders, 0, { 0: 0.4 }, 0, prm).total;
    expect(bd.strat).toBeLessThan(nakedShort); // il verticale costa meno della nuda
  });

  it('diagonale put (scadenze DIVERSE): NESSUN credito verticale Reg-T → scan TIMS', () => {
    // stessi strike/premi del verticale, ma la long scade molto dopo → diagonale
    const diag: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 85, T: 1.25, exp: '2027-09-18', q: 1, px: 9, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(diag, [], unders, 0, sig, 0, prm);
    const bd = m.bd.find((b) => b.u === 'XYZ')!;
    // la short diagonale NON riceve il credito verticale: la componente strategy
    // è azzerata (deferita allo scan), il margine è interamente TIMS
    expect(bd.strat).toBe(0);
    expect(bd.scan).toBeGreaterThan(0);
    expect(m.total).toBeGreaterThan(0);
  });

  it('naked puro (nessuna long sul lato) resta Reg-T nudo, non deferito', () => {
    const naked: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const m = occMargin(naked, [], unders, 0, { 0: 0.4 }, 0, prm);
    const bd = m.bd.find((b) => b.u === 'XYZ')!;
    expect(bd.strat).toBeGreaterThan(0); // nudo addebitato (Reg-T), scan non gira
    expect(bd.scan).toBe(0);
    // su una nuda il Reg-T puro coincide col totale (nessuno scan)
    expect(m.totRegT).toBeCloseTo(m.total, 6);
  });

  it('Reg-T puro credita il diagonale come verticale (≠ totale ibrido)', () => {
    const diag: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 6, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 85, T: 1.25, exp: '2027-09-18', q: 1, px: 9, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const m = occMargin(diag, [], unders, 0, sig, 0, prm);
    // Reg-T puro applica il credito di spread al diagonale → valore definito > 0,
    // diverso dal totale ibrido (governato dallo scan TIMS)
    expect(m.totRegT).toBeGreaterThan(0);
    expect(m.totRegT).not.toBeCloseTo(m.total, 1);
  });
});

describe('stressLab — scan IV di classe (ivScan)', () => {
  const unders: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
  const base = { ...surf, r: R, fxUSD: FX.USD, kScan: 0.7, fxRange: 0.03 };
  const withIv = (v: number): MarginParams => ({ ...base, ivScan: v });

  // Diagonal con net-vega: short near-dated + long far-dated, stesso lato.
  const diag: StressLeg[] = [
    { u: 'XYZ', cp: 'C', K: 100, T: 0.15, exp: '2026-08-18', q: -1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    { u: 'XYZ', cp: 'C', K: 105, T: 1.5, exp: '2027-12-18', q: 1, px: 18, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
  ];
  const sigDiag: Record<number, number> = { 0: 0.4, 1: 0.4 };

  it('scan IV più ampio → margine ≥ (monotòno) sul diagonal net-vega', () => {
    const m0 = occMargin(diag, [], unders, 0, sigDiag, 0, withIv(0)).total;
    const m40 = occMargin(diag, [], unders, 0, sigDiag, 0, withIv(0.4)).total;
    const m80 = occMargin(diag, [], unders, 0, sigDiag, 0, withIv(0.8)).total;
    expect(m40).toBeGreaterThanOrEqual(m0);
    expect(m80).toBeGreaterThanOrEqual(m40);
  });

  it('INVARIANTE: short nuda NON è toccata dallo scan IV (lo scan non gira)', () => {
    const naked: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 100, T: 0.25, exp: '2026-09-18', q: -1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sig: Record<number, number> = { 0: 0.4 };
    const m0 = occMargin(naked, [], unders, 0, sig, 0, withIv(0)).total;
    const m90 = occMargin(naked, [], unders, 0, sig, 0, withIv(0.9)).total;
    expect(m90).toBeCloseTo(m0, 6);
  });

  it('INVARIANTE: covered call resta 0 a qualunque scan IV', () => {
    const cc: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 110, T: 0.25, exp: '2026-09-18', q: -1, px: 2, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4 };
    expect(occMargin(cc, eqCov, unders, 0, sig, 0, withIv(0.9)).total).toBe(0);
  });

  it('INVARIANTE: covered call + long orfana resta 0 (long pagata mai addebitata)', () => {
    const legsBug: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 105, T: 0.25, exp: '2026-09-18', q: -1, px: 3, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 130, T: 1.0, exp: '2027-06-18', q: 1, px: 5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const eqCov: StressEquity[] = [
      { nm: 'XYZ', ccy: 'USD', px: 100, q: 100, eur: 8620, beta: 1, tick: 'XYZ' },
    ];
    const sig: Record<number, number> = { 0: 0.4, 1: 0.4 };
    expect(occMargin(legsBug, eqCov, unders, 0, sig, 0, withIv(0.9)).total).toBe(0);
  });

  it('scan di classe: call e put NETTATE (≤ somma dei due lati scansionati a parte)', () => {
    // short call spread + short put spread (condor corto): il peggior prezzo per le
    // call (alto) e per le put (basso) NON coincidono → la netting di classe dà un
    // requisito ≤ della somma dei due spread scansionati separatamente.
    const callSp: StressLeg[] = [
      { u: 'XYZ', cp: 'C', K: 110, T: 0.25, exp: '2026-09-18', q: -1, px: 4, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'C', K: 125, T: 0.25, exp: '2026-09-18', q: 1, px: 1.5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const putSp: StressLeg[] = [
      { u: 'XYZ', cp: 'P', K: 90, T: 0.25, exp: '2026-09-18', q: -1, px: 4, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
      { u: 'XYZ', cp: 'P', K: 75, T: 0.25, exp: '2026-09-18', q: 1, px: 1.5, fl: false, mult: 100, nm: 'XYZ', iv: 0.4 },
    ];
    const sigC: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const sigP: Record<number, number> = { 0: 0.4, 1: 0.4 };
    const sigBoth: Record<number, number> = { 0: 0.4, 1: 0.4, 2: 0.4, 3: 0.4 };
    const mC = occMargin(callSp, [], unders, 0, sigC, 0, withIv(0.4)).total;
    const mP = occMargin(putSp, [], unders, 0, sigP, 0, withIv(0.4)).total;
    const mBoth = occMargin([...callSp, ...putSp], [], unders, 0, sigBoth, 0, withIv(0.4)).total;
    expect(mBoth).toBeGreaterThan(0);
    // netting di classe: il condor non costa più dei due spread separati
    expect(mBoth).toBeLessThanOrEqual(mC + mP + 1);
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

describe('stressLab — netting Ex CC e NP (intrinseco hold-to-expiry)', () => {
  // 4 gambe ATM sullo stesso sottostante (beta=1): short call, long put, long call, short put.
  const legs: StressLeg[] = [
    { u: 'X', cp: 'C', K: 100, T: 0.5, exp: '2026-12-18', q: -1, px: 8, fl: false, mult: 100, nm: 'X', iv: 0.3 }, // 0: CALL venduta
    { u: 'X', cp: 'P', K: 100, T: 0.5, exp: '2026-12-18', q: 1, px: 7, fl: false, mult: 100, nm: 'X', iv: 0.3 },  // 1: PUT comprata
    { u: 'X', cp: 'C', K: 100, T: 0.5, exp: '2026-12-18', q: 1, px: 8, fl: false, mult: 100, nm: 'X', iv: 0.3 },  // 2: CALL comprata
    { u: 'X', cp: 'P', K: 100, T: 0.5, exp: '2026-12-18', q: -1, px: 7, fl: false, mult: 100, nm: 'X', iv: 0.3 }, // 3: PUT venduta
  ];
  const unders: StressUnderlyingMap = { X: { S: 100, beta: 1 } };
  const effIV = effIVMap(legs);
  const netParams: ScenarioParams = { ...baseParams, netting: true };

  it('shock GIÙ: PUT a intrinseco, CALL a zero', () => {
    const res = runScenario(legs, [], unders, effIV, -10, 0, netParams); // S: 100 → 90
    // CALL venduta e CALL comprata → zero P&L
    expect(res.rows[0].pnlEUR).toBeCloseTo(0, 6);
    expect(res.rows[2].pnlEUR).toBeCloseTo(0, 6);
    // PUT comprata → guadagna intrinseco (S<K); PUT venduta → perde intrinseco
    expect(res.rows[1].pnlEUR).toBeGreaterThan(0);
    expect(res.rows[3].pnlEUR).toBeLessThan(0);
    // PUT comprata: ΔP = intrinseco(90)-intrinseco(100) = 10-0 = 10 → q·mult·10/fx
    expect(res.rows[1].pnlEUR).toBeCloseTo((1 * 100 * 10) / FX.USD, 4);
    // tutte le gambe trattate a intrinseco sotto netting
    expect(res.rows.every((r) => r.atIntrinsic)).toBe(true);
  });

  it('shock SU: CALL a intrinseco, PUT a zero (opposto)', () => {
    const res = runScenario(legs, [], unders, effIV, 10, 0, netParams); // S: 100 → 110
    // PUT comprata e PUT venduta → zero P&L
    expect(res.rows[1].pnlEUR).toBeCloseTo(0, 6);
    expect(res.rows[3].pnlEUR).toBeCloseTo(0, 6);
    // CALL venduta → perde intrinseco (S>K); CALL comprata → guadagna
    expect(res.rows[0].pnlEUR).toBeLessThan(0);
    expect(res.rows[2].pnlEUR).toBeGreaterThan(0);
    // CALL venduta: ΔP = intrinseco(110)-intrinseco(100) = 10-0 = 10 → q=-1
    expect(res.rows[0].pnlEUR).toBeCloseTo((-1 * 100 * 10) / FX.USD, 4);
  });

  it('a shock 0 il netting non genera P&L', () => {
    const res = runScenario(legs, [], unders, effIV, 0, 0, netParams);
    expect(Math.abs(res.optEUR)).toBeCloseTo(0, 6);
  });

  it('senza netting le stesse gambe NON sono a intrinseco', () => {
    const res = runScenario(legs, [], unders, effIV, -10, 0, baseParams);
    expect(res.rows.every((r) => !r.atIntrinsic)).toBe(true);
  });

  it('covered call ITM: compensa sopra lo strike, perde solo sotto', () => {
    // 100 azioni a 500, call venduta strike 350 (deep ITM). fx=1 per numeri puliti.
    const eq: StressEquity[] = [
      { nm: 'Y', ccy: 'USD', px: 500, q: 100, eur: 50000, beta: 1, tick: 'Y' },
    ];
    const cc: StressLeg[] = [
      { u: 'Y', cp: 'C', K: 350, T: 0.3, exp: '2026-12-18', q: -1, px: 155, fl: false, mult: 100, nm: 'Y', iv: 0.3 },
    ];
    const un: StressUnderlyingMap = { Y: { S: 500, beta: 1 } };
    const eff = effIVMap(cc);
    const prm: ScenarioParams = { ...baseParams, netting: true, fx: { USD: 1, HKD: 9 } };

    // −20%: 500 → 400, ancora SOPRA lo strike 350 → compensazione totale, P&L ≈ 0.
    const above = runScenario(cc, eq, un, eff, -20, 0, prm);
    // azioni −10000, call +10000 (intrinseco 150 → 50)
    expect(above.eqEUR).toBeCloseTo(-10000, 4);
    expect(above.optEUR).toBeCloseTo(10000, 4);
    expect(above.totEUR).toBeCloseTo(0, 4);

    // −40%: 500 → 300, SOTTO lo strike 350 → si perde dallo strike in giù.
    const below = runScenario(cc, eq, un, eff, -40, 0, prm);
    expect(below.eqEUR).toBeCloseTo(-20000, 4);
    expect(below.optEUR).toBeCloseTo(15000, 4); // intrinseco 150 → 0
    // perdita = (strike − spot)·azioni = (350 − 300)·100 = 5000
    expect(below.totEUR).toBeCloseTo(-5000, 4);
  });
});

describe('marginCallShock — soglia margin call (cash + bond·95%)', () => {
  it('BOND_MARGIN_HAIRCUT è 0,95', () => {
    expect(BOND_MARGIN_HAIRCUT).toBe(0.95);
  });

  it('interpola linearmente il primo attraversamento margine > cover', () => {
    const pts = [
      { x: 0, margin: 100 },
      { x: -10, margin: 200 },
      { x: -20, margin: 400 }, // cover 300 → a metà tra −10 e −20
    ];
    expect(marginCallShock(pts, 300)).toBeCloseTo(-15, 6);
  });

  it('ritorna la x del primo punto se già in margin call a shock 0', () => {
    const pts = [
      { x: 0, margin: 500 },
      { x: -10, margin: 700 },
    ];
    expect(marginCallShock(pts, 300)).toBe(0);
  });

  it('ritorna null se la soglia non viene mai superata', () => {
    const pts = [
      { x: 0, margin: 100 },
      { x: -10, margin: 150 },
      { x: -20, margin: 180 },
    ];
    expect(marginCallShock(pts, 300)).toBeNull();
  });

  it('ritorna null con cover non positiva o senza punti', () => {
    expect(marginCallShock([], 100)).toBeNull();
    expect(marginCallShock([{ x: 0, margin: 50 }], 0)).toBeNull();
    expect(marginCallShock([{ x: 0, margin: 50 }], -10)).toBeNull();
  });

  it('non scatta su attraversamenti al ribasso (margine che RIENTRA sotto cover)', () => {
    // sale sopra cover tra −10 e −20, poi rientra: il punto restituito è il PRIMO attraversamento
    const pts = [
      { x: 0, margin: 100 },
      { x: -10, margin: 250 },
      { x: -20, margin: 350 },
      { x: -30, margin: 280 },
      { x: -40, margin: 500 },
    ];
    expect(marginCallShock(pts, 300)).toBeCloseTo(-15, 6);
  });

  it('coerenza con la definizione cover = cash + bond × 0,95', () => {
    const cash = 100_000;
    const bonds = 200_000;
    const cover = cash + bonds * BOND_MARGIN_HAIRCUT; // 290k
    const pts = [
      { x: 0, margin: 200_000 },
      { x: -10, margin: 290_000 }, // esattamente = cover → NON ancora margin call (serve >)
      { x: -20, margin: 380_000 },
    ];
    const mc = marginCallShock(pts, cover);
    // attraversamento tra −10 (=cover, non oltre) e −20
    expect(mc).not.toBeNull();
    expect(mc as number).toBeLessThanOrEqual(-10);
    expect(mc as number).toBeGreaterThan(-20);
  });
});
