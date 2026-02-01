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

  const fetchMappings = useCallback(async (stocks: StockInfo[], derivativeNames: string[] = []) => {
    if ((stocks.length === 0 && derivativeNames.length === 0) || hasFetched || isFetchingRef.current) return;
    
    isFetchingRef.current = true;
    setIsLoading(true);
    
    try {
      const isins = stocks.map(s => s.isin).filter(Boolean);
      
      // 1. Fetch existing mappings from DB (by ISIN)
      let existingData: any[] = [];
      if (isins.length > 0) {
        const { data, error } = await supabase
          .from('isin_mappings')
          .select('isin, ticker, sector, industry')
          .in('isin', isins) as any;
        
        if (error) {
          console.error('Error fetching sector mappings:', error);
          return;
        }
        existingData = data || [];
      }
      
      // 2. Build lookup map (by ISIN and by ticker for derivatives)
      const existingIsins = new Set(existingData.map((d: any) => d.isin));
      const newMappings: Record<string, SectorMapping> = {};
      
      for (const row of existingData) {
        if (row.sector) {
          // Store by ISIN
          newMappings[row.isin] = {
            ticker: row.ticker || '',
            sector: row.sector,
            industry: row.industry || '',
          };
          // Also store by ticker for derivative lookup
          if (row.ticker) {
            newMappings[`ticker:${row.ticker.toUpperCase()}`] = {
              ticker: row.ticker,
              sector: row.sector,
              industry: row.industry || '',
            };
          }
        }
      }
      
      // 3. Find ISINs that need resolution
      const missingIsins = isins.filter(isin => !existingIsins.has(isin));
      const needsSectorUpdate = existingData.filter((d: any) => d.ticker && !d.sector).map((d: any) => d.isin);
      const isinsToResolve = [...new Set([...missingIsins, ...needsSectorUpdate])];
      
      // 4. Find derivative names that don't have cached ticker mapping
      const derivativeNamesToResolve = derivativeNames.filter(name => {
        const upperName = name.toUpperCase();
        // Check if any existing ticker matches this name
        for (const [key, mapping] of Object.entries(newMappings)) {
          if (key.startsWith('ticker:') && upperName.includes(mapping.ticker.toUpperCase())) {
            return false; // Already have this
          }
        }
        return true;
      });
      
      console.log(`Sector mappings: ${Object.keys(newMappings).length} cached, ${isinsToResolve.length} ISINs + ${derivativeNamesToResolve.length} names need resolution`);
      
      // 5. If there are items needing resolution, call edge function
      if (isinsToResolve.length > 0 || derivativeNamesToResolve.length > 0) {
        console.log('Triggering sector resolution:', { 
          isins: isinsToResolve.slice(0, 5), 
          names: derivativeNamesToResolve.slice(0, 5) 
        });
        
        // Build descriptions map for AI fallback
        const descriptions: Record<string, string> = {};
        for (const stock of stocks) {
          if (isinsToResolve.includes(stock.isin)) {
            descriptions[stock.isin] = stock.description;
          }
        }
        
        const { data: resolveData, error: invokeError } = await supabase.functions.invoke('update-prices-cron', {
          body: { 
            mode: 'resolve-and-get-sectors', 
            isins: isinsToResolve,
            descriptions,
            names: derivativeNamesToResolve, // NEW: also send derivative underlyings
          }
        });
        
        if (invokeError) {
          console.error('Error invoking resolve-and-get-sectors:', invokeError);
        } else {
          // Re-fetch mappings after resolution
          const allIsins = [...new Set([...isins, ...isinsToResolve])];
          if (allIsins.length > 0) {
            const { data: updatedData } = await supabase
              .from('isin_mappings')
              .select('isin, ticker, sector, industry')
              .in('isin', allIsins) as any;
            
            if (updatedData) {
              const updatedMappings: Record<string, SectorMapping> = {};
              for (const row of updatedData) {
                if (row.sector) {
                  updatedMappings[row.isin] = {
                    ticker: row.ticker || '',
                    sector: row.sector,
                    industry: row.industry || '',
                  };
                  if (row.ticker) {
                    updatedMappings[`ticker:${row.ticker.toUpperCase()}`] = {
                      ticker: row.ticker,
                      sector: row.sector,
                      industry: row.industry || '',
                    };
                  }
                }
              }
              
              // Also add results from names resolution (returned from edge function)
              const nameResults = resolveData?.nameResults || [];
              for (const nr of nameResults) {
                if (nr.sector && nr.ticker) {
                  updatedMappings[`ticker:${nr.ticker.toUpperCase()}`] = {
                    ticker: nr.ticker,
                    sector: nr.sector,
                    industry: nr.industry || '',
                  };
                  // Also store by normalized name for lookup
                  updatedMappings[`name:${nr.name.toUpperCase()}`] = {
                    ticker: nr.ticker,
                    sector: nr.sector,
                    industry: nr.industry || '',
                  };
                }
              }
              
              setMappings(updatedMappings);
              console.log(`Updated to ${Object.keys(updatedMappings).length} sector mappings after resolution`);
            }
          } else {
            // Only name results
            const nameResults = resolveData?.nameResults || [];
            const updatedMappings: Record<string, SectorMapping> = { ...newMappings };
            for (const nr of nameResults) {
              if (nr.sector && nr.ticker) {
                updatedMappings[`ticker:${nr.ticker.toUpperCase()}`] = {
                  ticker: nr.ticker,
                  sector: nr.sector,
                  industry: nr.industry || '',
                };
                updatedMappings[`name:${nr.name.toUpperCase()}`] = {
                  ticker: nr.ticker,
                  sector: nr.sector,
                  industry: nr.industry || '',
                };
              }
            }
            setMappings(updatedMappings);
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
