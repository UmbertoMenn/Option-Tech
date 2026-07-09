import { describe, it, expect } from 'vitest';
import { autoReconcileStrategies } from '@/lib/strategyAutoReconcile';
import { reconcileConfigs } from '@/lib/strategyReconciliation';
import { StrategyConfiguration, PositionSignature } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';

let posId = 0;
function makeOption(partial: Partial<Position> & { underlying: string; option_type: 'call' | 'put'; strike_price: number; expiry_date: string; quantity: number }): Position {
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

function makeConfig(partial: Partial<StrategyConfiguration> & { underlying: string; strategy_type: string; position_signatures: PositionSignature[] }): StrategyConfiguration {
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

/** Helper: reconcile + auto-resolve in un colpo */
function run(configs: StrategyConfiguration[], positions: Position[]) {
  const items = reconcileConfigs(configs, positions);
  return autoReconcileStrategies(configs, items, positions);
}

describe('autoReconcileStrategies — roll di una gamba (caso dominante)', () => {
  it('naked put MU: roll P900 → P960 stessa scadenza (stesso caso del file movimenti reale)', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    // Nuovo snapshot: la P900 non c'è più, c'è la P960
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 960, expiry_date: '2026-08-21', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    expect(res.resolvedConfigs).toHaveLength(1);
    const sigs = res.resolvedConfigs![0].position_signatures;
    expect(sigs).toHaveLength(1);
    expect(sigs[0].strike).toBe(960);
    expect(sigs[0].expiry).toBe('2026-08-21');
    expect(sigs[0].quantity_sign).toBe(-1);
  });

  it('naked put WDC: roll con cambio scadenza P560 set → P540 ott', () => {
    const configs = [
      makeConfig({
        underlying: 'WDC',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 560, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'WDC', option_type: 'put', strike_price: 540, expiry_date: '2026-10-16', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    const sigs = res.resolvedConfigs![0].position_signatures;
    expect(sigs[0].strike).toBe(540);
    expect(sigs[0].expiry).toBe('2026-10-16');
  });

  it('due naked put stesso sottostante: appaiamento monotono per strike (nessun incrocio)', () => {
    const configs = [
      makeConfig({
        underlying: 'NVDA',
        strategy_type: 'naked_put',
        position_signatures: [
          { option_type: 'put', strike: 100, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'put', strike: 200, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
        ],
      }),
    ];
    // Entrambe rollate: 100→110, 200→210
    const positions = [
      makeOption({ underlying: 'NVDA', option_type: 'put', strike_price: 210, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'NVDA', option_type: 'put', strike_price: 110, expiry_date: '2026-09-18', quantity: -1 }),
    ];

    const res = run(configs, positions);
    const strikes = res.resolvedConfigs![0].position_signatures.map(s => s.strike).sort((a, b) => a - b);
    expect(strikes).toEqual([110, 210]);
    expect(res.unresolvedItems).toHaveLength(0);
  });

  it('ristrutturazione completa: Iron Condor richiuso su 4 strike nuovi = 4 roll simultanei', () => {
    const configs = [
      makeConfig({
        underlying: 'META',
        strategy_type: 'iron_condor',
        position_signatures: [
          { option_type: 'put', strike: 400, expiry: '2026-08-21', quantity_sign: 1, quantity_abs: 1 },
          { option_type: 'put', strike: 450, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'call', strike: 600, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'call', strike: 650, expiry: '2026-08-21', quantity_sign: 1, quantity_abs: 1 },
        ],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 420, expiry_date: '2026-10-16', quantity: 1 }),
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 470, expiry_date: '2026-10-16', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 620, expiry_date: '2026-10-16', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 670, expiry_date: '2026-10-16', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    const sigs = res.resolvedConfigs![0].position_signatures;
    expect(sigs).toHaveLength(4);
    // Ogni ruolo mantiene il proprio segno/tipo con il nuovo strike
    expect(sigs.find(s => s.option_type === 'put' && s.quantity_sign === 1)?.strike).toBe(420);
    expect(sigs.find(s => s.option_type === 'put' && s.quantity_sign === -1)?.strike).toBe(470);
    expect(sigs.find(s => s.option_type === 'call' && s.quantity_sign === -1)?.strike).toBe(620);
    expect(sigs.find(s => s.option_type === 'call' && s.quantity_sign === 1)?.strike).toBe(670);
  });
});

describe('autoReconcileStrategies — riduzioni e chiusure', () => {
  it('gamba scaduta/chiusa senza rimpiazzo viene rimossa dalla config', () => {
    const configs = [
      makeConfig({
        underlying: 'AAPL',
        strategy_type: 'derisking_covered_call',
        linked_stock_id: 'stock1',
        position_signatures: [
          { option_type: 'call', strike: 300, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'put', strike: 200, expiry: '2026-07-17', quantity_sign: 1, quantity_abs: 1 },
        ],
      }),
    ];
    // La put protettiva è scaduta, la call c'è ancora
    const positions = [
      makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 300, expiry_date: '2026-07-17', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    const sigs = res.resolvedConfigs![0].position_signatures;
    expect(sigs).toHaveLength(1);
    expect(sigs[0].option_type).toBe('call');
  });

  it('strategia interamente chiusa senza azioni collegate → config eliminata', () => {
    const configs = [
      makeConfig({
        underlying: 'RKLB',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 110, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 }],
      }),
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    // RKLB chiusa del tutto, MU ancora presente
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.resolvedConfigs).toHaveLength(1);
    expect(res.resolvedConfigs![0].underlying).toBe('MU');
  });

  it('covered call con azioni collegate sopravvive anche a call scaduta (stock-only CC)', () => {
    const configs = [
      makeConfig({
        underlying: 'CEG',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_ceg',
        position_signatures: [{ option_type: 'call', strike: 320, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions: Position[] = []; // call scaduta, niente derivati

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    // La config resta (con firme vuote), NON viene eliminata
    expect(res.resolvedConfigs).toHaveLength(1);
    expect(res.resolvedConfigs![0].position_signatures).toHaveLength(0);
    expect(res.resolvedConfigs![0].linked_stock_id).toBe('stock_ceg');
  });

  it('roll parziale: −3 contratti di cui 1 rollato → firma splittata (2 vecchi + 1 nuovo)', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 3 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -2 }),
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 960, expiry_date: '2026-08-21', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    const sigs = res.resolvedConfigs![0].position_signatures;
    const old = sigs.find(s => s.strike === 900)!;
    const rolled = sigs.find(s => s.strike === 960)!;
    expect(old.quantity_abs).toBe(2);
    expect(rolled.quantity_abs).toBe(1);
  });
});

describe('autoReconcileStrategies — aggiunte e nuovi sottostanti', () => {
  it('put venduta NON-roll su sottostante con una naked_put → NUOVA config separata (mai accodata)', () => {
    const configs = [
      makeConfig({
        underlying: 'MRVL',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 240, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MRVL', option_type: 'put', strike_price: 240, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'MRVL', option_type: 'put', strike_price: 220, expiry_date: '2026-10-16', quantity: -2 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    // Due config naked_put separate: quella originale intatta + la nuova
    const nps = res.resolvedConfigs!.filter(c => c.strategy_type === 'naked_put');
    expect(nps).toHaveLength(2);
    const original = nps.find(c => c.position_signatures.some(s => s.strike === 240))!;
    expect(original.position_signatures).toHaveLength(1);
    const created = nps.find(c => c.position_signatures.some(s => s.strike === 220))!;
    expect(created.position_signatures[0].quantity_abs).toBe(2);
  });

  it('put VENDUTA su sottostante con covered call → nuova config naked_put (mai dentro la CC)', () => {
    const stock = { id: 'stock_googl', asset_type: 'stock', description: 'ALPHABET INC', ticker: 'GOOGL', quantity: 100 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'GOOGL',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_googl',
        position_signatures: [{ option_type: 'call', strike: 200, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'GOOGL', option_type: 'put', strike_price: 150, expiry_date: '2026-10-16', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    const np = res.resolvedConfigs!.find(c => c.strategy_type === 'naked_put')!;
    expect(np).toBeDefined();
    expect(np.position_signatures[0].strike).toBe(150);
    // La CC resta intatta
    const cc = res.resolvedConfigs!.find(c => c.strategy_type === 'covered_call')!;
    expect(cc.position_signatures).toHaveLength(1);
  });

  it('put COMPRATA su sottostante con covered call → CC trasformata in de-risking', () => {
    const configs = [
      makeConfig({
        underlying: 'AAPL',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_aapl',
        position_signatures: [{ option_type: 'call', strike: 300, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 300, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 220, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    expect(res.unresolvedItems).toHaveLength(0);
    expect(res.resolvedConfigs).toHaveLength(1);
    const drcc = res.resolvedConfigs![0];
    expect(drcc.strategy_type).toBe('derisking_covered_call');
    expect(drcc.position_signatures).toHaveLength(2);
    expect(drcc.linked_stock_id).toBe('stock_aapl');
  });

  it('put COMPRATA su sottostante con naked put stessa scadenza → put_spread', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 800, expiry_date: '2026-08-21', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs![0].strategy_type).toBe('put_spread');
    expect(res.resolvedConfigs![0].position_signatures).toHaveLength(2);
  });

  it('put COMPRATA su naked put con scadenza diversa → diagonal_put_spread', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 800, expiry_date: '2026-12-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs![0].strategy_type).toBe('diagonal_put_spread');
  });

  it('call COMPRATA su sottostante configurato → config leap_call creata', () => {
    const stock = { id: 'stock_googl', asset_type: 'stock', description: 'ALPHABET INC', ticker: 'GOOGL', quantity: 100 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'GOOGL',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_googl',
        position_signatures: [{ option_type: 'call', strike: 200, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 200, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'GOOGL', option_type: 'call', strike_price: 180, expiry_date: '2027-01-15', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.unresolvedItems).toHaveLength(0);
    const leap = res.resolvedConfigs!.find(c => c.strategy_type === 'leap_call')!;
    expect(leap).toBeDefined();
    expect(leap.position_signatures[0].strike).toBe(180);
  });

  it('sottostante nuovo con sole put vendute → config naked_put creata automaticamente', () => {
    const configs: StrategyConfiguration[] = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      // Sottostante mai visto prima
      makeOption({ underlying: 'AMD', option_type: 'put', strike_price: 120, expiry_date: '2026-09-18', quantity: -2 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    const amd = res.resolvedConfigs!.find(c => c.underlying.includes('AMD'))!;
    expect(amd.strategy_type).toBe('naked_put');
    expect(amd.position_signatures[0].strike).toBe(120);
    expect(amd.position_signatures[0].quantity_abs).toBe(2);
  });

  it('sottostante nuovo con long call (es. IREN/APLD del file reale) → leap_call automatica', () => {
    const configs: StrategyConfiguration[] = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      makeOption({ underlying: 'IREN', option_type: 'call', strike_price: 80, expiry_date: '2028-01-21', quantity: 2 }),
    ];

    const res = run(configs, positions);
    expect(res.unresolvedItems).toHaveLength(0);
    const iren = res.resolvedConfigs!.find(c => c.underlying.includes('IREN'))!;
    expect(iren.strategy_type).toBe('leap_call');
    expect(iren.position_signatures[0].quantity_abs).toBe(2);
  });

  it('sottostante nuovo put spread completo (venduta+comprata stessa scadenza) → put_spread', () => {
    const configs: StrategyConfiguration[] = [];
    const positions = [
      makeOption({ underlying: 'TSLA', option_type: 'put', strike_price: 400, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'TSLA', option_type: 'put', strike_price: 350, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const tsla = res.resolvedConfigs!.find(c => c.underlying.includes('TSLA'))!;
    expect(tsla.strategy_type).toBe('put_spread');
    expect(tsla.position_signatures).toHaveLength(2);
  });

  it('sottostante nuovo con 4 ruoli stessa scadenza → iron_condor', () => {
    const configs: StrategyConfiguration[] = [];
    const positions = [
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 400, expiry_date: '2026-09-18', quantity: 1 }),
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 450, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 600, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 650, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const meta = res.resolvedConfigs!.find(c => c.underlying.includes('META'))!;
    expect(meta.strategy_type).toBe('iron_condor');
    expect(meta.position_signatures).toHaveLength(4);
  });

  it('sottostante nuovo con 4 ruoli su scadenze miste → double_diagonal', () => {
    const configs: StrategyConfiguration[] = [];
    const positions = [
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 400, expiry_date: '2026-12-18', quantity: 1 }),
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 450, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 600, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'META', option_type: 'call', strike_price: 650, expiry_date: '2026-12-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const meta = res.resolvedConfigs!.find(c => c.underlying.includes('META'))!;
    expect(meta.strategy_type).toBe('double_diagonal');
  });

  it('sottostante nuovo call venduta con azione in portafoglio → covered_call linkata', () => {
    const stock = { id: 'stock_ceg', asset_type: 'stock', description: 'CONSTELLATION ENERGY', ticker: 'CEG', quantity: 100 } as unknown as Position;
    const configs: StrategyConfiguration[] = [];
    const positions = [
      stock,
      makeOption({ underlying: 'CEG', option_type: 'call', strike_price: 320, expiry_date: '2026-09-18', quantity: -1 }),
    ];

    const res = run(configs, positions);
    const ceg = res.resolvedConfigs!.find(c => c.underlying.includes('CEG'))!;
    expect(ceg.strategy_type).toBe('covered_call');
    expect(ceg.linked_stock_id).toBe('stock_ceg');
  });

  it('combinazione non riconosciuta su sottostante nuovo → config other (mai al dialog)', () => {
    const configs: StrategyConfiguration[] = [];
    // Call venduta senza azione in portafoglio: non classificabile con certezza
    const positions = [
      makeOption({ underlying: 'XYZ', option_type: 'call', strike_price: 50, expiry_date: '2026-09-18', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.unresolvedItems).toHaveLength(0);
    const xyz = res.resolvedConfigs!.find(c => c.underlying.includes('XYZ'))!;
    expect(xyz.strategy_type).toBe('other');
  });
});

describe('autoReconcileStrategies — regole concordate (rounds interattivi)', () => {
  it('R2: retype sempre — IC che degrada a una sola put venduta → naked_put', () => {
    const configs = [
      makeConfig({
        underlying: 'META',
        strategy_type: 'iron_condor',
        position_signatures: [
          { option_type: 'put', strike: 400, expiry: '2026-08-21', quantity_sign: 1, quantity_abs: 1 },
          { option_type: 'put', strike: 450, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'call', strike: 600, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'call', strike: 650, expiry: '2026-08-21', quantity_sign: 1, quantity_abs: 1 },
        ],
      }),
    ];
    // Restano solo la put venduta (rollata su nuovo strike): le altre 3 gambe chiuse
    const positions = [
      makeOption({ underlying: 'META', option_type: 'put', strike_price: 430, expiry_date: '2026-10-16', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs).toHaveLength(1);
    expect(res.resolvedConfigs![0].strategy_type).toBe('naked_put');
    expect(res.resolvedConfigs![0].position_signatures[0].strike).toBe(430);
  });

  it('R2: retype — naked put + put comprata → put_spread via riclassificazione', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 800, expiry_date: '2026-08-21', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs![0].strategy_type).toBe('put_spread');
    expect(res.resolvedConfigs![0].position_signatures).toHaveLength(2);
  });

  it('R4: roll con aumento di quantità — contratti extra nella STESSA strategia', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    // Chiudo 1 P900, apro 2 P960: roll 1 + aumento 1
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 960, expiry_date: '2026-08-21', quantity: -2 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs).toHaveLength(1);
    const sigs = res.resolvedConfigs![0].position_signatures;
    expect(sigs).toHaveLength(1);
    expect(sigs[0].strike).toBe(960);
    expect(sigs[0].quantity_abs).toBe(2); // roll + aumento, stessa strategia
  });

  it('R5: put comprata standalone senza strategie sul sottostante → config protection', () => {
    const configs: StrategyConfiguration[] = [];
    const positions = [
      makeOption({ underlying: 'NKE', option_type: 'put', strike_price: 90, expiry_date: '2026-12-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const nke = res.resolvedConfigs!.find(c => c.underlying.includes('NKE'))!;
    expect(nke.strategy_type).toBe('protection');
  });

  it('R7: seconda put comprata su de-risking con copertura PARZIALE → accorpata', () => {
    const stock = { id: 'stock_aapl', asset_type: 'stock', description: 'APPLE INC', ticker: 'AAPL', quantity: 300 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'AAPL',
        strategy_type: 'derisking_covered_call',
        linked_stock_id: 'stock_aapl',
        position_signatures: [
          { option_type: 'call', strike: 300, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 3 },
          { option_type: 'put', strike: 220, expiry: '2026-09-18', quantity_sign: 1, quantity_abs: 1 }, // copre 1/3
        ],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 300, expiry_date: '2026-09-18', quantity: -3 }),
      makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 220, expiry_date: '2026-09-18', quantity: 1 }),
      // Seconda put comprata: la copertura era parziale (1 su 3) → accorpa
      makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 215, expiry_date: '2026-10-16', quantity: 1 }),
    ];

    const res = run(configs, positions);
    expect(res.resolvedConfigs).toHaveLength(1);
    const drcc = res.resolvedConfigs![0];
    expect(drcc.strategy_type).toBe('derisking_covered_call');
    expect(drcc.position_signatures.filter(s => s.option_type === 'put' && s.quantity_sign === 1)).toHaveLength(2);
  });

  it('R7: put comprata su de-risking con copertura COMPLETA → config protection separata', () => {
    const stock = { id: 'stock_aapl', asset_type: 'stock', description: 'APPLE INC', ticker: 'AAPL', quantity: 100 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'AAPL',
        strategy_type: 'derisking_covered_call',
        linked_stock_id: 'stock_aapl',
        position_signatures: [
          { option_type: 'call', strike: 300, expiry: '2026-09-18', quantity_sign: -1, quantity_abs: 1 },
          { option_type: 'put', strike: 220, expiry: '2026-09-18', quantity_sign: 1, quantity_abs: 1 }, // copre 100/100 azioni
        ],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'AAPL', option_type: 'call', strike_price: 300, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 220, expiry_date: '2026-09-18', quantity: 1 }),
      makeOption({ underlying: 'AAPL', option_type: 'put', strike_price: 200, expiry_date: '2026-12-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const protection = res.resolvedConfigs!.find(c => c.strategy_type === 'protection')!;
    expect(protection).toBeDefined();
    expect(protection.position_signatures[0].strike).toBe(200);
    // La de-risking resta con la sua unica protezione
    const drcc = res.resolvedConfigs!.find(c => c.strategy_type === 'derisking_covered_call')!;
    expect(drcc.position_signatures.filter(s => s.option_type === 'put')).toHaveLength(1);
  });

  it('R9: coppia call venduta + call comprata insieme → config call_spread unica', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
      makeOption({ underlying: 'MU', option_type: 'call', strike_price: 1100, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'MU', option_type: 'call', strike_price: 1200, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const cs = res.resolvedConfigs!.find(c => c.strategy_type === 'call_spread')!;
    expect(cs).toBeDefined();
    expect(cs.position_signatures).toHaveLength(2);
    // La naked put originale resta intatta
    const np = res.resolvedConfigs!.find(c => c.strategy_type === 'naked_put')!;
    expect(np.position_signatures).toHaveLength(1);
  });

  it('R13: coppia spread con quantità diverse (2V+1C) → spread 1+1, il resto naked put', () => {
    const configs: StrategyConfiguration[] = [];
    const positions = [
      makeOption({ underlying: 'TSLA', option_type: 'put', strike_price: 400, expiry_date: '2026-09-18', quantity: -2 }),
      makeOption({ underlying: 'TSLA', option_type: 'put', strike_price: 350, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const spread = res.resolvedConfigs!.find(c => c.strategy_type === 'put_spread')!;
    expect(spread.position_signatures.find(s => s.quantity_sign === -1)?.quantity_abs).toBe(1);
    expect(spread.position_signatures.find(s => s.quantity_sign === 1)?.quantity_abs).toBe(1);
    const np = res.resolvedConfigs!.find(c => c.strategy_type === 'naked_put')!;
    expect(np.position_signatures[0].quantity_abs).toBe(1);
    expect(np.position_signatures[0].strike).toBe(400);
  });

  it('R14: call comprata non-roll con leap_call esistente → nuova config leap_call separata', () => {
    const configs = [
      makeConfig({
        underlying: 'IREN',
        strategy_type: 'leap_call',
        position_signatures: [{ option_type: 'call', strike: 80, expiry: '2028-01-21', quantity_sign: 1, quantity_abs: 2 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'IREN', option_type: 'call', strike_price: 80, expiry_date: '2028-01-21', quantity: 2 }),
      makeOption({ underlying: 'IREN', option_type: 'call', strike_price: 100, expiry_date: '2028-06-16', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const leaps = res.resolvedConfigs!.filter(c => c.strategy_type === 'leap_call');
    expect(leaps).toHaveLength(2);
  });

  it('call venduta + put comprata su sottostante nuovo con azione → covered call che diventa de-risking', () => {
    const stock = { id: 'stock_ceg', asset_type: 'stock', description: 'CONSTELLATION ENERGY', ticker: 'CEG', quantity: 100 } as unknown as Position;
    const configs: StrategyConfiguration[] = [];
    const positions = [
      stock,
      makeOption({ underlying: 'CEG', option_type: 'call', strike_price: 320, expiry_date: '2026-09-18', quantity: -1 }),
      makeOption({ underlying: 'CEG', option_type: 'put', strike_price: 250, expiry_date: '2026-09-18', quantity: 1 }),
    ];

    const res = run(configs, positions);
    const ceg = res.resolvedConfigs!.find(c => c.underlying.includes('CEG'))!;
    expect(ceg.strategy_type).toBe('derisking_covered_call');
    expect(ceg.linked_stock_id).toBe('stock_ceg');
    expect(ceg.position_signatures).toHaveLength(2);
  });
});

describe('autoReconcileStrategies — bug reale: covered call salvata col nome esteso azienda', () => {
  // Riproduce esattamente il caso trovato in produzione: la covered call ha
  // underlying="ADVANCED MICRO DEVIC" (nome esteso, da stock.description) e
  // firme vuote, mentre la call venduta reale arriva con underlying="AMD"
  // (ticker, dal descrittore opzione). Senza il resolver canonico condiviso,
  // le due finiscono in gruppi "underlying" diversi e non si incontrano mai.
  it('call venduta con underlying=ticker si aggancia alla covered call salvata con underlying=nome esteso', () => {
    const stock = { id: 'stock_amd', asset_type: 'stock', description: 'ADVANCED MICRO DEVIC', ticker: 'AMD', quantity: 400 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'ADVANCED MICRO DEVIC', // nome esteso, come in produzione
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_amd',
        position_signatures: [], // vuota: la call è "sparita" perché mai stata qui
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'AMD', option_type: 'call', strike_price: 520, expiry_date: '2027-12-17', quantity: -4 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(true);
    // Deve esserci UNA sola config covered_call con la gamba, non una
    // 'other' separata: l'azione collegata deve far riconoscere lo stesso
    // sottostante nonostante i due testi diversi.
    const cc = res.resolvedConfigs!.find(c => c.strategy_type === 'covered_call')!;
    expect(cc).toBeDefined();
    expect(cc.position_signatures).toHaveLength(1);
    expect(cc.position_signatures[0].strike).toBe(520);
    expect(res.resolvedConfigs!.some(c => c.strategy_type === 'other')).toBe(false);
  });

  it('azione collegata SENZA ticker popolato → risoluzione per nome via resolver canonico', () => {
    // Caso limite realistico: il ticker della posizione azionaria non è
    // stato risolto (capita con alcuni broker/asset esotici), resta solo
    // la descrizione estesa. Deve comunque risolvere allo stesso ticker
    // canonico del descrittore opzione.
    const stock = { id: 'stock_tsla', asset_type: 'stock', description: 'TESLA INC', ticker: null, quantity: 200 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'TESLA INC',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_tsla',
        position_signatures: [],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'TSLA', option_type: 'call', strike_price: 480, expiry_date: '2027-12-17', quantity: -2 }),
    ];

    const res = run(configs, positions);
    const cc = res.resolvedConfigs!.find(c => c.strategy_type === 'covered_call')!;
    expect(cc).toBeDefined();
    expect(cc.position_signatures).toHaveLength(1);
    expect(res.resolvedConfigs!.some(c => c.strategy_type === 'other')).toBe(false);
  });
});

describe('autoReconcileStrategies — risoluzione via underlying_mappings (no alias statico)', () => {
  it('PGR: covered call "PROGRESSIVE CORP" si aggancia alla call venduta "PGR" tramite mappa dinamica (PGR NON è più nella lista statica)', () => {
    // Prova che la corrispondenza nome-esteso→ticker arriva da
    // underlying_mappings, non dalla lista hardcoded. Se questo test passa
    // senza PGR nella lista statica, il resolver dinamico funziona.
    const dynamicAliases = new Map<string, string>([
      ['PROGRESSIVE CORP', 'PGR'],
      ['PROGRESSIVE', 'PGR'],
    ]);
    const stock = { id: 'stock_pgr', asset_type: 'stock', description: 'PROGRESSIVE CORP', ticker: null, quantity: 200 } as unknown as Position;
    const configs = [
      makeConfig({
        underlying: 'PROGRESSIVE CORP',
        strategy_type: 'covered_call',
        linked_stock_id: 'stock_pgr',
        position_signatures: [],
      }),
    ];
    const positions = [
      stock,
      makeOption({ underlying: 'PGR', option_type: 'call', strike_price: 220, expiry_date: '2026-09-18', quantity: -2 }),
    ];

    const items = reconcileConfigs(configs, positions, dynamicAliases);
    const res = autoReconcileStrategies(configs, items, positions, undefined, dynamicAliases);
    const cc = res.resolvedConfigs!.find(c => c.strategy_type === 'covered_call')!;
    expect(cc).toBeDefined();
    expect(cc.position_signatures).toHaveLength(1);
    expect(cc.position_signatures[0].strike).toBe(220);
    expect(res.resolvedConfigs!.some(c => c.strategy_type === 'other')).toBe(false);
  });
});

describe('autoReconcileStrategies — nessuna modifica', () => {
  it('config allineate allo snapshot → nessuna azione', () => {
    const configs = [
      makeConfig({
        underlying: 'MU',
        strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 900, expiry: '2026-08-21', quantity_sign: -1, quantity_abs: 1 }],
      }),
    ];
    const positions = [
      makeOption({ underlying: 'MU', option_type: 'put', strike_price: 900, expiry_date: '2026-08-21', quantity: -1 }),
    ];

    const res = run(configs, positions);
    expect(res.hasAutoChanges).toBe(false);
    expect(res.resolvedConfigs).toBeNull();
    expect(res.unresolvedItems).toHaveLength(0);
  });
});
