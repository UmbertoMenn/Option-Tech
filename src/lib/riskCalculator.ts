import { Position } from '@/types/portfolio';
import { 
  DerivativeCategories, 
  LongPutPosition, 
  NakedPutPosition, 
  LeapCallPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  GroupedOtherStrategy,
  normalizeForMatching,
  getCanonicalKey
} from './derivativeStrategies';
import { 
  calculateUniversalMaxLoss, 
  positionsToLegs,
  OptionLeg 
} from './universalMaxLoss';

export interface StockRiskDetail {
  underlying: string;
  stockValue: number;           // Valore azioni in valuta originale
  stockQuantity: number;        // Numero azioni
  stockPrice: number;           // Prezzo azione
  protectionStrike: number | null;
  protectionContracts: number;
  protectionOptionPrice: number | null; // Prezzo opzione (mkt se disponibile, fallback avg_cost)
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
  marketPrice: number;          // Prezzo di mercato dell'opzione
  expiry: string;
  marketValue: number;          // Rischio = prezzo mercato × contratti × 100
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
  hasUnlimitedRisk: boolean;    // Flag per strategie con rischio illimitato (es. Short Strangle)
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

export interface BondRiskDetail {
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
  totalBondRisk: number;
  totalNakedPutRisk: number;
  totalLeapCallRisk: number;
  totalStrategyRisk: number;
  grandTotal: number;
  
