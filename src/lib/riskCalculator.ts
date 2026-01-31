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

export interface RiskAnalysis {
  // Totali EUR
  totalStockRisk: number;
  totalNakedPutRisk: number;
  totalLeapCallRisk: number;
  totalStrategyRisk: number;
  grandTotal: number;
  
  // Dettagli
  stockDetails: StockRiskDetail[];
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
  
  for (const stock of stocks) {
    if (stock.asset_type !== 'stock') continue;
    
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
      hasProtection: protectionContracts > 0
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
 * Calculate Iron Condor max loss.
 * Formula: max(PUT spread width, CALL spread width) × 100 × contratti - GP
 */
function calculateIronCondorMaxLoss(ic: IronCondorPosition): { maxLoss: number; calculation: string } {
  const putSpreadWidth = Math.abs((ic.soldPut.strike_price || 0) - (ic.boughtPut.strike_price || 0));
  const callSpreadWidth = Math.abs((ic.boughtCall.strike_price || 0) - (ic.soldCall.strike_price || 0));
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  
  // GP = Gain Potenziale (premi incassati - premi pagati)
  // For sold options: market_value is positive (premium received)
  // For bought options: market_value is negative (premium paid)
  const gp = Math.abs(ic.totalPremium);
  
  const maxLoss = (maxSpreadWidth * 100 * ic.contracts) - gp;
  
  return {
    maxLoss: Math.max(0, maxLoss),
    calculation: `Max(${putSpreadWidth}, ${callSpreadWidth}) × 100 × ${ic.contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
  };
}

/**
 * Calculate Double Diagonal max loss.
 * Similar to Iron Condor.
 */
function calculateDoubleDiagonalMaxLoss(dd: DoubleDiagonalPosition): { maxLoss: number; calculation: string } {
  const putSpreadWidth = Math.abs((dd.soldPut.strike_price || 0) - (dd.boughtPut.strike_price || 0));
  const callSpreadWidth = Math.abs((dd.boughtCall.strike_price || 0) - (dd.soldCall.strike_price || 0));
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  
  const gp = Math.abs(dd.totalPremium);
  const maxLoss = (maxSpreadWidth * 100 * dd.contracts) - gp;
  
  return {
    maxLoss: Math.max(0, maxLoss),
    calculation: `Max(${putSpreadWidth}, ${callSpreadWidth}) × 100 × ${dd.contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
  };
}

/**
 * Calculate strategy risk for grouped other strategies.
 */
function calculateGroupedStrategyMaxLoss(group: GroupedOtherStrategy): { maxLoss: number; calculation: string } {
  const strategyName = group.strategyName || 'Unknown';
  const options = group.options;
  
  // Get exchange rate from first option
  const exchangeRate = options.length > 0 ? getEffectiveExchangeRate(options[0].option) : 1;
  
  // Sort options by strike
  const sortedOptions = [...options].sort((a, b) => 
    (a.option.strike_price || 0) - (b.option.strike_price || 0)
  );
  
  const puts = sortedOptions.filter(o => o.option.option_type === 'put');
  const calls = sortedOptions.filter(o => o.option.option_type === 'call');
  
  // SHORT STRANGLE: Risk = Strike PUT venduta × 100 × contratti
  if (strategyName === 'Short Strangle') {
    const soldPuts = puts.filter(p => p.option.quantity < 0);
    if (soldPuts.length > 0) {
      const soldPut = soldPuts[0];
      const strike = soldPut.option.strike_price || 0;
      const contracts = Math.abs(soldPut.option.quantity);
      const maxLoss = strike * 100 * contracts;
      return {
        maxLoss,
        calculation: `Strike PUT ${strike} × 100 × ${contracts} = ${maxLoss.toFixed(0)} (rischio infinito)`
      };
    }
  }
  
  // VERTICAL SPREADS (Bull Put, Bear Put, Bull Call, Bear Call)
  if (strategyName?.includes('Spread') && !strategyName.includes('Diagonal') && !strategyName.includes('Calendar')) {
    const relevantOptions = strategyName.includes('Put') ? puts : calls;
    if (relevantOptions.length >= 2) {
      const strikes = relevantOptions.map(o => o.option.strike_price || 0).sort((a, b) => a - b);
      const spreadWidth = strikes[strikes.length - 1] - strikes[0];
      const contracts = Math.abs(relevantOptions[0].option.quantity);
      const gp = Math.abs(group.totalPremium);
      const maxLoss = (spreadWidth * 100 * contracts) - gp;
      return {
        maxLoss: Math.max(0, maxLoss),
        calculation: `(${strikes[strikes.length - 1]} - ${strikes[0]}) × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
      };
    }
  }
  
  // BROKEN WING BUTTERFLY / BUTTERFLY
  if (strategyName?.includes('Butterfly')) {
    // 3 strikes: bought low, sold middle (2x), bought high
    const strikes = [...new Set(sortedOptions.map(o => o.option.strike_price || 0))].sort((a, b) => a - b);
    if (strikes.length >= 2) {
      const lowerWidth = strikes.length > 1 ? strikes[1] - strikes[0] : 0;
      const upperWidth = strikes.length > 2 ? strikes[2] - strikes[1] : lowerWidth;
      const maxWidth = Math.max(lowerWidth, upperWidth);
      const contracts = Math.abs(sortedOptions[0]?.option.quantity || 1);
      const gp = Math.abs(group.totalPremium);
      const maxLoss = (maxWidth * 100 * contracts) - gp;
      return {
        maxLoss: Math.max(0, maxLoss),
        calculation: `Max width ${maxWidth} × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
      };
    }
  }
  
  // DEFAULT: Sum of absolute values of sold options (conservative estimate)
  const soldOptions = options.filter(o => o.option.quantity < 0);
  if (soldOptions.length > 0) {
    // For sold PUTs, use strike as max loss
    const soldPuts = soldOptions.filter(o => o.option.option_type === 'put');
    if (soldPuts.length > 0) {
      const totalPutRisk = soldPuts.reduce((sum, p) => {
        return sum + (p.option.strike_price || 0) * Math.abs(p.option.quantity) * 100;
      }, 0);
      return {
        maxLoss: totalPutRisk,
        calculation: `Somma strike PUT vendute × 100 × contratti = ${totalPutRisk.toFixed(0)}`
      };
    }
  }
  
  // Fallback: use premium as max loss estimate
  return {
    maxLoss: Math.abs(group.totalPremium),
    calculation: `Premio totale = ${Math.abs(group.totalPremium).toFixed(0)}`
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
  // Get stock positions
  const stocks = positions.filter(p => p.asset_type === 'stock');
  
  // Calculate each risk category
  const stockDetails = calculateStockRisk(stocks, categories.longPuts);
  const nakedPutDetails = calculateNakedPutRisk(categories.nakedPuts);
  const leapCallDetails = calculateLeapCallRisk(categories.leapCalls);
  const strategyDetails = calculateStrategyRisk(categories);
  
  // Sum up totals in EUR
  const totalStockRisk = stockDetails.reduce((sum, s) => sum + s.riskEUR, 0);
  const totalNakedPutRisk = nakedPutDetails.reduce((sum, n) => sum + n.riskEUR, 0);
  const totalLeapCallRisk = leapCallDetails.reduce((sum, l) => sum + l.riskEUR, 0);
  const totalStrategyRisk = strategyDetails.reduce((sum, s) => sum + s.maxLossEUR, 0);
  const grandTotal = totalStockRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk;
  
  return {
    totalStockRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    grandTotal,
    stockDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails
  };
}
