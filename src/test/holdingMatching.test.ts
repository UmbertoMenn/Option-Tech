import { describe, it, expect } from 'vitest';
import { 
  getHoldingKey, 
  isSameHolding, 
  normalizeHoldingName,
  calculateConsolidatedTopHoldings,
  ConsolidatedHoldingWithDetails 
} from '@/lib/sectorExposure';
import { RiskAnalysis, StockRiskDetail, NakedPutRiskDetail } from '@/lib/riskCalculator';

describe('getHoldingKey', () => {
  it('should generate same key for variations of ALIBABA', () => {
    const key1 = getHoldingKey('AZ.ALIBABA GROUP HOLDING LTD');
    const key2 = getHoldingKey('ALIBABA GROUP HOLDING LTD');
    const key3 = getHoldingKey('ALIBABA GROUP');
    const key4 = getHoldingKey('ALIBABA');
    
    // All should produce a key containing ALIBABA
    expect(key1).toContain('ALIBABA');
    expect(key2).toContain('ALIBABA');
    expect(key3).toContain('ALIBABA');
    expect(key4).toContain('ALIBABA');
    
    // Keys should be equal for same company
    expect(key1).toBe(key2);
    expect(key1).toBe(key3);
    expect(key1).toBe(key4);
  });
  
  it('should generate DIFFERENT keys for different companies sharing stopwords', () => {
    const alibabaKey = getHoldingKey('ALIBABA GROUP HOLDING LTD');
    const hutchisonKey = getHoldingKey('CK HUTCHISON HOLDINGS LTD');
    
    // Keys should be different
    expect(alibabaKey).not.toBe(hutchisonKey);
    
    // ALIBABA key should contain ALIBABA but not HUTCHISON
    expect(alibabaKey).toContain('ALIBABA');
    expect(alibabaKey).not.toContain('HUTCHISON');
    
    // HUTCHISON key should contain HUTCHISON but not ALIBABA
    expect(hutchisonKey).toContain('HUTCHISON');
    expect(hutchisonKey).not.toContain('ALIBABA');
  });
  
  it('should remove common corporate stopwords', () => {
    const key = getHoldingKey('ALIBABA GROUP HOLDING LTD ADR CLASS A SHARES');
    
    // Should not contain stopwords
    expect(key).not.toContain('GROUP');
    expect(key).not.toContain('HOLDING');
    expect(key).not.toContain('LTD');
    expect(key).not.toContain('ADR');
    expect(key).not.toContain('CLASS');
    expect(key).not.toContain('SHARES');
    
    // Should contain ALIBABA
    expect(key).toContain('ALIBABA');
  });
  
  it('should return null for names with only stopwords', () => {
    const key = getHoldingKey('GROUP HOLDING LTD');
    expect(key).toBeNull();
  });
  
  it('should handle canonical aliases like ALPHABET/GOOGLE', () => {
    const googleKey = getHoldingKey('GOOGLE');
    const alphabetKey = getHoldingKey('ALPHABET INC CLASS A');
    
    // Both should be canonical ALPHABET keys (ALPHABET is the canonical name in SPECIAL_ALIASES)
    expect(googleKey).toBe('CANONICAL:ALPHABET');
    expect(alphabetKey).toBe('CANONICAL:ALPHABET');
  });
});

describe('isSameHolding', () => {
  it('should match ALIBABA variations', () => {
    expect(isSameHolding('AZ.ALIBABA GROUP HOLDING LTD', 'ALIBABA GROUP HOLDING LTD')).toBe(true);
    expect(isSameHolding('ALIBABA GROUP HOLDING LTD', 'ALIBABA')).toBe(true);
    expect(isSameHolding('AZ.ALIBABA GROUP HOLDING LTD', 'ALIBABA')).toBe(true);
  });
  
  it('should NOT match different companies that share stopwords', () => {
    // This is the critical test - these should NOT match
    expect(isSameHolding('ALIBABA GROUP HOLDING LTD', 'CK HUTCHISON HOLDINGS LTD')).toBe(false);
    expect(isSameHolding('ALIBABA GROUP', 'BERKSHIRE HATHAWAY GROUP')).toBe(false);
    expect(isSameHolding('MICROSOFT CORP', 'MICROSTRATEGY CORP')).toBe(false);
  });
  
  it('should match NVIDIA variations', () => {
    expect(isSameHolding('NVIDIA', 'NVIDIA CORP')).toBe(true);
    expect(isSameHolding('NVIDIA CORPORATION', 'NVIDIA')).toBe(true);
  });
  
  it('should match Google/Alphabet via canonical alias', () => {
    expect(isSameHolding('GOOGLE', 'ALPHABET INC CLASS A')).toBe(true);
    expect(isSameHolding('GOOGL', 'ALPHABET')).toBe(true);
  });
  
  it('should require exact match when only stopwords remain', () => {
    // These have no distinctive tokens
    expect(isSameHolding('GROUP HOLDING LTD', 'GROUP HOLDING LTD')).toBe(true);
    expect(isSameHolding('GROUP HOLDING LTD', 'COMPANY INC')).toBe(false);
  });
});

describe('normalizeHoldingName', () => {
  it('should remove AZ. prefix', () => {
    const normalized = normalizeHoldingName('AZ.ALIBABA GROUP HOLDING LTD');
    expect(normalized).not.toContain('AZ.');
    expect(normalized).toContain('ALIBABA');
  });
  
  it('should handle names without AZ. prefix', () => {
    const normalized = normalizeHoldingName('NVIDIA CORP');
    expect(normalized).toContain('NVIDIA');
  });
});

