import { describe, it, expect } from 'vitest';
import { calculateConsolidatedTopHoldings } from '@/lib/sectorExposure';
import { RiskAnalysis } from '@/lib/riskCalculator';
import { GPHoldingRow } from '@/hooks/useGPHoldings';

// Perimetro GP delle Holdings Consolidate: con GP incluse le azioni GP si sommano
// all'holding diretto (gpRisk) e i titoli solo-GP compaiono; con GP escluse
// (toggle card → gpStockHoldings = []) restano solo le posizioni dirette.

const analysis: RiskAnalysis = {
  totalStockRisk: 14670,
  totalETFRisk: 0,
  totalPureStockRisk: 14670,
  totalCommodityRisk: 0,
  totalBondRisk: 0,
  totalNakedPutRisk: 0,
  totalLeapCallRisk: 0,
  totalStrategyRisk: 0,
  totalSyntheticCcDrccRisk: 0,
  syntheticCcDrccDetails: [],
  grandTotal: 14670,
  stockDetails: [
    {
      underlying: 'AZ.ALIBABA GROUP HOLDING LTD',
      tickerKey: 'BABA',
      isin: 'US01609W1027',
      stockQuantity: 100,
      stockPrice: 175,
      stockValue: 17500,
      protectedValue: 0,
      riskOriginal: 17500,
      riskEUR: 14670,
      currency: 'USD',
      exchangeRate: 1.193,
      isETF: false,
      hasProtection: false,
      protectionStrike: null,
      protectionContracts: 0,
      protectionOptionPrice: null,
    },
  ],
  commodityDetails: [],
  bondDetails: [],
  nakedPutDetails: [],
  leapCallDetails: [],
  strategyDetails: [],
} as unknown as RiskAnalysis;

const gpRow = (description: string, ticker: string, value: number): GPHoldingRow => ({
  id: ticker,
  portfolio_id: 'p1',
  asset_type: 'stock',
  description,
  quantity: 10,
  market_value: value,
  price: null,
  currency: 'EUR',
  exchange_rate: 1,
  weight_pct: null,
  ticker_code: ticker,
  price_date: null,
  created_at: '',
  updated_at: '',
});

const gp: GPHoldingRow[] = [
  gpRow('ALIBABA GROUP HOLDING LTD', 'BABA', 5000),
  gpRow('NVIDIA CORP', 'NVDA', 8000),
];

describe('Holdings Consolidate — toggle GP', () => {
  it('GP incluse: gpRisk sommato all\'holding diretto e titolo solo-GP presente', () => {
    const res = calculateConsolidatedTopHoldings(analysis, {}, { includeProtections: true }, 100, gp);
    const baba = res.find(h => h.name.toUpperCase().includes('ALIBABA'))!;
    expect(baba.gpRisk).toBe(5000);
    expect(baba.totalExposure).toBeCloseTo(baba.stockRiskWithProtection + 5000, 0);
    expect(res.some(h => h.name.toUpperCase().includes('NVIDIA'))).toBe(true);
  });

  it('GP escluse: nessun gpRisk e nessun titolo solo-GP', () => {
    const res = calculateConsolidatedTopHoldings(analysis, {}, { includeProtections: true }, 100, []);
    const baba = res.find(h => h.name.toUpperCase().includes('ALIBABA'))!;
    expect(baba.gpRisk).toBe(0);
    expect(res.some(h => h.name.toUpperCase().includes('NVIDIA'))).toBe(false);
    expect(res.every(h => h.gpRisk === 0)).toBe(true);
  });
});
