import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PriceData {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  lastUpdated: string;
  source: 'yahoo' | 'yahoo-options' | 'justetf' | 'error';
  error?: string;
}

interface RequestBody {
  tickers: string[];       // Stock/ETF tickers: ["AAPL", "MSFT"]
  isins: string[];         // ISINs for ISIN-based resolution: ["IT0003132476"]
  options: OptionRequest[];
}

interface OptionRequest {
  underlying: string;
  expiry: string;
  optionType: 'call' | 'put';
  strike: number;
  originalId: string;
}

// ============ LOCAL UNDERLYING TO TICKER MAPPING (for fast lookup) ============

const UNDERLYING_TO_TICKER: Record<string, string> = {
  'APPLE COMPUTER, INC.': 'AAPL', 'APPLE COMPUTER INC': 'AAPL', 'APPLE INC': 'AAPL', 'APPLE INC.': 'AAPL',
  'NVIDIA CORP': 'NVDA', 'NVIDIA CORPORATION': 'NVDA',
  'MICROSOFT CORP': 'MSFT', 'MICROSOFT CORPORATION': 'MSFT',
  'AMAZON.COM.INC': 'AMZN', 'AMAZON.COM, INC.': 'AMZN', 'AMAZON.COM INC': 'AMZN', 'AMAZON COM INC': 'AMZN',
  'META PLATFORMS': 'META', 'META PLATFORMS INC': 'META', 'META PLATFORMS, INC.': 'META', 'FACEBOOK INC': 'META',
  'ALPHABET INC': 'GOOGL', 'ALPHABET INC.': 'GOOGL', 'GOOGLE INC.': 'GOOGL', 'GOOGLE INC. (A)': 'GOOGL',
  'ALPHABET INC-CL A': 'GOOGL', 'ALPHABET INC-CL C': 'GOOG', 'GOOGLE INC. (C)': 'GOOG',
  'TESLA INC': 'TSLA', 'TESLA, INC.': 'TSLA', 'TESLA MOTORS INC': 'TSLA',
  'NETFLIX INC': 'NFLX', 'NETFLIX, INC.': 'NFLX',
  'ADOBE INC': 'ADBE', 'ADOBE SYSTEMS INC': 'ADBE',
  'SALESFORCE INC': 'CRM', 'SALESFORCE.COM INC': 'CRM',
  'PAYPAL HOLDINGS INC': 'PYPL', 'PAYPAL HOLDINGS': 'PYPL',
  'INTEL CORP': 'INTC', 'INTEL CORPORATION': 'INTC',
  'AMD': 'AMD', 'ADVANCED MICRO DEVICES': 'AMD', 'ADVANCED MICRO DEVICES INC': 'AMD',
  'JPMORGAN CHASE': 'JPM', 'JPMORGAN CHASE & CO': 'JPM', 'JP MORGAN CHASE': 'JPM',
  'VISA INC': 'V', 'VISA': 'V',
  'MASTERCARD INC': 'MA', 'MASTERCARD': 'MA',
  'SPY': 'SPY', 'SPDR S&P 500 ETF': 'SPY',
  'QQQ': 'QQQ', 'INVESCO QQQ TRUST': 'QQQ',
  'IWM': 'IWM', 'ISHARES RUSSELL 2000': 'IWM',
};

// ============ DYNAMIC UNDERLYING RESOLUTION ============

/**
 * Resolve underlying name to ticker with dynamic Yahoo Search fallback
 * 1. Try local lookup table (fast)
 * 2. Check database cache (underlying_mappings)
 * 3. Use Yahoo Finance Search API (fallback)
 * 4. Cache results for future use
 */
