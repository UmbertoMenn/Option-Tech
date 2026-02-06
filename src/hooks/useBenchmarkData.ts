import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { HistoricalDataEntry } from '@/types/historicalData';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';

interface BenchmarkPrice {
  ticker: string;
  price_date: string;
  close_price: number;
}

interface BenchmarkReturn {
  date: string;
  returnPct: number;
  benchmarkType: 'equity' | 'balanced';
}

// Benchmark tickers
const EQUITY_BENCHMARKS = ['URTH', 'SPY', 'ACWI', 'EXSA.DE'] as const;
const BOND_TICKER = 'AGG';
const BALANCED_EQUITY_TICKER = 'SPY';

/**
 * Calculate the equity exposure percentage from a historical data entry
 */
function getEquityExposure(entry: HistoricalDataEntry, viewMode: ViewMode): number {
  // For base view, use total_value as denominator
  // For netting views, the netting value includes derivatives exposure
  const baseValue = entry.total_value;
  
  if (baseValue <= 0) return 0;
  
  // Estimate equity exposure based on view mode
  // In netting views, if netting > total_value, exposure > 100%
  switch (viewMode) {
    case 'base':
      // Base view: use stored average_balance ratio or default to 60%
      return 0.6; // Conservative default
    case 'netting_total':
    case 'netting_ex_cc':
    case 'netting_ex_cc_np': {
      const nettingValue = viewMode === 'netting_total' 
        ? entry.netting_total 
        : viewMode === 'netting_ex_cc' 
          ? entry.netting_ex_cc 
          : (entry.netting_ex_cc_np ?? entry.netting_ex_cc);
      
      // If netting > base, exposure > 100%
      const ratio = nettingValue / baseValue;
      // Cap at 150% for benchmark calculation purposes
      return Math.min(ratio, 1.5);
    }
    default:
      return 0.6;
  }
}

/**
 * Select appropriate benchmark based on equity exposure
 * - exposure >= 90% → 100% equity benchmark
 * - exposure 40-60% → 50/50 balanced
 * - otherwise → weighted blend
 */
function selectBenchmarkWeight(equityExposure: number): { equityWeight: number; useBalanced: boolean } {
  if (equityExposure >= 0.9) {
    return { equityWeight: 1, useBalanced: false };
  } else if (equityExposure >= 0.4 && equityExposure <= 0.6) {
    return { equityWeight: 0, useBalanced: true };
  } else if (equityExposure > 0.6) {
    // Interpolate between balanced and equity
    const t = (equityExposure - 0.6) / 0.3;
    return { equityWeight: t, useBalanced: false };
  } else {
    // Below 40%, still use balanced but note it's not a perfect match
    return { equityWeight: 0, useBalanced: true };
  }
}

