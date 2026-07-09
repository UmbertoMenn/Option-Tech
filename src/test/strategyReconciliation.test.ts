import { describe, it, expect } from 'vitest';
import { reconcileConfigs } from '@/lib/strategyReconciliation';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';

let posId = 0;
function makeOption(partial: Partial<Position> & { underlying: string; option_type: 'call' | 'put'; strike_price: number; expiry_date: string; quantity: number }): Position {
  return {
    id: `pos_${++posId}`,
    portfolio_id: 'pf1',
    description: `${partial.underlying} ${partial.option_type} ${partial.strike_price}`,
    asset_type: 'derivative',
    currency: 'USD',
    current_price: 1,
    market_value: 100,
    created_at: '',
    updated_at: '',
    ...partial,
  } as unknown as Position;
}

function makeConfig(partial: Partial<StrategyConfiguration> & { underlying: string; strategy_type: string; position_signatures: unknown[] }): StrategyConfiguration {
  return {
    id: `cfg_${partial.underlying}_${partial.strategy_type}`,
    portfolio_id: 'pf1',
    is_synthetic: false,
    linked_stock_id: null,
    linked_stock_slot_ids: [],
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  } as StrategyConfiguration;
}

describe('reconcileConfigs — regressione: config a firme vuote non deve essere invisibile', () => {
  it('covered call con position_signatures=[] genera comunque un item con la gamba "new" (bug produzione: prima veniva saltata interamente)', () => {
    const configs = [
      makeConfig({
        underlying: 'ADVANCED MICRO DEVIC',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_amd',
        position_signatures: [],
      }),
    ];
    const positions = [
      { id: 'stock_amd', asset_type: 'stock', description: 'ADVANCED MICRO DEVIC', ticker: 'AMD', quantity: 400 } as unknown as Position,
      makeOption({ underlying: 'AMD', option_type: 'call', strike_price: 520, expiry_date: '2027-12-17', quantity: -4 }),
    ];

    const items = reconcileConfigs(configs, positions);
    expect(items).toHaveLength(1);
    expect(items[0].legs).toHaveLength(1);
    expect(items[0].legs[0].status).toBe('new');
    expect(items[0].legs[0].signature.option_type).toBe('call');
    expect(items[0].legs[0].signature.strike).toBe(520);
  });

  it('config a firme vuote e nessuna posizione sul sottostante → nessun item (resta silenziosa, comportamento invariato)', () => {
    const configs = [
      makeConfig({
        underlying: 'COREWEAVE INC-CL A',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_crwv',
        position_signatures: [],
      }),
    ];
    const positions = [
      { id: 'stock_crwv', asset_type: 'stock', description: 'COREWEAVE INC-CL A', ticker: 'CRWV', quantity: 200 } as unknown as Position,
    ];

    const items = reconcileConfigs(configs, positions);
    expect(items).toHaveLength(0);
  });

  it('nome esteso azienda (config) e ticker (posizione) si raggruppano sotto la stessa chiave underlying', () => {
    const configs = [
      makeConfig({
        underlying: 'TESLA INC',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_tsla',
        position_signatures: [],
      }),
      makeConfig({
        underlying: 'TSLA',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 360, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      { id: 'stock_tsla', asset_type: 'stock', description: 'TESLA INC', ticker: 'TSLA', quantity: 200 } as unknown as Position,
      makeOption({ underlying: 'TSLA', option_type: 'put', strike_price: 360, expiry_date: '2026-07-17', quantity: -1 }),
      makeOption({ underlying: 'TSLA', option_type: 'call', strike_price: 480, expiry_date: '2027-12-17', quantity: -2 }),
    ];

    const items = reconcileConfigs(configs, positions);
    // reconcileConfigs non decide la destinazione finale (compito di
    // autoReconcileStrategies, testato a parte): genera un item "new" per
    // OGNI config del gruppo che non copre già quella posizione. Qui la
    // prova che conta è che entrambe le config (nome esteso e ticker)
    // siano finite nello STESSO gruppo underlying — prima del fix erano
    // due gruppi separati e la call non sarebbe mai comparsa come "new"
    // per la covered call.
    expect(items).toHaveLength(2);
    const ccItem = items.find(i => i.config.strategy_type === 'covered_call')!;
    expect(ccItem).toBeDefined();
    expect(ccItem.legs).toHaveLength(1);
    expect(ccItem.legs[0].status).toBe('new');
    expect(ccItem.legs[0].signature.strike).toBe(480);
    const npItem = items.find(i => i.config.strategy_type === 'naked_put')!;
    expect(npItem).toBeDefined();
    const npNewLeg = npItem.legs.find(l => l.status === 'new')!;
    expect(npNewLeg).toBeDefined();
    expect(npNewLeg.signature.option_type).toBe('call'); // vede anche lui la stessa call, non ancora attribuita
    const npPresentLeg = npItem.legs.find(l => l.status === 'present')!;
    expect(npPresentLeg.signature.option_type).toBe('put'); // la sua put originale resta intatta
  });
});