async function resolveUnderlyingToTicker(
  underlying: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const normalized = underlying.toUpperCase().trim();
  
  // 1. Try local lookup first (instant)
  if (UNDERLYING_TO_TICKER[normalized]) {
    return UNDERLYING_TO_TICKER[normalized];
  }
  
  // Clean version for lookup
  const cleaned = normalized.replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim();
  if (UNDERLYING_TO_TICKER[cleaned]) {
    return UNDERLYING_TO_TICKER[cleaned];
  }
  
  // Check partial matches in local lookup
  for (const [key, ticker] of Object.entries(UNDERLYING_TO_TICKER)) {
    if (cleaned.startsWith(key) || key.startsWith(cleaned)) {
      return ticker;
    }
  }
  
  // If it looks like a ticker already (1-5 uppercase letters), return as-is
  if (/^[A-Z]{1,5}$/.test(cleaned)) {
    return cleaned;
  }
  
  // 2. Check database cache
  try {
    const { data: cached } = await supabase
      .from('underlying_mappings')
      .select('ticker')
      .eq('underlying', normalized)
      .maybeSingle();
    
    if (cached?.ticker) {
      console.log(`[resolveUnderlying] Cache hit: "${underlying}" → ${cached.ticker}`);
      return cached.ticker;
    }
  } catch (error) {
    console.error(`[resolveUnderlying] Cache lookup error:`, error);
  }
  
  // 3. Resolve via Yahoo Finance Search API
  try {
    const ticker = await resolveViaYahooSearch(normalized);
    
    if (ticker) {
      // 4. Cache for future use
      try {
        await supabase.from('underlying_mappings').upsert({
          underlying: normalized,
          ticker,
          source: 'yahoo',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'underlying' });
        console.log(`[resolveUnderlying] Resolved & cached: "${underlying}" → ${ticker}`);
      } catch (cacheError) {
        console.error(`[resolveUnderlying] Cache save error:`, cacheError);
      }
      
      return ticker;
    }
  } catch (error) {
    console.error(`[resolveUnderlying] Yahoo search error for "${underlying}":`, error);
  }
  
  console.log(`[resolveUnderlying] Could not resolve: "${underlying}"`);
  return null;
}

/**
 * Use Yahoo Finance Search API to find ticker from company name
 */
