import { createContext, useContext, useState, useCallback, useRef, useMemo, ReactNode, useEffect } from 'react';
import { Position } from '@/types/portfolio';

export interface LivePriceData {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  lastUpdated: string;
  source: 'tradier' | 'yahoo' | 'justetf' | 'database' | 'error';
  error?: string;
  // Direction tracking for 45s visual feedback
  previousPrice: number | null;
  priceDirection: 'up' | 'down' | null;
  directionTimestamp: number | null;
}

// Extended position type with live price flag
export interface PositionWithLive extends Position {
  _isLive?: boolean;
  _livePrice?: LivePriceData;
}

interface PriceHistoryEntry {
  previousPrice: number | null;
  currentPrice: number | null;
  direction: 'up' | 'down' | null;
  directionTimestamp: number | null;
}

interface LivePricesContextType {
  priceHistory: Record<string, PriceHistoryEntry>;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  updatePriceHistory: (positions: Position[]) => void;
  getPriceDirectionForPosition: (positionId: string) => PriceHistoryEntry | null;
  applyDirectionToPositions: (positions: Position[]) => PositionWithLive[];
  refresh: () => void;
  lastFetched: Date | null;
}

const LivePricesContext = createContext<LivePricesContextType | null>(null);

const DIRECTION_DISPLAY_MS = 45000; // 45 seconds for price direction color

interface LivePricesProviderProps {
  children: ReactNode;
}

export function LivePricesProvider({ children }: LivePricesProviderProps) {
  const [priceHistory, setPriceHistory] = useState<Record<string, PriceHistoryEntry>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);
  
  const previousPricesRef = useRef<Record<string, number | null>>({});

  /**
   * Updates price history when new positions data arrives from DB polling.
   * Compares with previous prices to detect direction changes.
   */
  const updatePriceHistory = useCallback((positions: Position[]) => {
    const now = Date.now();
    const newHistory: Record<string, PriceHistoryEntry> = {};
    
    for (const pos of positions) {
      const posId = pos.id;
      const currentPrice = pos.current_price;
      const previousPrice = previousPricesRef.current[posId] ?? null;
      const oldEntry = priceHistory[posId];
      
      let direction: 'up' | 'down' | null = null;
      let directionTimestamp: number | null = null;
      
      if (previousPrice !== null && currentPrice !== null) {
        if (currentPrice > previousPrice) {
          direction = 'up';
          directionTimestamp = now;
        } else if (currentPrice < previousPrice) {
          direction = 'down';
          directionTimestamp = now;
        } else {
          // Price unchanged - keep old direction if still within 45s window
          if (oldEntry?.directionTimestamp && (now - oldEntry.directionTimestamp) < DIRECTION_DISPLAY_MS) {
            direction = oldEntry.direction;
            directionTimestamp = oldEntry.directionTimestamp;
          }
        }
      }
      
      newHistory[posId] = {
        previousPrice,
        currentPrice,
        direction,
        directionTimestamp,
      };
      
      // Update the previous price ref for next comparison
      previousPricesRef.current[posId] = currentPrice;
    }
    
    setPriceHistory(newHistory);
    
    // Find the most recent updated_at from positions
    const latestUpdate = positions.reduce((latest, pos) => {
      const posDate = new Date(pos.updated_at);
      return posDate > latest ? posDate : latest;
    }, new Date(0));
    
    if (latestUpdate.getTime() > 0) {
      setLastUpdated(latestUpdate);
    }
  }, [priceHistory]);

  /**
   * Get price direction info for a specific position
   */
  const getPriceDirectionForPosition = useCallback((positionId: string): PriceHistoryEntry | null => {
    return priceHistory[positionId] || null;
  }, [priceHistory]);

  /**
   * Apply direction tracking to positions for visual feedback
   */
  const applyDirectionToPositions = useCallback((positions: Position[]): PositionWithLive[] => {
    return positions.map(position => {
      const directionEntry = priceHistory[position.id];
      
      if (!directionEntry) {
        return {
          ...position,
          _isLive: position.current_price !== null,
        };
      }
      
      const livePrice: LivePriceData = {
        symbol: position.ticker || position.isin || position.id,
        price: position.current_price,
        change: null,
        changePct: null,
        bid: null,
        ask: null,
        volume: null,
        lastUpdated: position.updated_at,
        source: 'database',
        previousPrice: directionEntry.previousPrice,
        priceDirection: directionEntry.direction,
        directionTimestamp: directionEntry.directionTimestamp,
      };
      
      return {
        ...position,
        _isLive: position.current_price !== null,
        _livePrice: livePrice,
      };
    });
  }, [priceHistory]);

  /**
   * Manual refresh - triggers React Query refetch via invalidation
   * The actual refresh is handled by usePortfolio's refetchInterval
   */
  const refresh = useCallback(() => {
    // This is now a no-op since prices are fetched server-side
    // The UI will update via React Query polling
    console.log('[LivePricesContext] Manual refresh requested - prices are updated server-side');
  }, []);

  const value = useMemo(() => ({
    priceHistory,
    lastUpdated,
    isLoading,
    error,
    updatePriceHistory,
    getPriceDirectionForPosition,
    applyDirectionToPositions,
    refresh,
    lastFetched: lastUpdated,
  }), [
    priceHistory,
    lastUpdated,
    isLoading,
    error,
    updatePriceHistory,
    getPriceDirectionForPosition,
    applyDirectionToPositions,
    refresh,
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
