import { describe, expect, it } from 'vitest';
import { Position } from '@/types/portfolio';
import { buildDynamicAliasMap } from '@/lib/tickerIdentity';
import { findUnlinkedShortCalls } from '@/lib/unrecognizedUnderlyings';

function position(overrides: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1', isin: null, ticker: null, description: '', asset_type: 'stock',
    currency: 'EUR', exchange_rate: 1, quantity: 0, current_price: null, avg_cost: null,
    market_value: null, profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null, created_at: '', updated_at: '',
    ...overrides,
  };
}

const shortCall = (underlying: string, description = '') =>
  position({ asset_type: 'derivative', option_type: 'call', quantity: -1, underlying, description });

describe('findUnlinkedShortCalls', () => {
  it('segnala una short call su codice non mappato senza azione corrispondente', () => {
    const derivs = [shortCall('XYZ1', '[XYZ1][12/26][C][100]')];
    const res = findUnlinkedShortCalls(derivs, [], undefined);
    expect(res).toHaveLength(1);
    expect(res[0].code).toBe('XYZ1');
    expect(res[0].contractCount).toBe(1);
  });

  it('NON segnala se una riga di mapping la riconosce (codice → ticker dell’azione)', () => {
    const dyn = buildDynamicAliasMap([{ underlying: 'RAC', ticker: 'RACE' }]);
    const derivs = [shortCall('RAC', '[RAC][12/26][C][322]')];
    const stocks = [position({ asset_type: 'stock', ticker: 'RACE.MI', description: 'FERRARI NV', isin: 'NL0011585146', quantity: 100 })];
    expect(findUnlinkedShortCalls(derivs, stocks, dyn)).toHaveLength(0);
  });

  it('NON segnala una call già coperta da un’azione posseduta (US)', () => {
    const derivs = [shortCall('AAPL', 'AAPL CALL 250')];
    const stocks = [position({ asset_type: 'stock', ticker: 'AAPL', description: 'APPLE INC', quantity: 100 })];
    expect(findUnlinkedShortCalls(derivs, stocks, undefined)).toHaveLength(0);
  });

  it('NON segnala le put naked (non richiedono copertura)', () => {
    const shortPut = position({ asset_type: 'derivative', option_type: 'put', quantity: -1, underlying: 'ZZZ9' });
    expect(findUnlinkedShortCalls([shortPut], [], undefined)).toHaveLength(0);
  });

  it('NON segnala le long call', () => {
    const longCall = position({ asset_type: 'derivative', option_type: 'call', quantity: 1, underlying: 'ZZZ9' });
    expect(findUnlinkedShortCalls([longCall], [], undefined)).toHaveLength(0);
  });

  it('aggrega i contratti dello stesso codice', () => {
    const derivs = [shortCall('XYZ1'), shortCall('XYZ1'), shortCall('XYZ1')];
    const res = findUnlinkedShortCalls(derivs, [], undefined);
    expect(res).toHaveLength(1);
    expect(res[0].contractCount).toBe(3);
  });

  it('ignora un’azione a quantità zero come copertura', () => {
    const derivs = [shortCall('QQQ2')];
    const stocks = [position({ asset_type: 'stock', ticker: 'QQQ2', quantity: 0 })];
    // La quantità zero non copre: se la chiave non è alta affidabilità resta segnalata
    const res = findUnlinkedShortCalls(derivs, stocks, undefined);
    expect(res).toHaveLength(1);
  });
});
