import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UnderlyingPrice {
  price: number;
  currency: string;
  ticker?: string;
}

export interface UseUnderlyingPricesResult {
  prices: Record<string, UnderlyingPrice>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUnderlyingPrices(underlyings: string[]): UseUnderlyingPricesResult {
  const [prices, setPrices] = useState<Record<string, UnderlyingPrice>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);
  const lastUnderlyingsRef = useRef<string>('');

  const fetchPrices = useCallback(async (forceRefresh = false) => {
    // Deduplicate and filter valid underlyings
    const uniqueUnderlyings = [...new Set(underlyings.filter(u => u && typeof u === 'string'))];
    
    if (uniqueUnderlyings.length === 0) {
      return;
    }

    // Create a key to compare with previous fetch
    const underlyingsKey = uniqueUnderlyings.sort().join('|');
    
    // Don't refetch if we already have the same underlyings (unless forced)
    if (!forceRefresh && hasFetchedRef.current && lastUnderlyingsRef.current === underlyingsKey) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`Fetching prices for ${uniqueUnderlyings.length} underlyings`);
      
      const { data, error: fetchError } = await supabase.functions.invoke('fetch-underlying-prices', {
        body: { underlyings: uniqueUnderlyings }
      });

      if (fetchError) {
        throw new Error(fetchError.message || 'Failed to fetch underlying prices');
      }

      if (data?.prices) {
        setPrices(data.prices);
        console.log(`Received ${Object.keys(data.prices).length} underlying prices`);
      }

      hasFetchedRef.current = true;
      lastUnderlyingsRef.current = underlyingsKey;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error fetching prices';
      console.error('Error fetching underlying prices:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [underlyings]);

  // Fetch prices when underlyings change
  useEffect(() => {
    if (underlyings.length > 0) {
      fetchPrices();
    }
  }, [fetchPrices, underlyings.length]);

  const refetch = useCallback(() => {
    hasFetchedRef.current = false;
    fetchPrices(true);
  }, [fetchPrices]);

  return { prices, isLoading, error, refetch };
}
