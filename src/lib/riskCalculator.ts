import { Position } from '@/types/portfolio';
import { 
  DerivativeCategories, 
  LongPutPosition, 
  NakedPutPosition, 
  LeapCallPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  GroupedOtherStrategy
} from './derivativeStrategies';
import { 
  calculateUniversalMaxLoss, 
  positionsToLegs,
  OptionLeg 
} from './universalMaxLoss';
// ============= INTERFACES =============

export interface StockRiskDetail {
  underlying: string;
  stockValue: number;           // Valore azioni in valuta originale
  stockQuantity: number;        // Numero azioni
  stockPrice: number;           // Prezzo azione
  protectionStrike: number | null;
  protectionContracts: number;
  protectedValue: number;       // Valore protetto in valuta originale
  riskOriginal: number;         // Rischio in valuta originale
  riskEUR: number;              // Rischio convertito in EUR
  currency: string;
  exchangeRate: number;
  hasProtection: boolean;
  isin?: string;                // ISIN for ETF lookups
  isETF: boolean;               // Flag per distinguere ETF da azioni
}

export interface NakedPutRiskDetail {
  underlying: string;
  strike: number;
  contracts: number;
  expiry: string;
  riskOriginal: number;         // Strike × Contratti × 100
  riskEUR: number;
  currency: string;
  exchangeRate: number;
}

export interface LeapCallRiskDetail {
  underlying: string;
  strike: number;
  contracts: number;
  avgCost: number;
  expiry: string;
  premiumPaid: number;          // Rischio = premio pagato (contratti × PMC × 100)
  riskEUR: number;
  currency: string;
  exchangeRate: number;
}

export interface StrategyRiskDetail {
  strategyName: string;
  underlying: string;
  maxLoss: number;              // In valuta originale
  maxLossEUR: number;
  currency: string;
  exchangeRate: number;
  calculation: string;          // Descrizione calcolo per tooltip
}

export interface CommodityRiskDetail {
  underlying: string;
  value: number;              // Valore in valuta originale
  quantity: number;
  price: number;
  riskOriginal: number;       // Rischio in valuta originale (= valore)
  riskEUR: number;            // Rischio convertito in EUR
  currency: string;
  exchangeRate: number;
}

export interface RiskAnalysis {
  // Totali EUR
  totalStockRisk: number;       // Rischio totale Azioni + ETF (per retrocompatibilità)
  totalETFRisk: number;         // Rischio solo ETF
  totalPureStockRisk: number;   // Rischio solo Azioni (no ETF)
  totalCommodityRisk: number;
  totalNakedPutRisk: number;
  totalLeapCallRisk: number;
  totalStrategyRisk: number;
  grandTotal: number;
  
  // Dettagli
  stockDetails: StockRiskDetail[];
  commodityDetails: CommodityRiskDetail[];
  nakedPutDetails: NakedPutRiskDetail[];
  leapCallDetails: LeapCallRiskDetail[];
  strategyDetails: StrategyRiskDetail[];
}

// ============= HELPER FUNCTIONS =============

/**
 * Gets the effective exchange rate for a position.
 * Returns the exchange_rate if available, otherwise defaults to 1 (EUR or fallback).
 */
function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

/**
 * Normalizes text for matching (same logic as derivativeStrategies.ts)
 */
function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|COMMON|STOCK|DEL|OHIO|CA|THE|ADR)\b/gi, '')
    .trim();
}

// ============= RISK CALCULATION FUNCTIONS =============

/**
 * Calculate stock risk taking into account protective puts.
 * Formula:
 * - Senza protezione: Quantità × Prezzo
 * - Con protezione: Valore Azioni - (Strike PUT × Contratti × 100)
 */
