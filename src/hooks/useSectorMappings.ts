import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SectorMapping {
  ticker: string;
  sector: string;
  industry: string;
}

export function useSectorMappings() {
  const [mappings, setMappings] = useState<Record<string, SectorMapping>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchMappings = useCallback(async (isins: string[]) => {
    if (isins.length === 0 || hasFetched) return;
    
    setIsLoading(true);
    try {
      // Use type assertion since the types aren't updated yet
      const { data, error } = await supabase
        .from('isin_mappings')
        .select('isin, ticker, sector, industry')
        .in('isin', isins) as any;
      
      if (error) {
        console.error('Error fetching sector mappings:', error);
        return;
      }
      
      if (!data) return;
      
      // Build lookup map by ISIN
      const newMappings: Record<string, SectorMapping> = {};
      for (const row of data) {
        if (row.sector) {
          newMappings[row.isin] = {
            ticker: row.ticker || '',
            sector: row.sector,
            industry: row.industry || '',
          };
        }
      }
      
      setMappings(newMappings);
      setHasFetched(true);
      console.log(`Loaded ${Object.keys(newMappings).length} sector mappings from database`);
    } catch (err) {
      console.error('Error in fetchMappings:', err);
    } finally {
      setIsLoading(false);
    }
  }, [hasFetched]);

  // Reset state when portfolio changes
  const reset = useCallback(() => {
    setMappings({});
    setHasFetched(false);
  }, []);

  return { mappings, fetchMappings, isLoading, reset };
}
