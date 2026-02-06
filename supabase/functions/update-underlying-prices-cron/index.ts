import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fetch price from Yahoo Finance
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
    console.error(`Error fetching price for ${ticker}:`, error);
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

  const startTime = Date.now();
  console.log("=== Update Underlying Prices Cron Job Started ===");

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
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

    // Resolve tickers from underlyings via underlying_mappings
    let tickersFromDerivatives: string[] = [];
    if (underlyings.length > 0) {
      const { data: underlyingMappings, error: umError } = await supabase
        .from('underlying_mappings')
        .select('ticker')
        .in('underlying', underlyings);
      
      if (umError) {
        console.error("Error fetching underlying_mappings:", umError.message);
      }
      
      tickersFromDerivatives = underlyingMappings?.map(m => m.ticker).filter(Boolean) || [];
      console.log(`Resolved ${tickersFromDerivatives.length} tickers from derivative underlyings`);
    }

    // Step 3: Consolidate and deduplicate
    const uniqueTickers = [...new Set([...tickersFromStocks, ...tickersFromDerivatives])];
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
    console.log(`Found ${uniqueTickers.length} unique tickers to update`);

    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    // Step 2: Fetch prices for each ticker and upsert to underlying_prices
    for (const ticker of uniqueTickers) {
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
            errors.push(`${ticker}: upsert failed - ${upsertError.message}`);
          } else {
            console.log(`Updated ${ticker}: ${priceResult.price} ${priceResult.currency}`);
            updated++;
          }
        } else {
          console.log(`No price available for ${ticker}`);
          failed++;
          errors.push(`${ticker}: no price data`);
        }
        
        // Rate limiting: 100ms between requests
        await delay(100);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing ${ticker}:`, errorMsg);
        failed++;
        errors.push(`${ticker}: ${errorMsg}`);
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
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit errors in response
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
