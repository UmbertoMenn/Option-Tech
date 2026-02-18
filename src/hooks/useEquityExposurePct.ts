import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';

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
 */
export function useEquityExposurePct(options: UseEquityExposurePctOptions = {}): EquityExposureResult {
  const {
    includeNakedPut = true,
    includeStrategies = true,
    includeLeapCall = true
  } = options;
  
  const { positions, summary, isLoading: isLoadingPortfolio } = usePortfolio();
  const { overrides, isLoading: isLoadingOverrides } = useDerivativeOverrides();
  const { selectedPortfolioId } = usePortfolioContext();
  
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  
  const result = useMemo(() => {
    const isLoading = isLoadingPortfolio || isLoadingOverrides;
    
    if (!positions || positions.length === 0 || !summary || summary.totalValue <= 0) {
      return {
        equityExposurePct: 0.6,
        equityExposureEUR: 0,
        assetsTotalEUR: 0,
        isLoading,
        hasData: false
      };
    }

    let totalStockRisk = 0;
    let totalCommodityRisk = 0;
    let totalNakedPutRisk = 0;
    let totalLeapCallRisk = 0;
    let totalStrategyRisk = 0;

    const analyzePositions = (posArr: Position[], ovr: typeof overrides) => {
      const snap = posArr.map(p => ({
        ...p,
        current_price: p.snapshot_price ?? p.current_price,
        market_value: p.snapshot_market_value ?? p.market_value,
      }));
      const derivs = snap.filter(p => p.asset_type === 'derivative');
      const cats = categorizeDerivatives(derivs, snap, ovr);
      return analyzePortfolioRisk(snap, cats);
    };

    if (isGlobalAggregate) {
      // Per-portfolio analysis and sum
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

      for (const [pid, pPositions] of byPortfolio) {
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const analysis = analyzePositions(pPositions, pOverrides);
        totalStockRisk += analysis.totalStockRisk;
        totalCommodityRisk += analysis.totalCommodityRisk;
        totalNakedPutRisk += analysis.totalNakedPutRisk;
        totalLeapCallRisk += analysis.totalLeapCallRisk;
        totalStrategyRisk += analysis.totalStrategyRisk;
      }
    } else {
      const analysis = analyzePositions(positions, overrides);
      totalStockRisk = analysis.totalStockRisk;
      totalCommodityRisk = analysis.totalCommodityRisk;
      totalNakedPutRisk = analysis.totalNakedPutRisk;
      totalLeapCallRisk = analysis.totalLeapCallRisk;
      totalStrategyRisk = analysis.totalStrategyRisk;
    }
    
    const grandTotal = 
      totalStockRisk +
      totalCommodityRisk +
      (includeNakedPut ? totalNakedPutRisk : 0) +
      (includeLeapCall ? totalLeapCallRisk : 0) +
      (includeStrategies ? totalStrategyRisk : 0);
    
    const assetsTotalEUR = summary.totalValue;
    let equityExposurePct = grandTotal / assetsTotalEUR;
    equityExposurePct = Math.max(0, Math.min(1, equityExposurePct));
    
    return {
      equityExposurePct,
      equityExposureEUR: grandTotal,
      assetsTotalEUR,
      isLoading,
      hasData: true
    };
  }, [positions, summary, overrides, isLoadingPortfolio, isLoadingOverrides, includeNakedPut, includeStrategies, includeLeapCall, isGlobalAggregate]);
  
  return result;
}
