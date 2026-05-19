import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { useStrategyConfigurations, StrategyConfiguration } from './useStrategyConfigurations';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk, RiskAnalysis } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';

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
  const { configurations: strategyConfigs, isLoading: isLoadingConfigs } = useStrategyConfigurations();
  const { selectedPortfolioId } = usePortfolioContext();
  
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  
  const analysis = useMemo(() => {
    const empty: RiskAnalysis = {
      totalStockRisk: 0, totalETFRisk: 0, totalPureStockRisk: 0,
      totalCommodityRisk: 0, totalBondRisk: 0, totalNakedPutRisk: 0,
      totalLeapCallRisk: 0, totalStrategyRisk: 0, totalSyntheticCcDrccRisk: 0,
      grandTotal: 0,
      stockDetails: [], syntheticCcDrccDetails: [], commodityDetails: [], bondDetails: [],
      nakedPutDetails: [], leapCallDetails: [], strategyDetails: []
    };

    if (!positions || positions.length === 0) return empty;
    
    if (isGlobalAggregate) {
      const byPortfolio = new Map<string, Position[]>();
      positions.forEach(p => {
        if (!byPortfolio.has(p.portfolio_id)) byPortfolio.set(p.portfolio_id, []);
        byPortfolio.get(p.portfolio_id)!.push(p);
      });

      const overridesByPortfolio = new Map<string, typeof overrides>();
      overrides.forEach(o => {
        if (!overridesByPortfolio.has(o.portfolio_id)) overridesByPortfolio.set(o.portfolio_id, []);
        overridesByPortfolio.get(o.portfolio_id)!.push(o);
      });

      const configsByPortfolio = new Map<string, StrategyConfiguration[]>();
      strategyConfigs.forEach(c => {
        if (!configsByPortfolio.has(c.portfolio_id)) configsByPortfolio.set(c.portfolio_id, []);
        configsByPortfolio.get(c.portfolio_id)!.push(c);
      });

      const merged = { ...empty };

      for (const [pid, pPositions] of byPortfolio) {
        const snap = toSnapshotPositions(pPositions);
        const derivs = snap.filter(p => p.asset_type === 'derivative');
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const cats = categorizeDerivatives(derivs, snap, pOverrides, pConfigs);
        const result = analyzePortfolioRisk(snap, cats);

        merged.totalStockRisk += result.totalStockRisk;
        merged.totalETFRisk += result.totalETFRisk;
        merged.totalPureStockRisk += result.totalPureStockRisk;
        merged.totalCommodityRisk += result.totalCommodityRisk;
        merged.totalBondRisk += result.totalBondRisk;
        merged.totalNakedPutRisk += result.totalNakedPutRisk;
        merged.totalLeapCallRisk += result.totalLeapCallRisk;
        merged.totalStrategyRisk += result.totalStrategyRisk;
        merged.grandTotal += result.grandTotal;
        merged.stockDetails.push(...result.stockDetails);
        merged.commodityDetails.push(...result.commodityDetails);
        merged.bondDetails.push(...result.bondDetails);
        merged.nakedPutDetails.push(...result.nakedPutDetails);
        merged.leapCallDetails.push(...result.leapCallDetails);
        merged.strategyDetails.push(...result.strategyDetails);
      }

      return merged;
    }
    
    // Single portfolio / user aggregate: standard logic
    const snapshotPositions = toSnapshotPositions(positions);
    const derivatives = snapshotPositions.filter(p => p.asset_type === 'derivative');
    const categories = categorizeDerivatives(derivatives, snapshotPositions, overrides, strategyConfigs);
    return analyzePortfolioRisk(snapshotPositions, categories);
  }, [positions, overrides, strategyConfigs, isGlobalAggregate]);
  
  return {
    ...analysis,
    isLoading: isLoading || isLoadingOverrides || isLoadingConfigs
  };
}
