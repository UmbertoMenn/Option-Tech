import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk } from '@/lib/riskCalculator';

export interface EquityExposureResult {
  /** Equity exposure as percentage (0-1) */
  equityExposurePct: number;
  /** Equity exposure in EUR (totalStockRisk from Risk Analyzer) */
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
 * Formula: equityExposurePct = totalStockRisk / totalValue
 * 
 * Where:
 * - totalStockRisk = Stocks + Equity ETFs (net of Long PUT protections)
 * - totalValue = Total asset value (cash, bonds, stocks, ETFs, commodities - excludes derivatives)
 */
export function useEquityExposurePct(): EquityExposureResult {
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
    
    // Filter derivatives
    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    
    // Categorize derivatives using existing logic WITH overrides (same as Risk Analyzer)
    const categories = categorizeDerivatives(derivatives, positions, overrides);
    
    // Calculate risk analysis (same as Risk Analyzer)
    const analysis = analyzePortfolioRisk(positions, categories);
    
    // Equity exposure = totalStockRisk / totalValue
    // totalStockRisk includes Stocks + Equity ETFs, net of Long PUT protections
    const equityExposureEUR = analysis.totalStockRisk;
    const assetsTotalEUR = summary.totalValue;
    
    // Calculate percentage with safety clamp
    let equityExposurePct = equityExposureEUR / assetsTotalEUR;
    
    // Clamp between 0 and 1 to avoid unrealistic values
    equityExposurePct = Math.max(0, Math.min(1, equityExposurePct));
    
    return {
      equityExposurePct,
      equityExposureEUR,
      assetsTotalEUR,
      isLoading,
      hasData: true
    };
  }, [positions, summary, overrides, isLoadingPortfolio, isLoadingOverrides]);
  
  return result;
}
