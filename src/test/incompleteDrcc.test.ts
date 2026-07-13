import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

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

function cfg(c: Partial<StrategyConfiguration>): StrategyConfiguration {
  return {
    id: 'cfg1', portfolio_id: 'pf1', underlying: 'CEG',
    strategy_type: 'derisking_covered_call', position_signatures: [],
    is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [],
    sort_order: 0, created_at: '', updated_at: '',
    ...c,
  };
}

describe('categorizeDerivatives — DR-CC incompleta (gamba mancante)', () => {
  it('DR-CC non sintetica senza Long Put resta DR-CC incompleta, NON diventa Covered Call', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const shortCall = pos({ option_type: 'call', quantity: -1, strike_price: 320, expiry_date: '2026-12-18',
      underlying: 'CEG', ticker: 'CEG', current_price: 10 });
    const config = cfg({
      strategy_type: 'derisking_covered_call', underlying: 'CEG', linked_stock_id: stock.id,
      position_signatures: [{ option_type: 'call', strike: 320, expiry: '2026-12-18', quantity_sign: -1, quantity_abs: 1 }],
    });

    const cats = categorizeDerivatives([shortCall], [stock, shortCall], [], [config]);

    expect(cats.deRiskingCoveredCalls.length).toBe(1);
    expect(cats.deRiskingCoveredCalls[0].incomplete).toBe(true);
    expect(cats.deRiskingCoveredCalls[0].missingLegs).toContain('Long Put');
    expect(cats.deRiskingCoveredCalls[0].protectionPut).toBeUndefined();
    // NON deve essere finita tra le Covered Call
    expect(cats.coveredCalls.length).toBe(0);
    // E deve comparire tra le incomplete (per il display unificato), con la call come gamba presente
    const inc = cats.incompleteStrategies.filter(i => i.strategyType === 'derisking_covered_call');
    expect(inc.length).toBe(1);
    expect(inc[0].missingLegs).toContain('Long Put');
    expect(inc[0].presentLegs.some(l => l.option_type === 'call')).toBe(true);
  });

  it('DR-CC completa (call + put) NON è marcata incompleta', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const shortCall = pos({ option_type: 'call', quantity: -1, strike_price: 320, expiry_date: '2026-12-18',
      underlying: 'CEG', ticker: 'CEG', current_price: 10 });
    const longPut = pos({ option_type: 'put', quantity: 1, strike_price: 250, expiry_date: '2026-12-18',
      underlying: 'CEG', ticker: 'CEG', current_price: 6 });
    const config = cfg({
      linked_stock_id: stock.id,
      position_signatures: [
        { option_type: 'call', strike: 320, expiry: '2026-12-18', quantity_sign: -1, quantity_abs: 1 },
        { option_type: 'put', strike: 250, expiry: '2026-12-18', quantity_sign: 1, quantity_abs: 1 },
      ],
    });

    const cats = categorizeDerivatives([shortCall, longPut], [stock, shortCall, longPut], [], [config]);

    expect(cats.deRiskingCoveredCalls.length).toBe(1);
    expect(cats.deRiskingCoveredCalls[0].incomplete ?? false).toBe(false);
    expect(cats.deRiskingCoveredCalls[0].protectionPut?.strike_price).toBe(250);
  });

  it('senza configurazione, azione + short call + long put diventa DR-CC', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const shortCall = pos({ option_type: 'call', quantity: -1, strike_price: 320, expiry_date: '2026-12-18', underlying: 'CEG' });
    const longPut = pos({ option_type: 'put', quantity: 1, strike_price: 250, expiry_date: '2026-12-18', underlying: 'CEG' });

    const cats = categorizeDerivatives([shortCall, longPut], [stock, shortCall, longPut], [], []);

    expect(cats.deRiskingCoveredCalls).toHaveLength(1);
    expect(cats.deRiskingCoveredCalls[0].protectionPut?.id).toBe(longPut.id);
    expect(cats.coveredCalls).toHaveLength(0);
    expect(cats.longPuts).toHaveLength(0);
  });
});