export function calculateStockRisk(
  stocks: Position[],
  longPuts: LongPutPosition[]
): StockRiskDetail[] {
  const result: StockRiskDetail[] = [];
  
  // Group long puts by underlying
  const putsByUnderlying = new Map<string, LongPutPosition[]>();
  for (const lp of longPuts) {
    const underlyingKey = normalizeForMatching(lp.option.underlying || lp.option.description);
    if (!putsByUnderlying.has(underlyingKey)) {
      putsByUnderlying.set(underlyingKey, []);
    }
    putsByUnderlying.get(underlyingKey)!.push(lp);
  }
  
  // Include only stocks and ETFs (commodities are calculated separately)
  const stockAssetTypes = ['stock', 'etf'];
  
  for (const stock of stocks) {
    if (!stockAssetTypes.includes(stock.asset_type)) continue;
    
    const stockKey = normalizeForMatching(stock.ticker || stock.description);
    const stockValue = (stock.quantity || 0) * (stock.current_price || 0);
    const exchangeRate = getEffectiveExchangeRate(stock);
    const currency = stock.currency || 'USD';
    
    // Find protective puts for this stock
    const protectivePuts = putsByUnderlying.get(stockKey) || [];
    
    let protectionStrike: number | null = null;
    let protectionContracts = 0;
    let protectedValue = 0;
    
    if (protectivePuts.length > 0) {
      // Use the highest strike put as protection (most protective)
      const sortedPuts = [...protectivePuts].sort((a, b) => 
        (b.option.strike_price || 0) - (a.option.strike_price || 0)
      );
      const mainPut = sortedPuts[0];
      protectionStrike = mainPut.option.strike_price || null;
      protectionContracts = protectivePuts.reduce((sum, p) => sum + p.contracts, 0);
      protectedValue = (protectionStrike || 0) * protectionContracts * 100;
    }
    
    // Risk = Stock Value - Protected Value (minimum 0)
    const riskOriginal = Math.max(0, stockValue - protectedValue);
    const riskEUR = riskOriginal / exchangeRate;
    
    result.push({
      underlying: stock.ticker || stock.description,
      stockValue,
      stockQuantity: stock.quantity || 0,
      stockPrice: stock.current_price || 0,
      protectionStrike,
      protectionContracts,
      protectedValue,
      riskOriginal,
      riskEUR,
      currency,
      exchangeRate,
      hasProtection: protectionContracts > 0,
      isin: stock.isin || undefined,
      isETF: stock.asset_type === 'etf'
    });
  }
  
  return result;
}

/**
 * Calculate naked put risk.
 * Formula: Strike × Contratti × 100 / Cambio
 */
export function calculateNakedPutRisk(
  nakedPuts: NakedPutPosition[]
): NakedPutRiskDetail[] {
  return nakedPuts.map(np => {
    const strike = np.option.strike_price || 0;
    const contracts = np.contracts;
    const exchangeRate = getEffectiveExchangeRate(np.option);
    const riskOriginal = strike * contracts * 100;
    
    return {
      underlying: np.option.underlying || np.option.description,
      strike,
      contracts,
      expiry: np.option.expiry_date || '',
      riskOriginal,
      riskEUR: riskOriginal / exchangeRate,
      currency: np.option.currency || 'USD',
      exchangeRate
    };
  });
}

/**
 * Calculate leap call risk.
 * Formula: Contratti × PMC × 100 / Cambio (premio pagato)
 */
export function calculateLeapCallRisk(
  leapCalls: LeapCallPosition[]
): LeapCallRiskDetail[] {
  return leapCalls.map(lc => {
    const contracts = lc.contracts;
    const avgCost = lc.option.avg_cost || 0;
    const exchangeRate = getEffectiveExchangeRate(lc.option);
    const premiumPaid = contracts * avgCost * 100;
    
    return {
      underlying: lc.option.underlying || lc.option.description,
      strike: lc.option.strike_price || 0,
      contracts,
      avgCost,
      expiry: lc.option.expiry_date || '',
      premiumPaid,
      riskEUR: premiumPaid / exchangeRate,
      currency: lc.option.currency || 'USD',
      exchangeRate
    };
  });
}

/**
 * Helper: Convert Position objects to OptionLeg format.
 */
function positionToLeg(p: Position): OptionLeg {
  return {
    type: (p.option_type || 'put') as 'call' | 'put',
    strike: p.strike_price || 0,
    quantity: p.quantity || 0,
    avgCost: p.avg_cost || 0
  };
}

/**
 * Calculate Iron Condor max loss using universal formula.
 * This replaces the old name-based calculation with a payoff-based approach.
 */
function calculateIronCondorMaxLoss(ic: IronCondorPosition): { maxLoss: number; calculation: string } {
  const legs: OptionLeg[] = [
    positionToLeg(ic.soldPut),
    positionToLeg(ic.boughtPut),
    positionToLeg(ic.soldCall),
    positionToLeg(ic.boughtCall)
  ];
  
  const result = calculateUniversalMaxLoss(legs);
  
  return {
    maxLoss: result.maxLoss,
    calculation: result.calculation
  };
}

/**
 * Calculate Double Diagonal max loss using universal formula.
 */
function calculateDoubleDiagonalMaxLoss(dd: DoubleDiagonalPosition): { maxLoss: number; calculation: string } {
  const legs: OptionLeg[] = [
    positionToLeg(dd.soldPut),
    positionToLeg(dd.boughtPut),
    positionToLeg(dd.soldCall),
    positionToLeg(dd.boughtCall)
  ];
  
  const result = calculateUniversalMaxLoss(legs);
  
  return {
    maxLoss: result.maxLoss,
    calculation: result.calculation
  };
}

/**
 * Calculate strategy risk for grouped other strategies using universal formula.
 */
