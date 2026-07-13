/**
 * Tests for exported utility functions from StrategyConfigWizard:
 * - autoClassify
 * - buildSignatures
 * - buildConfigsFromStrategies
 * - WizardStrategy
 *
 * These tests cover Bug 2 (config_locked comparison) and ensure auto-classify
 * produces the correct UpsertConfigParams shape.
 */
import { describe, it, expect } from 'vitest';
import {
  autoClassify,
  buildSignatures,
  buildConfigsFromStrategies,
  WizardStrategy,
} from '@/components/derivatives/StrategyConfigWizard';
import { Position } from '@/types/portfolio';

let posId = 0;
function makeOption(
  partial: Partial<Position> & {
    underlying: string;
    option_type: 'call' | 'put';
    strike_price: number;
    expiry_date: string;
    quantity: number;
  },
): Position {
  return {
    id: `pos_${++posId}`,
    portfolio_id: 'pf1',
    isin: undefined,
    ticker: undefined,
    description: `${partial.underlying} ${partial.option_type} ${partial.strike_price}`,
    asset_type: 'derivative',
    currency: 'USD',
    current_price: 1,
    avg_cost: undefined,
    market_value: 100,
    profit_loss: undefined,
    profit_loss_pct: undefined,
    weight_pct: undefined,
    created_at: '',
    updated_at: '',
    ...partial,
  } as unknown as Position;
}

function makeStock(partial: Partial<Position> & { description: string; quantity: number }): Position {
  return {
    id: `pos_${++posId}`,
    portfolio_id: 'pf1',
    isin: undefined,
    ticker: partial.description,
    description: partial.description,
    asset_type: 'stock',
    currency: 'USD',
    current_price: 100,
    avg_cost: undefined,
    market_value: partial.quantity * 100,
    profit_loss: undefined,
    profit_loss_pct: undefined,
    weight_pct: undefined,
    created_at: '',
    updated_at: '',
    ...partial,
  } as unknown as Position;
}

// ---------------------------------------------------------------------------
// buildSignatures
// ---------------------------------------------------------------------------
describe('buildSignatures', () => {
  it('produces correct signature for a single naked put', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const sigs = buildSignatures([put]);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({
      option_type: 'put',
      strike: 80,
      expiry: '2026-06-20',
      quantity_sign: -1,
      quantity_abs: 1,
    });
  });

  it('ignores stock positions — only derivative legs in signatures', () => {
    const stock = makeStock({ description: 'MU', quantity: 100 });
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const sigs = buildSignatures([stock, put]);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].option_type).toBe('put');
  });

  it('accumulates quantity_abs for multiple contracts of the same leg', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -3 });
    const sigs = buildSignatures([put]);
    expect(sigs[0].quantity_abs).toBe(3);
  });

  it('produces separate signatures for different legs', () => {
    const soldCall = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const boughtCall = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 210, expiry_date: '2026-06-20', quantity: 1 });
    const soldPut = makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 180, expiry_date: '2026-06-20', quantity: -1 });
    const boughtPut = makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 170, expiry_date: '2026-06-20', quantity: 1 });
    const sigs = buildSignatures([soldCall, boughtCall, soldPut, boughtPut]);
    expect(sigs).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// autoClassify
// ---------------------------------------------------------------------------
describe('autoClassify', () => {
  it('classifies a single naked put', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const strategies = autoClassify([put], [put]);
    expect(strategies).toHaveLength(1);
    expect(strategies[0].strategyType).toBe('naked_put');
    expect(strategies[0].positions).toContainEqual(expect.objectContaining({ id: put.id }));
  });

  it('classifies a covered call (short call + stock)', () => {
    const stock = makeStock({ description: 'AAPL', quantity: 100 });
    const call = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const allPositions = [stock, call];
    const strategies = autoClassify([call], allPositions);
    expect(strategies).toHaveLength(1);
    expect(strategies[0].strategyType).toBe('covered_call');
  });

  it('excludes archived underlyings', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const strategies = autoClassify([put], [put], ['MU']);
    expect(strategies).toHaveLength(0);
  });

  it('classifies an iron condor (4 legs, same expiry)', () => {
    const soldCall = makeOption({ underlying: 'SPY', option_type: 'call', strike_price: 570, expiry_date: '2026-06-20', quantity: -1 });
    const boughtCall = makeOption({ underlying: 'SPY', option_type: 'call', strike_price: 580, expiry_date: '2026-06-20', quantity: 1 });
    const soldPut = makeOption({ underlying: 'SPY', option_type: 'put', strike_price: 520, expiry_date: '2026-06-20', quantity: -1 });
    const boughtPut = makeOption({ underlying: 'SPY', option_type: 'put', strike_price: 510, expiry_date: '2026-06-20', quantity: 1 });
    const legs = [soldCall, boughtCall, soldPut, boughtPut];
    const strategies = autoClassify(legs, legs);
    expect(strategies).toHaveLength(1);
    expect(strategies[0].strategyType).toBe('iron_condor');
  });
});

