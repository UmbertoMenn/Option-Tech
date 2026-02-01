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
 * Prices are now updated server-side via cron job and read from database.
 */
export function useLivePrices(
  positions: Position[],
  options: UseLivePricesOptions = {}
) {
  const {
    priceHistory,
    isLoading,
    lastFetched,
    error,
    refresh,
    getPriceDirectionForPosition,
  } = useLivePricesContext();
  
  return {
    stockPrices: {},  // Legacy compatibility - prices now come from DB
    optionPrices: {}, // Legacy compatibility - prices now come from DB
    isLoading,
    lastFetched,
    error,
    refresh,
    getPriceForPosition: () => null, // Legacy compatibility
  };
}