describe('calculateConsolidatedTopHoldings', () => {
  it('should NOT merge naked puts from different underlyings', () => {
    // Mock analysis with Alibaba stock + puts, and XYZ puts
    const mockAnalysis: RiskAnalysis = {
      totalStockRisk: 15000,
      totalETFRisk: 0,
      totalPureStockRisk: 15000,
      totalCommodityRisk: 0,
      totalBondRisk: 100000,
      totalNakedPutRisk: 50000,
      totalLeapCallRisk: 0,
      totalStrategyRisk: 0, totalSyntheticCcDrccRisk: 0, syntheticCcDrccDetails: [],
      grandTotal: 65000,
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
      nakedPutDetails: [
        {
          underlying: 'ALIBABA GROUP HOLDING LTD',
          tickerKey: 'BABA',
          contracts: 1,
          strike: 165,
          expiry: '2025-06-20',
          currency: 'USD',
          exchangeRate: 1.197,
          riskOriginal: 16500,
          riskEUR: 13784,
        },
        {
          underlying: 'ALIBABA GROUP HOLDING LTD',
          tickerKey: 'BABA',
          contracts: 1,
          strike: 170,
          expiry: '2025-06-20',
          currency: 'USD',
          exchangeRate: 1.197,
          riskOriginal: 17000,
          riskEUR: 14202,
        },
        {
          underlying: 'XYZ HOLDINGS LTD',
          tickerKey: 'NAME:XYZ HOLDINGS LTD',
          contracts: 5,
          strike: 100,
          expiry: '2025-06-20',
          currency: 'USD',
          exchangeRate: 1.197,
          riskOriginal: 50000,
          riskEUR: 41771,
        },
      ],
      leapCallDetails: [],
      strategyDetails: [],
    };
    
    const result = calculateConsolidatedTopHoldings(
      mockAnalysis,
      {},
      { includeProtections: false }
    );
    
    // Find Alibaba holding
    const alibaba = result.find(h => 
      h.name.toUpperCase().includes('ALIBABA')
    );
    
    // Find XYZ holding
    const xyz = result.find(h => 
      h.name.toUpperCase().includes('XYZ')
    );
    
    // ALIBABA should exist with correct values
    expect(alibaba).toBeDefined();
    // Stock risk should be approximately 14670 (17500 / 1.193)
    expect(alibaba!.stockRisk).toBeCloseTo(14669, -1); // Allow 10 unit tolerance
    // Alibaba PUT risk should be ONLY the two puts (13784 + 14202 = 27986)
    expect(alibaba!.nakedPutRisk).toBeCloseTo(27986, 0);
    expect(alibaba!.nakedPutDetails).toHaveLength(2);
    expect(alibaba!.nakedPutDetails.map(p => p.strike).sort()).toEqual([165, 170]);
    
    // XYZ should exist separately
    expect(xyz).toBeDefined();
    expect(xyz!.nakedPutRisk).toBeCloseTo(41771, 0);
    expect(xyz!.nakedPutDetails).toHaveLength(1);
    expect(xyz!.stockRisk).toBe(0); // No stock for XYZ
  });
  
  it('should flag when PUT risk is abnormally high relative to expected', () => {
    // This test ensures the bug doesn't reappear:
    // If Alibaba has only 2 puts at strikes 165 and 170, 
    // the PUT risk should be around 28k, NOT 174k
    
    const mockAnalysis: RiskAnalysis = {
      totalStockRisk: 15000,
      totalETFRisk: 0,
      totalPureStockRisk: 15000,
      totalCommodityRisk: 0,
      totalBondRisk: 100000,
      totalNakedPutRisk: 28000,
      totalLeapCallRisk: 0,
      totalStrategyRisk: 0, totalSyntheticCcDrccRisk: 0, syntheticCcDrccDetails: [],
      grandTotal: 43000,
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
      nakedPutDetails: [
        {
          underlying: 'ALIBABA GROUP HOLDING LTD',
          tickerKey: 'BABA',
          contracts: 1,
          strike: 165,
          expiry: '2025-06-20',
          currency: 'USD',
          exchangeRate: 1.197,
          riskOriginal: 16500,
          riskEUR: 13784,
        },
        {
          underlying: 'ALIBABA GROUP HOLDING LTD',
          tickerKey: 'BABA',
          contracts: 1,
          strike: 170,
          expiry: '2025-06-20',
          currency: 'USD',
          exchangeRate: 1.197,
          riskOriginal: 17000,
          riskEUR: 14202,
        },
      ],
      leapCallDetails: [],
      strategyDetails: [],
    };
    
    const result = calculateConsolidatedTopHoldings(
      mockAnalysis,
      {},
      { includeProtections: false }
    );
    
    const alibaba = result.find(h => h.name.toUpperCase().includes('ALIBABA'));
    
    expect(alibaba).toBeDefined();
    
    // The expected PUT risk is around 28k (13784 + 14202)
    const expectedPutRisk = 13784 + 14202;
    
    // If PUT risk is more than 2x expected, something is wrong
    expect(alibaba!.nakedPutRisk).toBeLessThan(expectedPutRisk * 2);
    
    // More strictly: should be within 1% of expected
    expect(alibaba!.nakedPutRisk).toBeCloseTo(expectedPutRisk, 0);
  });
});
