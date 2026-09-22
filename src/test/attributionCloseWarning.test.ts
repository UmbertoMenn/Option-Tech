import { describe, expect, it } from 'vitest';
import { buildMovementAttributionInputs, StoredMovementRow } from '@/lib/movementAttribution';
import { isClosingPriceMethod } from '@/lib/optionPremiumSplit';
import { calculatePerformanceAttribution } from '@/lib/performanceAttribution';
import { FullSnapshot } from '@/lib/fullSnapshot';
import { HistoricalDataEntry } from '@/types/historicalData';

const row = (overrides: Partial<StoredMovementRow> = {}): StoredMovementRow => ({
  source: 'titoli', rowKey: 'option', accountId: 'account', scope: 'portfolio', kind: 'sell',
  effectiveDate: '2026-08-21', bookingDate: null, valueDate: null, operationDate: null,
  causale: 'VEN', causaleDescription: null, operationId: null, description: 'TESTU6P100',
  isin: null, descriptor: 'TESTU6P100', underlyingTicker: 'TEST', optionType: 'put',
  strike: 100, expiryDate: '2026-09-18', positionSide: 'short', quantity: 1, price: 5,
  currency: 'EUR', exchangeRate: 1, grossEur: 500, accruedEur: 0, netEur: 500,
  commissionEur: 0, fxCommissionEur: 0, taxEur: 0, bolliEur: 0, unexplainedChargeEur: 0,
  periodStart: '2026-08-01', periodEnd: '2026-08-31', underlyingKey: 'TEST',
  underlyingPrice: 110, intrinsicPerShare: 0, timeValuePerShare: 5,
  attributionPriceSource: 'exact_trade_date', manualTimeValuePerShare: null, ...overrides,
});
const snapshot = (date: string): FullSnapshot => ({
  portfolio_id: 'test', snapshot_date: date, positions: [], strategy_configurations: [],
  derivative_overrides: [], gp_holdings: [], cash_value: 10000, gp_total_value: null,
});

describe('warning premi da chiusura', () => {
  it.each([
    { name: 'vendita OTM', overrides: {}, method: 'close', warning: 1 },
    { name: 'acquisto ITM', overrides: { kind: 'buy', underlyingPrice: 98 }, method: 'close', warning: 1 },
    { name: 'vendita ITM', overrides: { underlyingPrice: 98 }, method: 'close_itm_estimate', warning: 1 },
    { name: 'chiusura precedente', overrides: { attributionPriceSource: 'previous_close' }, method: 'close', warning: 1 },
    { name: 'correzione manuale', overrides: { manualTimeValuePerShare: 3 }, method: 'manual', warning: 0 },
  ] as const)('$name: dettaglio e conteggio coerenti senza cambiare importi', ({ overrides, method, warning }) => {
    const inputs = buildMovementAttributionInputs({ rows: [row(overrides)], uploads: [], snapshots: [] });
    expect(inputs.premiumReview).toHaveLength(1);
    expect(inputs.premiumReview[0].method).toBe(method);
    expect(Number(isClosingPriceMethod(inputs.premiumReview[0].method))).toBe(warning);
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-07-31'), endSnapshot: snapshot('2026-08-27'),
      startHistorical: { netting_total: 10000 } as HistoricalDataEntry,
      endHistorical: { netting_total: 10000 } as HistoricalDataEntry,
      allHistoricalData: [], deposits: [], trades: inputs.trades, internalTransfers: [],
    });
    expect(result.coverage.closingPriceTrades).toBe(warning);
    const time = result.items.find(i => i.category === 'option_time')!;
    const intrinsic = result.items.find(i => i.category === 'option_intrinsic')!;
    expect(Math.abs(time.netFlows + intrinsic.netFlows)).toBe(500);
    if (warning) expect(time.reason).toContain('chiusura del sottostante');
    // Il premio temporale è sempre determinato: le righe opzioni sono "calcolate", mai "parziali".
    expect(time.status).toBe('calculated');
    expect(intrinsic.status).not.toBe('partial'); // OTM: nessun intrinseco → "nessuna attività"
  });
});
