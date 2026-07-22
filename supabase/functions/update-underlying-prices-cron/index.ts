import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// EU ticker suffixes - use Yahoo Finance for these
const EU_SUFFIXES = ['.MI', '.DE', '.SW', '.PA', '.AS', '.L', '.MC', '.BR', '.VI', '.CO', '.HE', '.ST', '.OL', '.LS'];

function isEuropeanTicker(ticker: string): boolean {
  const upperTicker = ticker.toUpperCase();
  return EU_SUFFIXES.some(suffix => upperTicker.endsWith(suffix));
}

// Chunk array into batches
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Fetch price from Yahoo Finance (for EU tickers)
async function fetchYahooPrice(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.log(`Yahoo API returned ${response.status} for ${ticker}`);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      console.log(`No result in Yahoo response for ${ticker}`);
      return null;
    }
    
    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    
    if (!price || price <= 0) {
      console.log(`Invalid price for ${ticker}: ${price}`);
      return null;
    }
    
    return {
      price,
      currency: meta.currency || 'USD',
    };
  } catch (error) {
    console.error(`Error fetching Yahoo price for ${ticker}:`, error);
    return null;
  }
}

// Fetch price from Finnhub (for US tickers)
async function fetchFinnhubPrice(ticker: string, apiKey: string): Promise<{ price: number; currency: string } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Finnhub API returned ${response.status} for ${ticker}`);
      return null;
    }
    
    const data = await response.json();
    // Finnhub response: { c: currentPrice, h: high, l: low, o: open, pc: previousClose, t: timestamp }
    const price = data.c; // Current price
    
    if (!price || price <= 0) {
      // Fallback to previous close if current price is 0 (market closed)
      if (data.pc && data.pc > 0) {
        console.log(`Using previous close for ${ticker}: ${data.pc}`);
        return { price: data.pc, currency: 'USD' };
      }
      console.log(`Invalid Finnhub price for ${ticker}: ${price}`);
      return null;
    }
    
    return { price, currency: 'USD' };
  } catch (error) {
    console.error(`Error fetching Finnhub price for ${ticker}:`, error);
    return null;
  }
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  console.log("=== Update Underlying Prices Cron Job Started ===");

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const finnhubApiKey = Deno.env.get("FINNHUB_API_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }
    
    if (!finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not configured - will use Yahoo Finance for all tickers");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get ISINs from active STOCK positions
    const { data: stockPositions, error: stockError } = await supabase
      .from('positions')
      .select('isin')
      .eq('asset_type', 'stock')
      .not('isin', 'is', null);
    
    if (stockError) {
      console.error("Error fetching stock positions:", stockError.message);
    }

    const stockIsins = [...new Set(stockPositions?.map(p => p.isin).filter(Boolean) || [])];
    console.log(`Found ${stockIsins.length} unique ISINs from stock positions`);

    // Resolve tickers from ISINs via isin_mappings
    let tickersFromStocks: string[] = [];
    if (stockIsins.length > 0) {
      const { data: isinMappings, error: isinError } = await supabase
        .from('isin_mappings')
        .select('ticker')
        .in('isin', stockIsins);
      
      if (isinError) {
        console.error("Error fetching isin_mappings:", isinError.message);
      }
      
      tickersFromStocks = isinMappings?.map(m => m.ticker).filter(Boolean) || [];
      console.log(`Resolved ${tickersFromStocks.length} tickers from stock ISINs`);
    }

    // Step 2: Get underlyings from active DERIVATIVE positions
    const { data: derivativePositions, error: derivError } = await supabase
      .from('positions')
      .select('underlying')
      .eq('asset_type', 'derivative')
      .not('underlying', 'is', null);
    
    if (derivError) {
      console.error("Error fetching derivative positions:", derivError.message);
    }

    const underlyings = [...new Set(derivativePositions?.map(p => p.underlying).filter(Boolean) || [])];
    console.log(`Found ${underlyings.length} unique underlyings from derivative positions`);

    // Resolve tickers from underlyings via underlying_mappings (with normalization fallback)
    let tickersFromDerivatives: string[] = [];
    if (underlyings.length > 0) {
      const normalizeUnderlying = (s: string): string => {
        return String(s || '')
          .toUpperCase()
          .replace(/[.,'"`]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LLC|PLC|SA|NV|AG|SE|HOLDINGS?|GROUP|GRP)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };

      const { data: allMappings, error: umError } = await supabase
        .from('underlying_mappings')
        .select('underlying, ticker');

      if (umError) {
        console.error("Error fetching underlying_mappings:", umError.message);
      }

      const exactMap: Record<string, string> = {};
      const normalizedMap: Record<string, string> = {};
      (allMappings || []).forEach((m: any) => {
        if (m.underlying && m.ticker) {
          exactMap[m.underlying] = m.ticker;
          normalizedMap[normalizeUnderlying(m.underlying)] = m.ticker;
        }
      });

      const resolved = new Set<string>();
      const unresolved: string[] = [];
      for (const u of underlyings) {
        const t = exactMap[u] || normalizedMap[normalizeUnderlying(u)];
        if (t) resolved.add(t);
        else unresolved.push(u);
      }
      tickersFromDerivatives = [...resolved];
      console.log(`Resolved ${tickersFromDerivatives.length} tickers from derivative underlyings`);
      if (unresolved.length > 0) {
        console.log(`Unresolved underlyings (no mapping): ${unresolved.join(', ')}`);
      }
    }


    // Step 3: Get tickers from price_alerts
    const { data: priceAlerts, error: priceAlertsError } = await supabase
      .from('price_alerts')
      .select('ticker')
      .eq('enabled', true);
    
    if (priceAlertsError) {
      console.error("Error fetching price_alerts:", priceAlertsError.message);
    }

    const tickersFromPriceAlerts = [...new Set(priceAlerts?.map(p => p.ticker).filter(Boolean) || [])];
    console.log(`Found ${tickersFromPriceAlerts.length} unique tickers from price_alerts`);

    // Step 4: Consolidate and deduplicate all tickers
    const uniqueTickers = [...new Set([...tickersFromStocks, ...tickersFromDerivatives, ...tickersFromPriceAlerts])];
    console.log(`Total unique tickers to update: ${uniqueTickers.length}`);

    if (uniqueTickers.length === 0) {
      console.log("No active positions found - nothing to update");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No active positions to update",
          stocks_found: stockIsins.length,
          derivatives_found: underlyings.length,
          updated: 0,
          failed: 0,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Separate EU and US tickers
    const euTickers = uniqueTickers.filter(t => isEuropeanTicker(t));
    const usTickers = uniqueTickers.filter(t => !isEuropeanTicker(t));
    
    console.log(`EU tickers (Yahoo Finance): ${euTickers.length}`);
    console.log(`US tickers (Finnhub): ${usTickers.length}`);

    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    // Step 5: Fetch EU prices via Yahoo Finance
    if (euTickers.length > 0) {
      console.log(`--- Fetching ${euTickers.length} EU tickers via Yahoo Finance ---`);
      for (const ticker of euTickers) {
        try {
          const priceResult = await fetchYahooPrice(ticker);
          
          if (priceResult) {
            const { error: upsertError } = await supabase
              .from('underlying_prices')
              .upsert({
                ticker,
                price: priceResult.price,
                currency: priceResult.currency,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'ticker' });
            
            if (upsertError) {
              console.error(`Failed to upsert price for ${ticker}:`, upsertError.message);
              failed++;
              errors.push(`${ticker}: upsert failed`);
            } else {
              console.log(`[Yahoo] Updated ${ticker}: ${priceResult.price} ${priceResult.currency}`);
              updated++;
            }
          } else {
            console.log(`[Yahoo] No price for ${ticker}`);
            failed++;
            errors.push(`${ticker}: no Yahoo data`);
          }
          
          // Rate limiting for Yahoo
          await delay(100);
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error processing ${ticker}:`, errorMsg);
          failed++;
          errors.push(`${ticker}: ${errorMsg}`);
        }
      }
    }

    // Step 6: Fetch US prices via Finnhub with batching (60/min limit)
    if (usTickers.length > 0 && finnhubApiKey) {
      const FINNHUB_RATE_LIMIT = 60;
      const batches = chunkArray(usTickers, FINNHUB_RATE_LIMIT);
      
      console.log(`--- Fetching ${usTickers.length} US tickers via Finnhub (${batches.length} batch${batches.length > 1 ? 'es' : ''}) ---`);
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        // Wait 60 seconds between batches (except for first batch)
        if (batchIndex > 0) {
          console.log(`Waiting 60 seconds for Finnhub rate limit (batch ${batchIndex + 1}/${batches.length})...`);
          await delay(60000);
        }
        
        console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} tickers)`);
        
        for (const ticker of batch) {
          try {
            const priceResult = await fetchFinnhubPrice(ticker, finnhubApiKey);
            
            if (priceResult) {
              const { error: upsertError } = await supabase
                .from('underlying_prices')
                .upsert({
                  ticker,
                  price: priceResult.price,
                  currency: priceResult.currency,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'ticker' });
              
              if (upsertError) {
                console.error(`Failed to upsert price for ${ticker}:`, upsertError.message);
                failed++;
                errors.push(`${ticker}: upsert failed`);
              } else {
                console.log(`[Finnhub] Updated ${ticker}: ${priceResult.price} USD`);
                updated++;
              }
            } else {
              console.log(`[Finnhub] No price for ${ticker}`);
              failed++;
              errors.push(`${ticker}: no Finnhub data`);
            }
            
            // Small delay between Finnhub calls to be nice
            await delay(50);
            
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error processing ${ticker}:`, errorMsg);
            failed++;
            errors.push(`${ticker}: ${errorMsg}`);
          }
        }
      }
    } else if (usTickers.length > 0 && !finnhubApiKey) {
      // Fallback to Yahoo for US if no Finnhub key
      console.log(`--- Fallback: Fetching ${usTickers.length} US tickers via Yahoo Finance ---`);
      for (const ticker of usTickers) {
        try {
          const priceResult = await fetchYahooPrice(ticker);
          
          if (priceResult) {
            const { error: upsertError } = await supabase
              .from('underlying_prices')
              .upsert({
                ticker,
                price: priceResult.price,
                currency: priceResult.currency,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'ticker' });
            
            if (upsertError) {
              failed++;
              errors.push(`${ticker}: upsert failed`);
            } else {
              console.log(`[Yahoo-Fallback] Updated ${ticker}: ${priceResult.price} ${priceResult.currency}`);
              updated++;
            }
          } else {
            failed++;
            errors.push(`${ticker}: no Yahoo data`);
          }
          
          await delay(100);
          
        } catch (error) {
          failed++;
          errors.push(`${ticker}: error`);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`=== Cron Job Completed: ${updated} updated, ${failed} failed in ${durationMs}ms ===`);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        failed,
        total: uniqueTickers.length,
        eu_tickers: euTickers.length,
        us_tickers: usTickers.length,
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Cron job error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
