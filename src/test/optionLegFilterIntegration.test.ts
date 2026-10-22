import { describe, expect, it } from 'vitest';
import type { DerivativeCategories } from '@/lib/derivativeStrategies';
import { computeMonitoring } from '@/lib/monitoringEngine';
import { analyzePortfolioRisk, calculateNakedPutRisk, type SpotResolver } from '@/lib/riskCalculator';
import { filterByLegs, moneynessOf } from '@/lib/optionLegFilter';
import {
  derivativeExposureTotal,
  filterRiskAnalysisByOptionLegs,
  riskAnalysisOptionItemsLegs,
} from '@/lib/equityExposureFilter';
import { deRiskingCoveredCallLegs, spotFromPrices } from '@/lib/strategyFilterLegs';
import type { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { Position } from '@/types/portfolio';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'derivative',
    currency: 'USD', exchange_rate: 1, quantity: 0,
    current_price: null, avg_cost: null, market_value: null,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

const opt = (underlying: string, type: 'call' | 'put', strike: number, qty: number, expiry: string, extra: Partial<Position> = {}) =>
  pos({ underlying, option_type: type, strike_price: strike, quantity: qty, expiry_date: expiry, description: `${underlying} ${type} ${strike}`, avg_cost: 1, current_price: 1, ...extra });

function emptyCats(): DerivativeCategories {
  return {
    coveredCalls: [], deRiskingCoveredCalls: [], longPuts: [], ironCondors: [], doubleDiagonals: [],
    nakedPuts: [], leapCalls: [], otherStrategies: [], groupedOtherStrategies: [], resolvedConfigs: [],
    incompleteStrategies: [],
  };
}

const prices = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).map(([k, price]) => [k, { price } as unknown as UnderlyingPrice]));

const resolverFrom = (m: Record<string, number>): SpotResolver => (name) =>
  m[name] != null ? { spot: m[name], source: 'ticker_cache', tickerUsed: name } : { spot: null, source: 'none', tickerUsed: null };

describe('monitoringEngine: gambe filtrabili sugli elementi', () => {
  it('Naked Put ITM porta la put con spot dalla stessa chiave usata per lo stato ITM', () => {
    const put = opt('XYZ', 'put', 100, -2, '2026-12-18');
    const cats = { ...emptyCats(), nakedPuts: [{ option: put, underlying: null, contracts: 2 }] };
    const m = computeMonitoring(cats, [put], [], prices({ XYZ: 90 }), [], []);
    expect(m.nakedPutsITM).toHaveLength(1);
    expect(m.nakedPutsITM[0].legs).toEqual([{ optionType: 'put', strike: 100, expiry: '2026-12-18', spot: 90 }]);
    expect(moneynessOf(m.nakedPutsITM[0].legs![0])).toBe('put_itm');
  });

  it('Call non coperte: una gamba per ogni short call del sottostante', () => {
    const c1 = opt('ABC', 'call', 50, -1, '2026-11-20');
    const c2 = opt('ABC', 'call', 60, -1, '2027-01-15');
    const m = computeMonitoring(emptyCats(), [c1, c2], [], prices({ ABC: 55 }), [], []);
    expect(m.uncoveredCalls).toHaveLength(1);
    const legs = m.uncoveredCalls[0].legs!;
    expect(legs.map((l) => [l.strike, l.expiry, moneynessOf(l)])).toEqual([
      [50, '2026-11-20', 'call_itm'],
      [60, '2027-01-15', 'call_otm'],
    ]);
    // Filtro scadenza gennaio: l'elemento resta (ha una gamba a gennaio)
    expect(filterByLegs(m.uncoveredCalls, (u) => u.legs ?? [], { buckets: [], expiries: ['2027-01-15'] })).toHaveLength(1);
    expect(filterByLegs(m.uncoveredCalls, (u) => u.legs ?? [], { buckets: ['call_itm'], expiries: ['2027-01-15'] })).toHaveLength(0);
  });
});

describe('strategyFilterLegs', () => {
  it('DR-CC include call venduta e put di protezione con lo spot di option.underlying', () => {
    const call = opt('NVDA', 'call', 200, -1, '2026-12-18');
    const prot = opt('NVDA', 'put', 150, 1, '2027-06-17');
    const stock = pos({ asset_type: 'stock', ticker: 'NVDA', quantity: 100 });
    const legs = deRiskingCoveredCallLegs({
      coveredCall: { option: call, underlying: stock, contractsCovered: 1, sharesCovered: 100, isFullyCovered: true },
      protectionPut: prot,
      isSynthetic: false,
    }, prices({ NVDA: 180 }));
    expect(legs.map((l) => [l.optionType, l.strike, l.spot])).toEqual([['call', 200, 180], ['put', 150, 180]]);
  });

  it('spot non positivo o chiave mancante → null (gamba non classificabile)', () => {
    expect(spotFromPrices(prices({ A: 0 }), 'A')).toBeNull();
    expect(spotFromPrices(prices({ A: 10 }), null)).toBeNull();
  });
});

