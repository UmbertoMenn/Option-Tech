import { useState, useMemo, useEffect, useRef } from 'react';
import { useRiskAnalysis } from './useRiskAnalysis';
import { useETFAllocations, ETFAllocation } from './useETFAllocations';
import { calculateCurrencyExposure, CurrencyExposure, CurrencyExposureOptions } from '@/lib/currencyExposure';
import { applyETFDecomposition } from '@/lib/etfCurrencyDecomposition';

export interface CurrencyExposureResult {
  exposures: CurrencyExposure[];
  usdExposure: CurrencyExposure | null;
  usdExposurePct: number;  // 0-1
  totalExposure: number;   // EUR
  isLoading: boolean;
  isETFDataLoading: boolean;
  etfCount: number;
  loadedETFCount: number;
  allocations: Record<string, ETFAllocation>;
}

export interface UseCurrencyExposureOptions extends CurrencyExposureOptions {}

/**
 * Centralized hook for calculating currency exposure with ETF decomposition.
 * Used by both RiskAnalyzer and PerformanceEvolutionChart.
 */
export function useCurrencyExposure(options: UseCurrencyExposureOptions = {}): CurrencyExposureResult {
  const { includeDerivatives = true, includeBonds = true } = options;
  
  const [hasFetchedETFs, setHasFetchedETFs] = useState(false);
  const riskAnalysis = useRiskAnalysis();
  const { isLoading, ...analysis } = riskAnalysis;
  
  const { allocations, fetchMultipleAllocations, loading: etfLoading } = useETFAllocations();
  
  // Calculate base currency exposure from existing data
  const baseCurrencyExposure = useMemo(() => 
    calculateCurrencyExposure(analysis, { includeDerivatives, includeBonds }), 
    [analysis, includeDerivatives, includeBonds]
  );
  
  // Extract ETF ISINs from stock details - use the isETF flag from riskCalculator
  const etfIsins = useMemo(() => {
    const isins: string[] = [];
    const seen = new Set<string>();
    
    for (const stock of analysis.stockDetails) {
      // Use the isETF flag (derived from asset_type === 'etf') instead of pattern matching
      if (stock.isin && !seen.has(stock.isin) && stock.isETF) {
        seen.add(stock.isin);
        isins.push(stock.isin);
      }
    }
    return isins;
  }, [analysis.stockDetails]);
  
  // Fetch ETF allocations ONCE when data is ready
  useEffect(() => {
    if (etfIsins.length > 0 && !hasFetchedETFs) {
      setHasFetchedETFs(true);
      fetchMultipleAllocations(etfIsins);
    }
  }, [etfIsins, hasFetchedETFs, fetchMultipleAllocations]);
  
  // Apply ETF decomposition to currency exposure
  const currencyExposure = useMemo(() => {
    if (Object.keys(allocations).length === 0) {
      return baseCurrencyExposure;
    }
    return applyETFDecomposition(baseCurrencyExposure, allocations);
  }, [baseCurrencyExposure, allocations]);
  
  // Check if any ETF data is still loading
  const isETFDataLoading = Object.values(etfLoading).some(Boolean);
  
  // Calculate totals and USD exposure
  const { totalExposure, usdExposure, usdExposurePct } = useMemo(() => {
    const total = currencyExposure.reduce((sum, c) => sum + c.totalRisk, 0);
    const usd = currencyExposure.find(c => c.currency === 'USD') || null;
    const pct = total > 0 && usd ? usd.totalRisk / total : 0;
    
    return {
      totalExposure: total,
      usdExposure: usd,
      usdExposurePct: pct,
    };
  }, [currencyExposure]);
  
  // Count loaded ETFs
  const loadedETFCount = useMemo(() => 
    Object.keys(allocations).filter(isin => etfIsins.includes(isin)).length,
    [allocations, etfIsins]
  );
  
  return {
    exposures: currencyExposure,
    usdExposure,
    usdExposurePct,
    totalExposure,
    isLoading,
    isETFDataLoading,
    etfCount: etfIsins.length,
    loadedETFCount,
    allocations,
  };
}
