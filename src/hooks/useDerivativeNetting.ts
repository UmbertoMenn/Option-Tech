import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { DerivativeOverride } from '@/types/derivativeOverrides';

export interface NettingResult {
  // Netting excluding OTM covered calls, with ITM covered calls valued at intrinsic value
  nettingExCoveredCall: number;
  // Total netting including all derivatives
  nettingTotal: number;
  // Netting excluding OTM covered calls AND OTM naked puts
  nettingExCCAndNP: number;
}

/**
 * Gets the effective exchange rate for a position.
 * Returns the exchange_rate if available, otherwise defaults to 1 (EUR or fallback).
 */
function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  // EUR currency or missing rate = no conversion needed
  return 1;
}

/**
 * Calculates the portfolio value with derivatives netting.
 * All derivative values are converted to EUR using their exchange_rate.
 * 
 * Netting logic:
 * - Sold options (quantity < 0): SUBTRACT (current_price * |quantity| * 100 / exchange_rate)
 *   → Closing a sold option means buying it back, reducing portfolio value
 * - Bought options (quantity > 0): ADD (current_price * quantity * 100 / exchange_rate)
 *   → Closing a bought option means selling it, increasing portfolio value
 * 
 * Netting ex CC logic:
 * - OTM covered calls (strike >= stock price): excluded completely (no impact)
 * - ITM covered calls (strike < stock price): subtract (contracts * 100 * (stock_price - strike)) / exchange_rate
 * 
 * @param positions All portfolio positions
 * @param summary Portfolio summary with total value
 * @param overrides Manual derivative overrides
 * @returns Netting values for both calculations
 */
export function useDerivativeNetting(
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = []
): NettingResult {
  return useMemo(() => {
    if (!summary || positions.length === 0) {
      return {
        nettingExCoveredCall: summary?.totalValue ?? 0,
        nettingTotal: summary?.totalValue ?? 0,
        nettingExCCAndNP: summary?.totalValue ?? 0,
      };
    }

    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    
    if (derivatives.length === 0) {
      return {
        nettingExCoveredCall: summary.totalValue,
        nettingTotal: summary.totalValue,
        nettingExCCAndNP: summary.totalValue,
      };
    }

    // Categorize derivatives to identify covered calls and naked puts (with overrides)
    const categories = categorizeDerivatives(derivatives, positions, overrides);
    
    // Create map of covered call IDs to their data for ITM/OTM check
    const coveredCallMap = new Map(
      categories.coveredCalls.map(cc => [cc.option.id, cc])
    );
    
    // Create map of naked put IDs to their data for ITM/OTM check
    const nakedPutMap = new Map(
      categories.nakedPuts.map(np => [np.option.id, np])
    );
    
    // Calculate netting for each derivative
    let totalNetting = 0;
    let nettingExCoveredCall = 0;
    let nettingExCCAndNP = 0;
    
    for (const derivative of derivatives) {
      const price = derivative.snapshot_price ?? derivative.current_price ?? 0;
      const quantity = derivative.quantity;
      const multiplier = 100; // Standard option multiplier
      const exchangeRate = getEffectiveExchangeRate(derivative);
      
      // Netting value: positive for bought options, negative for sold options
      // Convert to EUR by dividing by exchange rate
      const nettingValue = (price * quantity * multiplier) / exchangeRate;
      
      totalNetting += nettingValue;
      
      // For netting ex covered call: special handling for covered calls
      const coveredCall = coveredCallMap.get(derivative.id);
      const nakedPut = nakedPutMap.get(derivative.id);
      
      if (coveredCall) {
        // This is a covered call - check if ITM or OTM
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = coveredCall.underlying.snapshot_price ?? coveredCall.underlying.current_price ?? 0;
        
        if (strikePrice < underlyingPrice) {
          // ITM covered call: subtract intrinsic value converted to EUR
          // (contracts * 100 * (stock_price - strike)) / exchange_rate
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          nettingExCoveredCall -= intrinsicValue;
          nettingExCCAndNP -= intrinsicValue;
        }
        // OTM covered call (strike >= underlyingPrice): don't subtract anything
      } else if (nakedPut) {
        // This is a naked put - check if ITM/OTM for nettingExCCAndNP
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = nakedPut.underlying?.snapshot_price ?? nakedPut.underlying?.current_price ?? 0;
        
        // Include full netting value in nettingExCoveredCall (naked puts are always included)
        nettingExCoveredCall += nettingValue;
        
        // For nettingExCCAndNP: use intrinsic value for ITM, exclude OTM
        if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
          // OTM naked put (strike < underlying): excluded (will expire worthless)
        } else if (underlyingPrice > 0 && strikePrice >= underlyingPrice) {
          // ITM naked put: subtract intrinsic value (consistent with covered call ITM)
          // Formula: (strike - underlying) × contracts × 100 / exchange_rate
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (strikePrice - underlyingPrice)) / exchangeRate;
          nettingExCCAndNP -= intrinsicValue;
        } else {
          // No underlying price available: fallback to market buyback cost
          nettingExCCAndNP += nettingValue;
        }
      } else {
        // Not a covered call or naked put - include full netting value
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
      }
    }
    
    return {
      nettingExCoveredCall: summary.totalValue + nettingExCoveredCall,
      nettingTotal: summary.totalValue + totalNetting,
      nettingExCCAndNP: summary.totalValue + nettingExCCAndNP,
    };
  }, [positions, summary, overrides]);
}
