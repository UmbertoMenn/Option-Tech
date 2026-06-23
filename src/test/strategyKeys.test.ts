import { describe, it, expect } from 'vitest';
import {
  formatExpiryKey,
  nakedPutKey,
  nakedPutKeyForPosition,
  isSoldPut,
} from '@/lib/strategyKeys';
import { Position } from '@/types/portfolio';

function makePut(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    portfolio_id: 'ptf-1',
    isin: null,
    ticker: 'AMZN',
    description: 'AMZN PUT',
    asset_type: 'derivative',
    currency: 'USD',
    exchange_rate: 1.16,
    quantity: -1,
    current_price: 3,
    avg_cost: 5,
    market_value: -300,
    profit_loss: null,
    profit_loss_pct: null,
    weight_pct: null,
    option_type: 'put',
    strike_price: 180,
    expiry_date: '2026-01-16',
    underlying: 'AMZN',
    snapshot_price: null,
    snapshot_market_value: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('strategyKeys', () => {
  it('formatExpiryKey produces YYYYMM, or noexp', () => {
    expect(formatExpiryKey('2026-01-16')).toBe('202601');
    expect(formatExpiryKey('2026-12-31')).toBe('202612');
    expect(formatExpiryKey(null)).toBe('noexp');
    expect(formatExpiryKey(undefined)).toBe('noexp');
  });

  it('nakedPutKey matches the strategy_cache format np_{underlying}_{strike}_{YYYYMM}', () => {
    expect(nakedPutKey('AMZN', 180, '2026-01-16')).toBe('np_AMZN_180_202601');
    // strike falsy → 0 (mirrors `strike || 0` in strategyCache)
    expect(nakedPutKey('AMZN', null, '2026-01-16')).toBe('np_AMZN_0_202601');
  });

  it('nakedPutKeyForPosition uses underlying, then description', () => {
    expect(nakedPutKeyForPosition(makePut())).toBe('np_AMZN_180_202601');
    expect(
      nakedPutKeyForPosition(makePut({ underlying: null, description: 'CRM' })),
    ).toBe('np_CRM_180_202601');
  });

  it('key is stable across re-imports (independent of volatile id/price)', () => {
    const a = nakedPutKeyForPosition(makePut({ id: 'uuid-A', current_price: 2 }));
    const b = nakedPutKeyForPosition(makePut({ id: 'uuid-B', current_price: 9 }));
    expect(a).toBe(b);
  });

  it('isSoldPut: only short puts qualify', () => {
    expect(isSoldPut(makePut({ quantity: -2 }))).toBe(true);
    expect(isSoldPut(makePut({ quantity: 1 }))).toBe(false); // long put
    expect(isSoldPut(makePut({ option_type: 'call', quantity: -1 }))).toBe(false);
  });
});

describe('roll-up gating decision', () => {
  // Mirrors the edge-function branch: a flagged strategy_key fires the dedicated
  // roll-up alerts and suppresses the standard naked-put ones.
  function pickAlertTypes(strategyKey: string, rollUpKeys: Set<string>) {
    const isRollUp = rollUpKeys.has(strategyKey);
    return {
      action: isRollUp ? 'action_put_roll_up_otm' : 'action_naked_put_itm',
      dist: isRollUp ? 'distance_put_roll_up' : 'distance_naked_put',
    };
  }

  it('flagged put → roll-up alert types (critical on OTM)', () => {
    const key = nakedPutKeyForPosition(makePut());
    const flags = new Set([key]);
    expect(pickAlertTypes(key, flags)).toEqual({
      action: 'action_put_roll_up_otm',
      dist: 'distance_put_roll_up',
    });
  });

  it('un-flagged put → standard naked-put alert types', () => {
    const key = nakedPutKeyForPosition(makePut());
    expect(pickAlertTypes(key, new Set())).toEqual({
      action: 'action_naked_put_itm',
      dist: 'distance_naked_put',
    });
  });
});
