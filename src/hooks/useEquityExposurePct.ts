import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';

export interface UseEquityExposurePctOptions {
  /** Include Naked PUT exposure in calculation (default: true) */
  includeNakedPut?: boolean;
  /** Include Strategies exposure in calculation (default: true) */
  includeStrategies?: boolean;
  /** Include Leap CALL exposure in calculation (default: true) */
  includeLeapCall?: boolean;
}

export interface EquityExposureResult {
  /** Equity exposure as percentage (0-1), capped at 100% */
  equityExposurePct: number;
  /** Total risk exposure in EUR (grandTotal from Risk Analyzer) */
  equityExposureEUR: number;
  /** Total asset value in EUR (from portfolio summary) */
  assetsTotalEUR: number;
  /** Whether data is still loading */
  isLoading: boolean;
  /** Whether we have valid data */
  hasData: boolean;
}

/**
 * Hook that calculates equity exposure percentage using the same logic as Risk Analyzer.
 * 
 * Formula: equityExposurePct = grandTotal / totalValue (capped at 100%)
 * 
 * Where grandTotal can include:
 * - ETF + Stocks (net of protections) + Commodities (always included)
 * - Naked PUT (optional, default: true)
 * - Leap CALL (optional, default: true)
 * - Strategies Max Loss (optional, default: true)
 * 
 * For benchmark comparison, use with all flags set to false to get direct equity exposure only.
 */
export function useEquityExposurePct(options: UseEquityExposurePctOptions = {}): EquityExposureResult {
  const {
    includeNakedPut = true,
    includeStrategies = true,
    includeLeapCall = true
  } = options;
  
  const { positions, summary, isLoading: isLoadingPortfolio } = usePortfolio();
  const { overrides, isLoading: isLoadingOverrides } = useDerivativeOverrides();
  
  const result = useMemo(() => {
    const isLoading = isLoadingPortfolio || isLoadingOverrides;
    
    // Default fallback when data is not available
    if (!positions || positions.length === 0 || !summary || summary.totalValue <= 0) {
      return {
        equityExposurePct: 0.6, // Conservative fallback
        equityExposureEUR: 0,
        assetsTotalEUR: 0,
        isLoading,
        hasData: false
      };
    }
    
    // Use snapshot prices for equity exposure (Excel values, not live cron prices)
    const snapshotPositions: Position[] = positions.map(p => ({
      ...p,
      current_price: p.snapshot_price ?? p.current_price,
      market_value: p.snapshot_market_value ?? p.market_value,
    }));
    
    // Filter derivatives
    const derivatives = snapshotPositions.filter(p => p.asset_type === 'derivative');
    
    // Categorize derivatives using existing logic WITH overrides (same as Risk Analyzer)
    const categories = categorizeDerivatives(derivatives, snapshotPositions, overrides);
    
    // Calculate risk analysis (same as Risk Analyzer)
    const analysis = analyzePortfolioRisk(snapshotPositions, categories);
    
    // Dynamic grandTotal based on options
    // Always include: ETF + Stocks (net of protections) + Commodities
    // Conditionally include: Naked PUT, Leap CALL, Strategies
    const grandTotal = 
      analysis.totalStockRisk +        // Stocks (already net of protections)
      analysis.totalCommodityRisk +    // Commodities
      (includeNakedPut ? analysis.totalNakedPutRisk : 0) +
      (includeLeapCall ? analysis.totalLeapCallRisk : 0) +
      (includeStrategies ? analysis.totalStrategyRisk : 0);
    
    const assetsTotalEUR = summary.totalValue;
    
    // Calculate percentage with safety clamp
    let equityExposurePct = grandTotal / assetsTotalEUR;
    
    // Clamp between 0 and 1 to avoid unrealistic values
    equityExposurePct = Math.max(0, Math.min(1, equityExposurePct));
    
    return {
      equityExposurePct,
      equityExposureEUR: grandTotal,
      assetsTotalEUR,
      isLoading,
      hasData: true
    };
  }, [positions, summary, overrides, isLoadingPortfolio, isLoadingOverrides, includeNakedPut, includeStrategies, includeLeapCall]);
  
  return result;
}
