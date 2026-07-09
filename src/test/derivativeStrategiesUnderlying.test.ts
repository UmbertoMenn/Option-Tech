import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';

let pid = 0;
function opt(partial: Partial<Position> & { underlying: string; option_type: 'call' | 'put'; strike_price: number; expiry_date: string; quantity: number }): Position {
  return {
    id: `opt_${++pid}`,
    portfolio_id: 'pf1',
    description: `[${partial.underlying}][x][${partial.option_type === 'call' ? 'C' : 'P'}][${partial.strike_price}]`,
    asset_type: 'derivative',
    ticker: null,
    currency: 'USD',
    current_price: 1,
    market_value: 100,
    created_at: '', updated_at: '',
    ...partial,
  } as unknown as Position;
}

function stock(id: string, description: string, ticker: string | null, quantity: number): Position {
  return {
    id, portfolio_id: 'pf1', description, ticker, asset_type: 'stock',
    underlying: null, currency: 'USD', current_price: 1, market_value: quantity * 100,
    quantity, created_at: '', updated_at: '',
  } as unknown as Position;
}

function cfg(partial: Partial<StrategyConfiguration> & { underlying: string; strategy_type: string }): StrategyConfiguration {
  return {
    id: `cfg_${partial.underlying}_${partial.strategy_type}`,
    portfolio_id: 'pf1',
    position_signatures: [],
    is_synthetic: false,
    linked_stock_id: null,
    linked_stock_slot_ids: [],
    sort_order: 0,
    created_at: '', updated_at: '',
    ...partial,
  } as StrategyConfiguration;
}

const dynamicAliases = new Map<string, string>([
  ['ADVANCED MICRO DEVIC', 'AMD'],
  ['ADVANCED MICRO DEVICES', 'AMD'],
  ['CONSTELLATION ENERGY', 'CEG'],
  ['PROGRESSIVE CORP', 'PGR'],
]);

