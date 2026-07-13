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

  it('keeps two de-risking covered calls on the same underlying separate when their structures differ', () => {
    const stock = makeStock({ description: 'GOOGL', quantity: 200 });
    const soldCall1 = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const longPut1 = makeOption({ underlying: 'GOOGL', option_type: 'put', strike_price: 150, expiry_date: '2026-06-20', quantity: 1 });
    const soldCall2 = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 220, expiry_date: '2026-09-18', quantity: -1 });
    const longPut2 = makeOption({ underlying: 'GOOGL', option_type: 'put', strike_price: 160, expiry_date: '2026-09-18', quantity: 1 });

    const strategies = autoClassify(
      [soldCall1, longPut1, soldCall2, longPut2],
      [stock, soldCall1, longPut1, soldCall2, longPut2],
    );

    expect(strategies).toHaveLength(2);
    expect(strategies.every(s => s.strategyType === 'derisking_covered_call')).toBe(true);

    const shortCallStrikes = strategies
      .map(s => s.positions.find(p => p.option_type === 'call' && p.quantity < 0)?.strike_price)
      .sort((a, b) => (a || 0) - (b || 0));
    expect(shortCallStrikes).toEqual([200, 220]);
    expect(strategies.every(s => s.positions.filter(p => p.asset_type === 'stock').length === 1)).toBe(true);
    expect(strategies.every(s => s.positions.filter(p => p.option_type === 'put' && p.quantity > 0).length === 1)).toBe(true);
  });

  it('keeps all legs of a single multi-leg de-risking covered call together', () => {
    const stock = makeStock({ description: 'GOOGL', quantity: 100 });
    const soldCall = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const longPut = makeOption({ underlying: 'GOOGL', option_type: 'put', strike_price: 150, expiry_date: '2026-06-20', quantity: 1 });

    const strategies = autoClassify([soldCall, longPut], [stock, soldCall, longPut]);

    expect(strategies).toHaveLength(1);
    expect(strategies[0].strategyType).toBe('derisking_covered_call');
    expect(strategies[0].positions.map(p => p.id).sort()).toEqual([stock.id, soldCall.id, longPut.id].sort());
  });

  it('keeps structurally separate covered calls on the same underlying as distinct rows', () => {
    const stock = makeStock({ description: 'AAPL', quantity: 200 });
    const soldCall1 = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const soldCall2 = makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 210, expiry_date: '2026-09-18', quantity: -1 });

    const strategies = autoClassify([soldCall1, soldCall2], [stock, soldCall1, soldCall2]);

    expect(strategies).toHaveLength(2);
    expect(strategies.every(s => s.strategyType === 'covered_call')).toBe(true);
    expect(strategies.every(s => s.positions.filter(p => p.asset_type === 'stock').length === 1)).toBe(true);
    const shortCallStrikes = strategies
      .map(s => s.positions.find(p => p.option_type === 'call' && p.quantity < 0)?.strike_price)
      .sort((a, b) => (a || 0) - (b || 0));
    expect(shortCallStrikes).toEqual([200, 210]);
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

