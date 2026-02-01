import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SectorMapping {
  ticker: string;
  sector: string;
  industry: string;
}

export interface StockInfo {
  isin: string;
  description: string;
}

export function useSectorMappings() {
  const [mappings, setMappings] = useState<Record<string, SectorMapping>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const isFetchingRef = useRef(false);

  const fetchMappings = useCallback(async (stocks: StockInfo[]) => {
    if (stocks.length === 0 || hasFetched || isFetchingRef.current) return;
    
    const isins = stocks.map(s => s.isin).filter(Boolean);
    if (isins.length === 0) return;
    
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
      
      // 2. Build lookup map
      const existingIsins = new Set(data?.map((d: any) => d.isin) || []);
      const newMappings: Record<string, SectorMapping> = {};
      
      for (const row of data || []) {
        if (row.sector) {
          newMappings[row.isin] = {
            ticker: row.ticker || '',
            sector: row.sector,
            industry: row.industry || '',
          };
        }
      }
      
      // 3. Find ISINs that need resolution:
      //    - Missing from isin_mappings entirely
      //    - Exist but have no sector
      const missingIsins = isins.filter(isin => !existingIsins.has(isin));
      const needsSectorUpdate = data?.filter((d: any) => d.ticker && !d.sector).map((d: any) => d.isin) || [];
      
      const toResolve = [...new Set([...missingIsins, ...needsSectorUpdate])];
      
      console.log(`Sector mappings: ${Object.keys(newMappings).length} cached, ${toResolve.length} need resolution`);
      
      // 4. If there are ISINs needing resolution, call edge function
      if (toResolve.length > 0) {
        console.log('Triggering sector resolution for:', toResolve);
        
        // Build descriptions map for AI fallback
        const descriptions: Record<string, string> = {};
        for (const stock of stocks) {
          if (toResolve.includes(stock.isin)) {
            descriptions[stock.isin] = stock.description;
          }
        }
        
        const { error: invokeError } = await supabase.functions.invoke('update-prices-cron', {
          body: { 
            mode: 'resolve-and-get-sectors', 
            isins: toResolve,
            descriptions 
          }
        });
        
        if (invokeError) {
          console.error('Error invoking resolve-and-get-sectors:', invokeError);
        } else {
          // Re-fetch mappings after resolution
          const { data: updatedData } = await supabase
            .from('isin_mappings')
            .select('isin, ticker, sector, industry')
            .in('isin', isins) as any;
          
          if (updatedData) {
            const updatedMappings: Record<string, SectorMapping> = {};
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
            console.log(`Updated to ${Object.keys(updatedMappings).length} sector mappings after resolution`);
          }
        }
      } else {
        setMappings(newMappings);
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
