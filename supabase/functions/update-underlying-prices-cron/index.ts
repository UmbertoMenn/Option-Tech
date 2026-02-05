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

    // Step 1: Get all unique tickers from underlying_mappings
    const { data: mappings, error: mappingsError } = await supabase
      .from('underlying_mappings')
      .select('ticker');
    
    if (mappingsError) {
      throw new Error(`Failed to fetch underlying_mappings: ${mappingsError.message}`);
    }

    if (!mappings || mappings.length === 0) {
      console.log("No tickers found in underlying_mappings");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No tickers to update",
          updated: 0,
          failed: 0,
          duration_ms: Date.now() - startTime
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get unique tickers
    const uniqueTickers = [...new Set(mappings.map(m => m.ticker).filter(Boolean))];
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
