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
const EQUITY_BENCHMARKS = ['SPY', 'QQQ'] as const;
const BOND_TICKER = 'AGG';
const EURUSD_TICKER = 'EURUSD=X';
const ALL_TICKERS = [...EQUITY_BENCHMARKS, BOND_TICKER, EURUSD_TICKER] as const;

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

// Note: getEquityExposure and selectBenchmarkWeight are deprecated.
// The benchmark now uses the real equity exposure percentage from useEquityExposurePct hook.

export function useBenchmarkData(
  historicalData: HistoricalDataEntry[],
  viewMode: ViewMode,
  currentDate?: string | null,
  equityExposurePct?: number | null,
  usdExposurePct?: number | null,
  currencyAdjusted?: boolean
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

    // Helper to calculate EUR/USD variation for currency adjustment
    // Formula: variazione_EURUSD = ((EURUSD_current / EURUSD_base) - 1) * 100
    // If EUR appreciates (EURUSD goes up), USD assets lose value in EUR terms
    const calculateEurusdVariation = (targetDate: string): number => {
      const eurusdBase = basePrices[EURUSD_TICKER];
      const eurusdResult = getClosestPrice(EURUSD_TICKER, targetDate);
      
      if (!eurusdBase || !eurusdResult.price) return 0;
      
      // Variation in percentage: if EURUSD goes from 1.10 to 1.15, variation is ~4.5%
      return ((eurusdResult.price / eurusdBase) - 1) * 100;
    };

    // Calculate returns for each historical snapshot using HISTORICAL equity exposure
    // IMPORTANT: The equity exposure at point N determines the benchmark return from N to N+1
    const returns: Array<{
      date: string;
      equityReturn: number;
      bondReturn: number;
      scaledReturn: number;
      eurusdVariation?: number;
      equityPctUsed?: number; // Track which equity % was used for debugging
    }> = [];

    sortedHistory.forEach((entry, index) => {
      if (index === 0) {
        returns.push({
          date: entry.snapshot_date,
          equityReturn: 0,
          bondReturn: 0,
          scaledReturn: 0,
          eurusdVariation: 0,
          equityPctUsed: 0,
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

      // Calculate bond return (AGG)
      const aggBase = basePrices[BOND_TICKER];
      let bondReturn = 0;
      if (aggBase && aggResult.price) {
        bondReturn = ((aggResult.price - aggBase) / aggBase) * 100;
      }

      // CRITICAL: Use the PREVIOUS point's equity exposure for this period's benchmark
      // The equity exposure at point N determines the benchmark return from N to N+1
      const prevEntry = sortedHistory[index - 1];
      const historicalEquityPct = prevEntry.equity_exposure_pct;
      
      // Use historical equity exposure if available (> 0), otherwise fallback
      // Note: 0 is treated as "not set" and falls back to current or 60%
      const equityPct = historicalEquityPct && historicalEquityPct > 0 
        ? historicalEquityPct 
        : (equityExposurePct ?? 0.6);
      
      let scaledReturn = equityPct * avgEquityReturn + (1 - equityPct) * bondReturn;

      // Apply currency adjustment if enabled using HISTORICAL USD exposure
      // Same logic as equity: use previous point's USD exposure for this period's adjustment
      let eurusdVariation = 0;
      if (currencyAdjusted) {
        const historicalUsdPct = prevEntry.usd_exposure_pct;
        const usdPct = historicalUsdPct && historicalUsdPct > 0 
          ? historicalUsdPct 
          : (usdExposurePct ?? 0.8);
        
        if (usdPct > 0) {
          eurusdVariation = calculateEurusdVariation(entry.snapshot_date);
          // If EUR appreciates (positive variation), USD assets lose value → reduce benchmark
          scaledReturn = scaledReturn - (usdPct * eurusdVariation);
        }
      }

      returns.push({
        date: entry.snapshot_date,
        equityReturn: avgEquityReturn,
        bondReturn,
        scaledReturn,
        eurusdVariation,
        equityPctUsed: equityPct,
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

      // Calculate bond return for current date
      const aggBase = basePrices[BOND_TICKER];
      let bondReturnCurrent = 0;
      if (aggBase && aggResultCurrent.price) {
        bondReturnCurrent = ((aggResultCurrent.price - aggBase) / aggBase) * 100;
      }

      // Calculate scaled return using the LAST historical point's equity exposure
      // This represents the equity exposure from the last snapshot to current date
      const lastEntry = sortedHistory[sortedHistory.length - 1];
      const historicalEquityPct = lastEntry?.equity_exposure_pct;
      
      const equityPct = historicalEquityPct && historicalEquityPct > 0 
        ? historicalEquityPct 
        : (equityExposurePct ?? 0.6);
        
      let scaledReturnCurrent = equityPct * avgEquityReturnCurrent + (1 - equityPct) * bondReturnCurrent;

      // Apply currency adjustment if enabled using last historical USD exposure
      let eurusdVariationCurrent = 0;
      if (currencyAdjusted) {
        const historicalUsdPct = lastEntry?.usd_exposure_pct;
        const usdPct = historicalUsdPct && historicalUsdPct > 0 
          ? historicalUsdPct 
          : (usdExposurePct ?? 0.8);
        
        if (usdPct > 0) {
          eurusdVariationCurrent = calculateEurusdVariation(currentDate);
          scaledReturnCurrent = scaledReturnCurrent - (usdPct * eurusdVariationCurrent);
        }
      }

      returns.push({
        date: currentDate,
        equityReturn: avgEquityReturnCurrent,
        bondReturn: bondReturnCurrent,
        scaledReturn: scaledReturnCurrent,
        eurusdVariation: eurusdVariationCurrent,
        equityPctUsed: equityPct,
      });
    }

    // Calculate stale summary (global overview for the most recent target date)
    // Exclude EURUSD from staleness warnings as it's internal
    const targetDate = currentDate || dateRange?.to || '';
    const summary: BenchmarkStaleSummary[] = [];
    
    if (targetDate) {
      [...EQUITY_BENCHMARKS, BOND_TICKER].forEach(ticker => {
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
  }, [benchmarkPrices, historicalData, currentDate, dateRange?.to, equityExposurePct, usdExposurePct, currencyAdjusted]);

  return {
    benchmarkReturns,
    dataGaps,
    staleSummary,
    isLoading,
    hasBenchmarkData: benchmarkReturns.length > 0,
    refreshBenchmark,
  };
}
