import { describe, it, expect } from 'vitest';
import { occSphMargin, OccSphResult } from '@/lib/occSphMargin';
import type { StressLeg, StressEquity, StressUnderlyingMap } from '@/lib/stressLab';

/* Helper: gamba con default sui campi non usati dalla pipeline OCCSPH */
const leg = (p: Partial<StressLeg> & Pick<StressLeg, 'u' | 'cp' | 'K' | 'q' | 'px'>): StressLeg => ({
  T: 0.25,
  exp: '2026-09-18',
  fl: false,
  mult: 100,
  nm: p.u,
  iv: 0.3,
  ...p,
});

const eqRow = (tick: string, q: number, gp = false): StressEquity => ({
  nm: tick,
  ccy: 'USD',
  px: 100,
  q,
  eur: 0,
  beta: 1,
  tick,
  gp,
});

const U: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 } };
const PRM = { fxUSD: 1 };

const sum = (r: OccSphResult) => r.premium + r.minimum + r.additional;

describe('occSphMargin — single-leg naked', () => {
  it('naked call: premio + (pct·S − OTM) quando sopra il floor', () => {
    // K=105, px=3: base=(20−5)·100=1500 ≥ floor 1000 → 300+1500=1800
    const r = occSphMargin([leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 })], [], U, PRM);
    expect(r.total).toBeCloseTo(1800, 6);
    expect(r.trace[0].kind).toBe('naked');
    expect(r.trace[0].premium).toBeCloseTo(300, 6);
    expect(r.trace[0].additional).toBeCloseTo(1500, 6);
    expect(r.trace[0].minimum).toBe(0);
  });

  it('naked call deep OTM: scatta il floor 10%·S', () => {
    // K=140, px=0.5: base=−2000 < floor 1000 → 50+1000=1050
    const r = occSphMargin([leg({ u: 'XYZ', cp: 'C', K: 140, q: -1, px: 0.5 })], [], U, PRM);
    expect(r.total).toBeCloseTo(1050, 6);
    expect(r.trace[0].minimum).toBeCloseTo(1000, 6);
    expect(r.trace[0].additional).toBe(0);
  });

  it('naked put deep OTM: floor 10%·K', () => {
    // K=60, px=0.3: floor=0.1·60·100=600 → 30+600=630
    const r = occSphMargin([leg({ u: 'XYZ', cp: 'P', K: 60, q: -1, px: 0.3 })], [], U, PRM);
    expect(r.total).toBeCloseTo(630, 6);
    expect(r.trace[0].minimum).toBeCloseTo(600, 6);
  });

  it('long residua: margine 0, tracciata come long', () => {
    const r = occSphMargin([leg({ u: 'XYZ', cp: 'C', K: 105, q: 1, px: 3 })], [], U, PRM);
    expect(r.total).toBe(0);
    expect(r.trace[0].kind).toBe('long');
  });
});

describe('occSphMargin — pre-processing covered', () => {
  it('le azioni coprono le call corte più ITM (margine 0)', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 }),
      leg({ u: 'XYZ', cp: 'C', K: 95, q: -1, px: 8 }),
    ];
    const r = occSphMargin(legs, [eqRow('XYZ', 100)], U, PRM);
    expect(r.nCov).toBe(1);
    // Coperta la K=95 (più ITM); resta naked la K=105 → 1800
    expect(r.total).toBeCloseTo(1800, 6);
    const cov = r.trace.find((t) => t.kind === 'covered_call');
    expect(cov?.legs[0]).toContain('95');
  });

  it('le azioni GP NON coprono le call del book', () => {
    const legs = [leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 })];
    const r = occSphMargin(legs, [eqRow('XYZ', 100, true)], U, PRM);
    expect(r.nCov).toBe(0);
    expect(r.total).toBeCloseTo(1800, 6);
  });
});

describe('occSphMargin — spread (gerarchia step 1)', () => {
  it('credit spread: ampiezza − credito netto', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -1, px: 5 }),
      leg({ u: 'XYZ', cp: 'C', K: 110, q: 1, px: 2 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    // (110−100)·100 − (5−2)·100 = 700
    expect(r.total).toBeCloseTo(700, 6);
    expect(r.trace[0].kind).toBe('vertical_credit');
    expect(r.trace[0].additional).toBeCloseTo(700, 6);
  });

  it('debit spread: margine 0', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 110, q: -1, px: 2 }),
      leg({ u: 'XYZ', cp: 'C', K: 100, q: 1, px: 5 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    expect(r.total).toBe(0);
    expect(r.trace[0].kind).toBe('vertical_debit');
  });

  it('diagonale (scadenza diversa) NON riceve credito di spread', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -1, px: 5, exp: '2026-09-18' }),
      leg({ u: 'XYZ', cp: 'C', K: 110, q: 1, px: 4, exp: '2026-12-18' }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    // Short naked C100: 500 + 2000 = 2500; long → 0
    expect(r.total).toBeCloseTo(2500, 6);
    expect(r.trace.some((t) => t.kind === 'naked')).toBe(true);
  });

  it('consumo progressivo: 2 short + 1 long → 1 spread + 1 naked', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -2, px: 5 }),
      leg({ u: 'XYZ', cp: 'C', K: 110, q: 1, px: 2 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    // spread 700 + naked C100 (500+2000)=2500 → 3200
    expect(r.total).toBeCloseTo(3200, 6);
    expect(r.trace.filter((t) => t.kind === 'vertical_credit').length).toBe(1);
    expect(r.trace.filter((t) => t.kind === 'naked').length).toBe(1);
  });
});

