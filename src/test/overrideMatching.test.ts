import { describe, it, expect } from 'vitest';
import { computeRemappedLinkedStock, findMatchingStock, StrategyConfigLinkedStock } from '@/lib/overrideMatching';
import { Position } from '@/types/portfolio';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'stock',
    currency: 'EUR', exchange_rate: 1, quantity: 0,
    current_price: null, avg_cost: null, market_value: null,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

describe('findMatchingStock', () => {
  it('rimappa per ISIN quando disponibile (fonte più affidabile)', () => {
    const oldStock = pos({ id: 'old-1', asset_type: 'stock', isin: 'US0000000001', ticker: 'RGTI' });
    const newStock = pos({ id: 'new-1', asset_type: 'stock', isin: 'US0000000001', ticker: 'RGTI' });
    const result = findMatchingStock('old-1', [oldStock], [newStock]);
    expect(result).toBe('new-1');
  });

  it('fallback per ticker quando manca ISIN', () => {
    const oldStock = pos({ id: 'old-1', asset_type: 'stock', isin: null, ticker: 'RGTI' });
    const newStock = pos({ id: 'new-1', asset_type: 'stock', isin: null, ticker: 'RGTI' });
    const result = findMatchingStock('old-1', [oldStock], [newStock]);
    expect(result).toBe('new-1');
  });

  it('fallback per description normalizzata quando mancano ISIN e ticker', () => {
    const oldStock = pos({ id: 'old-1', asset_type: 'stock', description: 'AZ.RIGETTI COMPUTING INC' });
    const newStock = pos({ id: 'new-1', asset_type: 'stock', description: 'az.rigetti computing inc ' });
    const result = findMatchingStock('old-1', [oldStock], [newStock]);
    expect(result).toBe('new-1');
  });

  it('ritorna null se lo stock vecchio non esiste più nel set old (già stale)', () => {
    const newStock = pos({ id: 'new-1', asset_type: 'stock', isin: 'US1' });
    const result = findMatchingStock('id-inesistente', [], [newStock]);
    expect(result).toBeNull();
  });

  it('ritorna null se nessuna posizione nuova corrisponde (ISIN, ticker e descrizione tutti diversi)', () => {
    const oldStock = pos({ id: 'old-1', asset_type: 'stock', isin: 'US1', ticker: 'AAA', description: 'Alpha Corp' });
    const newStock = pos({ id: 'new-1', asset_type: 'stock', isin: 'US2', ticker: 'BBB', description: 'Beta Corp' });
    const result = findMatchingStock('old-1', [oldStock], [newStock]);
    expect(result).toBeNull();
  });
});

describe('computeRemappedLinkedStock', () => {
  it('rimappa linked_stock_id al nuovo ID dopo un upload che rigenera gli ID posizione', () => {
    const oldStock = pos({ id: 'old-rgti', asset_type: 'stock', isin: 'US76655K1034', ticker: 'RGTI' });
    const newStock = pos({ id: 'new-rgti', asset_type: 'stock', isin: 'US76655K1034', ticker: 'RGTI' });
    const config: StrategyConfigLinkedStock = { id: 'cfg-1', linked_stock_id: 'old-rgti', linked_stock_slot_ids: [] };

    const result = computeRemappedLinkedStock(config, [oldStock], [newStock]);

    expect(result.changed).toBe(true);
    expect(result.linked_stock_id).toBe('new-rgti');
  });

  it('non tocca nulla se il link è già corretto (nessun cambio ID)', () => {
    const stock = pos({ id: 'same-id', asset_type: 'stock', isin: 'US1', ticker: 'AAA' });
    const config: StrategyConfigLinkedStock = { id: 'cfg-1', linked_stock_id: 'same-id', linked_stock_slot_ids: [] };

    const result = computeRemappedLinkedStock(config, [stock], [stock]);

    expect(result.changed).toBe(false);
    expect(result.linked_stock_id).toBe('same-id');
  });

  it('azzera (non lascia un riferimento morto) se il vecchio link è già stale e non trova match', () => {
    const config: StrategyConfigLinkedStock = { id: 'cfg-1', linked_stock_id: 'id-gia-orfano', linked_stock_slot_ids: [] };
    const newStock = pos({ id: 'new-1', asset_type: 'stock', isin: 'US1' });

    const result = computeRemappedLinkedStock(config, [], [newStock]);

    expect(result.changed).toBe(true);
    expect(result.linked_stock_id).toBeNull();
  });

  it('non modifica config senza alcun link (linked_stock_id null, slot vuoti)', () => {
    const config: StrategyConfigLinkedStock = { id: 'cfg-1', linked_stock_id: null, linked_stock_slot_ids: [] };

    const result = computeRemappedLinkedStock(config, [], []);

    expect(result.changed).toBe(false);
    expect(result.linked_stock_id).toBeNull();
  });

  it('rimappa ogni slot id (stock split su più gambe) preservando ordine E suffisso __slot_N', () => {
    const oldA = pos({ id: 'old-a', asset_type: 'stock', isin: 'US1' });
    const oldB = pos({ id: 'old-b', asset_type: 'stock', isin: 'US2' });
    const newA = pos({ id: 'new-a', asset_type: 'stock', isin: 'US1' });
    const newB = pos({ id: 'new-b', asset_type: 'stock', isin: 'US2' });
    const config: StrategyConfigLinkedStock = {
      id: 'cfg-1', linked_stock_id: 'old-a',
      linked_stock_slot_ids: ['old-a__slot_0', 'old-b__slot_1'],
    };

    const result = computeRemappedLinkedStock(config, [oldA, oldB], [newA, newB]);

    expect(result.changed).toBe(true);
    expect(result.linked_stock_slot_ids).toEqual(['new-a__slot_0', 'new-b__slot_1']);
    expect(result.linked_stock_id).toBe('new-a');
  });

  it('due slot dello STESSO titolo (200 azioni su 2 covered call) restano slot distinti dopo il remap', () => {
    // Bug segnalato: gli slot collassavano su un riferimento duplicato alla
    // posizione base e le config oltre la prima perdevano il titolo.
    const oldA = pos({ id: 'old-a', asset_type: 'stock', isin: 'US1' });
    const newA = pos({ id: 'new-a', asset_type: 'stock', isin: 'US1' });
    const config: StrategyConfigLinkedStock = {
      id: 'cfg-1', linked_stock_id: 'old-a',
      linked_stock_slot_ids: ['old-a__slot_0', 'old-a__slot_1'],
    };

    const result = computeRemappedLinkedStock(config, [oldA], [newA]);

    expect(result.changed).toBe(true);
    expect(result.linked_stock_slot_ids).toEqual(['new-a__slot_0', 'new-a__slot_1']);
    expect(result.linked_stock_id).toBe('new-a');
  });
});