  // Dettagli
  stockDetails: StockRiskDetail[];
  commodityDetails: CommodityRiskDetail[];
  bondDetails: BondRiskDetail[];
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
 * Checks if an option matches a stock using flexible matching logic.
 * This is consistent with derivativeStrategies.ts findUnderlyingStock logic.
 */
function matchesUnderlying(option: Position, stock: Position): boolean {
  // Build full text for matching
  const optionText = normalizeForMatching(
    `${option.underlying || ''} ${option.description || ''} ${option.ticker || ''}`
  );
  const stockText = normalizeForMatching(
    `${stock.ticker || ''} ${stock.description || ''}`
  );
  
  // 1. Direct match
  if (optionText === stockText && optionText.length > 0) return true;
  
  // 2. Check for ticker containment
  if (stock.ticker) {
    const tickerNorm = normalizeForMatching(stock.ticker);
    if (tickerNorm.length > 0 && optionText.includes(tickerNorm)) return true;
  }
  
  // 3. Check for stock name containment
  const stockName = normalizeForMatching(stock.description);
  if (stockName.length > 0 && optionText.includes(stockName)) return true;
  
  // 4. Token-based matching (filter corporate stopwords to avoid false positives)
  const CORPORATE_STOPWORDS = new Set([
    'group', 'holding', 'holdings', 'company', 'companies', 'corp',
    'corporation', 'limited', 'ltd', 'inc', 'incorporated', 'plc',
    'ag', 'sa', 'spa', 'nv', 'bv', 'se', 'the'
  ]);
  const optionTokens = optionText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
  const stockTokens = stockText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
  
  if (stockTokens.length > 0) {
    const matchCount = stockTokens.filter(t => optionTokens.includes(t)).length;
    // For single-word names (e.g., NVIDIA), require 1 match
    // For compound names, require at least half
    const threshold = stockTokens.length === 1 ? 1 : Math.ceil(stockTokens.length / 2);
    if (matchCount >= threshold) return true;
  }
  
  // 5. Special aliases (GOOGLE = ALPHABET, etc.)
  const optionCanonical = getCanonicalKey(optionText);
  const stockCanonical = getCanonicalKey(stockText);
  if (optionCanonical && stockCanonical && optionCanonical === stockCanonical) {
    return true;
  }
  
  return false;
}

// ============= RISK CALCULATION FUNCTIONS =============

/**
 * Calculate stock risk taking into account protective puts.
 * Formula for partial protection:
 * - Risk = (Unprotected Shares × Price) + (Protected Shares × max(0, Price - Strike))
 * 
 * This searches for bought PUTs directly in all positions, bypassing
 * the derivative classification which may group them into "Altre Strategie".
 */
export function calculateStockRisk(
  stocks: Position[],
  longPuts: LongPutPosition[],
  allPositions: Position[]
): StockRiskDetail[] {
  const result: StockRiskDetail[] = [];
  
  // Include only stocks and ETFs (commodities are calculated separately)
  const stockAssetTypes = ['stock', 'etf'];
  
  // Pre-filter all bought PUTs from positions (quantity > 0 = bought)
  const allBoughtPuts = allPositions.filter(p => 
    p.asset_type === 'derivative' && 
    p.option_type === 'put' && 
    (p.quantity || 0) > 0
  );
  
  for (const stock of stocks) {
    if (!stockAssetTypes.includes(stock.asset_type)) continue;
    
    const stockQuantity = stock.quantity || 0;
    const stockPrice = stock.current_price || 0;
    const stockValue = stockQuantity * stockPrice;
    const exchangeRate = getEffectiveExchangeRate(stock);
    const currency = stock.currency || 'USD';
    
    // Find ALL bought PUTs for this stock from positions (bypasses classification)
    const boughtPutsFromPositions = allBoughtPuts.filter(put => matchesUnderlying(put, stock));
    
    // Also check classified longPuts (and avoid duplicates)
    const classifiedPuts = longPuts.filter(lp => matchesUnderlying(lp.option, stock));
    const classifiedPutIds = new Set(classifiedPuts.map(lp => lp.option.id));
    
    // Merge: use classified + additional from positions not already counted
    const additionalPuts = boughtPutsFromPositions.filter(p => !classifiedPutIds.has(p.id));
    
    // Calculate total protection contracts
    const contractsFromClassified = classifiedPuts.reduce((sum, lp) => sum + lp.contracts, 0);
    const contractsFromPositions = additionalPuts.reduce((sum, p) => sum + (p.quantity || 0), 0);
    const protectionContracts = contractsFromClassified + contractsFromPositions;
    
    // Calculate weighted average strike and option price (market if available)
    let avgStrike = 0;
    let avgOptionPrice = 0;
    if (protectionContracts > 0) {
      const classifiedWeightedSum = classifiedPuts.reduce((sum, lp) => 
        sum + (lp.option.strike_price || 0) * lp.contracts, 0
      );
      const positionsWeightedSum = additionalPuts.reduce((sum, p) => 
        sum + (p.strike_price || 0) * (p.quantity || 0), 0
      );
      avgStrike = (classifiedWeightedSum + positionsWeightedSum) / protectionContracts;
      
      // Weighted average option price: prefer current_price, fallback avg_cost
      const classifiedPriceWeightedSum = classifiedPuts.reduce((sum, lp) => {
        const px = (lp.option.current_price ?? lp.option.avg_cost ?? 0);
        return sum + px * lp.contracts;
      }, 0);
      const positionsPriceWeightedSum = additionalPuts.reduce((sum, p) => {
        const px = (p.current_price ?? p.avg_cost ?? 0);
        return sum + px * (p.quantity || 0);
      }, 0);
      avgOptionPrice = (classifiedPriceWeightedSum + positionsPriceWeightedSum) / protectionContracts;
    }
    
    // Calculate protected vs unprotected shares
    const protectedShares = Math.min(protectionContracts * 100, stockQuantity);
    const unprotectedShares = stockQuantity - protectedShares;
    
    // Formula corretta per protezione parziale:
    // Risk = (Azioni_non_protette × Prezzo) + (Azioni_protette × max(0, Prezzo - Strike))
    const unprotectedRisk = unprotectedShares * stockPrice;
    const protectedRisk = protectedShares * Math.max(0, stockPrice - avgStrike);
    const riskOriginal = unprotectedRisk + protectedRisk;
    const riskEUR = riskOriginal / exchangeRate;
    
    // For UI compatibility, protectedValue represents the floor value
    const protectedValue = protectedShares * avgStrike;
    
    result.push({
      underlying: stock.ticker || stock.description,
      stockValue,
      stockQuantity,
      stockPrice,
      protectionStrike: avgStrike > 0 ? avgStrike : null,
      protectionContracts,
      protectionOptionPrice: avgOptionPrice > 0 ? avgOptionPrice : null,
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
 * Formula: Prezzo mercato × Contratti × 100 / Cambio (valore di mercato)
 */
export function calculateLeapCallRisk(
  leapCalls: LeapCallPosition[]
): LeapCallRiskDetail[] {
  return leapCalls.map(lc => {
    const contracts = lc.contracts;
    const avgCost = lc.option.avg_cost || 0;
    const marketPrice = lc.option.current_price || avgCost; // Fallback to avgCost if no market price
    const exchangeRate = getEffectiveExchangeRate(lc.option);
    const marketValue = contracts * marketPrice * 100;
    
    return {
      underlying: lc.option.underlying || lc.option.description,
      strike: lc.option.strike_price || 0,
      contracts,
      avgCost,
      marketPrice,
      expiry: lc.option.expiry_date || '',
      marketValue,
      riskEUR: marketValue / exchangeRate,
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
function calculateGroupedStrategyMaxLoss(group: GroupedOtherStrategy): { 
  maxLoss: number; 
  calculation: string; 
  isUnlimited: boolean;
} {
  const legs = positionsToLegs(group.options.map(o => o.option));
  
  if (legs.length === 0) {
    return { maxLoss: 0, calculation: 'Nessuna gamba', isUnlimited: false };
  }
  
  const result = calculateUniversalMaxLoss(legs);
  
  // Add strategy name to calculation if available
  const strategyPrefix = group.strategyName ? `${group.strategyName}: ` : '';
  
  return {
    maxLoss: result.maxLoss,
    calculation: `${strategyPrefix}${result.calculation}`,
    isUnlimited: result.isUnlimited
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
      calculation,
      hasUnlimitedRisk: false
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
      calculation,
      hasUnlimitedRisk: false
    });
  }
  
  // Grouped Other Strategies
  for (const group of categories.groupedOtherStrategies) {
    if (group.options.length === 0) continue;
    
    const firstOption = group.options[0].option;
    const exchangeRate = getEffectiveExchangeRate(firstOption);
    const currency = firstOption.currency || 'USD';
    const { maxLoss, calculation, isUnlimited } = calculateGroupedStrategyMaxLoss(group);
    
    result.push({
      strategyName: group.strategyName || 'Strategia Complessa',
      underlying: group.underlying,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation,
      hasUnlimitedRisk: isUnlimited
    });
  }
  
  return result;
}

/**
 * Helper to check if a position is an EUROFOREX instrument (excluded from risk analysis).
 */
function isEuroforexInstrument(name: string | undefined | null): boolean {
  return name?.toUpperCase().includes('EUROFOREX') || false;
}

/**
 * Main function: analyze portfolio risk across all categories.
 */
export function analyzePortfolioRisk(
  positions: Position[],
  categories: DerivativeCategories
): RiskAnalysis {
  // Get stock/ETF positions (excluding commodities and bonds)
  const stockAssetTypes = ['stock', 'etf'];
  const stocks = positions.filter(p => stockAssetTypes.includes(p.asset_type));
  
  // Get commodity positions separately
  const commodities = positions.filter(p => p.asset_type === 'commodity');
  
  // Get bond positions separately
  const bonds = positions.filter(p => p.asset_type === 'bond');
  
  // Calculate each risk category
  // Pass allPositions to calculateStockRisk for direct PUT lookup
  const stockDetails = calculateStockRisk(stocks, categories.longPuts, positions);
  const commodityDetails = calculateCommodityRisk(commodities);
  const bondDetails = calculateBondRisk(bonds);
  
  // Filter EUROFOREX from Naked Puts and Leap Calls
  const filteredNakedPuts = categories.nakedPuts.filter(
    np => !isEuroforexInstrument(np.option.underlying || np.option.description)
  );
  const nakedPutDetails = calculateNakedPutRisk(filteredNakedPuts);
  
  const filteredLeapCalls = categories.leapCalls.filter(
    lc => !isEuroforexInstrument(lc.option.underlying || lc.option.description)
  );
  const leapCallDetails = calculateLeapCallRisk(filteredLeapCalls);
  
  const strategyDetails = calculateStrategyRisk(categories);
  
  // Sum up totals in EUR
  const totalStockRisk = stockDetails.reduce((sum, s) => sum + s.riskEUR, 0);
  const totalETFRisk = stockDetails.filter(s => s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalPureStockRisk = stockDetails.filter(s => !s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalCommodityRisk = commodityDetails.reduce((sum, c) => sum + c.riskEUR, 0);
  const totalBondRisk = bondDetails.reduce((sum, b) => sum + b.riskEUR, 0);
  const totalNakedPutRisk = nakedPutDetails.reduce((sum, n) => sum + n.riskEUR, 0);
  const totalLeapCallRisk = leapCallDetails.reduce((sum, l) => sum + l.riskEUR, 0);
  const totalStrategyRisk = strategyDetails.reduce((sum, s) => sum + s.maxLossEUR, 0);
  const grandTotal = totalStockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk;
  
  return {
    totalStockRisk,
    totalETFRisk,
    totalPureStockRisk,
    totalCommodityRisk,
    totalBondRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    grandTotal,
    stockDetails,
    commodityDetails,
    bondDetails,
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

/**
 * Calculate bond risk.
 * Formula: Quantità × Prezzo / Cambio (no protection available for bonds)
 */
export function calculateBondRisk(
  bonds: Position[]
): BondRiskDetail[] {
  return bonds.map(bond => {
    const quantity = bond.quantity || 0;
    const price = bond.current_price || 0;
    // Bonds are quoted as percentage of face value (e.g., 98.5 = 98.5% of 100)
    // So we multiply by quantity and divide by 100 to get actual value
    const value = (quantity * price) / 100;
    const exchangeRate = getEffectiveExchangeRate(bond);
    const currency = bond.currency || 'EUR';
    
    return {
      underlying: bond.ticker || bond.description,
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
