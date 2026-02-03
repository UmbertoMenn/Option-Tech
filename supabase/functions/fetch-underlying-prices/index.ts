import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UnderlyingPriceResult {
  price: number;
  currency: string;
  ticker?: string;
}

// Static mappings for common company names to tickers
const SPECIAL_MAPPINGS: Record<string, string> = {
  // Common variations
  'NVIDIA': 'NVDA',
  'NVIDIA CORP': 'NVDA',
  'APPLE': 'AAPL',
  'APPLE INC': 'AAPL',
  'APPLE COMPUTER': 'AAPL',
  'APPLE COMPUTER INC': 'AAPL',
  'AMAZON': 'AMZN',
  'AMAZON COM': 'AMZN',
  'AMAZON.COM': 'AMZN',
  'AMAZON.COM INC': 'AMZN',
  'AMAZON COM INC': 'AMZN',
  'MICROSOFT': 'MSFT',
  'MICROSOFT CORP': 'MSFT',
  'GOOGLE': 'GOOGL',
  'ALPHABET': 'GOOGL',
  'ALPHABET INC': 'GOOGL',
  'ALPHABET CLASS': 'GOOGL',
  'TESLA': 'TSLA',
  'TESLA INC': 'TSLA',
  'META': 'META',
  'META PLATFORMS': 'META',
  'FACEBOOK': 'META',
  'NETFLIX': 'NFLX',
  'NETFLIX INC': 'NFLX',
  'INTEL': 'INTC',
  'INTEL CORP': 'INTC',
  'AMD': 'AMD',
  'ADVANCED MICRO DEVICES': 'AMD',
  'ADOBE': 'ADBE',
  'ADOBE INC': 'ADBE',
  'SALESFORCE': 'CRM',
  'CISCO': 'CSCO',
  'CISCO SYSTEMS': 'CSCO',
  'ORACLE': 'ORCL',
  'ORACLE CORP': 'ORCL',
  'IBM': 'IBM',
  'PAYPAL': 'PYPL',
  'PAYPAL HOLDINGS': 'PYPL',
  'DISNEY': 'DIS',
  'WALT DISNEY': 'DIS',
  'WALMART': 'WMT',
  'JOHNSON': 'JNJ',
  'JOHNSON JOHNSON': 'JNJ',
  'VISA': 'V',
  'VISA INC': 'V',
  'MASTERCARD': 'MA',
  'JPMORGAN': 'JPM',
  'JP MORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'GOLDMAN SACHS': 'GS',
  'MORGAN STANLEY': 'MS',
  'BERKSHIRE': 'BRK-B',
  'BERKSHIRE HATHAWAY': 'BRK-B',
  'EXXON': 'XOM',
  'EXXON MOBIL': 'XOM',
  'CHEVRON': 'CVX',
  'COCA COLA': 'KO',
  'COCA-COLA': 'KO',
  'PEPSI': 'PEP',
  'PEPSICO': 'PEP',
  'PROCTER': 'PG',
  'PROCTER GAMBLE': 'PG',
  'NETEASE': 'NTES',
  'NETEASE INC': 'NTES',
  'ENI': 'ENI.MI',
  'ENI SPA': 'ENI.MI',
  'ALIBABA': 'BABA',
  'ALIBABA GROUP': 'BABA',
  'PDD': 'PDD',
  'PDD HOLDINGS': 'PDD',
  'PINDUODUO': 'PDD',
  'PALANTIR': 'PLTR',
  'PALANTIR TECHNOLOGIES': 'PLTR',
  'SNOWFLAKE': 'SNOW',
  'SNOWFLAKE INC': 'SNOW',
  'SERVICENOW': 'NOW',
  'LOCKHEED': 'LMT',
  'LOCKHEED MARTIN': 'LMT',
  'BOEING': 'BA',
  'GENERAL ELECTRIC': 'GE',
  'BROADCOM': 'AVGO',
  'QUALCOMM': 'QCOM',
  'TEXAS INSTRUMENTS': 'TXN',
  'ELI LILLY': 'LLY',
  'LILLY': 'LLY',
  'NOVO NORDISK': 'NVO',
  'UNITEDHEALTH': 'UNH',
  'PFIZER': 'PFE',
  'ABBVIE': 'ABBV',
  'MERCK': 'MRK',
  'CONOCOPHILLIPS': 'COP',
  'CONSTELLATION ENERGY': 'CEG',
  'BYD': 'BYD',
  'RAYTHEON': 'RTX',
  'COSTCO': 'COST',
  'COREWEAVE': 'CRWV',
};

