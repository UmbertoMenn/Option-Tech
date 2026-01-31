import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';

export interface NettingResult {
  // Netting excluding OTM covered calls, with ITM covered calls valued at intrinsic value
  nettingExCoveredCall: number;
  // Total netting including all derivatives
  nettingTotal: number;
}

/**
 * Calculates the portfolio value with derivatives netting.
 * 
 * Netting logic:
 * - Sold options (quantity < 0): SUBTRACT (current_price * |quantity| * 100) from portfolio
 *   → Closing a sold option means buying it back, reducing portfolio value
 * - Bought options (quantity > 0): ADD (current_price * quantity * 100) to portfolio
 *   → Closing a bought option means selling it, increasing portfolio value
 * 
 * Netting ex CC logic:
 * - OTM covered calls (strike > stock price): excluded completely (no impact)
 * - ITM covered calls (strike <= stock price): subtract contracts * 100 * (stock_price - strike)
 * 
 * @param positions All portfolio positions
 * @param summary Portfolio summary with total value
 * @returns Netting values for both calculations
 */
export function useDerivativeNetting(
  positions: Position[],
  summary: PortfolioSummary | null
): NettingResult {
  return useMemo(() => {
    if (!summary || positions.length === 0) {
      return {
        nettingExCoveredCall: summary?.totalValue ?? 0,
        nettingTotal: summary?.totalValue ?? 0,
      };
    }

    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    
    if (derivatives.length === 0) {
      return {
        nettingExCoveredCall: summary.totalValue,
        nettingTotal: summary.totalValue,
      };
    }

    // Categorize derivatives to identify covered calls
    const categories = categorizeDerivatives(derivatives, positions);
    
    // Create map of covered call IDs to their data for ITM/OTM check
    const coveredCallMap = new Map(
      categories.coveredCalls.map(cc => [cc.option.id, cc])
    );
    
    // Calculate netting for each derivative
    let totalNetting = 0;
    let nettingExCoveredCall = 0;
    
    for (const derivative of derivatives) {
      const price = derivative.current_price ?? 0;
      const quantity = derivative.quantity;
      const multiplier = 100; // Standard option multiplier
      
      // Netting value: positive for bought options, negative for sold options
      // This is what we'd get/pay if we closed the position
      const nettingValue = price * quantity * multiplier;
      
      totalNetting += nettingValue;
      
      // For netting ex covered call: special handling for covered calls
      const coveredCall = coveredCallMap.get(derivative.id);
      
      if (coveredCall) {
        // This is a covered call - check if ITM or OTM
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = coveredCall.underlying.current_price ?? 0;
        
        if (strikePrice < underlyingPrice) {
          // ITM covered call: subtract intrinsic value
          // contracts * 100 * (stock_price - strike)
          const contracts = Math.abs(quantity);
          const intrinsicValue = contracts * multiplier * (underlyingPrice - strikePrice);
          nettingExCoveredCall -= intrinsicValue;
        }
        // OTM covered call (strike >= underlyingPrice): don't subtract anything
      } else {
        // Not a covered call - include full netting value
        nettingExCoveredCall += nettingValue;
      }
    }
    
    return {
      nettingExCoveredCall: summary.totalValue + nettingExCoveredCall,
      nettingTotal: summary.totalValue + totalNetting,
    };
  }, [positions, summary]);
}
