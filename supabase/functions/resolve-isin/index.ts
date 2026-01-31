import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IsinMapping {
  isin: string;
  ticker: string;
  exchange: string | null;
  source: string;
}

interface OpenFigiResult {
  data: {
    ticker?: string;
    exchCode?: string;
    marketSector?: string;
  }[];
}

/**
 * Resolve ISINs to tickers using OpenFIGI API
 */
async function resolveViaOpenFigi(isins: string[]): Promise<Map<string, IsinMapping>> {
  const results = new Map<string, IsinMapping>();
  
  if (isins.length === 0) return results;
  
  try {
    // OpenFIGI batch request format
    const body = isins.map(isin => ({
      idType: 'ID_ISIN',
      idValue: isin,
    }));
    
    const response = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // OpenFIGI allows 25 requests/min without API key
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      console.error(`OpenFIGI error: ${response.status}`);
      return results;
    }
    
    const data: OpenFigiResult[] = await response.json();
    
    // Match results with input ISINs
    for (let i = 0; i < isins.length; i++) {
      const isin = isins[i];
      const figiData = data[i]?.data?.[0];
      
      if (figiData?.ticker) {
        // Add exchange suffix for non-US tickers
        let ticker = figiData.ticker;
        if (figiData.exchCode && figiData.exchCode !== 'US') {
          // Common exchange mappings
          const exchangeMap: Record<string, string> = {
            'IM': '.MI',  // Milan
            'GY': '.DE',  // Germany/Xetra
            'FP': '.PA',  // Paris
            'LN': '.L',   // London
            'SM': '.MC',  // Madrid
            'NA': '.AS',  // Amsterdam
            'BB': '.BR',  // Brussels
            'SW': '.SW',  // Swiss
          };
          const suffix = exchangeMap[figiData.exchCode] || '';
          ticker = `${figiData.ticker}${suffix}`;
        }
        
        results.set(isin, {
          isin,
          ticker,
          exchange: figiData.exchCode || null,
          source: 'openfigi',
        });
      }
    }
  } catch (error) {
    console.error('OpenFIGI fetch error:', error);
  }
  
  return results;
}

/**
 * Fallback: resolve via Yahoo Finance search
 */
async function resolveViaYahooSearch(isin: string): Promise<IsinMapping | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const quote = data?.quotes?.[0];
    
    if (quote?.symbol) {
      return {
        isin,
        ticker: quote.symbol,
        exchange: quote.exchange || null,
        source: 'yahoo',
      };
    }
  } catch (error) {
    console.error(`Yahoo search error for ${isin}:`, error);
  }
  
  return null;
}

/**
 * Fallback for European ETFs: scrape JustETF for ticker
 */
async function resolveViaJustETF(isin: string): Promise<IsinMapping | null> {
  try {
    const url = `https://www.justetf.com/api/etfs/${isin}/quote`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      // Try scraping the ETF page
      const pageUrl = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
      const pageResponse = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (!pageResponse.ok) return null;
      
      const html = await pageResponse.text();
      
      // Extract ticker from page - look for "Ticker: XXX"
      const tickerMatch = html.match(/Ticker:\s*<\/td>\s*<td[^>]*>([A-Z0-9]+)/i) ||
                          html.match(/data-ticker="([A-Z0-9]+)"/i);
      
      if (tickerMatch?.[1]) {
        // Determine exchange suffix from ISIN
        let suffix = '';
        if (isin.startsWith('IE') || isin.startsWith('LU')) {
          // Check for common European exchanges
          const exchangeMatch = html.match(/Xetra|London|Borsa Italiana|Euronext/i);
          if (exchangeMatch) {
            const exchangeMap: Record<string, string> = {
              'xetra': '.DE',
              'london': '.L',
              'borsa italiana': '.MI',
              'euronext': '.PA',
            };
            suffix = exchangeMap[exchangeMatch[0].toLowerCase()] || '';
          }
        }
        
        return {
          isin,
          ticker: `${tickerMatch[1]}${suffix}`,
          exchange: null,
          source: 'justetf',
        };
      }
    }
    
    const data = await response.json();
    if (data?.ticker) {
      return {
        isin,
        ticker: data.ticker,
        exchange: data.exchange || null,
        source: 'justetf',
      };
    }
  } catch (error) {
    console.error(`JustETF error for ${isin}:`, error);
  }
  
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { isins }: { isins: string[] } = await req.json();
    
    if (!isins || !Array.isArray(isins) || isins.length === 0) {
      return new Response(JSON.stringify({ mappings: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`Resolving ${isins.length} ISINs`);
    
    // Create Supabase client for cache
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Check cache first
    const { data: cached } = await supabase
      .from('isin_mappings')
      .select('*')
      .in('isin', isins);
    
    const cachedMap = new Map<string, IsinMapping>();
    const uncachedIsins: string[] = [];
    
    for (const isin of isins) {
      const cachedItem = cached?.find(c => c.isin === isin);
      if (cachedItem) {
        cachedMap.set(isin, cachedItem as IsinMapping);
      } else {
        uncachedIsins.push(isin);
      }
    }
    
    console.log(`Found ${cachedMap.size} cached, resolving ${uncachedIsins.length} new`);
    
    // Resolve uncached ISINs
    const newMappings = new Map<string, IsinMapping>();
    
    if (uncachedIsins.length > 0) {
      // Step 1: Try OpenFIGI for all
      const figiResults = await resolveViaOpenFigi(uncachedIsins);
      figiResults.forEach((v, k) => newMappings.set(k, v));
      
      // Step 2: Yahoo fallback for still unresolved
      const stillUnresolved = uncachedIsins.filter(isin => !newMappings.has(isin));
      
      for (const isin of stillUnresolved) {
        const yahooResult = await resolveViaYahooSearch(isin);
        if (yahooResult) {
          newMappings.set(isin, yahooResult);
          continue;
        }
        
        // Step 3: JustETF fallback for ETFs (usually IE/LU ISINs)
        if (isin.startsWith('IE') || isin.startsWith('LU')) {
          const justEtfResult = await resolveViaJustETF(isin);
          if (justEtfResult) {
            newMappings.set(isin, justEtfResult);
          }
        }
      }
      
      // Cache new mappings
      if (newMappings.size > 0) {
        const toInsert = Array.from(newMappings.values()).map(m => ({
          isin: m.isin,
          ticker: m.ticker,
          exchange: m.exchange,
          source: m.source,
        }));
        
        await supabase.from('isin_mappings').upsert(toInsert, { onConflict: 'isin' });
        console.log(`Cached ${toInsert.length} new ISIN mappings`);
      }
    }
    
    // Combine cached and new results
    const allMappings: Record<string, string> = {};
    
    cachedMap.forEach((v, k) => {
      allMappings[k] = v.ticker;
    });
    
    newMappings.forEach((v, k) => {
      allMappings[k] = v.ticker;
    });
    
    console.log(`Returning ${Object.keys(allMappings).length} mappings`);
    
    return new Response(JSON.stringify({ mappings: allMappings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in resolve-isin:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        mappings: {},
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