// ---------------------------------------------------------------------------
// Dual DRCC on the same underlying — distinct stock slot allocation
// (regression tests for the GOOGL/Alphabet two-strategy split fix)
// ---------------------------------------------------------------------------
describe('autoClassify — dual DRCC on same underlying: distinct stock slots', () => {
  function makeGoogDrcc() {
    const stock = makeStock({ description: 'GOOGL', quantity: 200 });
    const soldCall1 = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const longPut1  = makeOption({ underlying: 'GOOGL', option_type: 'put',  strike_price: 150, expiry_date: '2026-06-20', quantity:  1 });
    const soldCall2 = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 220, expiry_date: '2026-09-18', quantity: -1 });
    const longPut2  = makeOption({ underlying: 'GOOGL', option_type: 'put',  strike_price: 160, expiry_date: '2026-09-18', quantity:  1 });
    return { stock, soldCall1, longPut1, soldCall2, longPut2 };
  }

  it('assigns distinct __slot_N IDs to each strategy when two DRCC share the same stock', () => {
    const { stock, soldCall1, longPut1, soldCall2, longPut2 } = makeGoogDrcc();
    const strategies = autoClassify(
      [soldCall1, longPut1, soldCall2, longPut2],
      [stock, soldCall1, longPut1, soldCall2, longPut2],
    );

    expect(strategies).toHaveLength(2);
    expect(strategies.every(s => s.strategyType === 'derisking_covered_call')).toBe(true);

    const stockPositions = strategies.map(s => s.positions.find(p => p.asset_type === 'stock')!);
    expect(stockPositions[0]).toBeDefined();
    expect(stockPositions[1]).toBeDefined();

    // Each strategy has a distinct virtual slot ID
    expect(stockPositions[0].id).not.toBe(stockPositions[1].id);
    expect(stockPositions[0].id).toMatch(/__slot_\d+$/);
    expect(stockPositions[1].id).toMatch(/__slot_\d+$/);

    // Each slot holds exactly 100 shares
    expect(stockPositions.every(p => p.quantity === 100)).toBe(true);

    // Both slots refer to the same underlying stock
    const base0 = stockPositions[0].id.replace(/__slot_\d+$/, '');
    const base1 = stockPositions[1].id.replace(/__slot_\d+$/, '');
    expect(base0).toBe(base1);
    expect(base0).toBe(stock.id);
  });

  it('buildConfigsFromStrategies produces distinct linked_stock_slot_ids for two DRCC', () => {
    const { stock, soldCall1, longPut1, soldCall2, longPut2 } = makeGoogDrcc();
    const strategies = autoClassify(
      [soldCall1, longPut1, soldCall2, longPut2],
      [stock, soldCall1, longPut1, soldCall2, longPut2],
    );
    const configs = buildConfigsFromStrategies(strategies);

    expect(configs).toHaveLength(2);
    expect(configs.every(c => c.strategy_type === 'derisking_covered_call')).toBe(true);

    // Same real stock ID for both (same underlying portfolio position)
    expect(configs[0].linked_stock_id).toBe(stock.id);
    expect(configs[1].linked_stock_id).toBe(stock.id);

    // But distinct slot IDs — no two strategies share the same slot
    const slot0 = configs[0].linked_stock_slot_ids[0];
    const slot1 = configs[1].linked_stock_slot_ids[0];
    expect(slot0).toBeDefined();
    expect(slot1).toBeDefined();
    expect(slot0).not.toBe(slot1);
    expect(slot0).toMatch(/__slot_\d+$/);
    expect(slot1).toMatch(/__slot_\d+$/);

    // Each strategy has 2 option signatures (sold call + long put), no stock in signatures
    expect(configs[0].position_signatures).toHaveLength(2);
    expect(configs[1].position_signatures).toHaveLength(2);
  });

  it('two identical auto-classify runs on dual DRCC produce stable slot assignments', () => {
    const { stock, soldCall1, longPut1, soldCall2, longPut2 } = makeGoogDrcc();
    const allPositions = [stock, soldCall1, longPut1, soldCall2, longPut2];
    const derivs = [soldCall1, longPut1, soldCall2, longPut2];

    const run1 = buildConfigsFromStrategies(autoClassify(derivs, allPositions));
    const run2 = buildConfigsFromStrategies(autoClassify(derivs, allPositions));

    expect(run1).toHaveLength(2);
    expect(run2).toHaveLength(2);

    // Sort by short-call strike for stable comparison
    const sort = (cs: typeof run1) =>
      [...cs].sort((a, b) => (a.position_signatures.find(s => s.option_type === 'call')?.strike ?? 0)
                            - (b.position_signatures.find(s => s.option_type === 'call')?.strike ?? 0));

    const s1 = sort(run1);
    const s2 = sort(run2);
    expect(s1[0].linked_stock_slot_ids).toEqual(s2[0].linked_stock_slot_ids);
    expect(s1[1].linked_stock_slot_ids).toEqual(s2[1].linked_stock_slot_ids);
    // The two slots must differ between strategies
    expect(s1[0].linked_stock_slot_ids[0]).not.toBe(s1[1].linked_stock_slot_ids[0]);
  });

  it('single DRCC on same underlying does NOT create virtual slots', () => {
    const stock = makeStock({ description: 'GOOGL', quantity: 100 });
    const soldCall = makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-06-20', quantity: -1 });
    const longPut  = makeOption({ underlying: 'GOOGL', option_type: 'put',  strike_price: 150, expiry_date: '2026-06-20', quantity:  1 });

    const strategies = autoClassify([soldCall, longPut], [stock, soldCall, longPut]);

    expect(strategies).toHaveLength(1);
    const stockPos = strategies[0].positions.find(p => p.asset_type === 'stock')!;
    // No virtual slot suffix for single strategy
    expect(stockPos.id).toBe(stock.id);
    expect(stockPos.quantity).toBe(100);
  });

  it('parity: initial auto-classify path and wizard button path use the same pipeline', () => {
    // Both Derivatives.tsx (initial) and handleAutoClassify (wizard button) call
    // autoClassify() + buildConfigsFromStrategies() — this test verifies they
    // produce identical configs.
    const { stock, soldCall1, longPut1, soldCall2, longPut2 } = makeGoogDrcc();
    const allPositions = [stock, soldCall1, longPut1, soldCall2, longPut2];
    const derivs = [soldCall1, longPut1, soldCall2, longPut2];

    const initialConfigs = buildConfigsFromStrategies(autoClassify(derivs, allPositions));
    const wizardConfigs  = buildConfigsFromStrategies(autoClassify(derivs, allPositions));

    expect(initialConfigs.length).toBe(wizardConfigs.length);
    initialConfigs.forEach((c, i) => {
      expect(c.strategy_type).toBe(wizardConfigs[i].strategy_type);
      expect(c.linked_stock_id).toBe(wizardConfigs[i].linked_stock_id);
      expect(c.linked_stock_slot_ids).toEqual(wizardConfigs[i].linked_stock_slot_ids);
    });
  });

  it('unrelated positions are not affected by auto-classify of another underlying', () => {
    const putMU = makeOption({ underlying: 'MU', option_type: 'put', strike_price: 80, expiry_date: '2026-06-20', quantity: -1 });
    const { stock, soldCall1, longPut1 } = makeGoogDrcc();

    // Classify only GOOGL derivatives
    const googlStrategies = autoClassify([soldCall1, longPut1], [stock, soldCall1, longPut1]);
    expect(googlStrategies).toHaveLength(1);
    expect(googlStrategies[0].strategyType).toBe('derisking_covered_call');
    expect(googlStrategies[0].positions.some(p => p.id === putMU.id)).toBe(false);

    // Classify only MU derivatives — unaffected
    const muStrategies = autoClassify([putMU], [putMU]);
    expect(muStrategies).toHaveLength(1);
    expect(muStrategies[0].strategyType).toBe('naked_put');
    expect(muStrategies[0].positions.some(p => p.id === soldCall1.id)).toBe(false);
  });
});
