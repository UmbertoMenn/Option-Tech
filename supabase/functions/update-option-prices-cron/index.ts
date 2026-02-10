import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Chunk array into batches
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate the 3rd Friday of a given month (0-indexed)
function getThirdFriday(year: number, month: number): Date {
  const firstDay = new Date(year, month, 1);
  const firstFriday = 1 + ((5 - firstDay.getDay() + 7) % 7);
  return new Date(year, month, firstFriday + 14);
}

// Build OCC symbol: {TICKER}{YYMMDD}{C/P}{STRIKE*1000 padded 8 digits}
// Broker stores expiry as ~21st of month; OCC requires the 3rd Friday
function buildOCCSymbol(ticker: string, expiryDate: string, optionType: string, strikePrice: number): string {
  const d = new Date(expiryDate);
  const thirdFri = getThirdFriday(d.getFullYear(), d.getMonth());
  const yy = thirdFri.getFullYear().toString().slice(-2);
  const mm = (thirdFri.getMonth() + 1).toString().padStart(2, '0');
  const dd = thirdFri.getDate().toString().padStart(2, '0');
  const type = optionType.toLowerCase() === 'call' ? 'C' : 'P';
  // Strike * 1000, padded to 8 digits
  const strikeInt = Math.round(strikePrice * 1000);
  const strikeStr = strikeInt.toString().padStart(8, '0');
  return `${ticker}${yy}${mm}${dd}${type}${strikeStr}`;
}

// Fetch option price from Yahoo Finance using (bid+ask)/2
async function fetchOptionPrice(occSymbol: string): Promise<{ price: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(occSymbol)}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.log(`Yahoo API returned ${response.status} for ${occSymbol}`);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      console.log(`No result in Yahoo response for ${occSymbol}`);
      return null;
    }
    
    const meta = result.meta;
    
    // Try (bid + ask) / 2 first
    const bid = meta.bid;
    const ask = meta.ask;
    
    if (bid != null && ask != null && bid > 0 && ask > 0) {
      const price = (bid + ask) / 2;
      console.log(`[Yahoo] ${occSymbol}: bid=${bid}, ask=${ask}, mid=${price.toFixed(4)}`);
      return { price };
    }
    
    // Fallback to regularMarketPrice
    const regularPrice = meta.regularMarketPrice;
    if (regularPrice && regularPrice > 0) {
      console.log(`[Yahoo] ${occSymbol}: fallback to regularMarketPrice=${regularPrice}`);
      return { price: regularPrice };
    }
    
    // Try previousClose as last resort
    const prevClose = meta.previousClose;
    if (prevClose && prevClose > 0) {
      console.log(`[Yahoo] ${occSymbol}: fallback to previousClose=${prevClose}`);
      return { price: prevClose };
    }
    
    console.log(`[Yahoo] No valid price for ${occSymbol}`);
    return null;
  } catch (error) {
    console.error(`Error fetching ${occSymbol}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== Update Option Prices Cron Job Started ===");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get all active derivative positions (not expired)
    const today = new Date().toISOString().split('T')[0];
    const { data: derivatives, error: derivError } = await supabase
      .from('positions')
      .select('id, underlying, option_type, strike_price, expiry_date')
      .eq('asset_type', 'derivative')
      .not('underlying', 'is', null)
      .not('option_type', 'is', null)
      .not('strike_price', 'is', null)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today);
    
    if (derivError) {
      throw new Error(`Error fetching derivatives: ${derivError.message}`);
    }

    if (!derivatives || derivatives.length === 0) {
      console.log("No active derivatives found");
      return new Response(
        JSON.stringify({ success: true, message: "No active derivatives", updated: 0, failed: 0, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${derivatives.length} active derivative positions`);

    // Step 2: Get all underlying_mappings
    const uniqueUnderlyings = [...new Set(derivatives.map(d => d.underlying).filter(Boolean))];
    const { data: mappings, error: mapError } = await supabase
      .from('underlying_mappings')
      .select('underlying, ticker')
      .in('underlying', uniqueUnderlyings);
    
    if (mapError) {
      console.error("Error fetching underlying_mappings:", mapError.message);
    }

    const underlyingToTicker: Record<string, string> = {};
    mappings?.forEach(m => {
      underlyingToTicker[m.underlying] = m.ticker;
    });

    console.log(`Resolved ${Object.keys(underlyingToTicker).length} / ${uniqueUnderlyings.length} underlyings to tickers`);

    // Step 3: Build OCC symbols and map to position IDs
    interface OptionUpdate {
      positionId: string;
      occSymbol: string;
      underlying: string;
    }

    const updates: OptionUpdate[] = [];
    const skipped: string[] = [];

    for (const d of derivatives) {
      const ticker = underlyingToTicker[d.underlying];
      if (!ticker) {
        skipped.push(`${d.underlying} (no ticker mapping)`);
        continue;
      }

      const occSymbol = buildOCCSymbol(ticker, d.expiry_date, d.option_type, d.strike_price);
      updates.push({
        positionId: d.id,
        occSymbol,
        underlying: d.underlying,
      });
    }

    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} positions without ticker mapping: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}`);
    }

    console.log(`Will fetch prices for ${updates.length} options`);

    // Step 4: Fetch prices in batches with rate limiting
    const BATCH_SIZE = 50;
    const DELAY_BETWEEN_CALLS = 200; // ms
    const DELAY_BETWEEN_BATCHES = 2000; // ms

    const batches = chunkArray(updates, BATCH_SIZE);
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      if (batchIndex > 0) {
        console.log(`Pausing ${DELAY_BETWEEN_BATCHES}ms between batches (${batchIndex + 1}/${batches.length})...`);
        await delay(DELAY_BETWEEN_BATCHES);
      }

      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} options)`);

      for (const item of batch) {
        try {
          const result = await fetchOptionPrice(item.occSymbol);

          if (result) {
            const { error: updateError } = await supabase
              .from('positions')
              .update({
                current_price: result.price,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.positionId);

            if (updateError) {
              console.error(`Failed to update position ${item.positionId}:`, updateError.message);
              failed++;
              errors.push(`${item.occSymbol}: update failed`);
            } else {
              updated++;
            }
          } else {
            failed++;
            errors.push(`${item.occSymbol}: no price data`);
          }

          await delay(DELAY_BETWEEN_CALLS);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error processing ${item.occSymbol}:`, errorMsg);
          failed++;
          errors.push(`${item.occSymbol}: ${errorMsg}`);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`=== Option Prices Cron Completed: ${updated} updated, ${failed} failed, ${skipped.length} skipped in ${durationMs}ms ===`);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        failed,
        skipped: skipped.length,
        total: derivatives.length,
        duration_ms: durationMs,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Cron job error:", errorMessage);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage, duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