describe('categorizeDerivatives — bug produzione: covered call col nome esteso azienda', () => {
  it('AMD: covered call vuota "ADVANCED MICRO DEVIC" + azione(ticker AMD) + call venduta(underlying AMD) → CC completa, non incompleta', () => {
    const configs = [
      cfg({ underlying: 'ADVANCED MICRO DEVIC', strategy_type: 'covered_call', linked_stock_id: 'stk_amd' }),
    ];
    const amdStock = stock('stk_amd', 'ADVANCED MICRO DEVIC', 'AMD', 400);
    const soldCall = opt({ underlying: 'AMD', option_type: 'call', strike_price: 520, expiry_date: '2027-12-17', quantity: -4 });
    const positions = [amdStock, soldCall];

    const cats = categorizeDerivatives([soldCall], positions, [], configs, { dynamicAliases });

    // La call venduta deve stare nella covered call, completa
    expect(cats.coveredCalls).toHaveLength(1);
    const cc = cats.coveredCalls[0];
    expect(cc.option.id).toBe(soldCall.id);
    expect(cc.incomplete).toBeFalsy();
    // Non deve finire in "Altre Strategie"
    expect(cats.otherStrategies.some(o => o.option.id === soldCall.id)).toBe(false);
    // Nessuna strategia incompleta con "gamba mancante"
    expect(cats.incompleteStrategies).toHaveLength(0);
  });

  it('linked_stock col ticker risolve la config anche senza dynamicAliases (segnale prioritario + adozione short call)', () => {
    const configs = [
      cfg({ underlying: 'ADVANCED MICRO DEVIC', strategy_type: 'covered_call', linked_stock_id: 'stk_amd' }),
    ];
    const amdStock = stock('stk_amd', 'ADVANCED MICRO DEVIC', 'AMD', 400);
    const soldCall = opt({ underlying: 'AMD', option_type: 'call', strike_price: 520, expiry_date: '2027-12-17', quantity: -4 });

    // Il linked_stock (ticker AMD) risolve la config a "AMD" anche senza
    // mappe: è il segnale prioritario del resolver. L'adozione della short
    // call libera completa la CC.
    const cats = categorizeDerivatives([soldCall], [amdStock, soldCall], [], configs);
    expect(cats.coveredCalls).toHaveLength(1);
    expect(cats.coveredCalls[0].incomplete).toBeFalsy();
    expect(cats.incompleteStrategies).toHaveLength(0);
  });

  it('CEG: covered call (azione + call venduta) coesiste con LEAP call comprata e naked put, senza mescolarle', () => {
    // Riproduce lo scenario CEG reale: 100 azioni, call venduta 300, call
    // comprata 580 (LEAP), put vendute. La call venduta 300 con le 100
    // azioni è una covered call; la 580 comprata è una leap separata.
    const cegStock = stock('stk_ceg', 'CONSTELLATION ENERGY', 'CEG', 100);
    const soldCall300 = opt({ underlying: 'CEG', option_type: 'call', strike_price: 300, expiry_date: '2026-07-17', quantity: -1 });
    const boughtCall580 = opt({ underlying: 'CEG', option_type: 'call', strike_price: 580, expiry_date: '2027-01-15', quantity: 2 });
    const soldPut250 = opt({ underlying: 'CEG', option_type: 'put', strike_price: 250, expiry_date: '2026-07-17', quantity: -1 });

    const configs = [
      cfg({ underlying: 'CONSTELLATION ENERGY', strategy_type: 'covered_call', linked_stock_id: 'stk_ceg',
        position_signatures: [{ option_type: 'call', strike: 300, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 }] as never }),
      cfg({ underlying: 'CEG', strategy_type: 'leap_call',
        position_signatures: [{ option_type: 'call', strike: 580, expiry: '2027-01-15', quantity_sign: 1, quantity_abs: 2 }] as never }),
      cfg({ underlying: 'CEG', strategy_type: 'naked_put',
        position_signatures: [{ option_type: 'put', strike: 250, expiry: '2026-07-17', quantity_sign: -1, quantity_abs: 1 }] as never }),
    ];
    const derivs = [soldCall300, boughtCall580, soldPut250];
    const cats = categorizeDerivatives(derivs, [cegStock, ...derivs], [], configs, { dynamicAliases });

    // Covered call: la call venduta 300
    expect(cats.coveredCalls).toHaveLength(1);
    expect(cats.coveredCalls[0].option.strike_price).toBe(300);
    expect(cats.coveredCalls[0].incomplete).toBeFalsy();
    // LEAP: la call comprata 580
    expect(cats.leapCalls.some(l => l.option.strike_price === 580)).toBe(true);
    // Naked put: la put venduta 250
    expect(cats.nakedPuts.some(n => n.option.strike_price === 250)).toBe(true);
    // La call venduta 300 NON deve finire in leap né in other
    expect(cats.leapCalls.some(l => l.option.strike_price === 300)).toBe(false);
    expect(cats.otherStrategies.some(o => o.option.strike_price === 300)).toBe(false);
  });

  it('CoreWeave: CC stock-only GENUINA (nessuna call da nessuna parte) resta incompleta, non adotta nulla', () => {
    const configs = [
      cfg({ underlying: 'COREWEAVE INC-CL A', strategy_type: 'covered_call', linked_stock_id: 'stk_crwv' }),
    ];
    const crwvStock = stock('stk_crwv', 'COREWEAVE INC-CL A', 'CRWV', 200);
    const otherPut = opt({ underlying: 'CRWV', option_type: 'put', strike_price: 90, expiry_date: '2026-08-21', quantity: -1 });

    const cats = categorizeDerivatives([otherPut], [crwvStock, otherPut], [], configs, { dynamicAliases });
    expect(cats.coveredCalls.filter(c => !c.incomplete)).toHaveLength(0);
    expect(cats.incompleteStrategies.some(s => s.missingLegs.includes('Short Call'))).toBe(true);
    expect(cats.coveredCalls.some(c => c.option.id === otherPut.id)).toBe(false);
  });
});
