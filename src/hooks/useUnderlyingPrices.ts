import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  const lastKeyRef = useRef<string>('');

  // Create a stable key from the underlyings array
  const underlyingsKey = useMemo(() => {
    const unique = [...new Set(underlyings.filter(u => u && typeof u === 'string'))];
    return unique.sort().join('|');
  }, [underlyings]);

  useEffect(() => {
    const fetchPrices = async () => {
      const uniqueUnderlyings = [...new Set(underlyings.filter(u => u && typeof u === 'string'))];
      
      if (uniqueUnderlyings.length === 0) {
        return;
      }

      // Don't refetch if we already have the same underlyings
      if (hasFetchedRef.current && lastKeyRef.current === underlyingsKey) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log(`Fetching prices for ${uniqueUnderlyings.length} underlyings:`, uniqueUnderlyings);
        
        const { data, error: fetchError } = await supabase.functions.invoke('fetch-underlying-prices', {
          body: { underlyings: uniqueUnderlyings }
        });

        if (fetchError) {
          throw new Error(fetchError.message || 'Failed to fetch underlying prices');
        }

        if (data?.prices) {
          setPrices(data.prices);
          console.log(`Received ${Object.keys(data.prices).length} underlying prices:`, Object.keys(data.prices));
        }

        hasFetchedRef.current = true;
        lastKeyRef.current = underlyingsKey;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error fetching prices';
        console.error('Error fetching underlying prices:', errorMessage);
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    if (underlyings.length > 0) {
      fetchPrices();
    }
  }, [underlyings, underlyingsKey]);

  const refetch = useCallback(() => {
    hasFetchedRef.current = false;
    lastKeyRef.current = '';
    // Force re-run of effect by triggering a state change
    setPrices({});
  }, []);

  return { prices, isLoading, error, refetch };
}
