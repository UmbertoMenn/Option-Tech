import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { useStrategyConfigurations, StrategyConfiguration } from './useStrategyConfigurations';
import { useGPHoldings } from './useGPHoldings';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk } from '@/lib/riskCalculator';
import { computeSinglePortfolioNetting } from './useDerivativeNetting';
import { Position } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';

export interface UseEquityExposurePctOptions {
  includeNakedPut?: boolean;
  includeStrategies?: boolean;
  includeLeapCall?: boolean;
}

export interface EquityExposureResult {
  equityExposurePct: number;
  equityExposureEUR: number;
  assetsTotalEUR: number;
  isLoading: boolean;
  hasData: boolean;
}

/**
 * Equity exposure allineata al Risk Analyzer:
 *   numeratore = grandTotal (stock+ETF+commodity+naked put+leap+strategie+sintetiche CC/DR-CC)
 *                + valore stock GP
 *   denominatore = netting_total (totalValue + nettingResult.totalNetting)
 *
 * I toggle includeNakedPut/includeStrategies/includeLeapCall restano supportati;
 * con default (tutti true + GP) il risultato coincide con la card Risk Analyzer
 * "Protezioni incluse".
 */
export function useEquityExposurePct(options: UseEquityExposurePctOptions = {}): EquityExposureResult {
  const {
    includeNakedPut = true,
    includeStrategies = true,
    includeLeapCall = true
  } = options;
  
  const { positions, summary, isLoading: isLoadingPortfolio } = usePortfolio();
  const { overrides, isLoading: isLoadingOverrides } = useDerivativeOverrides();
  const { configurations: strategyConfigs, isLoading: isLoadingConfigs } = useStrategyConfigurations();
  const { gpSummary, isLoading: isLoadingGP } = useGPHoldings() as any;
  const { selectedPortfolioId } = usePortfolioContext();
  
  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  
  const result = useMemo(() => {
    const isLoading = isLoadingPortfolio || isLoadingOverrides || isLoadingConfigs || !!isLoadingGP;
    
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
    let totalSyntheticCcDrccRisk = 0;
    let totalNetting = 0;

    const analyzeAndNet = (
      posArr: Position[],
      ovr: DerivativeOverride[],
      cfgs: StrategyConfiguration[]
    ) => {
      const snap = posArr.map(p => ({
        ...p,
        current_price: p.snapshot_price ?? p.current_price,
        market_value: p.snapshot_market_value ?? p.market_value,
      }));
      const derivs = snap.filter(p => p.asset_type === 'derivative');
      const cats = categorizeDerivatives(derivs, snap, ovr, cfgs);
      const analysis = analyzePortfolioRisk(snap, cats);
      const netting = computeSinglePortfolioNetting(snap, ovr, undefined, cfgs);
      return { analysis, netting };
    };

    if (isGlobalAggregate) {
      const byPortfolio = new Map<string, Position[]>();
      positions.forEach(p => {
        if (!byPortfolio.has(p.portfolio_id)) byPortfolio.set(p.portfolio_id, []);
        byPortfolio.get(p.portfolio_id)!.push(p);
      });

      const overridesByPortfolio = new Map<string, DerivativeOverride[]>();
      overrides.forEach(o => {
        if (!overridesByPortfolio.has(o.portfolio_id)) overridesByPortfolio.set(o.portfolio_id, []);
        overridesByPortfolio.get(o.portfolio_id)!.push(o);
      });

      const configsByPortfolio = new Map<string, StrategyConfiguration[]>();
      strategyConfigs.forEach(c => {
        if (!configsByPortfolio.has(c.portfolio_id)) configsByPortfolio.set(c.portfolio_id, []);
        configsByPortfolio.get(c.portfolio_id)!.push(c);
      });

      for (const [pid, pPositions] of byPortfolio) {
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const { analysis, netting } = analyzeAndNet(pPositions, pOverrides, pConfigs);
        totalStockRisk += analysis.totalStockRisk;
        totalCommodityRisk += analysis.totalCommodityRisk;
        totalNakedPutRisk += analysis.totalNakedPutRisk;
        totalLeapCallRisk += analysis.totalLeapCallRisk;
        totalStrategyRisk += analysis.totalStrategyRisk;
        totalSyntheticCcDrccRisk += analysis.totalSyntheticCcDrccRisk;
        totalNetting += netting.totalNetting;
      }
    } else {
      const { analysis, netting } = analyzeAndNet(positions, overrides, strategyConfigs);
      totalStockRisk = analysis.totalStockRisk;
      totalCommodityRisk = analysis.totalCommodityRisk;
      totalNakedPutRisk = analysis.totalNakedPutRisk;
      totalLeapCallRisk = analysis.totalLeapCallRisk;
      totalStrategyRisk = analysis.totalStrategyRisk;
      totalSyntheticCcDrccRisk = analysis.totalSyntheticCcDrccRisk;
      totalNetting = netting.totalNetting;
    }
    
    const gpStockValue = Number(gpSummary?.stockValue ?? 0);

    const numerator =
      totalStockRisk +
      totalCommodityRisk +
      totalSyntheticCcDrccRisk +
      (includeNakedPut ? totalNakedPutRisk : 0) +
      (includeLeapCall ? totalLeapCallRisk : 0) +
      (includeStrategies ? totalStrategyRisk : 0) +
      gpStockValue;
    
    const nettingTotal = summary.totalValue + totalNetting;
    const denominator = nettingTotal > 0 ? nettingTotal : summary.totalValue;
    let equityExposurePct = denominator > 0 ? numerator / denominator : 0.6;
    equityExposurePct = Math.max(0, Math.min(1, equityExposurePct));
    
    return {
      equityExposurePct,
      equityExposureEUR: numerator,
      assetsTotalEUR: denominator,
      isLoading,
      hasData: true
    };
  }, [positions, summary, overrides, strategyConfigs, isLoadingPortfolio, isLoadingOverrides, isLoadingConfigs, isLoadingGP, gpSummary, includeNakedPut, includeStrategies, includeLeapCall, isGlobalAggregate]);
  
  return result;
}