// Normalize name for matching
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bLLC\b/g, '')
    .replace(/\bPLC\b/g, '')
    .replace(/\bCO\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Try to extract ticker from a known format like "NVIDIA CORP" or find in mappings
function resolveTickerFromName(name: string): string | null {
  const normalized = normalizeName(name);
  
  // Direct match
  if (SPECIAL_MAPPINGS[normalized]) {
    return SPECIAL_MAPPINGS[normalized];
  }
  
  // Try partial matches
  for (const [key, ticker] of Object.entries(SPECIAL_MAPPINGS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return ticker;
    }
  }
  
  // Try to extract ticker pattern from the name (e.g., symbols like "AAPL", "MSFT")
  const tickerMatch = name.match(/\b([A-Z]{1,5})\b/);
  if (tickerMatch && SPECIAL_MAPPINGS[tickerMatch[1]]) {
    return SPECIAL_MAPPINGS[tickerMatch[1]];
  }
  
  return null;
}

// Use AI to infer ticker from company name
async function inferTickerWithAI(companyName: string): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log('No LOVABLE_API_KEY available for ticker inference');
    return null;
  }
  
  try {
    console.log(`Calling AI to infer ticker for: ${companyName}`);
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{
          role: "user",
          content: `What is the US stock ticker symbol for the company "${companyName}"? 
Reply with ONLY the ticker symbol (e.g., AAPL, MSFT, GOOGL, AMZN).
If this is not a publicly traded US company or you're unsure, reply "UNKNOWN".
Do not include any other text or explanation.`
        }],
        max_tokens: 20,
      }),
    });
    
    if (!response.ok) {
      console.error(`AI ticker inference failed with status: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const tickerRaw = data.choices?.[0]?.message?.content?.trim().toUpperCase();
    
    // Clean up the response
    const ticker = tickerRaw?.split(/[\s,.\n]/)[0];
    
    if (ticker && ticker !== 'UNKNOWN' && ticker.length >= 1 && ticker.length <= 5 && /^[A-Z-]+$/.test(ticker)) {
      console.log(`AI inferred ticker for "${companyName}": ${ticker}`);
      return ticker;
    }
    
    console.log(`AI could not infer valid ticker for "${companyName}": ${tickerRaw}`);
    return null;
  } catch (error) {
    console.error('Error inferring ticker with AI:', error);
    return null;
  }
}

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

// Validate ticker by checking if Yahoo Finance returns a valid price
async function validateTicker(ticker: string): Promise<boolean> {
  const priceResult = await fetchYahooPrice(ticker);
  return priceResult !== null && priceResult.price > 0;
}

// Check underlying_mappings cache with case-insensitive fallback
async function checkUnderlyingMappingsCache(
  supabase: any,
  underlying: string
): Promise<string | null> {
  try {
    // Try exact match first
    const { data } = await supabase
      .from('underlying_mappings')
      .select('ticker')
      .eq('underlying', underlying)
      .single();
    
    if (data?.ticker) {
      console.log(`Cache hit (exact) for "${underlying}": ${data.ticker}`);
      return data.ticker;
    }
  } catch {
    // No exact match, continue to normalized search
  }
  
  try {
    // Try case-insensitive match using normalized name
    const normalized = normalizeName(underlying);
    const firstWord = normalized.split(' ')[0];
    
    const { data: iData } = await supabase
      .from('underlying_mappings')
      .select('ticker, underlying')
      .ilike('underlying', `%${firstWord}%`)
      .limit(10);
    
    if (iData && iData.length > 0) {
      // Find best match using normalized comparison
      for (const row of iData) {
        if (normalizeName(row.underlying) === normalized) {
          console.log(`Cache hit (normalized) for "${underlying}": ${row.ticker}`);
          return row.ticker;
        }
      }
    }
  } catch (error) {
    console.log(`Error in normalized cache lookup: ${error}`);
  }
  
  return null;
}

// Save to underlying_mappings cache
async function saveToUnderlyingMappingsCache(
  supabase: any,
  underlying: string,
  ticker: string
): Promise<void> {
  try {
    await supabase
      .from('underlying_mappings')
      .upsert({
        underlying,
        ticker,
        source: 'fetch-underlying-prices',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'underlying' });
    console.log(`Saved mapping: "${underlying}" -> ${ticker}`);
  } catch (error) {
    console.error(`Error saving mapping for "${underlying}":`, error);
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { underlyings } = await req.json();
    
    if (!Array.isArray(underlyings) || underlyings.length === 0) {
      return new Response(
        JSON.stringify({ error: "underlyings must be a non-empty array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Fetching prices for ${underlyings.length} underlyings:`, underlyings);
    
    const results: Record<string, UnderlyingPriceResult> = {};
    
    for (const underlying of underlyings) {
      if (!underlying || typeof underlying !== 'string') continue;
      
      let ticker: string | null = null;
      
      // Step 1: Check underlying_mappings cache
      ticker = await checkUnderlyingMappingsCache(supabase, underlying);
      
      // Step 2: Try static mappings
      if (!ticker) {
        ticker = resolveTickerFromName(underlying);
        if (ticker) {
          console.log(`Resolved "${underlying}" via static mapping: ${ticker}`);
        }
      }
      
      // Step 3: Try AI inference with validation
      if (!ticker) {
        const aiTicker = await inferTickerWithAI(underlying);
        
        if (aiTicker) {
          // Validate AI-inferred ticker before accepting it
          const isValid = await validateTicker(aiTicker);
          if (isValid) {
            ticker = aiTicker;
            console.log(`AI ticker "${aiTicker}" validated successfully for "${underlying}"`);
          } else {
            console.log(`AI ticker "${aiTicker}" failed validation for "${underlying}"`);
          }
        }
      }
      
      if (!ticker) {
        console.log(`Could not resolve ticker for "${underlying}"`);
        continue;
      }
      
      // Save to cache using NORMALIZED underlying for consistency
      const normalizedUnderlying = normalizeName(underlying);
      await saveToUnderlyingMappingsCache(supabase, normalizedUnderlying, ticker);
      
      // Step 4: Fetch price from Yahoo Finance
      const priceResult = await fetchYahooPrice(ticker);
      
      if (priceResult) {
        results[underlying] = {
          price: priceResult.price,
          currency: priceResult.currency,
          ticker,
        };
        console.log(`Got price for "${underlying}" (${ticker}): ${priceResult.price} ${priceResult.currency}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Returning ${Object.keys(results).length} prices`);
    
    return new Response(
      JSON.stringify({ prices: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-underlying-prices:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
