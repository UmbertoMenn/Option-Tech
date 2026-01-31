import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk, RiskAnalysis } from '@/lib/riskCalculator';

export function useRiskAnalysis(): RiskAnalysis & { isLoading: boolean } {
  const { positions, isLoading } = usePortfolio();
  
  const analysis = useMemo(() => {
    if (!positions || positions.length === 0) {
      return {
        totalStockRisk: 0,
        totalCommodityRisk: 0,
        totalNakedPutRisk: 0,
        totalLeapCallRisk: 0,
        totalStrategyRisk: 0,
        grandTotal: 0,
        stockDetails: [],
        commodityDetails: [],
        nakedPutDetails: [],
        leapCallDetails: [],
        strategyDetails: []
      };
    }
    
    // Filter derivatives
    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    
    // Categorize derivatives using existing logic
    const categories = categorizeDerivatives(derivatives, positions);
    
    // Calculate risk analysis
    return analyzePortfolioRisk(positions, categories);
  }, [positions]);
  
  return {
    ...analysis,
    isLoading
  };
}