describe('Equity Exposure: totali filtrati per derivato ITM/OTM e scadenza', () => {
  const stock = pos({ asset_type: 'stock', ticker: 'MSFT', description: 'MICROSOFT', quantity: 100, current_price: 400, currency: 'USD' });
  const npItm = opt('AAA', 'put', 100, -1, '2026-12-18');   // spot 90 → ITM, rischio 10.000
  const npOtm = opt('BBB', 'put', 50, -2, '2027-01-15');    // spot 60 → OTM, rischio 10.000
  const leap = opt('CCC', 'call', 20, 1, '2028-01-21', { current_price: 15, avg_cost: 10 }); // spot 30 → ITM, 1.500
  const icLegs = {
    soldPut: opt('DDD', 'put', 90, -1, '2026-12-18'),
    boughtPut: opt('DDD', 'put', 80, 1, '2026-12-18'),
    soldCall: opt('DDD', 'call', 110, -1, '2026-12-18'),
    boughtCall: opt('DDD', 'call', 120, 1, '2026-12-18'),
  };
  const cats: DerivativeCategories = {
    ...emptyCats(),
    nakedPuts: [
      { option: npItm, underlying: null, contracts: 1 },
      { option: npOtm, underlying: null, contracts: 2 },
    ],
    leapCalls: [{ option: leap, underlying: null, contracts: 1 }],
    ironCondors: [{ underlying: 'DDD', expiryDate: '2026-12-18', ...icLegs, contracts: 1, totalPremium: 0, totalProfitLoss: 0 }],
  };
  const resolver = resolverFrom({ AAA: 90, BBB: 60, CCC: 30, DDD: 100 });
  const positions = [stock, npItm, npOtm, leap, ...Object.values(icLegs)];
  const analysis = analyzePortfolioRisk(positions, cats, resolver);
  const toggles = { includeNakedPut: true, includeLeapCall: true, includeStrategies: true, includeProtections: true };

  it('le voci derivate hanno le gambe con lo spot del resolver', () => {
    expect(analysis.nakedPutDetails.map((d) => moneynessOf(d.legs![0]))).toEqual(['put_itm', 'put_otm']);
    expect(analysis.strategyDetails[0].legs).toHaveLength(4);
    expect(riskAnalysisOptionItemsLegs(analysis)).toHaveLength(4);
  });

  it('senza filtro restituisce la stessa analisi', () => {
    expect(filterRiskAnalysisByOptionLegs(analysis, { buckets: [], expiries: [] })).toBe(analysis);
  });

  it('PUT ITM: solo la naked put ITM; IC dentro il range (nessuna gamba ITM) esce; azioni invariate', () => {
    const fa = filterRiskAnalysisByOptionLegs(analysis, { buckets: ['put_itm'], expiries: [] });
    expect(fa.nakedPutDetails.map((d) => d.underlying)).toEqual(['AAA']);
    expect(fa.totalNakedPutRisk).toBeCloseTo(10_000);
    expect(fa.leapCallDetails).toHaveLength(0);
    expect(fa.strategyDetails).toHaveLength(0);
    expect(fa.totalPureStockRisk).toBe(analysis.totalPureStockRisk);
    expect(fa.grandTotal).toBeCloseTo(analysis.totalStockRisk + 10_000);
    expect(derivativeExposureTotal(fa, toggles)).toBeCloseTo(10_000);
  });

  it('scadenza 18/12/26: naked put dicembre + iron condor per intero', () => {
    const fa = filterRiskAnalysisByOptionLegs(analysis, { buckets: [], expiries: ['2026-12-18'] });
    expect(fa.nakedPutDetails.map((d) => d.underlying)).toEqual(['AAA']);
    expect(fa.strategyDetails.map((d) => d.strategyName)).toEqual(['Iron Condor']);
    expect(fa.totalStrategyRisk).toBeCloseTo(analysis.totalStrategyRisk);
    expect(derivativeExposureTotal(fa, toggles)).toBeCloseTo(10_000 + analysis.totalStrategyRisk);
  });

  it('i toggle della card restano rispettati sul totale derivati filtrato', () => {
    const fa = filterRiskAnalysisByOptionLegs(analysis, { buckets: ['put_itm', 'call_itm'], expiries: [] });
    expect(derivativeExposureTotal(fa, toggles)).toBeCloseTo(10_000 + 1_500);
    expect(derivativeExposureTotal(fa, { ...toggles, includeNakedPut: false })).toBeCloseTo(1_500);
  });
});

describe('calculateNakedPutRisk', () => {
  it('senza resolver la gamba c\'è ma senza spot (non classificabile)', () => {
    const [d] = calculateNakedPutRisk([{ option: opt('ZZZ', 'put', 10, -1, '2026-12-18'), underlying: null, contracts: 1 }]);
    expect(d.legs).toEqual([{ optionType: 'put', strike: 10, expiry: '2026-12-18', spot: null }]);
  });
});
