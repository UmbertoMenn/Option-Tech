import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { computeMonitoring } from '@/lib/monitoringEngine';
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
    strategy_type: 'covered_call', position_signatures: [],
    is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [],
    sort_order: 0, created_at: '', updated_at: '',
    ...c,
  };
}

describe('categorizeDerivatives — CC/DR-CC con sola gamba azionaria', () => {
  it('Covered Call salvata con sole azioni (nessuna call venduta) diventa strategia incompleta con "Short Call" mancante', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const config = cfg({
      strategy_type: 'covered_call', underlying: 'CEG', linked_stock_id: stock.id,
      linked_stock_slot_ids: [stock.id], position_signatures: [],
    });

    const cats = categorizeDerivatives([], [stock], [], [config]);

    expect(cats.coveredCalls.length).toBe(0);
    const inc = cats.incompleteStrategies.filter(i => i.strategyType === 'covered_call');
    expect(inc.length).toBe(1);
    expect(inc[0].missingLegs).toContain('Short Call');
    expect(inc[0].linkedStock?.id).toBe(stock.id);
  });

  it('De-Risking CC salvata con sole azioni diventa strategia incompleta con "Short Call" (e "Long Put") mancanti', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const config = cfg({
      strategy_type: 'derisking_covered_call', underlying: 'CEG', linked_stock_id: stock.id,
      linked_stock_slot_ids: [stock.id], position_signatures: [],
    });

    const cats = categorizeDerivatives([], [stock], [], [config]);

    expect(cats.deRiskingCoveredCalls.length).toBe(0);
    const inc = cats.incompleteStrategies.filter(i => i.strategyType === 'derisking_covered_call');
    expect(inc.length).toBe(1);
    expect(inc[0].missingLegs).toContain('Short Call');
    expect(inc[0].missingLegs).toContain('Long Put');
  });

  it('CC stock-only resta visibile come incompleta anche se linked_stock_id è obsoleto ma underlying combacia', () => {
    const stock = pos({ id: 'stock-amd', asset_type: 'stock', ticker: 'AMD', description: 'ADVANCED MICRO DEVIC', quantity: 400, current_price: 170 });
    const config = cfg({
      strategy_type: 'covered_call',
      underlying: 'ADVANCED MICRO DEVIC',
      linked_stock_id: 'stock-non-piu-valido',
      linked_stock_slot_ids: [],
      position_signatures: [],
    });

    const cats = categorizeDerivatives([], [stock], [], [config]);

    const inc = cats.incompleteStrategies.filter(i => i.strategyType === 'covered_call');
    expect(inc.length).toBe(1);
    expect(inc[0].missingLegs).toContain('Short Call');
    expect(inc[0].linkedStock?.id).toBe(stock.id);
  });

  it('CC stock-only adotta una short call aggregata senza duplicarla in altre categorie', () => {
    const stock = pos({ id: 'stock-amd', asset_type: 'stock', ticker: 'AMD', description: 'ADVANCED MICRO DEVIC', quantity: 400, current_price: 170 });
    const shortCall = pos({
      id: 'opt-amd-c520',
      option_type: 'call',
      quantity: -4,
      strike_price: 520,
      expiry_date: '2027-12-17',
      underlying: 'AMD',
      ticker: 'AMD',
      current_price: 10,
    });
    const config = cfg({
      strategy_type: 'covered_call',
      underlying: 'ADVANCED MICRO DEVIC',
      linked_stock_id: stock.id,
      linked_stock_slot_ids: [stock.id],
      position_signatures: [],
    });

    const cats = categorizeDerivatives([shortCall], [stock, shortCall], [], [config], { configOnly: true });

    expect(cats.coveredCalls).toHaveLength(1);
    expect(cats.coveredCalls[0].option.id).toBe(shortCall.id);
    expect(cats.coveredCalls[0].contractsCovered).toBe(4);
    expect(cats.nakedPuts).toHaveLength(0);
    expect(cats.leapCalls).toHaveLength(0);
    expect(cats.groupedOtherStrategies).toHaveLength(0);
  });
});

describe('computeMonitoring — niente duplicati tra "call da rivendere" e "strategie incomplete"', () => {
  it('azioni scoperte con CC configurata solo su azioni: appaiono in availableCallsToSell (in contratti) e NON in incompleteMultiLegStrategies', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 200, current_price: 300 });
    const config = cfg({
      strategy_type: 'covered_call', underlying: 'CEG', linked_stock_id: stock.id,
      linked_stock_slot_ids: [stock.id], position_signatures: [],
    });

    const cats = categorizeDerivatives([], [stock], [], [config]);
    const monitoring = computeMonitoring(cats, [stock], [stock], {}, [config]);

    // 2 azioni da 100 = 2 contratti potenziali disponibili, nessuna call venduta
    expect(monitoring.availableCallsToSell.length).toBe(1);
    expect(monitoring.availableCallsToSell[0].availableContracts).toBe(2);

    // Non deve comparire anche tra le strategie incomplete (evita il duplicato)
    expect(monitoring.incompleteMultiLegStrategies.length).toBe(0);
  });

  it('DR-CC con call venduta ma senza Long Put: resta tra le strategie incomplete (non è un duplicato di "call da rivendere")', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'CEG', description: 'CONSTELLATION ENERGY', quantity: 100, current_price: 300 });
    const shortCall = pos({ option_type: 'call', quantity: -1, strike_price: 320, expiry_date: '2026-12-18',
      underlying: 'CEG', ticker: 'CEG', current_price: 10 });
    const config = cfg({
      strategy_type: 'derisking_covered_call', underlying: 'CEG', linked_stock_id: stock.id,
      position_signatures: [{ option_type: 'call', strike: 320, expiry: '2026-12-18', quantity_sign: -1, quantity_abs: 1 }],
    });

    const cats = categorizeDerivatives([shortCall], [stock, shortCall], [], [config]);
    const monitoring = computeMonitoring(cats, [stock, shortCall], [stock], {}, [config]);

    // La call è già venduta e copre le 100 azioni: nessun contratto disponibile da rivendere
    expect(monitoring.availableCallsToSell.length).toBe(0);
    // Manca solo la Long Put: resta visibile come strategia incompleta
    const inc = monitoring.incompleteMultiLegStrategies.filter(i => i.ticker === 'CEG');
    expect(inc.length).toBe(1);
    expect(inc[0].missingLegs).toEqual(['Long Put']);
  });
});