export function useBenchmarkData(
  historicalData: HistoricalDataEntry[],
  viewMode: ViewMode,
  currentDate?: string | null
) {
  // Get date range from historical data
  const dateRange = useMemo(() => {
    if (historicalData.length === 0) return null;
    
    const dates = historicalData.map(h => new Date(h.snapshot_date));
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    let maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    // Extend to current date if provided and later than last snapshot
    if (currentDate) {
      const current = new Date(currentDate);
      if (current > maxDate) {
        maxDate = current;
      }
    }
    
    // Extend range slightly for buffer
    minDate.setDate(minDate.getDate() - 7);
    
    return {
      from: minDate.toISOString().split('T')[0],
      to: maxDate.toISOString().split('T')[0],
    };
  }, [historicalData, currentDate]);

  // Fetch benchmark prices
  const { data: benchmarkPrices, isLoading } = useQuery({
    queryKey: ['benchmark-prices', dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!dateRange) return [];
      
      const { data, error } = await supabase
        .from('benchmark_prices')
        .select('ticker, price_date, close_price')
        .gte('price_date', dateRange.from)
        .lte('price_date', dateRange.to)
        .order('price_date', { ascending: true });
      
      if (error) throw error;
      return data as BenchmarkPrice[];
    },
    enabled: !!dateRange,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Calculate benchmark returns aligned with historical snapshots
  const benchmarkReturns = useMemo(() => {
    if (!benchmarkPrices || benchmarkPrices.length === 0 || historicalData.length < 2) {
      return [];
    }

    // Group prices by ticker and date
    const pricesByTicker: Record<string, Record<string, number>> = {};
    benchmarkPrices.forEach(p => {
      if (!pricesByTicker[p.ticker]) pricesByTicker[p.ticker] = {};
      pricesByTicker[p.ticker][p.price_date] = p.close_price;
    });

    // Sort historical data
    const sortedHistory = [...historicalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    // Find the closest benchmark price for a given date
    const getClosestPrice = (ticker: string, targetDate: string): number | null => {
      const prices = pricesByTicker[ticker];
      if (!prices) return null;
      
      // Try exact match first
      if (prices[targetDate]) return prices[targetDate];
      
      // Find closest date before target
      const sortedDates = Object.keys(prices).sort();
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        if (sortedDates[i] <= targetDate) {
          return prices[sortedDates[i]];
        }
      }
      
      // Fallback to first available
      return prices[sortedDates[0]] || null;
    };

    // Calculate cumulative returns from the first snapshot
    const firstEntry = sortedHistory[0];
    const firstDate = firstEntry.snapshot_date;
    
    // Get base prices for all benchmarks
    const basePrices: Record<string, number> = {};
    [...EQUITY_BENCHMARKS, BOND_TICKER].forEach(ticker => {
      const price = getClosestPrice(ticker, firstDate);
      if (price) basePrices[ticker] = price;
    });

    // Calculate returns for each historical snapshot
    const returns: Array<{
      date: string;
      equityReturn: number;
      balancedReturn: number;
      scaledReturn: number;
    }> = [];

    sortedHistory.forEach((entry, index) => {
      if (index === 0) {
        returns.push({
          date: entry.snapshot_date,
          equityReturn: 0,
          balancedReturn: 0,
          scaledReturn: 0,
        });
        return;
      }

      // Calculate equity benchmark return (average of available equity benchmarks)
      let equityReturns: number[] = [];
      EQUITY_BENCHMARKS.forEach(ticker => {
        const basePrice = basePrices[ticker];
        const currentPrice = getClosestPrice(ticker, entry.snapshot_date);
        if (basePrice && currentPrice) {
          equityReturns.push(((currentPrice - basePrice) / basePrice) * 100);
        }
      });
      const avgEquityReturn = equityReturns.length > 0 
        ? equityReturns.reduce((a, b) => a + b, 0) / equityReturns.length 
        : 0;

      // Calculate balanced return (50% SPY + 50% AGG)
      const spyBase = basePrices[BALANCED_EQUITY_TICKER];
      const spyCurrent = getClosestPrice(BALANCED_EQUITY_TICKER, entry.snapshot_date);
      const aggBase = basePrices[BOND_TICKER];
      const aggCurrent = getClosestPrice(BOND_TICKER, entry.snapshot_date);
      
      let balancedReturn = 0;
      if (spyBase && spyCurrent && aggBase && aggCurrent) {
        const spyReturn = ((spyCurrent - spyBase) / spyBase) * 100;
        const aggReturn = ((aggCurrent - aggBase) / aggBase) * 100;
        balancedReturn = 0.5 * spyReturn + 0.5 * aggReturn;
      }

      // Calculate scaled return based on equity exposure
      const equityExposure = getEquityExposure(entry, viewMode);
      const { equityWeight, useBalanced } = selectBenchmarkWeight(equityExposure);
      
      let scaledReturn: number;
      if (useBalanced) {
        scaledReturn = balancedReturn;
      } else if (equityWeight === 1) {
        scaledReturn = avgEquityReturn;
      } else {
        // Blend between balanced and equity
        scaledReturn = equityWeight * avgEquityReturn + (1 - equityWeight) * balancedReturn;
      }

      returns.push({
        date: entry.snapshot_date,
        equityReturn: avgEquityReturn,
        balancedReturn,
        scaledReturn,
      });
    });

    // Add current date point if provided and not already in returns
    if (currentDate && !returns.find(r => r.date === currentDate)) {
      let equityReturnsCurrent: number[] = [];
      EQUITY_BENCHMARKS.forEach(ticker => {
        const basePrice = basePrices[ticker];
        const currentPrice = getClosestPrice(ticker, currentDate);
        if (basePrice && currentPrice) {
          equityReturnsCurrent.push(((currentPrice - basePrice) / basePrice) * 100);
        }
      });
      const avgEquityReturnCurrent = equityReturnsCurrent.length > 0 
        ? equityReturnsCurrent.reduce((a, b) => a + b, 0) / equityReturnsCurrent.length 
        : 0;

      // Use last historical entry for equity exposure
      const lastEntry = sortedHistory[sortedHistory.length - 1];
      const equityExposure = getEquityExposure(lastEntry, viewMode);
      const { equityWeight, useBalanced } = selectBenchmarkWeight(equityExposure);
      
      // Calculate balanced return for current date
      const spyBase = basePrices[BALANCED_EQUITY_TICKER];
      const spyCurrent = getClosestPrice(BALANCED_EQUITY_TICKER, currentDate);
      const aggBase = basePrices[BOND_TICKER];
      const aggCurrent = getClosestPrice(BOND_TICKER, currentDate);
      
      let balancedReturnCurrent = 0;
      if (spyBase && spyCurrent && aggBase && aggCurrent) {
        const spyReturn = ((spyCurrent - spyBase) / spyBase) * 100;
        const aggReturn = ((aggCurrent - aggBase) / aggBase) * 100;
        balancedReturnCurrent = 0.5 * spyReturn + 0.5 * aggReturn;
      }

      let scaledReturnCurrent: number;
      if (useBalanced) {
        scaledReturnCurrent = balancedReturnCurrent;
      } else if (equityWeight === 1) {
        scaledReturnCurrent = avgEquityReturnCurrent;
      } else {
        scaledReturnCurrent = equityWeight * avgEquityReturnCurrent + (1 - equityWeight) * balancedReturnCurrent;
      }

      returns.push({
        date: currentDate,
        equityReturn: avgEquityReturnCurrent,
        balancedReturn: balancedReturnCurrent,
        scaledReturn: scaledReturnCurrent,
      });
    }

    return returns;
  }, [benchmarkPrices, historicalData, viewMode, currentDate]);

  return {
    benchmarkReturns,
    isLoading,
    hasBenchmarkData: benchmarkReturns.length > 0,
  };
}
