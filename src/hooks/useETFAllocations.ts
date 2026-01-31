import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ETFAllocation {
  isin: string;
  name: string;
  countryAllocations: Record<string, number>;
  currencyAllocations: Record<string, number>;
  isHedged: boolean;
  cached?: boolean;
}

export function useETFAllocations() {
  const [allocations, setAllocations] = useState<Record<string, ETFAllocation>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fetchAllocation = useCallback(async (isin: string, forceRefresh = false): Promise<ETFAllocation | null> => {
    // Return cached if available and not forcing refresh
    if (!forceRefresh && allocations[isin]) {
      return allocations[isin];
    }

    // Skip if already loading
    if (loading[isin]) {
      return null;
    }

    setLoading(prev => ({ ...prev, [isin]: true }));
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[isin];
      return newErrors;
    });

    try {
      const { data, error } = await supabase.functions.invoke('fetch-etf-allocation', {
        body: { isin, forceRefresh },
      });

      if (error) {
        throw new Error(error.message);
      }

      const allocation: ETFAllocation = {
        isin: data.isin,
        name: data.name,
        countryAllocations: data.countryAllocations,
        currencyAllocations: data.currencyAllocations,
        isHedged: data.isHedged,
        cached: data.cached,
      };

      setAllocations(prev => ({ ...prev, [isin]: allocation }));
      return allocation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch ETF allocation';
      setErrors(prev => ({ ...prev, [isin]: message }));
      console.error(`Error fetching ETF allocation for ${isin}:`, error);
      return null;
    } finally {
      setLoading(prev => ({ ...prev, [isin]: false }));
    }
  }, [allocations, loading]);

  const fetchMultipleAllocations = useCallback(async (isins: string[]): Promise<Record<string, ETFAllocation>> => {
    const results: Record<string, ETFAllocation> = {};
    
    // Fetch in parallel but with some throttling
    const batchSize = 3;
    for (let i = 0; i < isins.length; i += batchSize) {
      const batch = isins.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(isin => fetchAllocation(isin))
      );
      
      batchResults.forEach((result, index) => {
        if (result) {
          results[batch[index]] = result;
        }
      });
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < isins.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return results;
  }, [fetchAllocation]);

  return {
    allocations,
    loading,
    errors,
    fetchAllocation,
    fetchMultipleAllocations,
  };
}