describe('occSphMargin — straddle e combination (step 2–3)', () => {
  it('straddle short: lato peggiore per intero + premio altro lato', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -1, px: 4 }),
      leg({ u: 'XYZ', cp: 'P', K: 100, q: -1, px: 3.5 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    // nakedC=400+2000=2400 (peggiore) + premio put 350 = 2750
    expect(r.total).toBeCloseTo(2750, 6);
    expect(r.trace[0].kind).toBe('straddle');
    // sempre ≤ somma dei due naked (2400+2350)
    expect(r.total).toBeLessThan(4750);
  });

  it('strangle short (put K < call K)', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 110, q: -1, px: 2 }),
      leg({ u: 'XYZ', cp: 'P', K: 90, q: -1, px: 2 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    // nakedC = 200+1000=1200 (≥ nakedP 1200, tie → call) + premio put 200 = 1400
    expect(r.total).toBeCloseTo(1400, 6);
    expect(r.trace[0].kind).toBe('strangle');
  });

  it('guts short (call K < put K)', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 90, q: -1, px: 12 }),
      leg({ u: 'XYZ', cp: 'P', K: 110, q: -1, px: 11 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    expect(r.trace[0].kind).toBe('guts');
  });

  it('gli spread hanno priorità sui combo (gerarchia rigida)', () => {
    // Short C100 può fare spread con long C110 O strangle con short P90:
    // la gerarchia impone lo spread.
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -1, px: 5 }),
      leg({ u: 'XYZ', cp: 'C', K: 110, q: 1, px: 2 }),
      leg({ u: 'XYZ', cp: 'P', K: 90, q: -1, px: 2 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    expect(r.trace.some((t) => t.kind === 'vertical_credit')).toBe(true);
    expect(r.trace.some((t) => t.kind === 'naked')).toBe(true); // put residua
    // spread 700 + naked put 1200 = 1900
    expect(r.total).toBeCloseTo(1900, 6);
  });
});

describe('occSphMargin — invarianti e valuta', () => {
  it('premium + minimum + additional = totale (scomposizione esatta)', () => {
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 100, q: -2, px: 5 }),
      leg({ u: 'XYZ', cp: 'C', K: 110, q: 1, px: 2 }),
      leg({ u: 'XYZ', cp: 'P', K: 90, q: -1, px: 2 }),
      leg({ u: 'XYZ', cp: 'P', K: 60, q: -1, px: 0.3 }),
    ];
    const r = occSphMargin(legs, [], U, PRM);
    expect(sum(r)).toBeCloseTo(r.total, 6);
  });

  it('conversione EUR via fxUSD', () => {
    const legs = [leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 })];
    const r = occSphMargin(legs, [], U, { fxUSD: 1.16 });
    expect(r.total).toBeCloseTo(1800 / 1.16, 6);
  });

  it('byUnderlying somma al totale', () => {
    const U2: StressUnderlyingMap = { XYZ: { S: 100, beta: 1 }, ABC: { S: 50, beta: 1 } };
    const legs = [
      leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 }),
      leg({ u: 'ABC', cp: 'P', K: 45, q: -1, px: 1 }),
    ];
    const r = occSphMargin(legs, [], U2, PRM);
    const s = r.byUnderlying.reduce((a, b) => a + b.margin, 0);
    expect(s).toBeCloseTo(r.total, 6);
  });

  it('nakedPct più alto alza il margine (taratura banca)', () => {
    const legs = [leg({ u: 'XYZ', cp: 'C', K: 105, q: -1, px: 3 })];
    const r20 = occSphMargin(legs, [], U, { fxUSD: 1, nakedPct: 0.2 });
    const r30 = occSphMargin(legs, [], U, { fxUSD: 1, nakedPct: 0.3 });
    expect(r30.total).toBeGreaterThan(r20.total);
    // base a 30%: (30−5)·100=2500 → 300+2500=2800
    expect(r30.total).toBeCloseTo(2800, 6);
  });
});
