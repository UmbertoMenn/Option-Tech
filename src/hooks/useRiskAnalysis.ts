import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk, RiskAnalysis } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';

/** Replace live prices with Excel snapshot values for Dashboard/Risk Analyzer */
function toSnapshotPositions(positions: Position[]): Position[] {
  return positions.map(p => ({
    ...p,
    current_price: p.snapshot_price ?? p.current_price,
    market_value: p.snapshot_market_value ?? p.market_value,
  }));
}

export function useRiskAnalysis(): RiskAnalysis & { isLoading: boolean } {
  const { positions, isLoading } = usePortfolio();
  const { overrides, isLoading: isLoadingOverrides } = useDerivativeOverrides();
  
  const analysis = useMemo(() => {
    if (!positions || positions.length === 0) {
      return {
        totalStockRisk: 0,
        totalETFRisk: 0,
        totalPureStockRisk: 0,
        totalCommodityRisk: 0,
        totalBondRisk: 0,
        totalNakedPutRisk: 0,
        totalLeapCallRisk: 0,
        totalStrategyRisk: 0,
        grandTotal: 0,
        stockDetails: [],
        commodityDetails: [],
        bondDetails: [],
        nakedPutDetails: [],
        leapCallDetails: [],
        strategyDetails: []
      };
    }
    
    // Use snapshot prices for risk analysis (Excel values, not live cron prices)
    const snapshotPositions = toSnapshotPositions(positions);
    
    // Filter derivatives
    const derivatives = snapshotPositions.filter(p => p.asset_type === 'derivative');
    
    // Categorize derivatives using existing logic WITH overrides
    const categories = categorizeDerivatives(derivatives, snapshotPositions, overrides);
    
    // Calculate risk analysis
    return analyzePortfolioRisk(snapshotPositions, categories);
  }, [positions, overrides]);
  
  return {
    ...analysis,
    isLoading: isLoading || isLoadingOverrides
  };
}
