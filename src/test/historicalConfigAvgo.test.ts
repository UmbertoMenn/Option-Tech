/**
 * Caso reale andreaz, snapshot 07/09/2026: AVGO P360 set-26 venduta −2, config congelata
 * naked put per 1 contratto → il 2° contratto finiva in "Altre strategie (non abbinata)"
 * ed era escluso dal rolling. Con la config corretta a 2 contratti entrambe sono idonee.
 */
import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { rollableShortPutQty, rollExclusionReasons } from '@/lib/stressLabRollEligibility';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';
import { replaceHistoricalConfigs } from '@/lib/historicalConfigEdit';
import type { Position } from '@/types/portfolio';
import type { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

const PID = '6d84937c-4fdd-474d-89cf-717784aa1b8d';
const put = (id: string, K: number, q: number, px: number): Position =>
  ({
    id, portfolio_id: PID, asset_type: 'derivative', currency: 'USD', exchange_rate: 1.162,
    description: `Broadcom Inc OPTION PUT ${K} SEP/26`, underlying: 'Broadcom Inc', option_type: 'put',
    strike_price: K, expiry_date: '2026-09-18', quantity: q, current_price: px, snapshot_price: px,
    market_value: (Math.abs(q) * px * 100) / 1.162, snapshot_market_value: (Math.abs(q) * px * 100) / 1.162,
    avg_cost: px, ticker: null, isin: null,
  }) as unknown as Position;

const positions = [
  put('c78473b1', 380, -1, 24.725),
  put('53d4d7c8', 360, -2, 11.05),
  put('e4ada52a', 330, -1, 1.45),
  put('a1b280d8', 370, -1, 17.35),
];
const cfg = (id: string, K: number, qty: number, sort: number): StrategyConfiguration => ({
  id, portfolio_id: PID, underlying: 'AVGO', strategy_type: 'naked_put',
  position_signatures: [{ option_type: 'put', strike: K, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: qty }],
  is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [], sort_order: sort, config_locked: false,
  override_canceled_at: null, created_at: '2026-09-07T12:27:02Z', updated_at: '2026-09-07T12:27:02Z',
});
const frozen = [cfg('a', 370, 1, 28), cfg('b', 360, 1, 29), cfg('c', 380, 1, 68), cfg('d', 330, 1, 69)];
const aliases = buildDynamicAliasMap([{ underlying: 'Broadcom Inc', ticker: 'AVGO' }]);
const classify = (configs: StrategyConfiguration[]) => {
  const cats = categorizeDerivatives(positions, positions, [], configs, { dynamicAliases: aliases });
  return { qty: rollableShortPutQty(cats), why: rollExclusionReasons(cats) };
};
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('snapshot 07/09 andreaz — AVGO P360 set-26', () => {
  it('config congelata (1 contratto): il secondo contratto è escluso dal rolling', () => {
    const { qty, why } = classify(frozen);
    expect(sum(qty)).toBe(4); // 5 contratti venduti, 4 idonei
    expect(qty.get("53d4d7c8")).toBe(1);
    expect([...why.values()].some((w) => /non abbinata/.test(w))).toBe(true);
  });

  it('config corretta nello snapshot (2 contratti): tutte idonee, nessuna esclusione', () => {
    const corrected = replaceHistoricalConfigs(
      [cfg('a', 370, 1, 28), cfg('b', 360, 2, 29), cfg('c', 380, 1, 68), cfg('d', 330, 1, 69)],
      PID, '2026-11-10T14:30:00.000Z', () => crypto.randomUUID(),
    );
    const { qty, why } = classify(corrected);
    expect(sum(qty)).toBe(5);
    expect(qty.get("53d4d7c8")).toBe(2);
    expect(why.size).toBe(0);
  });
});
