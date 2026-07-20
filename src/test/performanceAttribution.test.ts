import { describe, expect, it } from 'vitest';
import { FullSnapshot } from '@/lib/fullSnapshot';
import { calculatePerformanceAttribution } from '@/lib/performanceAttribution';
import { splitOptionPremium } from '@/lib/optionTradeAttribution';
import { HistoricalDataEntry } from '@/types/historicalData';
import { Position } from '@/types/portfolio';

function position(overrides: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null,
    ticker: null,
    description: '',
    asset_type: 'stock',
    currency: 'EUR',
    exchange_rate: 1,
    quantity: 0,
    current_price: null,
    avg_cost: null,
    market_value: null,
    profit_loss: null,
    profit_loss_pct: null,
    weight_pct: null,
    option_type: null,
    strike_price: null,
    expiry_date: null,
    underlying: null,
    snapshot_price: null,
    snapshot_market_value: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function snapshot(date: string, cash: number, positions: Position[] = [], gpHoldings: FullSnapshot['gp_holdings'] = []): FullSnapshot {
  return {
    portfolio_id: 'pf1',
    snapshot_date: date,
    positions,
    strategy_configurations: [],
    derivative_overrides: [],
    gp_holdings: gpHoldings,
    cash_value: cash,
    gp_total_value: null,
  };
}

function historical(date: string, netting: number, spots: Record<string, number> = {}): HistoricalDataEntry {
  return {
    id: date,
    portfolio_id: 'pf1',
    snapshot_date: date,
    total_value: netting,
    netting_total: netting,
    netting_ex_cc: netting,
    netting_ex_cc_np: netting,
    netting_intrinsic_b: netting,
    deposits: 0,
    average_balance: 0,
    equity_exposure_pct: 0,
    usd_exposure_pct: 0,
    snapshot_underlying_prices: spots,
    created_at: '',
    updated_at: '',
  };
}

function itemAmount(result: ReturnType<typeof calculatePerformanceAttribution>, category: string): number {
  return result.items.find(item => item.category === category)?.amount ?? 0;
}

describe('splitOptionPremium', () => {
  it('separa la PUT Microsoft ITM dell’esempio: 30 intrinseco e 3 tempo', () => {
    const split = splitOptionPremium('put', 420, 33, 390);
    expect(split.intrinsicPerShare).toBe(30);
    expect(split.timeValuePerShare).toBe(3);
    expect(split.intrinsicCappedToPremium).toBe(false);
  });

  it('preserva sempre la riconciliazione anche con prezzo sottostante stale', () => {
    const split = splitOptionPremium('put', 420, 25, 390);
    expect(split.intrinsicPerShare + split.timeValuePerShare).toBe(25);
    expect(split.intrinsicCappedToPremium).toBe(true);
  });
});

describe('calculatePerformanceAttribution', () => {
  it('non registra utile al momento dell’apertura della short PUT', () => {
    const startHistorical = historical('2026-07-01', 10_000, { MSFT: 390 });
    const endHistorical = historical('2026-07-02', 10_000, { MSFT: 390 });
    const shortPut = position({
      asset_type: 'derivative',
      ticker: 'MSFT',
      underlying: 'MSFT',
      option_type: 'put',
      strike_price: 420,
      expiry_date: '2026-09-18',
      quantity: -1,
      snapshot_price: 33,
    });
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-01', 10_000),
      endSnapshot: snapshot('2026-07-02', 13_300, [shortPut]),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [{
        basis_key: 'OPT:MSFT:P:420:2026-09-18',
        trade_date: '2026-07-02',
        side: 'VEN',
        quantity: 1,
        price: 33,
        asset_type: 'derivative',
        underlying_key: 'MSFT',
        option_type: 'put',
        strike: 420,
        exchange_rate: 1,
        underlying_price: 390,
        intrinsic_per_share: 30,
        time_value_per_share: 3,
        attribution_price_source: 'exact_trade_date',
      }],
      internalTransfers: [],
    });

    expect(result.totalPL).toBe(0);
    expect(itemAmount(result, 'option_time')).toBeCloseTo(0, 6);
    expect(itemAmount(result, 'option_intrinsic')).toBeCloseTo(0, 6);
    expect(result.coverage.exactOptionTrades).toBe(1);
  });

  it('attribuisce a premio temporale maturato il decadimento da 33 a 30', () => {
    const startHistorical = historical('2026-07-02', 10_000, { MSFT: 390 });
    const endHistorical = historical('2026-07-10', 10_300, { MSFT: 390 });
    const putAt = (premium: number) => position({
      asset_type: 'derivative',
      ticker: 'MSFT',
      underlying: 'MSFT',
      option_type: 'put',
      strike_price: 420,
      expiry_date: '2026-09-18',
      quantity: -1,
      snapshot_price: premium,
    });
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-02', 13_300, [putAt(33)]),
      endSnapshot: snapshot('2026-07-10', 13_300, [putAt(30)]),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [],
      internalTransfers: [],
    });

    expect(result.totalPL).toBe(300);
    expect(itemAmount(result, 'option_time')).toBeCloseTo(300, 6);
    expect(itemAmount(result, 'option_intrinsic')).toBeCloseTo(0, 6);
  });

  it('neutralizza acquisti di azioni: il trasferimento cash→azioni non è rendimento', () => {
    const startHistorical = historical('2026-07-01', 10_000);
    const endHistorical = historical('2026-07-02', 10_000);
    const stock = position({
      asset_type: 'stock',
      isin: 'US5949181045',
      ticker: 'MSFT',
      quantity: 10,
      snapshot_market_value: 5_000,
    });
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-01', 10_000),
      endSnapshot: snapshot('2026-07-02', 5_000, [stock]),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [{
        basis_key: 'US5949181045',
        trade_date: '2026-07-02',
        side: 'ACQ',
        quantity: 10,
        price: 500,
        asset_type: 'stock',
        gross_eur: 5_000,
      }],
      internalTransfers: [],
    });

    expect(result.totalPL).toBe(0);
    expect(itemAmount(result, 'stock')).toBeCloseTo(0, 6);
    expect(itemAmount(result, 'cash')).toBeCloseTo(0, 6);
  });

  it('neutralizza il giroconto cash→GP e riconcilia esattamente il totale', () => {
    const startHistorical = historical('2026-07-01', 10_000);
    const endHistorical = historical('2026-07-02', 10_000);
    const gpHolding = {
      id: 'gp1', portfolio_id: 'pf1', asset_type: 'cash', description: 'GP',
      quantity: 1, market_value: 5_000, price: null, currency: 'EUR', exchange_rate: 1,
      weight_pct: null, ticker_code: null, price_date: '2026-07-02', created_at: '', updated_at: '',
    };
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-01', 10_000),
      endSnapshot: snapshot('2026-07-02', 5_000, [], [gpHolding]),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [],
      internalTransfers: [{
        debit_date: '2026-07-02',
        credit_date: '2026-07-02',
        amount_eur: 5_000,
        from_gp: false,
        to_gp: true,
      }],
    });

    expect(itemAmount(result, 'gp')).toBeCloseTo(0, 6);
    expect(itemAmount(result, 'cash')).toBeCloseTo(0, 6);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(result.totalPL, 6);
  });

  it('tratta l’assegnazione PUT come trasferimento intrinseco→azioni, senza falso rendimento', () => {
    const startHistorical = historical('2026-07-17', 7_000, { MSFT: 390 });
    const endHistorical = historical('2026-07-18', 7_000, { MSFT: 390 });
    const shortPut = position({
      asset_type: 'derivative', ticker: 'MSFT', underlying: 'MSFT',
      option_type: 'put', strike_price: 420, expiry_date: '2026-07-17',
      quantity: -1, snapshot_price: 30,
    });
    const assignedStock = position({
      asset_type: 'stock', isin: 'US5949181045', ticker: 'MSFT', quantity: 100,
      snapshot_price: 390, snapshot_market_value: 39_000,
    });
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-17', 10_000, [shortPut]),
      endSnapshot: snapshot('2026-07-18', -32_000, [assignedStock]),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [{
        basis_key: 'US5949181045', trade_date: '2026-07-18', side: 'ASG',
        kind: 'expiry_assignment', quantity: 100, price: 420,
        asset_type: 'stock', underlying_key: 'MSFT', option_type: 'put', strike: 420,
        exchange_rate: 1, underlying_price: 390, intrinsic_per_share: 30,
        time_value_per_share: 0, attribution_price_source: 'snapshot_proxy',
      }],
      internalTransfers: [],
    });

    expect(result.totalPL).toBe(0);
    expect(itemAmount(result, 'option_intrinsic')).toBeCloseTo(0, 6);
    expect(itemAmount(result, 'stock')).toBeCloseTo(0, 6);
    expect(itemAmount(result, 'cash')).toBeCloseTo(0, 6);
  });

  it('espone il residuo quando Netting e dettaglio posizioni non riconciliano', () => {
    const startHistorical = historical('2026-07-01', 100);
    const endHistorical = historical('2026-07-02', 120);
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-01', 100),
      // Il dettaglio disponibile spiega soltanto 10 €, mentre il Netting ne
      // riporta 20: la differenza non va più nascosta in “Non attribuito”.
      endSnapshot: snapshot('2026-07-02', 110),
      startHistorical,
      endHistorical,
      allHistoricalData: [startHistorical, endHistorical],
      deposits: [],
      trades: [],
      internalTransfers: [],
    });

    expect(itemAmount(result, 'cash')).toBeCloseTo(10, 6);
    expect(itemAmount(result, 'reconciliation_gap')).toBeCloseTo(10, 6);
    expect(itemAmount(result, 'unclassified')).toBeCloseTo(0, 6);
    expect(result.warnings.some(warning => warning.includes('residuo'))).toBe(true);
  });
});
