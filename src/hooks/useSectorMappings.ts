import { useState, useCallback, useRef } from 'react';
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
  const isFetchingRef = useRef(false);

  const fetchMappings = useCallback(async (isins: string[]) => {
    if (isins.length === 0 || hasFetched || isFetchingRef.current) return;
    
    isFetchingRef.current = true;
    setIsLoading(true);
    
    try {
      // 1. Fetch existing mappings from DB
      const { data, error } = await supabase
        .from('isin_mappings')
        .select('isin, ticker, sector, industry')
        .in('isin', isins) as any;
      
      if (error) {
        console.error('Error fetching sector mappings:', error);
        return;
      }
      
      // 2. Build lookup map and find ISINs with missing sectors
      const newMappings: Record<string, SectorMapping> = {};
      const missingIsins: string[] = [];
      
      for (const isin of isins) {
        const row = data?.find((d: any) => d.isin === isin);
        if (row?.sector) {
          newMappings[row.isin] = {
            ticker: row.ticker || '',
            sector: row.sector,
            industry: row.industry || '',
          };
        } else if (row?.ticker) {
          // Has ticker but no sector - needs update
          missingIsins.push(isin);
        }
      }
      
      setMappings(newMappings);
      console.log(`Loaded ${Object.keys(newMappings).length} sector mappings, ${missingIsins.length} missing`);
      
      // 3. If there are missing sectors, trigger edge function to fetch them
      if (missingIsins.length > 0) {
        console.log('Triggering sector update for:', missingIsins);
        
        const { error: invokeError } = await supabase.functions.invoke('update-prices-cron', {
          body: { mode: 'update-sectors', isins: missingIsins }
        });
        
        if (invokeError) {
          console.error('Error invoking update-sectors:', invokeError);
        } else {
          // Re-fetch mappings after update
          const { data: updatedData } = await supabase
            .from('isin_mappings')
            .select('isin, ticker, sector, industry')
            .in('isin', missingIsins) as any;
          
          if (updatedData) {
            const updatedMappings = { ...newMappings };
            for (const row of updatedData) {
              if (row.sector) {
                updatedMappings[row.isin] = {
                  ticker: row.ticker || '',
                  sector: row.sector,
                  industry: row.industry || '',
                };
              }
            }
            setMappings(updatedMappings);
            console.log(`Updated to ${Object.keys(updatedMappings).length} sector mappings`);
          }
        }
      }
      
      setHasFetched(true);
    } catch (err) {
      console.error('Error in fetchMappings:', err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [hasFetched]);

  // Reset state when portfolio changes
  const reset = useCallback(() => {
    setMappings({});
    setHasFetched(false);
    isFetchingRef.current = false;
  }, []);

  return { mappings, fetchMappings, isLoading, reset };
}
