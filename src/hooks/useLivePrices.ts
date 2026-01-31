import { useCallback, useEffect } from 'react';
import { Position } from '@/types/portfolio';
import { useLivePricesContext, LivePriceData, PositionWithLive } from '@/contexts/LivePricesContext';

export type { LivePriceData, PositionWithLive };

interface UseLivePricesOptions {
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * @deprecated Use useLivePricesContext() directly instead.
 * This hook is kept for backward compatibility.
 */
export function useLivePrices(
  positions: Position[],
  options: UseLivePricesOptions = {}
) {
  const { enabled = true } = options;
  
  const {
    stockPrices,
    optionPrices,
    isLoading,
    lastFetched,
    error,
    refresh,
    getPriceForPosition,
    setPositionsForFetch,
  } = useLivePricesContext();
  
  // Register positions for fetching when they change
  useEffect(() => {
    if (enabled && positions.length > 0) {
      setPositionsForFetch(positions);
    }
  }, [positions, enabled, setPositionsForFetch]);
  
  return {
    stockPrices,
    optionPrices,
    isLoading,
    lastFetched,
    error,
    refresh,
    getPriceForPosition,
  };
}
