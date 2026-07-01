import { describe, it, expect } from 'vitest';
import { calculateStockRisk } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';
import { CoveredCallPosition, DeRiskingCoveredCallPosition } from '@/lib/derivativeStrategies';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'stock',
    currency: 'USD', exchange_rate: 1, quantity: 0,
    current_price: null, avg_cost: null, market_value: null,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

describe('riskCalculator — cap Covered Call ITM sul rischio azioni', () => {
  it('CC ITM: rischio netto E lordo cappati allo strike; stockValue resta il mercato pieno', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'TEST', description: 'TEST CORP',
      quantity: 1000, current_price: 320 });
    const shortCall = pos({ asset_type: 'derivative', option_type: 'call', quantity: -10,
      strike_price: 300, underlying: 'TEST', ticker: 'TEST', current_price: 25 });
    const cc: CoveredCallPosition = {
      option: shortCall, underlying: stock, contractsCovered: 10, sharesCovered: 1000,
      isFullyCovered: true, isSynthetic: false,
    };

    const [d] = calculateStockRisk([stock], [], [cc], [], [stock, shortCall]);

    // valore di mercato pieno (non cappato)
    expect(d.stockValue).toBeCloseTo(320000, 0);
    // rischio netto: cappato allo strike 300 → 300 × 1000
    expect(d.riskOriginal).toBeCloseTo(300000, 0);
    // rischio LORDO (senza PUT): deve MANTENERE il cap allo strike, NON tornare a 320000
    expect(d.riskOriginalWithoutProtection).toBeCloseTo(300000, 0);
    // niente protezioni PUT → nessun risparmio protezioni
    expect(d.protectionSavingsOriginal ?? 0).toBeCloseTo(0, 0);
    // metadati cap per il tooltip
    expect(d.ccCappedShares).toBe(1000);
    expect(d.ccCapStrike).toBeCloseTo(300, 0);
  });

  it('CC OTM: nessun cap, rischio = mercato pieno', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'OTM', description: 'OTM CORP',
      quantity: 500, current_price: 100 });
    const shortCall = pos({ asset_type: 'derivative', option_type: 'call', quantity: -5,
      strike_price: 120, underlying: 'OTM', ticker: 'OTM', current_price: 2 });
    const cc: CoveredCallPosition = {
      option: shortCall, underlying: stock, contractsCovered: 5, sharesCovered: 500,
      isFullyCovered: true, isSynthetic: false,
    };
    const [d] = calculateStockRisk([stock], [], [cc], [], [stock, shortCall]);
    expect(d.riskOriginal).toBeCloseTo(50000, 0);                 // 500 × 100 (no cap OTM)
    expect(d.riskOriginalWithoutProtection).toBeCloseTo(50000, 0);
    expect(d.ccCappedShares ?? 0).toBe(0);
  });

  it('DR-CC stile Micron: 100 az cap call 480, prot PUT 280 → 200/az → 20.000', () => {
    const stock = pos({ asset_type: 'stock', ticker: 'MU', description: 'MICRON TECHNOLOGY',
      quantity: 100, current_price: 500, currency: 'USD', exchange_rate: 1.08 });
    const shortCall = pos({ asset_type: 'derivative', option_type: 'call', quantity: -1,
      strike_price: 480, underlying: 'MU', ticker: 'MU', current_price: 30 });
    const protPut = pos({ asset_type: 'derivative', option_type: 'put', quantity: 1,
      strike_price: 280, underlying: 'MU', ticker: 'MU', current_price: 5 });
    const dr: DeRiskingCoveredCallPosition = {
      coveredCall: { option: shortCall, underlying: stock, contractsCovered: 1, sharesCovered: 100,
        isFullyCovered: true, isSynthetic: false },
      protectionPut: protPut, isSynthetic: false,
    };
    const [d] = calculateStockRisk([stock], [], [], [dr], [stock, shortCall, protPut]);

    // rischio/az = call 480 − put 280 = 200 → 100 × 200 = 20.000
    expect(d.drccCallStrike).toBeCloseTo(480, 0);
    expect(d.drccProtectionStrike).toBeCloseTo(280, 0);
    expect(d.drccCapPerShare).toBeCloseTo(200, 0);
    expect(d.drccCappedShares).toBe(100);
    expect(d.riskOriginal).toBeCloseTo(20000, 0);
    // riskEUR = 20.000 / 1.08
    expect(d.riskEUR).toBeCloseTo(20000 / 1.08, 1);
  });
});
