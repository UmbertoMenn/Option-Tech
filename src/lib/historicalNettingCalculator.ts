import { Position } from '@/types/portfolio';

/**
 * Stand-alone netting calculator for historical data.
 * Replicates the logic from useDerivativeNetting.ts without React dependencies.
 * 
 * For historical data, we use a simplified approach:
 * - Covered Calls are identified when a sold CALL has a matching stock in the positions
 * - Naked Puts are sold PUTs without matching stock
 * - OTM/ITM determination uses strike price vs avg_cost as proxy (no live prices in historical data)
 */

export interface HistoricalNettingResult {
  totalValue: number;
  nettingTotal: number;
  nettingExCC: number;
  nettingExCCNP: number;
}

/**
 * Normalize string for matching (remove suffixes, prefixes, normalize case)
 */
function normalizeForMatching(str: string): string {
  return str
    .toUpperCase()
    .replace(/\s+INC\.?$/i, '')
    .replace(/\s+CORP\.?$/i, '')
    .replace(/\s+LTD\.?$/i, '')
    .replace(/\s+PLC\.?$/i, '')
    .replace(/\s+ADR$/i, '')
    .replace(/\s+SPA$/i, '')
    .replace(/\s+AG$/i, '')
    .replace(/^AZ\.\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two names match (flexible matching)
 */
function namesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeForMatching(name1);
  const n2 = normalizeForMatching(name2);
  
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Token-based matching
  const tokens1 = n1.split(' ').filter(t => t.length > 2);
  const tokens2 = n2.split(' ').filter(t => t.length > 2);
  
  if (tokens1.length === 0 || tokens2.length === 0) return false;
  
  // Check if main tokens match
  const mainToken1 = tokens1[0];
  const mainToken2 = tokens2[0];
  
  return mainToken1 === mainToken2 || 
         mainToken1.startsWith(mainToken2) || 
         mainToken2.startsWith(mainToken1);
}

/**
 * Find matching stock for an option
 */
function findUnderlyingStock(option: Position, stockPositions: Position[]): Position | null {
  const optionUnderlying = option.underlying || option.description;
  
  for (const stock of stockPositions) {
    const stockName = stock.ticker || stock.description;
    if (namesMatch(optionUnderlying, stockName)) {
      return stock;
    }
  }
  
  return null;
}

/**
 * Gets the effective exchange rate for a position.
 */
function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

/**
 * Calculate netting values from parsed positions (stand-alone, no React).
 * 
 * Logic:
 * 1. totalValue = sum(market_value of non-derivatives) + cashValue
 * 2. nettingTotal = totalValue + all derivative netting values
 * 3. nettingExCC = totalValue + derivative netting BUT:
 *    - OTM covered calls: excluded
 *    - ITM covered calls: subtract intrinsic value
 * 4. nettingExCCNP = like nettingExCC BUT:
 *    - OTM naked puts: excluded
 *    - ITM naked puts: subtract intrinsic value
 */
export function calculateNettingFromPositions(
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[],
  cashValue: number
): HistoricalNettingResult {
  // Calculate total value (non-derivatives + cash)
  const nonDerivatives = positions.filter(p => p.asset_type !== 'derivative');
  const totalValue = nonDerivatives.reduce((sum, p) => sum + (p.market_value ?? 0), 0) + cashValue;
  
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  
  if (derivatives.length === 0) {
    return {
      totalValue,
      nettingTotal: totalValue,
      nettingExCC: totalValue,
      nettingExCCNP: totalValue,
    };
  }
  
  // Get stock positions for matching
  const stockPositions = positions.filter(p => p.asset_type === 'stock') as Position[];
  
  // Identify covered calls and naked puts
  const coveredCallIds = new Set<number>();
  const nakedPutIds = new Set<number>();
  
  // Map derivatives with their matching stocks
  const derivativeInfo = derivatives.map((d, idx) => {
    const underlying = findUnderlyingStock(d as Position, stockPositions);
    return { derivative: d, index: idx, underlying };
  });
  
  // Identify covered calls (sold calls with underlying stock)
  for (const info of derivativeInfo) {
    const d = info.derivative;
    if (d.option_type === 'call' && d.quantity < 0 && info.underlying && info.underlying.quantity > 0) {
      coveredCallIds.add(info.index);
    }
  }
  
  // Identify naked puts (sold puts without underlying stock)
  for (const info of derivativeInfo) {
    const d = info.derivative;
    if (d.option_type === 'put' && d.quantity < 0) {
      // Naked put if no underlying stock, or underlying stock qty <= 0
      if (!info.underlying || info.underlying.quantity <= 0) {
        nakedPutIds.add(info.index);
      }
    }
  }
  
  // Calculate netting
  let totalNetting = 0;
  let nettingExCC = 0;
  let nettingExCCNP = 0;
  
  for (let i = 0; i < derivatives.length; i++) {
    const d = derivatives[i];
    const info = derivativeInfo[i];
    
    const price = d.current_price ?? 0;
    const quantity = d.quantity;
    const multiplier = 100;
    const exchangeRate = getEffectiveExchangeRate(d as Position);
    
    // Netting value: positive for bought, negative for sold
    const nettingValue = (price * quantity * multiplier) / exchangeRate;
    
    totalNetting += nettingValue;
    
    const isCoveredCall = coveredCallIds.has(i);
    const isNakedPut = nakedPutIds.has(i);
    
    if (isCoveredCall && info.underlying) {
      // Covered Call handling
      const strikePrice = d.strike_price ?? 0;
      // Use avg_cost as proxy for underlying price (historical data has no live prices)
      const underlyingPrice = info.underlying.current_price ?? info.underlying.avg_cost ?? 0;
      
      if (strikePrice < underlyingPrice) {
        // ITM covered call: subtract intrinsic value
        const contracts = Math.abs(quantity);
        const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
        nettingExCC -= intrinsicValue;
        nettingExCCNP -= intrinsicValue;
      }
      // OTM covered call: exclude completely (don't add anything)
    } else if (isNakedPut) {
      // Naked Put handling
      const strikePrice = d.strike_price ?? 0;
      // For naked puts without underlying, use current_price if available
      const underlyingPrice = info.underlying?.current_price ?? info.underlying?.avg_cost ?? 0;
      
      // Add to nettingExCC (naked puts are always included)
      nettingExCC += nettingValue;
      
      if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
        // OTM naked put: exclude from nettingExCCNP
        // (will expire worthless, don't add anything)
      } else if (underlyingPrice > 0 && strikePrice >= underlyingPrice) {
        // ITM naked put: subtract intrinsic value
        const contracts = Math.abs(quantity);
        const intrinsicValue = (contracts * multiplier * (strikePrice - underlyingPrice)) / exchangeRate;
        nettingExCCNP -= intrinsicValue;
      } else {
        // No underlying price: fallback to market buyback cost
        nettingExCCNP += nettingValue;
      }
    } else {
      // Not a covered call or naked put - include full netting value
      nettingExCC += nettingValue;
      nettingExCCNP += nettingValue;
    }
  }
  
  return {
    totalValue,
    nettingTotal: totalValue + totalNetting,
    nettingExCC: totalValue + nettingExCC,
    nettingExCCNP: totalValue + nettingExCCNP,
  };
}
