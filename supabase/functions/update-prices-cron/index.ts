import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Position {
  id: string;
  description: string;
  isin: string | null;
  ticker: string | null;
  current_price: number | null;
  asset_type: string;
  quantity: number;
  currency: string | null;
}

interface PriceResult {
  ticker: string;
  price: number;
  currency: string;
  name?: string;
}

interface UpdateResult {
  positionId: string;
  description: string;
  success: boolean;
  oldPrice: number | null;
  newPrice: number | null;
  error?: string;
}

// Yahoo Finance Quote API
async function fetchYahooPrice(ticker: string): Promise<PriceResult | null> {
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
      ticker,
      price,
      currency: meta.currency || 'USD',
      name: meta.shortName || meta.longName,
    };
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error);
    return null;
  }
}

// Yahoo Finance Search API - for ISIN resolution
async function searchYahooByISIN(isin: string): Promise<{ ticker: string; name: string; exchange: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const quotes = data.quotes || [];
    
    // Filter for equity/ETF types and prefer European exchanges for EU ISINs
    const validQuotes = quotes.filter((q: any) => 
      q.quoteType === 'EQUITY' || q.quoteType === 'ETF'
    );
    
    if (validQuotes.length === 0) {
      return null;
    }
    
    // For IE (Ireland) ISINs, prefer European exchanges
    const isEuropeanISIN = isin.startsWith('IE') || isin.startsWith('DE') || 
                           isin.startsWith('FR') || isin.startsWith('LU');
    
    let bestMatch = validQuotes[0];
    
    if (isEuropeanISIN) {
      // Prefer .DE, .L, .MI, .PA exchanges for European ISINs
      const europeanMatch = validQuotes.find((q: any) => 
        q.symbol.endsWith('.DE') || q.symbol.endsWith('.L') || 
        q.symbol.endsWith('.MI') || q.symbol.endsWith('.PA') ||
        q.symbol.endsWith('.AS') || q.symbol.endsWith('.SW')
      );
      if (europeanMatch) {
        bestMatch = europeanMatch;
      }
    }
    
    return {
      ticker: bestMatch.symbol,
      name: bestMatch.shortname || bestMatch.longname || '',
      exchange: bestMatch.exchange || '',
    };
  } catch (error) {
    console.error(`Error searching ISIN ${isin}:`, error);
    return null;
  }
}

// Resolve ISIN to ticker using cache + Yahoo Search
async function resolveISINToTicker(
  supabase: any,
  isin: string,
  positionDescription: string
): Promise<string | null> {
  // 1. Check cache first
  const { data: cached } = await supabase
    .from('isin_mappings')
    .select('ticker')
    .eq('isin', isin)
    .single();
  
  if (cached?.ticker) {
    console.log(`Cache hit for ISIN ${isin}: ${cached.ticker}`);
    return cached.ticker;
  }
  
  // 2. Search Yahoo Finance
  console.log(`Cache miss for ISIN ${isin}, searching Yahoo...`);
  const searchResult = await searchYahooByISIN(isin);
  
  if (!searchResult) {
    console.log(`No Yahoo result for ISIN ${isin}`);
    return null;
  }
  
  // 3. Validate result - check if name has some similarity to position description
  const descWords = positionDescription.toLowerCase().split(/\s+/);
  const nameWords = searchResult.name.toLowerCase().split(/\s+/);
  const hasCommonWord = descWords.some(dw => 
    nameWords.some(nw => nw.includes(dw) || dw.includes(nw)) && dw.length > 3
  );
  
  // If no common words and it's an ETF, still accept (ETF names vary a lot)
  const isLikelyValid = hasCommonWord || 
    searchResult.name.toLowerCase().includes('ishares') ||
    searchResult.name.toLowerCase().includes('vanguard') ||
    searchResult.name.toLowerCase().includes('xtrackers') ||
    searchResult.name.toLowerCase().includes('spdr') ||
    searchResult.name.toLowerCase().includes('invesco') ||
    positionDescription.toLowerCase().includes('ishares') ||
    positionDescription.toLowerCase().includes('etf');
  
  if (!isLikelyValid) {
    console.log(`Validation failed for ISIN ${isin}: "${searchResult.name}" vs "${positionDescription}"`);
    return null;
  }
  
  // 4. Save to cache
  await supabase
    .from('isin_mappings')
    .upsert({
      isin,
      ticker: searchResult.ticker,
      exchange: searchResult.exchange,
      source: 'yahoo_search',
      last_verified_at: new Date().toISOString(),
    }, { onConflict: 'isin' });
  
  console.log(`Saved mapping: ${isin} -> ${searchResult.ticker}`);
  return searchResult.ticker;
}