// ---------------------------------------------------------------------------
// buildConfigsFromStrategies
// ---------------------------------------------------------------------------
describe('buildConfigsFromStrategies', () => {
  it('converts a naked put strategy to UpsertConfigParams', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const strategy: WizardStrategy = {
      id: 'ws-1',
      positions: [put],
      strategyType: 'naked_put',
      isSynthetic: false,
      suggestedType: 'naked_put',
    };
    const configs = buildConfigsFromStrategies([strategy]);
    expect(configs).toHaveLength(1);
    const cfg = configs[0];
    expect(cfg.underlying).toBe('MU');
    expect(cfg.strategy_type).toBe('naked_put');
    expect(cfg.position_signatures).toHaveLength(1);
    expect(cfg.position_signatures[0]).toMatchObject({
      option_type: 'put',
      strike: 80,
      expiry: '2026-06-20',
      quantity_sign: -1,
    });
    expect(cfg.linked_stock_id).toBeNull();
    expect(cfg.sort_order).toBe(0);
  });

  it('sets linked_stock_id from stock position', () => {
    const stock = makeStock({ description: 'AAPL', quantity: 100 });
    const call = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const strategy: WizardStrategy = {
      id: 'ws-2',
      positions: [stock, call],
      strategyType: 'covered_call',
      isSynthetic: false,
      suggestedType: 'covered_call',
    };
    const configs = buildConfigsFromStrategies([strategy]);
    expect(configs[0].linked_stock_id).toBe(stock.id);
    expect(configs[0].linked_stock_slot_ids).toContain(stock.id);
  });

  it('assigns increasing sort_order values', () => {
    const put1 = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const put2 = makeOption({ underlying: 'NVDA', option_type: 'put', strike_price: 100, expiry_date: '2026-06-20', quantity: -1 });
    const strategies: WizardStrategy[] = [
      { id: 'ws-1', positions: [put1], strategyType: 'naked_put', isSynthetic: false, suggestedType: 'naked_put' },
      { id: 'ws-2', positions: [put2], strategyType: 'naked_put', isSynthetic: false, suggestedType: 'naked_put' },
    ];
    const configs = buildConfigsFromStrategies(strategies);
    expect(configs[0].sort_order).toBe(0);
    expect(configs[1].sort_order).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Auto-classify + buildConfigsFromStrategies round-trip
// (simulates Bug 2: saved config should match auto-classify → config_locked=false)
// ---------------------------------------------------------------------------
describe('autoClassify → buildConfigsFromStrategies round-trip', () => {
  it('auto-classify and build produce consistent underlying and signatures', () => {
    const put = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const strategies = autoClassify([put], [put]);
    expect(strategies).toHaveLength(1);

    const configs = buildConfigsFromStrategies(strategies);
    expect(configs).toHaveLength(1);
    expect(configs[0].underlying).toBe('MU');
    expect(configs[0].strategy_type).toBe('naked_put');
    expect(configs[0].position_signatures).toHaveLength(1);
    expect(configs[0].position_signatures[0]).toMatchObject({
      option_type: 'put',
      strike: 80,
      expiry: '2026-06-20',
      quantity_sign: -1,
      quantity_abs: 1,
    });
  });

  it('two identical auto-classify runs produce matching configs', () => {
    const put = makeOption({ underlying: 'NVDA', option_type: 'put', strike_price: 100, expiry_date: '2026-09-19', quantity: -2 });
    const run1 = buildConfigsFromStrategies(autoClassify([put], [put]));
    const run2 = buildConfigsFromStrategies(autoClassify([put], [put]));
    expect(run1).toHaveLength(1);
    expect(run2).toHaveLength(1);
    // Same underlying, strategy_type, and signatures — no override
    expect(run1[0].underlying).toBe(run2[0].underlying);
    expect(run1[0].strategy_type).toBe(run2[0].strategy_type);
    expect(run1[0].position_signatures).toEqual(run2[0].position_signatures);
  });
});
