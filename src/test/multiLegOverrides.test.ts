import { describe, expect, it } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { Position } from '@/types/portfolio';

function option(id: string, option_type: 'call' | 'put', quantity: number, strike_price: number): Position {
  return {
    id, portfolio_id: 'pf1', isin: null, ticker: 'X', description: `X ${option_type} ${strike_price}`,
    asset_type: 'derivative', currency: 'USD', exchange_rate: 1, quantity, current_price: 1,
    avg_cost: null, market_value: 10, profit_loss: 1, profit_loss_pct: null, weight_pct: null,
    option_type, strike_price, expiry_date: '2026-12-18', underlying: 'X',
    snapshot_price: null, snapshot_market_value: null, created_at: '', updated_at: '',
  };
}

describe('categorizeDerivatives — multi-leg override', () => {
  it('honors an iron condor override before automatic classification', () => {
    const soldPut = option('sp', 'put', -1, 80);
    const boughtPut = option('bp', 'put', 1, 70);
    const soldCall = option('sc', 'call', -1, 120);
    const boughtCall = option('bc', 'call', 1, 130);
    const override: DerivativeOverride = {
      id: 'override', portfolio_id: 'pf1', override_type: 'multi_leg', strategy_type: 'iron_condor',
      sold_put_id: soldPut.id, bought_put_id: boughtPut.id, sold_call_id: soldCall.id, bought_call_id: boughtCall.id,
      created_at: '', updated_at: '',
    };

    const categories = categorizeDerivatives([soldPut, boughtPut, soldCall, boughtCall], [soldPut, boughtPut, soldCall, boughtCall], [override], []);

    expect(categories.ironCondors).toHaveLength(1);
    expect(categories.ironCondors[0].soldPut.id).toBe(soldPut.id);
    expect(categories.nakedPuts).toHaveLength(0);
    expect(categories.otherStrategies).toHaveLength(0);
  });
});
