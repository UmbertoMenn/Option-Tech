import { describe, it, expect } from 'vitest';
import { categorizeDerivatives, findUnderlyingStock, optionMatchesStock } from '@/lib/derivativeStrategies';
import { computeLegDecomposition } from '@/hooks/useDerivativeNetting';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { Position } from '@/types/portfolio';

// Caso di produzione (portafoglio 5c9f75d5, 10/09/2026): la put venduta
// "Credo Technology Group Holding Ltd OPTION PUT 170 OCT/26" veniva collegata
// all'azione "AZ.ALIBABA GROUP HOLDING LTD" perché i due nomi condividono i
// token generici GROUP + HOLDING. Lo spot mostrato in dashboard era quindi il
// prezzo di BABA (112,66) invece di quello di CRDO (~168).

function crdoPut(): Position {
  return {
    id: 'crdo_put', portfolio_id: 'pf1', asset_type: 'derivative',
    description: 'Credo Technology Group Holding Ltd OPTION PUT 170 OCT/26',
    underlying: 'Credo Technology Group Holding Ltd', ticker: null,
    option_type: 'put', strike_price: 170, expiry_date: '2026-10-16',
    quantity: -1, current_price: 16.25, snapshot_price: 16.1,
    currency: 'USD', exchange_rate: 1.165, market_value: 1381.74,
    created_at: '', updated_at: '',
  } as unknown as Position;
}

function stock(id: string, description: string, ticker: string | null, price: number): Position {
  return {
    id, portfolio_id: 'pf1', asset_type: 'stock', description, ticker,
    underlying: null, currency: 'USD', current_price: price, snapshot_price: price,
    quantity: 100, market_value: price * 100, exchange_rate: 1.16,
    created_at: '', updated_at: '',
  } as unknown as Position;
}

const baba = () => stock('baba', 'AZ.ALIBABA GROUP HOLDING LTD', 'BABA', 112.66);

const cfg = (): StrategyConfiguration => ({
  id: 'cfg_crdo', portfolio_id: 'pf1',
  underlying: 'Credo Technology Group Holding Ltd', strategy_type: 'naked_put',
  position_signatures: [{ expiry: '2026-10-16', strike: 170, option_type: 'put', quantity_abs: 1, quantity_sign: -1 }],
  is_synthetic: false, linked_stock_id: null, linked_stock_slot_ids: [], sort_order: 0,
  created_at: '', updated_at: '',
} as unknown as StrategyConfiguration);

describe('collegamento opzione → azione sottostante', () => {
  it('non collega CREDO TECHNOLOGY GROUP HOLDING ad ALIBABA GROUP HOLDING', () => {
    expect(findUnderlyingStock(crdoPut(), [baba()])).toBeUndefined();
    expect(optionMatchesStock(crdoPut(), baba())).toBe(false);
  });

  it('collega comunque CRDO alla propria azione quando presente', () => {
    const crdo = stock('crdo', 'CREDO TECHNOLOGY GROUP HOLDING LTD', 'CRDO', 167.92);
    expect(findUnderlyingStock(crdoPut(), [baba(), crdo])?.id).toBe('crdo');
    expect(optionMatchesStock(crdoPut(), crdo)).toBe(true);
  });

  it('la config naked put CRDO non eredita BABA come linkedStock', () => {
    const put = crdoPut();
    const cats = categorizeDerivatives([put], [put, baba()], [], [cfg()], { configOnly: true });
    const rc = cats.resolvedConfigs.find(r => r.configId === 'cfg_crdo')!;
    expect(rc).toBeDefined();
    expect(rc.linkedStock?.id ?? null).not.toBe('baba');
  });

  it('lo spot della gamba nel dettaglio netting è quello di CRDO, non di BABA', () => {
    const put = crdoPut();
    const rows = computeLegDecomposition(
      'netting_total', [put, baba()], [],
      { 'Credo Technology Group Holding Ltd': { price: 167.92 } as any, CRDO: { price: 167.92 } as any },
      [cfg()],
    );
    const row = rows.find(r => r.positionId === 'crdo_put' || r.positionId.startsWith('crdo_put'));
    expect(row).toBeDefined();
    expect(row!.spot).toBeCloseTo(167.92, 2);
  });

  it('ticker contenuto come sottostringa non basta (ALL non è ALLY)', () => {
    const allstate = stock('all', 'ALLSTATE CORP', 'ALL', 200);
    const allyPut: Position = { ...crdoPut(), id: 'ally_put', underlying: 'ALLY FINANCIAL', description: 'ALLY FINANCIAL OPTION PUT 30 OCT/26' } as Position;
    expect(optionMatchesStock(allyPut, allstate)).toBe(false);
  });

  it('i token generici non bastano (ADVANCED MICRO DEVICES vs ADVANCED DRAINAGE SYSTEMS)', () => {
    const wms = stock('wms', 'ADVANCED DRAINAGE SYSTEMS INC', 'WMS', 150);
    const tsm = stock('tsm', 'TAIWAN SEMICONDUCTOR MANUFACTURING CO', 'TSM', 200);
    const amdPut: Position = { ...crdoPut(), id: 'amd_put', underlying: 'Advanced Micro Devices Inc', description: 'Advanced Micro Devices Inc OPTION PUT 150 OCT/26' } as Position;
    expect(findUnderlyingStock(amdPut, [wms, tsm])).toBeUndefined();
  });
});

describe('riskCalculator — protezione/copertura su azione sbagliata', () => {
  it('una put CRDO comprata non protegge l\'azione BABA', async () => {
    const { calculateStockRisk } = await import('@/lib/riskCalculator');
    const b = baba();
    const put: Position = { ...crdoPut(), id: 'crdo_long_put', quantity: 1 } as Position;
    const res = calculateStockRisk([b], [{ option: put } as any], [], [], [b, put]);
    const detail = res.find((r: any) => (r.stock?.id ?? r.stockId ?? r.id) === 'baba') ?? res[0];
    const s = JSON.stringify(detail);
    expect(s).not.toContain('crdo_long_put');
  });
});
