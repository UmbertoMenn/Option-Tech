import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { rollableShortPutQty, rollExclusionReasons } from '@/lib/stressLabRollEligibility';
import { Position } from '@/types/portfolio';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'derivative',
    currency: 'USD', exchange_rate: 1, quantity: 0,
    current_price: 1, avg_cost: null, market_value: 100,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

function cfg(c: Partial<StrategyConfiguration>): StrategyConfiguration {
  return {
    id: 'cfg1', portfolio_id: 'pf1', underlying: 'NVDA',
    strategy_type: 'put_spread', position_signatures: [],
    is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [],
    sort_order: 0, config_locked: true, override_canceled_at: null, created_at: '', updated_at: '',
    ...c,
  };
}

// Config reale su NVDA: put spread 200/180 dic-26 (le gambe reali possono essere state rimosse dal virtuale)
const spreadCfg = cfg({
  position_signatures: [
    { option_type: 'put', strike: 200, expiry: '2026-12-18', quantity_sign: -1, quantity_abs: 1 },
    { option_type: 'put', strike: 180, expiry: '2026-12-18', quantity_sign: 1, quantity_abs: 1 },
  ],
});

describe('Portafoglio virtuale: posizioni aggiunte fuori dal vincolo delle configurazioni salvate', () => {
  it('proof-of-bug: una put venduta REALE non abbinata su sottostante configurato resta in "Altre strategie"', () => {
    const orphan = pos({ id: 'real1', option_type: 'put', quantity: -2, strike_price: 210, expiry_date: '2027-01-15', underlying: 'NVDA' });
    const cats = categorizeDerivatives([orphan], [orphan], [], [spreadCfg]);
    expect(cats.nakedPuts).toHaveLength(0);
    expect(rollExclusionReasons(cats).get('real1')).toMatch(/Altre strategie/);
  });

  it('put venduta VIRTUALE su sottostante configurato (gambe reali rimosse) → naked put, rollabile', () => {
    const gen = pos({ id: 'virtual:abc', option_type: 'put', quantity: -3, strike_price: 210, expiry_date: '2027-01-15', underlying: 'NVDA' });
    const cats = categorizeDerivatives([gen], [gen], [], [spreadCfg]);
    expect(cats.nakedPuts.map((n) => n.option.id)).toEqual(['virtual:abc']);
    expect(rollableShortPutQty(cats).get('virtual:abc')).toBe(3);
    expect(rollExclusionReasons(cats).has('virtual:abc')).toBe(false);
  });

  it('put virtuale con la stessa firma di una gamba configurata non viene adottata dalla config', () => {
    const gen = pos({ id: 'virtual:x', option_type: 'put', quantity: -1, strike_price: 200, expiry_date: '2026-12-18', underlying: 'NVDA' });
    const cats = categorizeDerivatives([gen], [gen], [], [spreadCfg]);
    expect(cats.nakedPuts.map((n) => n.option.id)).toEqual(['virtual:x']);
    expect(cats.incompleteStrategies.flatMap((i) => i.presentLegs.map((l) => l.id))).not.toContain('virtual:x');
  });

  it('gambe reali configurate restano nella loro strategia, le virtuali accanto sono naked put', () => {
    const sold = pos({ id: 'r-s', option_type: 'put', quantity: -1, strike_price: 200, expiry_date: '2026-12-18', underlying: 'NVDA' });
    const bought = pos({ id: 'r-b', option_type: 'put', quantity: 1, strike_price: 180, expiry_date: '2026-12-18', underlying: 'NVDA' });
    const gen1 = pos({ id: 'virtual:1', option_type: 'put', quantity: -2, strike_price: 215, expiry_date: '2027-01-15', underlying: 'NVDA' });
    const gen2 = pos({ id: 'virtual:2', option_type: 'put', quantity: -1, strike_price: 205, expiry_date: '2026-12-18', underlying: 'NVDA' });
    const all = [sold, bought, gen1, gen2];
    const cats = categorizeDerivatives(all, all, [], [spreadCfg]);
    expect(cats.nakedPuts.map((n) => n.option.id).sort()).toEqual(['virtual:1', 'virtual:2']);
    const spreadIds = cats.groupedOtherStrategies.flatMap((g) => g.options.map((o) => o.option.id.replace(/__.*$/, '')));
    expect(spreadIds.sort()).toEqual(['r-b', 'r-s']);
    const roll = rollableShortPutQty(cats);
    expect(roll.get('virtual:1')).toBe(2);
    expect(roll.get('virtual:2')).toBe(1);
    expect(roll.get('r-s')).toBe(1);
  });
});
