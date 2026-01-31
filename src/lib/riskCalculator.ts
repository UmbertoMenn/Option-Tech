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
  
  // Include stocks, equity ETFs, and commodities as equity exposure
  const equityAssetTypes = ['stock', 'etf', 'commodity'];
  
  for (const stock of stocks) {
    if (!equityAssetTypes.includes(stock.asset_type)) continue;
    
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
 * Calculate the initial premium (GP) from avg_cost values.
 * Sold options (qty < 0) contribute positive premium (we receive money).
 * Bought options (qty > 0) contribute negative premium (we pay money).
 * Net GP = premium received - premium paid
 */
function calculateInitialPremium(positions: Position[]): number {
  let netPremium = 0;
  for (const pos of positions) {
    const avgCost = pos.avg_cost || 0;
    const qty = pos.quantity || 0;
    // For sold options (qty < 0): we received premium = avgCost * |qty| * 100
    // For bought options (qty > 0): we paid premium = avgCost * qty * 100
    // Net = received - paid = -qty * avgCost * 100 (since qty is negative for sold)
    netPremium += -qty * avgCost * 100;
  }
  return netPremium;
}

/**
 * Calculate Iron Condor max loss.
 * Formula: max(PUT spread width, CALL spread width) × 100 × contratti - GP
 * GP is calculated from initial premiums (avg_cost), not current market values.
 */
function calculateIronCondorMaxLoss(ic: IronCondorPosition): { maxLoss: number; calculation: string } {
  const putSpreadWidth = Math.abs((ic.soldPut.strike_price || 0) - (ic.boughtPut.strike_price || 0));
  const callSpreadWidth = Math.abs((ic.boughtCall.strike_price || 0) - (ic.soldCall.strike_price || 0));
  const maxSpreadWidth = Math.max(putSpreadWidth, callSpreadWidth);
  
  // GP = Gain Potenziale (premi incassati - premi pagati) from INITIAL premiums
  const gp = calculateInitialPremium([ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall]);
  
  const grossMaxLoss = maxSpreadWidth * 100 * ic.contracts;
  const maxLoss = grossMaxLoss - gp;
  
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
  
  const gp = calculateInitialPremium([dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall]);
  const grossMaxLoss = maxSpreadWidth * 100 * dd.contracts;
  const maxLoss = grossMaxLoss - gp;
  
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
  
  // Sort options by strike
  const sortedOptions = [...options].sort((a, b) => 
    (a.option.strike_price || 0) - (b.option.strike_price || 0)
  );
  
  const puts = sortedOptions.filter(o => o.option.option_type === 'put');
  const calls = sortedOptions.filter(o => o.option.option_type === 'call');
  
  // Calculate initial premium (GP) from avg_cost values
  const gp = calculateInitialPremium(options.map(o => o.option));
  
  // SHORT STRANGLE: Risk = Strike PUT venduta × 100 × contratti
  if (strategyName === 'Short Strangle' || strategyName === 'Short Straddle') {
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
  
  // LONG STRANGLE / LONG STRADDLE: Risk = premium paid
  if (strategyName === 'Long Strangle' || strategyName === 'Long Straddle') {
    // We paid for these options, risk is the premium paid
    const premiumPaid = options.reduce((sum, o) => {
      const avgCost = o.option.avg_cost || 0;
      const qty = Math.abs(o.option.quantity);
      return sum + avgCost * qty * 100;
    }, 0);
    return {
      maxLoss: premiumPaid,
      calculation: `Premio pagato = ${premiumPaid.toFixed(0)}`
    };
  }
  
  // VERTICAL SPREADS (Bull Put, Bear Put, Bull Call, Bear Call)
  if (strategyName?.includes('Spread') && !strategyName.includes('Diagonal') && !strategyName.includes('Calendar')) {
    const relevantOptions = strategyName.includes('Put') ? puts : calls;
    if (relevantOptions.length >= 2) {
      const strikes = relevantOptions.map(o => o.option.strike_price || 0).sort((a, b) => a - b);
      const spreadWidth = strikes[strikes.length - 1] - strikes[0];
      const contracts = Math.abs(relevantOptions[0].option.quantity);
      const grossMaxLoss = spreadWidth * 100 * contracts;
      const maxLoss = grossMaxLoss - gp;
      return {
        maxLoss: Math.max(0, maxLoss),
        calculation: `(${strikes[strikes.length - 1]} - ${strikes[0]}) × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${Math.max(0, maxLoss).toFixed(0)}`
      };
    }
  }
  
  // DIAGONAL/CALENDAR SPREADS: Risk = premium paid for long leg
  if (strategyName?.includes('Diagonal') || strategyName?.includes('Calendar')) {
    // Use net debit when present; otherwise (credit structures) avoid returning 0 by using
    // a conservative PUT-based exposure (sold put strike, optionally reduced by bought put strike).
    const netDebit = -gp; // If gp is negative, we paid net premium

    if (netDebit > 0) {
      return {
        maxLoss: netDebit,
        calculation: `Debito netto (premio pagato) = ${netDebit.toFixed(0)}`
      };
    }

    // Credit / zero-debit: fallback to PUT short-side risk
    const soldPuts = puts.filter(p => p.option.quantity < 0);
    const boughtPuts = puts.filter(p => p.option.quantity > 0);

    if (soldPuts.length > 0) {
      const soldPut = soldPuts.sort((a, b) => (b.option.strike_price || 0) - (a.option.strike_price || 0))[0];
      const soldStrike = soldPut.option.strike_price || 0;
      const contracts = Math.abs(soldPut.option.quantity || 0);

      const bestBoughtPut = boughtPuts
        .sort((a, b) => (a.option.strike_price || 0) - (b.option.strike_price || 0))[0];
      const boughtStrike = bestBoughtPut?.option.strike_price ?? null;

      // If we have a bought put, approximate as a spread risk; otherwise treat as naked.
      // For calendar (same strike), spreadWidth = 0 → fall back to naked strike risk.
      const spreadWidth = boughtStrike !== null ? Math.max(0, soldStrike - boughtStrike) : 0;
      const baseRisk = spreadWidth > 0 ? spreadWidth * 100 * contracts : soldStrike * 100 * contracts;
      const maxLoss = Math.max(0, baseRisk - gp); // credit reduces max loss

      return {
        maxLoss,
        calculation:
          boughtStrike !== null
            ? `MaxLoss ≈ (${soldStrike} - ${boughtStrike}) × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
            : `MaxLoss ≈ ${soldStrike} × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${maxLoss.toFixed(0)}`
      };
    }

    // If no sold PUT exists, fall back to premium-based estimate (rare for diagonal/calendar)
    const boughtOptions = options.filter(o => o.option.quantity > 0);
    const premiumPaid = boughtOptions.reduce((sum, o) => {
      const avgCost = o.option.avg_cost || 0;
      const qty = o.option.quantity;
      return sum + avgCost * qty * 100;
    }, 0);
    return {
      maxLoss: premiumPaid,
      calculation: `Premio pagato = ${premiumPaid.toFixed(0)}`
    };
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
      const grossMaxLoss = maxWidth * 100 * contracts;
      const maxLoss = grossMaxLoss - gp;
      return {
        maxLoss: Math.max(0, maxLoss),
        calculation: `Max width ${maxWidth} × 100 × ${contracts} - ${gp.toFixed(0)} GP = ${Math.max(0, maxLoss).toFixed(0)}`
      };
    }
  }
  
  // DEFAULT: For strategies with sold PUTs, use strike as max loss
  const soldOptions = options.filter(o => o.option.quantity < 0);
  if (soldOptions.length > 0) {
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
    // For sold CALLs without underlying, risk is theoretically infinite
    // Use a conservative estimate based on premium received
    const soldCalls = soldOptions.filter(o => o.option.option_type === 'call');
    if (soldCalls.length > 0) {
      const premiumReceived = soldCalls.reduce((sum, c) => {
        return sum + (c.option.avg_cost || 0) * Math.abs(c.option.quantity) * 100;
      }, 0);
      return {
        maxLoss: premiumReceived * 10, // Conservative estimate: 10x premium
        calculation: `CALL vendute senza copertura - rischio teorico illimitato (stima ${(premiumReceived * 10).toFixed(0)})`
      };
    }
  }
  
  // Fallback: For bought options, risk is premium paid
  const boughtOptions = options.filter(o => o.option.quantity > 0);
  if (boughtOptions.length > 0) {
    const premiumPaid = boughtOptions.reduce((sum, o) => {
      return sum + (o.option.avg_cost || 0) * o.option.quantity * 100;
    }, 0);
    return {
      maxLoss: premiumPaid,
      calculation: `Premio pagato = ${premiumPaid.toFixed(0)}`
    };
  }
  
  // Final fallback
  return {
    maxLoss: Math.abs(gp),
    calculation: `Premio netto = ${Math.abs(gp).toFixed(0)}`
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
  // Get equity positions (stocks, ETFs, commodities)
  const equityAssetTypes = ['stock', 'etf', 'commodity'];
  const stocks = positions.filter(p => equityAssetTypes.includes(p.asset_type));
  
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