// Determine the best ticker to use for a position
async function getTickerForPosition(
  supabase: any,
  position: Position
): Promise<string | null> {
  // Priority 1: Use existing ticker if it looks valid
  if (position.ticker && !position.ticker.includes(' ') && position.ticker.length < 15) {
    return position.ticker;
  }
  
  // Priority 2: Resolve ISIN
  if (position.isin) {
    const resolved = await resolveISINToTicker(supabase, position.isin, position.description);
    if (resolved) {
      return resolved;
    }
  }
  
  // Priority 3: Try to extract ticker from description for US stocks
  const descUpper = position.description.toUpperCase();
  const commonUSStocks: Record<string, string> = {
    'APPLE': 'AAPL',
    'MICROSOFT': 'MSFT',
    'AMAZON': 'AMZN',
    'GOOGLE': 'GOOGL',
    'ALPHABET': 'GOOGL',
    'TESLA': 'TSLA',
    'NVIDIA': 'NVDA',
    'META': 'META',
    'FACEBOOK': 'META',
    'NETFLIX': 'NFLX',
    'INTEL': 'INTC',
    'AMD': 'AMD',
    'ADOBE': 'ADBE',
    'SALESFORCE': 'CRM',
    'CISCO': 'CSCO',
    'ORACLE': 'ORCL',
    'IBM': 'IBM',
    'PAYPAL': 'PYPL',
    'DISNEY': 'DIS',
    'WALMART': 'WMT',
    'JOHNSON': 'JNJ',
    'VISA': 'V',
    'MASTERCARD': 'MA',
    'JPMORGAN': 'JPM',
    'GOLDMAN': 'GS',
    'MORGAN STANLEY': 'MS',
    'BERKSHIRE': 'BRK-B',
    'EXXON': 'XOM',
    'CHEVRON': 'CVX',
    'COCA-COLA': 'KO',
    'PEPSI': 'PEP',
    'PROCTER': 'PG',
    'NETEASE': 'NTES',
  };
  
  for (const [name, ticker] of Object.entries(commonUSStocks)) {
    if (descUpper.includes(name)) {
      return ticker;
    }
  }
  
  return null;
}

// Validate price change (sanity check)
function validatePriceChange(oldPrice: number | null, newPrice: number): { valid: boolean; reason?: string } {
  if (!oldPrice || oldPrice <= 0) {
    return { valid: true }; // First time price, accept it
  }
  
  const changePercent = Math.abs(newPrice - oldPrice) / oldPrice * 100;
  
  // Reject changes > 50% as suspicious
  if (changePercent > 50) {
    return { 
      valid: false, 
      reason: `Price change of ${changePercent.toFixed(1)}% exceeds 50% threshold (${oldPrice} -> ${newPrice})` 
    };
  }
  
  return { valid: true };
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const results: UpdateResult[] = [];
  let logId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Create log entry
    const { data: logEntry } = await supabase
      .from('price_update_logs')
      .insert({ source: 'cron', started_at: new Date().toISOString() })
      .select('id')
      .single();
    
    logId = logEntry?.id;

    // Fetch positions to update (Stocks, ETFs, Commodities only)
    const { data: positions, error: fetchError } = await supabase
      .from('positions')
      .select('id, description, isin, ticker, current_price, asset_type, quantity, currency')
      .in('asset_type', ['Stock', 'ETF', 'Commodity']);

    if (fetchError) {
      throw new Error(`Failed to fetch positions: ${fetchError.message}`);
    }

    console.log(`Found ${positions?.length || 0} positions to update`);

    // Process positions in batches
    const batchSize = 10;
    for (let i = 0; i < (positions?.length || 0); i += batchSize) {
      const batch = positions!.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (position: Position) => {
        const result: UpdateResult = {
          positionId: position.id,
          description: position.description,
          success: false,
          oldPrice: position.current_price,
          newPrice: null,
        };

        try {
          // Get ticker
          const ticker = await getTickerForPosition(supabase, position);
          
          if (!ticker) {
            result.error = 'Could not resolve ticker';
            results.push(result);
            return;
          }

          // Fetch price
          const priceData = await fetchYahooPrice(ticker);
          
          if (!priceData) {
            result.error = `Failed to fetch price for ${ticker}`;
            results.push(result);
            return;
          }

          // Validate price change
          const validation = validatePriceChange(position.current_price, priceData.price);
          
          if (!validation.valid) {
            result.error = validation.reason;
            console.warn(`Price validation failed for ${position.description}: ${validation.reason}`);
            results.push(result);
            return;
          }

          // Calculate new market value
          const newMarketValue = priceData.price * position.quantity;
          
          // Update position
          const { error: updateError } = await supabase
            .from('positions')
            .update({
              current_price: priceData.price,
              market_value: newMarketValue,
              ticker: ticker, // Also update ticker if we resolved it
              updated_at: new Date().toISOString(),
            })
            .eq('id', position.id);

          if (updateError) {
            result.error = `Update failed: ${updateError.message}`;
          } else {
            result.success = true;
            result.newPrice = priceData.price;
          }
        } catch (err) {
          result.error = err instanceof Error ? err.message : 'Unknown error';
        }

        results.push(result);
      }));

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < (positions?.length || 0)) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Update log entry
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (logId) {
      await supabase
        .from('price_update_logs')
        .update({
          positions_updated: successCount,
          positions_failed: failCount,
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId);
    }

    // Update portfolio last_updated timestamp
    const portfolioIds = [...new Set(positions?.map(p => (p as any).portfolio_id).filter(Boolean))];
    if (portfolioIds.length > 0) {
      await supabase
        .from('portfolios')
        .update({ last_updated: new Date().toISOString() })
        .in('id', portfolioIds);
    }

    const duration = Date.now() - startTime;
    console.log(`Price update completed in ${duration}ms: ${successCount} updated, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        duration: `${duration}ms`,
        updated: successCount,
        failed: failCount,
        results: results.slice(0, 50), // Return first 50 for debugging
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in update-prices-cron:", error);
    
    // Update log with error
    if (logId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase
        .from('price_update_logs')
        .update({
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', logId);
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