async function resolveViaYahooSearch(underlying: string): Promise<string | null> {
  // Clean up search term: remove INC, CORP, etc.
  const searchTerm = underlying
    .replace(/\s+(INC|CORP|CORPORATION|CO|LTD|LLC|PLC|NV|SA|AG|SPA|AB|CLASS\s*[A-C]|CL\s*[A-C])\.?$/gi, '')
    .replace(/[.,]+$/, '')
    .trim();
  
  if (!searchTerm || searchTerm.length < 2) {
    return null;
  }
  
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchTerm)}&quotesCount=5&newsCount=0`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.error(`[YahooSearch] API returned ${response.status} for "${searchTerm}"`);
      return null;
    }
    
    const data = await response.json();
    const quotes = data?.quotes || [];
    
    // Find best match: prefer EQUITY type and US market
    const match = quotes.find((q: any) => 
      q.quoteType === 'EQUITY' && 
      q.symbol && 
      !q.symbol.includes('.') // Prefer US tickers without exchange suffix
    ) || quotes.find((q: any) => 
      q.quoteType === 'EQUITY' && q.symbol
    ) || quotes[0];
    
    if (match?.symbol) {
      console.log(`[YahooSearch] Found: "${searchTerm}" → ${match.symbol} (${match.shortname || match.longname || 'N/A'})`);
      return match.symbol;
    }
  } catch (error) {
    console.error(`[YahooSearch] Fetch error for "${searchTerm}":`, error);
  }
  
  return null;
}

/**
 * Pre-resolve all unique underlyings for a batch of options
 * This is more efficient than resolving one-by-one
 */
async function resolveAllUnderlyings(
  options: OptionRequest[],
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const underlyings = [...new Set(options.map(o => o.underlying.toUpperCase().trim()))];
  
  if (underlyings.length === 0) return results;
  
  console.log(`[resolveAllUnderlyings] Processing ${underlyings.length} unique underlyings`);
  
  // 1. Check local lookup first
  const needsDbCheck: string[] = [];
  for (const u of underlyings) {
    const cleaned = u.replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim();
    
    if (UNDERLYING_TO_TICKER[u]) {
      results.set(u, UNDERLYING_TO_TICKER[u]);
    } else if (UNDERLYING_TO_TICKER[cleaned]) {
      results.set(u, UNDERLYING_TO_TICKER[cleaned]);
    } else if (/^[A-Z]{1,5}$/.test(cleaned)) {
      results.set(u, cleaned);
    } else {
      // Check partial matches
      let found = false;
      for (const [key, ticker] of Object.entries(UNDERLYING_TO_TICKER)) {
        if (cleaned.startsWith(key) || key.startsWith(cleaned)) {
          results.set(u, ticker);
          found = true;
          break;
        }
      }
      if (!found) {
        needsDbCheck.push(u);
      }
    }
  }
  
  console.log(`[resolveAllUnderlyings] Local lookup: ${results.size} found, ${needsDbCheck.length} need DB check`);
  
  // 2. Batch check database cache
  if (needsDbCheck.length > 0) {
    try {
      const { data: cached } = await supabase
        .from('underlying_mappings')
        .select('underlying, ticker')
        .in('underlying', needsDbCheck);
      
      const needsYahooSearch: string[] = [];
      
      for (const u of needsDbCheck) {
        const cachedItem = cached?.find(c => c.underlying === u);
        if (cachedItem?.ticker) {
          results.set(u, cachedItem.ticker);
        } else {
          needsYahooSearch.push(u);
        }
      }
      
      console.log(`[resolveAllUnderlyings] DB cache: ${needsDbCheck.length - needsYahooSearch.length} found, ${needsYahooSearch.length} need Yahoo Search`);
      
      // 3. Resolve remaining via Yahoo Search (with rate limiting)
      for (const underlying of needsYahooSearch) {
        const ticker = await resolveViaYahooSearch(underlying);
        
        if (ticker) {
          results.set(underlying, ticker);
          
          // Cache for future use
          try {
            await supabase.from('underlying_mappings').upsert({
              underlying,
              ticker,
              source: 'yahoo',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'underlying' });
          } catch (cacheError) {
            console.error(`[resolveAllUnderlyings] Cache error for ${underlying}:`, cacheError);
          }
        }
        
        // Rate limit: 100ms between Yahoo Search requests
        if (needsYahooSearch.indexOf(underlying) < needsYahooSearch.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    } catch (error) {
      console.error(`[resolveAllUnderlyings] Error:`, error);
    }
  }
  
  console.log(`[resolveAllUnderlyings] Final: ${results.size}/${underlyings.length} resolved`);
  return results;
}

// ============ ISIN RESOLUTION ============

async function resolveIsins(isins: string[], supabase: SupabaseClient): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  if (isins.length === 0) return results;
  
  try {
    // Check cache first
    const { data: cached } = await supabase
      .from('isin_mappings')
      .select('isin, ticker')
      .in('isin', isins);
    
    const uncachedIsins: string[] = [];
    
    for (const isin of isins) {
      const cachedItem = cached?.find(c => c.isin === isin);
      if (cachedItem) {
        results.set(isin, cachedItem.ticker);
      } else {
        uncachedIsins.push(isin);
      }
    }
    
    console.log(`[resolveIsins] ${results.size} cached, ${uncachedIsins.length} to resolve`);
    
    // Resolve uncached via OpenFIGI
    if (uncachedIsins.length > 0) {
      const body = uncachedIsins.map(isin => ({ idType: 'ID_ISIN', idValue: isin }));
      
      const response = await fetch('https://api.openfigi.com/v3/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      if (response.ok) {
        const data = await response.json();
        const toCache: { isin: string; ticker: string; exchange: string | null; source: string }[] = [];
        
        for (let i = 0; i < uncachedIsins.length; i++) {
          const isin = uncachedIsins[i];
          const figiData = data[i]?.data?.[0];
          
          if (figiData?.ticker) {
            let ticker = figiData.ticker;
            
            // Add exchange suffix for non-US
            if (figiData.exchCode && figiData.exchCode !== 'US') {
              const exchangeMap: Record<string, string> = {
                'IM': '.MI', 'GY': '.DE', 'FP': '.PA', 'LN': '.L', 
                'SM': '.MC', 'NA': '.AS', 'BB': '.BR', 'SW': '.SW',
              };
              ticker = `${figiData.ticker}${exchangeMap[figiData.exchCode] || ''}`;
            }
            
            results.set(isin, ticker);
            toCache.push({ isin, ticker, exchange: figiData.exchCode || null, source: 'openfigi' });
          }
        }
        
        // Cache new mappings
        if (toCache.length > 0) {
          await supabase.from('isin_mappings').upsert(toCache, { onConflict: 'isin' });
          console.log(`[resolveIsins] Cached ${toCache.length} new mappings`);
        }
      }
    }
  } catch (error) {
    console.error('[resolveIsins] Error:', error);
  }
  
  return results;
}

// ============ YAHOO FINANCE SESSION (crumb + cookies) ============

let yahooCrumb: string | null = null;
let yahooCookies: string | null = null;

async function getYahooSession(): Promise<{ crumb: string; cookies: string } | null> {
  if (yahooCrumb && yahooCookies) {
    return { crumb: yahooCrumb, cookies: yahooCookies };
  }

  try {
    console.log('[Yahoo] Fetching new session (crumb + cookie)...');
    
    // Step 1: Get cookies from consent page
    const consentResponse = await fetch('https://fc.yahoo.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const cookies = consentResponse.headers.get('set-cookie') || '';
    
    // Step 2: Get crumb using cookies
    const crumbResponse = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies,
      },
    });
    
    if (!crumbResponse.ok) {
      console.error(`[Yahoo] Failed to get crumb: ${crumbResponse.status}`);
      return null;
    }
    
    const crumb = await crumbResponse.text();
    
    if (crumb && crumb.length > 0) {
      yahooCrumb = crumb;
      yahooCookies = cookies;
      console.log('[Yahoo] Session obtained successfully');
      return { crumb, cookies };
    }
  } catch (error) {
    console.error('[Yahoo] Session error:', error);
  }
  
  return null;
}

// ============ YAHOO FINANCE STOCKS ============

async function fetchYahooPrices(tickers: string[]): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  if (tickers.length === 0) return results;
  
  try {
    const symbols = tickers.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.error(`Yahoo Finance error: ${response.status}`);
      for (const ticker of tickers) {
        results.set(ticker, {
          symbol: ticker, price: null, change: null, changePct: null,
          bid: null, ask: null, volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error', error: `Yahoo API returned ${response.status}`,
        });
      }
      return results;
    }
    
    const data = await response.json();
    const quotes = data?.quoteResponse?.result || [];
    
    for (const quote of quotes) {
      results.set(quote.symbol, {
        symbol: quote.symbol,
        price: quote.regularMarketPrice ?? null,
        change: quote.regularMarketChange ?? null,
        changePct: quote.regularMarketChangePercent ?? null,
        bid: quote.bid ?? null,
        ask: quote.ask ?? null,
        volume: quote.regularMarketVolume ?? null,
        lastUpdated: new Date().toISOString(),
        source: 'yahoo',
      });
    }
    
    // Mark missing
    for (const ticker of tickers) {
      if (!results.has(ticker)) {
        results.set(ticker, {
          symbol: ticker, price: null, change: null, changePct: null,
          bid: null, ask: null, volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error', error: 'Symbol not found',
        });
      }
    }
  } catch (error) {
    console.error('Yahoo Finance fetch error:', error);
    for (const ticker of tickers) {
      results.set(ticker, {
        symbol: ticker, price: null, change: null, changePct: null,
        bid: null, ask: null, volume: null,
        lastUpdated: new Date().toISOString(),
        source: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return results;
}

// ============ YAHOO FINANCE OPTIONS (with dynamic resolution) ============

async function fetchYahooOptionPrices(
  options: OptionRequest[],
  underlyingMap: Map<string, string>
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  if (options.length === 0) return results;

  // Group options by ticker + expiry for efficient fetching
  const groupedOptions = new Map<string, {
    ticker: string;
    expiryUnix: number;
    expiryStr: string;
    requests: OptionRequest[];
  }>();

  for (const opt of options) {
    const normalizedUnderlying = opt.underlying.toUpperCase().trim();
    const ticker = underlyingMap.get(normalizedUnderlying);
    
    if (!ticker) {
      results.set(opt.originalId, {
        symbol: opt.underlying,
        price: null,
        change: null,
        changePct: null,
        bid: null,
        ask: null,
        volume: null,
        lastUpdated: new Date().toISOString(),
        source: 'error',
        error: `Cannot resolve underlying "${opt.underlying}" to ticker`,
      });
      continue;
    }

    const expiryDate = new Date(opt.expiry);
    const expiryUnix = Math.floor(expiryDate.getTime() / 1000);
    const key = `${ticker}:${expiryUnix}`;

    if (!groupedOptions.has(key)) {
      groupedOptions.set(key, {
        ticker,
        expiryUnix,
        expiryStr: opt.expiry,
        requests: [],
      });
    }
    groupedOptions.get(key)!.requests.push(opt);
  }

  console.log(`[Yahoo Options] Fetching ${options.length} options grouped into ${groupedOptions.size} ticker+expiry combinations`);

  // Fetch each ticker+expiry combination
  for (const [, group] of groupedOptions) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${group.ticker}?date=${group.expiryUnix}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        console.error(`[Yahoo Options] Error for ${group.ticker} expiry ${group.expiryStr}: ${response.status}`);
        for (const opt of group.requests) {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            change: null,
            changePct: null,
            bid: null,
            ask: null,
            volume: null,
            lastUpdated: new Date().toISOString(),
            source: 'error',
            error: `Yahoo Options API returned ${response.status}`,
          });
        }
        continue;
      }

      const data = await response.json();
      const optionData = data?.optionChain?.result?.[0]?.options?.[0];
      
      if (!optionData) {
        for (const opt of group.requests) {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            change: null,
            changePct: null,
            bid: null,
            ask: null,
            volume: null,
            lastUpdated: new Date().toISOString(),
            source: 'error',
            error: 'No option data found for expiry',
          });
        }
        continue;
      }

      // Build map of contracts by strike+type
      const contractMap = new Map<string, any>();
      for (const call of optionData.calls || []) {
        contractMap.set(`C:${call.strike}`, call);
      }
      for (const put of optionData.puts || []) {
        contractMap.set(`P:${put.strike}`, put);
      }

      // Match each requested option
      for (const opt of group.requests) {
        const mapKey = `${opt.optionType === 'call' ? 'C' : 'P'}:${opt.strike}`;
        const contract = contractMap.get(mapKey);

        if (contract) {
          results.set(opt.originalId, {
            symbol: contract.contractSymbol || `${group.ticker}:${opt.strike}${opt.optionType === 'call' ? 'C' : 'P'}`,
            price: contract.lastPrice ?? null,
            change: contract.change ?? null,
            changePct: contract.percentChange ?? null,
            bid: contract.bid ?? null,
            ask: contract.ask ?? null,
            volume: contract.volume ?? null,
            lastUpdated: new Date().toISOString(),
            source: 'yahoo-options',
          });
        } else {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            change: null,
            changePct: null,
            bid: null,
            ask: null,
            volume: null,
            lastUpdated: new Date().toISOString(),
            source: 'error',
            error: `Option not found: ${opt.optionType} strike ${opt.strike}`,
          });
        }
      }
    } catch (error) {
      console.error(`[Yahoo Options] Fetch error for ${group.ticker}:`, error);
      for (const opt of group.requests) {
        results.set(opt.originalId, {
          symbol: opt.underlying,
          price: null,
          change: null,
          changePct: null,
          bid: null,
          ask: null,
          volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return results;
}

// ============ JUSTETF FOR EUROPEAN ETFs ============

async function fetchJustETFPrice(isin: string): Promise<PriceData | null> {
  try {
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Extract price from the page - look for various patterns
    // Pattern 1: "EUR 123.45" or "USD 123.45"
    const priceMatch = html.match(/(?:EUR|USD|GBP|CHF)\s*(\d+(?:[.,]\d+)?)/i);
    // Pattern 2: data-value attribute
    const dataValueMatch = html.match(/data-value="(\d+(?:\.\d+)?)"/);
    // Pattern 3: Price in specific div
    const divPriceMatch = html.match(/class="val"[^>]*>(\d+(?:[.,]\d+)?)/);
    
    const priceStr = priceMatch?.[1] || dataValueMatch?.[1] || divPriceMatch?.[1];
    
    if (priceStr) {
      const price = parseFloat(priceStr.replace(',', '.'));
      
      if (!isNaN(price)) {
        return {
          symbol: isin,
          price,
          change: null,
          changePct: null,
          bid: null,
          ask: null,
          volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'justetf',
        };
      }
    }
  } catch (error) {
    console.error(`JustETF error for ${isin}:`, error);
  }
  
  return null;
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { tickers = [], isins = [], options = [] }: RequestBody = await req.json();
    
    console.log(`[fetch-market-prices] Request: ${tickers.length} tickers, ${isins.length} ISINs, ${options.length} options`);
    
    // Create Supabase client for caching
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Step 1: Resolve ISINs to tickers
    const isinToTicker = await resolveIsins(isins, supabase);
    
    // Step 2: Pre-resolve all unique option underlyings (batch, with caching)
    const underlyingMap = await resolveAllUnderlyings(options, supabase);
    
    // Step 3: Combine tickers from direct input and ISIN resolution
    const allTickers = [...new Set([
      ...tickers.filter(t => t && t.length > 0),
      ...Array.from(isinToTicker.values()),
    ])];
    
    console.log(`[fetch-market-prices] Fetching ${allTickers.length} tickers from Yahoo`);
    
    // Step 4: Fetch all prices in parallel (stocks via Yahoo, options via Yahoo Options)
    const [stockPrices, optionPrices] = await Promise.all([
      fetchYahooPrices(allTickers),
      fetchYahooOptionPrices(options, underlyingMap),
    ]);
    
    // Step 5: For ISINs that didn't resolve but are ETFs, try JustETF
    const unresolvedIsins = isins.filter(isin => !isinToTicker.has(isin));
    
    for (const isin of unresolvedIsins) {
      // Only for European ETFs (IE/LU prefixes)
      if (isin.startsWith('IE') || isin.startsWith('LU')) {
        const justEtfPrice = await fetchJustETFPrice(isin);
        if (justEtfPrice) {
          stockPrices.set(isin, justEtfPrice);
        }
      }
    }
    
    // Step 6: Build response - map ISINs to their resolved prices
    const stocksResult: Record<string, PriceData> = {};
    
    // Add ticker-based prices
    stockPrices.forEach((price, symbol) => {
      stocksResult[symbol] = price;
    });
    
    // Add ISIN → ticker mapping for consumer convenience
    isinToTicker.forEach((ticker, isin) => {
      const price = stockPrices.get(ticker);
      if (price) {
        stocksResult[isin] = { ...price, symbol: isin };
      }
    });
    
    const result = {
      stocks: stocksResult,
      options: Object.fromEntries(optionPrices),
      isinMappings: Object.fromEntries(isinToTicker),
      underlyingMappings: Object.fromEntries(underlyingMap),
      fetchedAt: new Date().toISOString(),
    };
    
    console.log(`[fetch-market-prices] Returning ${Object.keys(result.stocks).length} stocks, ${Object.keys(result.options).length} options, ${underlyingMap.size} underlying mappings`);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in fetch-market-prices:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        stocks: {},
        options: {},
        isinMappings: {},
        underlyingMappings: {},
        fetchedAt: new Date().toISOString(),
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