function calculateGroupedStrategyMaxLoss(group: GroupedOtherStrategy): { maxLoss: number; calculation: string } {
  const legs = positionsToLegs(group.options.map(o => o.option));
  
  if (legs.length === 0) {
    return { maxLoss: 0, calculation: 'Nessuna gamba' };
  }
  
  const result = calculateUniversalMaxLoss(legs);
  
  // Add strategy name to calculation if available
  const strategyPrefix = group.strategyName ? `${group.strategyName}: ` : '';
  
  return {
    maxLoss: result.maxLoss,
    calculation: `${strategyPrefix}${result.calculation}`
  };
}

/**
 * Calculate strategy risk for all complex strategies.
 */
export function calculateStrategyRisk(categories: DerivativeCategories): StrategyRiskDetail[] {
  const result: StrategyRiskDetail[] = [];
  
  // Iron Condors
  for (const ic of categories.ironCondors) {
    const exchangeRate = getEffectiveExchangeRate(ic.soldPut);
    const currency = ic.soldPut.currency || 'USD';
    const { maxLoss, calculation } = calculateIronCondorMaxLoss(ic);
    
    result.push({
      strategyName: 'Iron Condor',
      underlying: ic.underlying,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation
    });
  }
  
  // Double Diagonals
  for (const dd of categories.doubleDiagonals) {
    const exchangeRate = getEffectiveExchangeRate(dd.soldPut);
    const currency = dd.soldPut.currency || 'USD';
    const { maxLoss, calculation } = calculateDoubleDiagonalMaxLoss(dd);
    
    result.push({
      strategyName: 'Double Diagonal',
      underlying: dd.underlying,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation
    });
  }
  
  // Grouped Other Strategies
  for (const group of categories.groupedOtherStrategies) {
    if (group.options.length === 0) continue;
    
    const firstOption = group.options[0].option;
    const exchangeRate = getEffectiveExchangeRate(firstOption);
    const currency = firstOption.currency || 'USD';
    const { maxLoss, calculation } = calculateGroupedStrategyMaxLoss(group);
    
    result.push({
      strategyName: group.strategyName || 'Strategia Complessa',
      underlying: group.underlying,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation
    });
  }
  
  return result;
}

/**
 * Main function: analyze portfolio risk across all categories.
 */
export function analyzePortfolioRisk(
  positions: Position[],
  categories: DerivativeCategories
): RiskAnalysis {
  // Get stock/ETF positions (excluding commodities)
  const stockAssetTypes = ['stock', 'etf'];
  const stocks = positions.filter(p => stockAssetTypes.includes(p.asset_type));
  
  // Get commodity positions separately
  const commodities = positions.filter(p => p.asset_type === 'commodity');
  
  // Calculate each risk category
  const stockDetails = calculateStockRisk(stocks, categories.longPuts);
  const commodityDetails = calculateCommodityRisk(commodities);
  const nakedPutDetails = calculateNakedPutRisk(categories.nakedPuts);
  const leapCallDetails = calculateLeapCallRisk(categories.leapCalls);
  const strategyDetails = calculateStrategyRisk(categories);
  
  // Sum up totals in EUR
  const totalStockRisk = stockDetails.reduce((sum, s) => sum + s.riskEUR, 0);
  const totalETFRisk = stockDetails.filter(s => s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalPureStockRisk = stockDetails.filter(s => !s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalCommodityRisk = commodityDetails.reduce((sum, c) => sum + c.riskEUR, 0);
  const totalNakedPutRisk = nakedPutDetails.reduce((sum, n) => sum + n.riskEUR, 0);
  const totalLeapCallRisk = leapCallDetails.reduce((sum, l) => sum + l.riskEUR, 0);
  const totalStrategyRisk = strategyDetails.reduce((sum, s) => sum + s.maxLossEUR, 0);
  const grandTotal = totalStockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk;
  
  return {
    totalStockRisk,
    totalETFRisk,
    totalPureStockRisk,
    totalCommodityRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    grandTotal,
    stockDetails,
    commodityDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails
  };
}

/**
 * Calculate commodity risk.
 * Formula: Quantità × Prezzo / Cambio (no protection available for commodities)
 */
export function calculateCommodityRisk(
  commodities: Position[]
): CommodityRiskDetail[] {
  return commodities.map(commodity => {
    const quantity = commodity.quantity || 0;
    const price = commodity.current_price || 0;
    const value = quantity * price;
    const exchangeRate = getEffectiveExchangeRate(commodity);
    const currency = commodity.currency || 'USD';
    
    return {
      underlying: commodity.ticker || commodity.description,
      value,
      quantity,
      price,
      riskOriginal: value,
      riskEUR: value / exchangeRate,
      currency,
      exchangeRate
    };
  });
}
