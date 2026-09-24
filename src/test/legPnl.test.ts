import { describe, it, expect } from 'vitest';
import { soldOptionPnl, stockPnlVsPmc, intrinsicValue } from '@/lib/legPnl';

describe('stockPnlVsPmc', () => {
  it('perdita rispetto al PMC', () => {
    const r = stockPnlVsPmc(300, 120, 100)!;
    expect(r.perShare).toBe(-20);
    expect(r.total).toBe(-6000);
    expect(r.pct).toBeCloseTo(-16.667, 2);
  });
  it('guadagno rispetto al PMC', () => {
    expect(stockPnlVsPmc(100, 50, 55)!.total).toBe(500);
  });
  it('null senza PMC o prezzo', () => {
    expect(stockPnlVsPmc(100, 0, 55)).toBeNull();
    expect(stockPnlVsPmc(100, 50, 0)).toBeNull();
    expect(stockPnlVsPmc(0, 50, 55)).toBeNull();
  });
});

describe('intrinsicValue', () => {
  it('call e put', () => {
    expect(intrinsicValue('call', 100, 110)).toBe(10);
    expect(intrinsicValue('call', 100, 90)).toBe(0);
    expect(intrinsicValue('put', 100, 90)).toBe(10);
    expect(intrinsicValue('put', 100, 110)).toBe(0);
  });
});

describe('soldOptionPnl', () => {
  it('put venduta ITM: intrinseca + temporale = totale', () => {
    // K=100, S=90, PMC=3, prezzo=12 → intrinseco 10, temporale residuo 2
    const r = soldOptionPnl({ optionType: 'put', strike: 100, quantity: -2, avgCost: 3, price: 12, spot: 90 })!;
    expect(r.contracts).toBe(2);
    expect(r.intrinsicPerShare).toBe(10);
    expect(r.timeValuePerShare).toBe(2);
    expect(r.intrinsicPnl).toBe(-2000);
    expect(r.timePnl).toBe(200);
    expect(r.totalPnl).toBe(-1800);
    expect(r.intrinsicPnl + r.timePnl).toBeCloseTo(r.totalPnl, 8);
  });
  it('call venduta ITM (covered call) con valore temporale salito', () => {
    // K=50, S=55, PMC=1, prezzo=7 → intrinseco 5, temporale 2 → temporale −100
    const r = soldOptionPnl({ optionType: 'call', strike: 50, quantity: -1, avgCost: 1, price: 7, spot: 55 })!;
    expect(r.intrinsicPnl).toBe(-500);
    expect(r.timePnl).toBe(-100);
    expect(r.totalPnl).toBe(-600);
  });
  it('OTM: nessuna perdita intrinseca, tutto temporale', () => {
    const r = soldOptionPnl({ optionType: 'put', strike: 100, quantity: -1, avgCost: 3, price: 1, spot: 110 })!;
    expect(r.intrinsicPnl === 0).toBe(true);
    expect(r.timePnl).toBe(200);
    expect(r.totalPnl).toBe(200);
  });
  it('prezzo sotto intrinseco (quote sporche): la somma resta coerente', () => {
    const r = soldOptionPnl({ optionType: 'put', strike: 100, quantity: -1, avgCost: 3, price: 9.8, spot: 90 })!;
    expect(r.timeValuePerShare).toBeCloseTo(-0.2, 8);
    expect(r.intrinsicPnl + r.timePnl).toBeCloseTo(r.totalPnl, 8);
  });
  it('null per opzioni acquistate o senza spot', () => {
    expect(soldOptionPnl({ optionType: 'put', strike: 100, quantity: 1, avgCost: 3, price: 1, spot: 90 })).toBeNull();
    expect(soldOptionPnl({ optionType: 'put', strike: 100, quantity: -1, avgCost: 3, price: 1, spot: 0 })).toBeNull();
    expect(soldOptionPnl({ optionType: null, strike: 100, quantity: -1, avgCost: 3, price: 1, spot: 90 })).toBeNull();
  });
});
