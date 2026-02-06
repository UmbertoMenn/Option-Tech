import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo, useCallback } from 'react';
import { HistoricalDataEntry } from '@/types/historicalData';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';

interface BenchmarkPrice {
  ticker: string;
  price_date: string;
  close_price: number;
}

export interface StaleTickerDetail {
  lastDate: string;
  daysDiff: number;
}

export interface BenchmarkDataGap {
  date: string;
  missingTickers: string[];
  staleTickers: string[];
  staleDetails: Record<string, StaleTickerDetail>;
}

export interface BenchmarkStaleSummary {
  ticker: string;
  lastDate: string;
  daysDiff: number;
}

// Benchmark tickers
const EQUITY_BENCHMARKS = ['URTH', 'SPY', 'ACWI', 'EXSA.DE'] as const;
const BOND_TICKER = 'AGG';
const BALANCED_EQUITY_TICKER = 'SPY';
const ALL_TICKERS = [...EQUITY_BENCHMARKS, BOND_TICKER] as const;

// Pagination settings
const PAGE_SIZE = 1000;

/**
 * Fetch all benchmark prices with pagination to avoid the 1000-row limit
 */
async function fetchAllBenchmarkPrices(from: string, to: string): Promise<BenchmarkPrice[]> {
  const allPrices: BenchmarkPrice[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('benchmark_prices')
      .select('ticker, price_date, close_price')
      .gte('price_date', from)
      .lte('price_date', to)
      .order('price_date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      allPrices.push(...(data as BenchmarkPrice[]));
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  console.log(`[Benchmark] Fetched ${allPrices.length} total price records for range ${from} to ${to}`);
  
  // Log max date per ticker for debugging
  const maxDates: Record<string, string> = {};
  allPrices.forEach(p => {
    if (!maxDates[p.ticker] || p.price_date > maxDates[p.ticker]) {
      maxDates[p.ticker] = p.price_date;
    }
  });
  console.log('[Benchmark] Max price_date per ticker:', maxDates);

  return allPrices;
}

/**
 * Calculate the equity exposure percentage from a historical data entry
 */
function getEquityExposure(entry: HistoricalDataEntry, viewMode: ViewMode): number {
  const baseValue = entry.total_value;
  
  if (baseValue <= 0) return 0;
  
  switch (viewMode) {
    case 'base':
      return 0.6; // Conservative default
    case 'netting_total':
    case 'netting_ex_cc':
    case 'netting_ex_cc_np': {
      const nettingValue = viewMode === 'netting_total' 
        ? entry.netting_total 
        : viewMode === 'netting_ex_cc' 
          ? entry.netting_ex_cc 
          : (entry.netting_ex_cc_np ?? entry.netting_ex_cc);
      
      const ratio = nettingValue / baseValue;
      return Math.min(ratio, 1.5);
    }
    default:
      return 0.6;
  }
}

/**
 * Select appropriate benchmark based on equity exposure
 */
function selectBenchmarkWeight(equityExposure: number): { equityWeight: number; useBalanced: boolean } {
  if (equityExposure >= 0.9) {
    return { equityWeight: 1, useBalanced: false };
  } else if (equityExposure >= 0.4 && equityExposure <= 0.6) {
    return { equityWeight: 0, useBalanced: true };
  } else if (equityExposure > 0.6) {
    const t = (equityExposure - 0.6) / 0.3;
    return { equityWeight: t, useBalanced: false };
  } else {
    return { equityWeight: 0, useBalanced: true };
  }
}

export function useBenchmarkData(
  historicalData: HistoricalDataEntry[],
  viewMode: ViewMode,
  currentDate?: string | null
) {
  const queryClient = useQueryClient();

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

  // Fetch benchmark prices with pagination
  const { data: benchmarkPrices, isLoading, refetch } = useQuery({
    queryKey: ['benchmark-prices', dateRange?.from, dateRange?.to],
    queryFn: async () => {
      if (!dateRange) return [];
      return fetchAllBenchmarkPrices(dateRange.from, dateRange.to);
    },
    enabled: !!dateRange,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Refresh benchmark data from the server
  const refreshBenchmark = useCallback(async () => {
    try {
      console.log('[Benchmark] Triggering refresh from update-benchmark-prices edge function...');
      const { data, error } = await supabase.functions.invoke('update-benchmark-prices', {
        body: { backfill: false },
      });
      
      if (error) {
        console.error('[Benchmark] Refresh failed:', error);
        throw error;
      }
      
      console.log('[Benchmark] Refresh result:', data);
      
      // Invalidate the query to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['benchmark-prices'] });
      
      return data;
    } catch (err) {
      console.error('[Benchmark] Error refreshing benchmark:', err);
      throw err;
    }
  }, [queryClient]);

  // Calculate benchmark returns aligned with historical snapshots
  const { benchmarkReturns, dataGaps, staleSummary } = useMemo(() => {
    if (!benchmarkPrices || benchmarkPrices.length === 0 || historicalData.length < 2) {
      return { benchmarkReturns: [], dataGaps: [], staleSummary: [] };
    }

    // Group prices by ticker and date
    const pricesByTicker: Record<string, Record<string, number>> = {};
    benchmarkPrices.forEach(p => {
      if (!pricesByTicker[p.ticker]) pricesByTicker[p.ticker] = {};
      pricesByTicker[p.ticker][p.price_date] = p.close_price;
    });

    // Calculate last fetched date per ticker for staleness detection
    const lastFetchedDateByTicker: Record<string, string> = {};
    ALL_TICKERS.forEach(ticker => {
      const prices = pricesByTicker[ticker];
      if (prices) {
        const sortedDates = Object.keys(prices).sort();
        lastFetchedDateByTicker[ticker] = sortedDates[sortedDates.length - 1] || '';
      }
    });

    // Sort historical data
    const sortedHistory = [...historicalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    // Track data gaps
    const gaps: BenchmarkDataGap[] = [];

    // Find the closest benchmark price for a given date
    const getClosestPrice = (ticker: string, targetDate: string): { 
      price: number | null; 
      matchedDate: string | null;
      isStale: boolean;
      daysDiff: number;
    } => {
      const prices = pricesByTicker[ticker];
      if (!prices) return { price: null, matchedDate: null, isStale: true, daysDiff: -1 };
      
      // Try exact match first
      if (prices[targetDate]) {
        return { price: prices[targetDate], matchedDate: targetDate, isStale: false, daysDiff: 0 };
      }
      
      // Find closest date before target
      const sortedDates = Object.keys(prices).sort();
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        if (sortedDates[i] <= targetDate) {
          const priceDate = new Date(sortedDates[i]);
          const target = new Date(targetDate);
          const daysDiff = Math.floor((target.getTime() - priceDate.getTime()) / (1000 * 60 * 60 * 24));
          // Consider stale if more than 7 days old
          return { 
            price: prices[sortedDates[i]], 
            matchedDate: sortedDates[i],
            isStale: daysDiff > 7,
            daysDiff 
          };
        }
      }
      
      // Fallback to first available (definitely stale)
      if (sortedDates.length > 0) {
        const priceDate = new Date(sortedDates[0]);
        const target = new Date(targetDate);
        const daysDiff = Math.floor((target.getTime() - priceDate.getTime()) / (1000 * 60 * 60 * 24));
        return { price: prices[sortedDates[0]], matchedDate: sortedDates[0], isStale: true, daysDiff: Math.abs(daysDiff) };
      }
      
      return { price: null, matchedDate: null, isStale: true, daysDiff: -1 };
    };

    // Calculate cumulative returns from the first snapshot
    const firstEntry = sortedHistory[0];
    const firstDate = firstEntry.snapshot_date;
    
    // Get base prices for all benchmarks
    const basePrices: Record<string, number> = {};
    ALL_TICKERS.forEach(ticker => {
      const result = getClosestPrice(ticker, firstDate);
      if (result.price) basePrices[ticker] = result.price;
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
      const equityReturns: number[] = [];
      const missingTickers: string[] = [];
      const staleTickers: string[] = [];
      const staleDetails: Record<string, StaleTickerDetail> = {};
      
      EQUITY_BENCHMARKS.forEach(ticker => {
        const basePrice = basePrices[ticker];
        const result = getClosestPrice(ticker, entry.snapshot_date);
        if (basePrice && result.price) {
          equityReturns.push(((result.price - basePrice) / basePrice) * 100);
          if (result.isStale && result.matchedDate) {
            staleTickers.push(ticker);
            staleDetails[ticker] = { lastDate: result.matchedDate, daysDiff: result.daysDiff };
          }
        } else {
          missingTickers.push(ticker);
        }
      });

      // Also check bond ticker
      const aggResult = getClosestPrice(BOND_TICKER, entry.snapshot_date);
      if (!aggResult.price) {
        missingTickers.push(BOND_TICKER);
      } else if (aggResult.isStale && aggResult.matchedDate) {
        staleTickers.push(BOND_TICKER);
        staleDetails[BOND_TICKER] = { lastDate: aggResult.matchedDate, daysDiff: aggResult.daysDiff };
      }
      
      if (missingTickers.length > 0 || staleTickers.length > 0) {
        gaps.push({ date: entry.snapshot_date, missingTickers, staleTickers, staleDetails });
      }

      const avgEquityReturn = equityReturns.length > 0 
        ? equityReturns.reduce((a, b) => a + b, 0) / equityReturns.length 
        : 0;

      // Calculate balanced return (50% SPY + 50% AGG)
      const spyBase = basePrices[BALANCED_EQUITY_TICKER];
      const spyResult = getClosestPrice(BALANCED_EQUITY_TICKER, entry.snapshot_date);
      const aggBase = basePrices[BOND_TICKER];
      
      let balancedReturn = 0;
      if (spyBase && spyResult.price && aggBase && aggResult.price) {
        const spyReturn = ((spyResult.price - spyBase) / spyBase) * 100;
        const aggReturn = ((aggResult.price - aggBase) / aggBase) * 100;
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
      const equityReturnsCurrent: number[] = [];
      const missingTickers: string[] = [];
      const staleTickers: string[] = [];
      const staleDetails: Record<string, StaleTickerDetail> = {};

      EQUITY_BENCHMARKS.forEach(ticker => {
        const basePrice = basePrices[ticker];
        const result = getClosestPrice(ticker, currentDate);
        if (basePrice && result.price) {
          equityReturnsCurrent.push(((result.price - basePrice) / basePrice) * 100);
          if (result.isStale && result.matchedDate) {
            staleTickers.push(ticker);
            staleDetails[ticker] = { lastDate: result.matchedDate, daysDiff: result.daysDiff };
          }
        } else {
          missingTickers.push(ticker);
        }
      });

      // Also check bond ticker for current date
      const aggResultCurrent = getClosestPrice(BOND_TICKER, currentDate);
      if (!aggResultCurrent.price) {
        missingTickers.push(BOND_TICKER);
      } else if (aggResultCurrent.isStale && aggResultCurrent.matchedDate) {
        staleTickers.push(BOND_TICKER);
        staleDetails[BOND_TICKER] = { lastDate: aggResultCurrent.matchedDate, daysDiff: aggResultCurrent.daysDiff };
      }

      if (missingTickers.length > 0 || staleTickers.length > 0) {
        gaps.push({ date: currentDate, missingTickers, staleTickers, staleDetails });
      }

      const avgEquityReturnCurrent = equityReturnsCurrent.length > 0 
        ? equityReturnsCurrent.reduce((a, b) => a + b, 0) / equityReturnsCurrent.length 
        : 0;

      // Use last historical entry for equity exposure
      const lastEntry = sortedHistory[sortedHistory.length - 1];
      const equityExposure = getEquityExposure(lastEntry, viewMode);
      const { equityWeight, useBalanced } = selectBenchmarkWeight(equityExposure);
      
      // Calculate balanced return for current date
      const spyBase = basePrices[BALANCED_EQUITY_TICKER];
      const spyResult = getClosestPrice(BALANCED_EQUITY_TICKER, currentDate);
      const aggBase = basePrices[BOND_TICKER];
      
      let balancedReturnCurrent = 0;
      if (spyBase && spyResult.price && aggBase && aggResultCurrent.price) {
        const spyReturn = ((spyResult.price - spyBase) / spyBase) * 100;
        const aggReturn = ((aggResultCurrent.price - aggBase) / aggBase) * 100;
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

    // Calculate stale summary (global overview for the most recent target date)
    const targetDate = currentDate || dateRange?.to || '';
    const summary: BenchmarkStaleSummary[] = [];
    
    if (targetDate) {
      ALL_TICKERS.forEach(ticker => {
        const lastDate = lastFetchedDateByTicker[ticker];
        if (lastDate) {
          const target = new Date(targetDate);
          const last = new Date(lastDate);
          const daysDiff = Math.floor((target.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
          // Report if more than 2 days old (considering weekends)
          if (daysDiff > 2) {
            summary.push({ ticker, lastDate, daysDiff });
          }
        } else {
          summary.push({ ticker, lastDate: 'N/A', daysDiff: -1 });
        }
      });
    }

    return { benchmarkReturns: returns, dataGaps: gaps, staleSummary: summary };
  }, [benchmarkPrices, historicalData, viewMode, currentDate, dateRange?.to]);

  return {
    benchmarkReturns,
    dataGaps,
    staleSummary,
    isLoading,
    hasBenchmarkData: benchmarkReturns.length > 0,
    refreshBenchmark,
  };
}
