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
        
        const results: Record<string, UnderlyingPrice> = {};
        
        // Step 1: Get underlying -> ticker mappings from cache
        const { data: mappings } = await supabase
          .from('underlying_mappings')
          .select('underlying, ticker')
          .in('underlying', uniqueUnderlyings);
        
        // Build mapping lookup
        const underlyingToTicker: Record<string, string> = {};
        if (mappings) {
          for (const m of mappings) {
            underlyingToTicker[m.underlying] = m.ticker;
          }
        }
        
        // Get all mapped tickers
        const mappedTickers = Object.values(underlyingToTicker).filter(Boolean);
        
        // Step 2: Query cached prices from underlying_prices table
        if (mappedTickers.length > 0) {
          const { data: cachedPrices } = await supabase
            .from('underlying_prices')
            .select('ticker, price, currency, updated_at')
            .in('ticker', mappedTickers);
          
          // Build ticker -> price lookup
          const tickerPrices: Record<string, { price: number; currency: string; updated_at: string }> = {};
          if (cachedPrices) {
            for (const p of cachedPrices) {
              tickerPrices[p.ticker] = { 
                price: Number(p.price), 
                currency: p.currency, 
                updated_at: p.updated_at 
              };
            }
          }
          
          // Step 3: Build results from cache
          for (const underlying of uniqueUnderlyings) {
            const ticker = underlyingToTicker[underlying];
            if (ticker && tickerPrices[ticker]) {
              results[underlying] = {
                price: tickerPrices[ticker].price,
                currency: tickerPrices[ticker].currency,
                ticker,
              };
            }
          }
          
          console.log(`Got ${Object.keys(results).length} prices from cache`);
        }
        
        // Step 4: For missing underlyings, call edge function
        const missingUnderlyings = uniqueUnderlyings.filter(u => !results[u]);
        
        if (missingUnderlyings.length > 0) {
          console.log(`Fetching ${missingUnderlyings.length} missing prices from edge function:`, missingUnderlyings);
          
          const { data, error: fetchError } = await supabase.functions.invoke('fetch-underlying-prices', {
            body: { underlyings: missingUnderlyings }
          });

          if (fetchError) {
            console.error('Edge function error:', fetchError.message);
            // Don't throw - we might have partial results from cache
          } else if (data?.prices) {
            // Merge fresh prices with cached results
            for (const [underlying, priceData] of Object.entries(data.prices)) {
              results[underlying] = priceData as UnderlyingPrice;
            }
            console.log(`Got ${Object.keys(data.prices).length} prices from edge function`);
          }
        }
        
        setPrices(results);
        console.log(`Total prices resolved: ${Object.keys(results).length}`);

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
