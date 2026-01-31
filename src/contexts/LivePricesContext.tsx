import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Position, AssetType } from '@/types/portfolio';
import { toast } from 'sonner';

export interface LivePriceData {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  lastUpdated: string;
  source: 'tradier' | 'yahoo' | 'justetf' | 'error';
  error?: string;
  // Direction tracking for 45s visual feedback
  previousPrice: number | null;
  priceDirection: 'up' | 'down' | null;
  directionTimestamp: number | null;
}

interface OptionRequest {
  underlying: string;
  expiry: string;
  optionType: 'call' | 'put';
  strike: number;
  originalId: string;
}

interface FetchResult {
  stocks: Record<string, Omit<LivePriceData, 'previousPrice' | 'priceDirection' | 'directionTimestamp'>>;
  options: Record<string, Omit<LivePriceData, 'previousPrice' | 'priceDirection' | 'directionTimestamp'>>;
  isinMappings: Record<string, string>;
  fetchedAt: string;
}

// Extended position type with live price flag
export interface PositionWithLive extends Position {
  _isLive?: boolean;
  _livePrice?: LivePriceData;
}

interface LivePricesContextType {
  stockPrices: Record<string, LivePriceData>;
  optionPrices: Record<string, LivePriceData>;
  isLoading: boolean;
  lastFetched: Date | null;
  error: string | null;
  refresh: () => void;
  getPriceForPosition: (position: Position) => LivePriceData | null;
  applyLivePricesToPositions: (positions: Position[]) => PositionWithLive[];
  setPositionsForFetch: (positions: Position[]) => void;
}

const LivePricesContext = createContext<LivePricesContextType | null>(null);

const POLLING_INTERVAL_MS = 300000; // 5 minutes
const DIRECTION_DISPLAY_MS = 45000; // 45 seconds for price direction color

/**
 * Adds direction tracking to price data by comparing with previous prices
 */
function addDirectionTracking(
  newPrices: Record<string, Omit<LivePriceData, 'previousPrice' | 'priceDirection' | 'directionTimestamp'>>,
  previousPrices: Record<string, LivePriceData>
): Record<string, LivePriceData> {
  const result: Record<string, LivePriceData> = {};
  
  for (const [symbol, newPrice] of Object.entries(newPrices)) {
    const oldPrice = previousPrices[symbol];
    let direction: 'up' | 'down' | null = null;
    let directionTimestamp: number | null = null;
    let previousPriceValue: number | null = null;
    
    if (oldPrice && oldPrice.price !== null && newPrice.price !== null) {
      previousPriceValue = oldPrice.price;
      
      if (newPrice.price > oldPrice.price) {
        direction = 'up';
        directionTimestamp = Date.now();
      } else if (newPrice.price < oldPrice.price) {
        direction = 'down';
        directionTimestamp = Date.now();
      } else {
        // Price unchanged - keep old direction if still within 45s window
        if (oldPrice.directionTimestamp && (Date.now() - oldPrice.directionTimestamp) < DIRECTION_DISPLAY_MS) {
          direction = oldPrice.priceDirection;
          directionTimestamp = oldPrice.directionTimestamp;
        }
      }
    }
    
    result[symbol] = {
      ...newPrice,
      previousPrice: previousPriceValue,
      priceDirection: direction,
      directionTimestamp: directionTimestamp,
    };
  }
  
  return result;
}

/**
 * Recalculates market_value and profit_loss for a position with a new price.
 */
function recalculatePosition(position: Position, livePrice: LivePriceData | null): PositionWithLive {
  if (!livePrice || livePrice.price === null || livePrice.source === 'error') {
    return position;
  }

  const newPrice = livePrice.price;
  const quantity = position.quantity;
  const avgCost = position.avg_cost ?? 0;
  const exchangeRate = position.exchange_rate ?? 1;

  // Derivatives use 100 multiplier
  const multiplier = position.asset_type === 'derivative' ? 100 : 1;

  const marketValue = (newPrice * quantity * multiplier) / exchangeRate;
  const costBasis = (avgCost * Math.abs(quantity) * multiplier) / exchangeRate;
  const profitLoss = marketValue - (quantity < 0 ? -costBasis : costBasis);
  const profitLossPct = costBasis !== 0 ? (profitLoss / Math.abs(costBasis)) * 100 : 0;

  return {
    ...position,
    current_price: newPrice,
    market_value: marketValue,
    profit_loss: profitLoss,
    profit_loss_pct: profitLossPct,
    _isLive: true,
    _livePrice: livePrice,
  };
}

interface LivePricesProviderProps {
  children: ReactNode;
}

