import { describe, it, expect } from 'vitest';
import { calculateStockRisk } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';
import {
  CoveredCallPosition,
  LongPutPosition,
  getCanonicalKey,
  optionMatchesStock,
} from '@/lib/derivativeStrategies';

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

// Caso reale silvias (11/11/2026): ETF UCITS senza ticker + opzioni GOOGLE.
const etf = pos({
  asset_type: 'etf', ticker: null, isin: 'IE00B53SZB19',
  description: 'ISHARES NASDAQ 100 UCITS ETF USD ACC',
  currency: 'EUR', exchange_rate: 1, quantity: 36, current_price: 1427.07,
});
const alphabet = pos({
  asset_type: 'stock', ticker: 'GOOGL', isin: 'US02079K3059',
  description: 'AZ.ALPHABET INC-CL A', quantity: 200, current_price: 287.38, exchange_rate: 1.1142,
});
const googCall335 = pos({ asset_type: 'derivative', option_type: 'call', quantity: -1,
  strike_price: 335, description: 'GOOGLE INC. (A) OPTION CALL 335 DEC/26' });
const googCall380 = pos({ asset_type: 'derivative', option_type: 'call', quantity: -1,
  strike_price: 380, description: 'GOOGLE INC. (A) OPTION CALL 380 DEC/26' });
const googPut270 = pos({ asset_type: 'derivative', option_type: 'put', quantity: 1,
  strike_price: 270, description: 'GOOGLE INC. (A) OPTION PUT 270 DEC/26', current_price: 5.025 });

describe('getCanonicalKey — testo vuoto', () => {
  it('ticker null / stringa vuota non risolve ad ALPHABET', () => {
    expect(getCanonicalKey('')).toBeNull();
    expect(getCanonicalKey('   ')).toBeNull();
  });
  it('GOOGLE/ALPHABET restano equivalenti', () => {
    expect(getCanonicalKey('GOOGLE INC. (A) OPTION PUT 270 DEC/26')).toBe('ALPHABET');
    expect(getCanonicalKey('AZ.ALPHABET INC-CL A')).toBe('ALPHABET');
  });
});

describe('optionMatchesStock — posizioni senza ticker', () => {
  it('le opzioni GOOGLE non si collegano a un ETF UCITS senza ticker', () => {
    for (const o of [googCall335, googCall380, googPut270]) {
      expect(optionMatchesStock(o, etf)).toBe(false);
      expect(optionMatchesStock(o, alphabet)).toBe(true);
    }
  });
  it('né a un\'azione italiana senza ticker (Banca Sella)', () => {
    const sella = pos({ asset_type: 'stock', ticker: null, isin: 'IT0005124398',
      description: 'AZ.BANCA SELLA SPA CATEGORIA S', currency: 'EUR', quantity: 750, current_price: 1.49 });
    expect(optionMatchesStock(googPut270, sella)).toBe(false);
  });
});

describe('Risk Analyzer — ETF senza ticker valorizzato a mercato pieno', () => {
  it('silvias: 36 × 1427,07 = 51.374,52 €, nessun cap CC né protezione GOOGLE', () => {
    const ccs: CoveredCallPosition[] = [googCall335, googCall380].map(o => ({
      option: o, underlying: alphabet, contractsCovered: 1, sharesCovered: 100,
      isFullyCovered: true, isSynthetic: false,
    }));
    const longPuts = [{ option: googPut270, contracts: 1 }] as unknown as LongPutPosition[];

    const [d] = calculateStockRisk([etf], longPuts, ccs, [], [etf, alphabet, googCall335, googCall380, googPut270]);

    // Prima del fix: cap CC ITM a 335/380 sulle 36 quote → ~12.870 €
    expect(d.riskEUR).toBeCloseTo(51374.52, 1);
    expect(d.riskEURWithoutProtection).toBeCloseTo(51374.52, 1);
    expect(d.ccCappedShares ?? 0).toBe(0);
    expect(d.hasProtection).toBe(false);
    expect(d.isETF).toBe(true);
  });
});