export function LivePricesProvider({ children }: LivePricesProviderProps) {
  const [stockPrices, setStockPrices] = useState<Record<string, LivePriceData>>({});
  const [optionPrices, setOptionPrices] = useState<Record<string, LivePriceData>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positionsToFetch, setPositionsToFetch] = useState<Position[]>([]);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef(false);
  const previousStockPricesRef = useRef<Record<string, LivePriceData>>({});
  const previousOptionPricesRef = useRef<Record<string, LivePriceData>>({});

  const fetchPrices = useCallback(async () => {
    if (positionsToFetch.length === 0 || isFetchingRef.current) return;
    
    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);
    
    try {
      // Separate stocks/ETFs from derivatives
      const stockPositions = positionsToFetch.filter(
        p => p.asset_type === 'stock' || p.asset_type === 'etf'
      );
      const derivativePositions = positionsToFetch.filter(
        p => p.asset_type === 'derivative' && 
             p.underlying && 
             p.expiry_date && 
             p.option_type && 
             p.strike_price
      );
      
      // Extract unique tickers (for positions that have them)
      const tickers = [...new Set(
        stockPositions
          .map(p => p.ticker)
          .filter((t): t is string => !!t && t.length > 0)
      )];
      
      // Extract unique ISINs (for positions without tickers)
      const isins = [...new Set(
        stockPositions
          .filter(p => !p.ticker && p.isin)
          .map(p => p.isin)
          .filter((i): i is string => !!i && i.length > 0)
      )];
      
      // Build option requests
      const optionRequests: OptionRequest[] = derivativePositions.map(p => ({
        underlying: p.underlying!,
        expiry: p.expiry_date!,
        optionType: p.option_type as 'call' | 'put',
        strike: p.strike_price!,
        originalId: p.id,
      }));
      
      console.log(`[LivePricesContext] Fetching: ${tickers.length} tickers, ${isins.length} ISINs, ${optionRequests.length} options`);
      
      const { data, error: fnError } = await supabase.functions.invoke<FetchResult>(
        'fetch-market-prices',
        {
          body: {
            tickers,
            isins,
            options: optionRequests,
          },
        }
      );
      
      if (fnError) {
        throw new Error(fnError.message);
      }
      
      if (data) {
        // Add direction tracking by comparing with previous prices
        const newStockPrices = addDirectionTracking(
          data.stocks || {},
          previousStockPricesRef.current
        );
        const newOptionPrices = addDirectionTracking(
          data.options || {},
          previousOptionPricesRef.current
        );
        
        // Update previous prices refs
        previousStockPricesRef.current = newStockPrices;
        previousOptionPricesRef.current = newOptionPrices;
        
        setStockPrices(newStockPrices);
        setOptionPrices(newOptionPrices);
        setLastFetched(new Date(data.fetchedAt));
        
        // Count successful fetches
        const stockCount = Object.values(newStockPrices).filter(s => s.source !== 'error').length;
        const optionCount = Object.values(newOptionPrices).filter(o => o.source !== 'error').length;
        
        console.log(`[LivePricesContext] Fetched ${stockCount} stocks, ${optionCount} options`);
        
        // Log direction changes for debugging
        const upCount = Object.values(newStockPrices).filter(s => s.priceDirection === 'up').length +
                       Object.values(newOptionPrices).filter(o => o.priceDirection === 'up').length;
        const downCount = Object.values(newStockPrices).filter(s => s.priceDirection === 'down').length +
                         Object.values(newOptionPrices).filter(o => o.priceDirection === 'down').length;
        
        if (upCount > 0 || downCount > 0) {
          console.log(`[LivePricesContext] Price changes: ${upCount} up, ${downCount} down`);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Errore nel recupero prezzi';
      setError(errorMessage);
      console.error('[LivePricesContext] Error fetching live prices:', err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [positionsToFetch]);

  // Manual refresh
  const refresh = useCallback(() => {
    fetchPrices();
    toast.info('Aggiornamento prezzi in corso...');
  }, [fetchPrices]);

  // Set up polling when positions change
  useEffect(() => {
    if (positionsToFetch.length === 0) return;

    // Initial fetch
    fetchPrices();
    
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // Set up polling
    intervalRef.current = setInterval(fetchPrices, POLLING_INTERVAL_MS);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [positionsToFetch.length, fetchPrices]);

  // Get price for a specific position
  const getPriceForPosition = useCallback((position: Position): LivePriceData | null => {
    if (position.asset_type === 'derivative') {
      return optionPrices[position.id] || null;
    }
    
    // Try ticker first
    if (position.ticker && stockPrices[position.ticker]) {
      return stockPrices[position.ticker];
    }
    
    // Try ISIN
    if (position.isin && stockPrices[position.isin]) {
      return stockPrices[position.isin];
    }
    
    return null;
  }, [stockPrices, optionPrices]);

  // Apply live prices to positions array
  const applyLivePricesToPositions = useCallback((positions: Position[]): PositionWithLive[] => {
    return positions.map(position => {
      const livePrice = getPriceForPosition(position);
      return recalculatePosition(position, livePrice);
    });
  }, [getPriceForPosition]);

  // Allow components to register positions for fetching
  const setPositionsForFetch = useCallback((positions: Position[]) => {
    setPositionsToFetch(positions);
  }, []);

  const value = useMemo(() => ({
    stockPrices,
    optionPrices,
    isLoading,
    lastFetched,
    error,
    refresh,
    getPriceForPosition,
    applyLivePricesToPositions,
    setPositionsForFetch,
  }), [
    stockPrices, 
    optionPrices, 
    isLoading, 
    lastFetched, 
    error, 
    refresh, 
    getPriceForPosition, 
    applyLivePricesToPositions,
    setPositionsForFetch,
  ]);

  return (
    <LivePricesContext.Provider value={value}>
      {children}
    </LivePricesContext.Provider>
  );
}

export function useLivePricesContext() {
  const context = useContext(LivePricesContext);
  if (!context) {
    throw new Error('useLivePricesContext must be used within a LivePricesProvider');
  }
  return context;
}

// Export the direction display duration for use in components
export const DIRECTION_DISPLAY_DURATION_MS = DIRECTION_DISPLAY_MS;
