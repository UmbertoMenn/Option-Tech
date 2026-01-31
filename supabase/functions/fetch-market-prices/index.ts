import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  source: 'tradier' | 'yahoo' | 'justetf' | 'error';
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

// ============ UNDERLYING TO TICKER MAPPING ============

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
  'CISCO SYSTEMS INC': 'CSCO', 'CISCO SYSTEMS': 'CSCO',
  'ORACLE CORP': 'ORCL', 'ORACLE CORPORATION': 'ORCL',
  'IBM': 'IBM', 'INTERNATIONAL BUSINESS MACHINES': 'IBM',
  'QUALCOMM INC': 'QCOM', 'QUALCOMM INCORPORATED': 'QCOM',
  'BROADCOM INC': 'AVGO', 'BROADCOM LTD': 'AVGO',
  'UBER TECHNOLOGIES INC': 'UBER', 'UBER TECHNOLOGIES': 'UBER',
  'AIRBNB INC': 'ABNB', 'AIRBNB': 'ABNB',
  'COINBASE GLOBAL INC': 'COIN', 'COINBASE': 'COIN',
  'PALANTIR TECHNOLOGIES INC': 'PLTR', 'PALANTIR': 'PLTR',
  'SNOWFLAKE INC': 'SNOW', 'SNOWFLAKE': 'SNOW',
  'CROWDSTRIKE HOLDINGS INC': 'CRWD', 'CROWDSTRIKE': 'CRWD',
  'DATADOG INC': 'DDOG', 'DATADOG': 'DDOG',
  'ZOOM VIDEO COMMUNICATIONS': 'ZM', 'ZOOM VIDEO COMMUNICATIONS INC': 'ZM',
  'SHOPIFY INC': 'SHOP', 'SHOPIFY': 'SHOP',
  'SPOTIFY TECHNOLOGY': 'SPOT', 'SPOTIFY TECHNOLOGY SA': 'SPOT',
  'BLOCK INC': 'SQ', 'SQUARE INC': 'SQ',
  'SERVICENOW INC': 'NOW', 'SERVICENOW': 'NOW',
  'WORKDAY INC': 'WDAY', 'WORKDAY': 'WDAY',
  'TWILIO INC': 'TWLO', 'TWILIO': 'TWLO',
  'MONGODB INC': 'MDB', 'MONGODB': 'MDB',
  'OKTA INC': 'OKTA', 'OKTA': 'OKTA',
  'JPMORGAN CHASE': 'JPM', 'JPMORGAN CHASE & CO': 'JPM', 'JP MORGAN CHASE': 'JPM', 'J.P. MORGAN CHASE & CO.': 'JPM',
  'BANK OF AMERICA': 'BAC', 'BANK OF AMERICA CORP': 'BAC',
  'WELLS FARGO': 'WFC', 'WELLS FARGO & CO': 'WFC',
  'GOLDMAN SACHS': 'GS', 'GOLDMAN SACHS GROUP': 'GS',
  'MORGAN STANLEY': 'MS',
  'CITIGROUP INC': 'C', 'CITIGROUP': 'C',
  'VISA INC': 'V', 'VISA': 'V',
  'MASTERCARD INC': 'MA', 'MASTERCARD': 'MA',
  'AMERICAN EXPRESS': 'AXP', 'AMERICAN EXPRESS CO': 'AXP',
  'BERKSHIRE HATHAWAY': 'BRK.B', 'BERKSHIRE HATHAWAY INC': 'BRK.B',
  'BLACKROCK INC': 'BLK', 'BLACKROCK': 'BLK',
  'JOHNSON & JOHNSON': 'JNJ',
  'UNITEDHEALTH GROUP': 'UNH', 'UNITEDHEALTH GROUP INC': 'UNH',
  'PFIZER INC': 'PFE', 'PFIZER': 'PFE',
  'MERCK & CO': 'MRK', 'MERCK': 'MRK',
  'ABBVIE INC': 'ABBV', 'ABBVIE': 'ABBV',
  'ELI LILLY': 'LLY', 'ELI LILLY AND CO': 'LLY',
  'MODERNA INC': 'MRNA', 'MODERNA': 'MRNA',
  'WALMART INC': 'WMT', 'WALMART': 'WMT',
  'COSTCO WHOLESALE': 'COST', 'COSTCO WHOLESALE CORP': 'COST',
  'HOME DEPOT INC': 'HD', 'HOME DEPOT': 'HD',
  'NIKE INC': 'NKE', 'NIKE': 'NKE',
  'STARBUCKS CORP': 'SBUX', 'STARBUCKS': 'SBUX',
  'MCDONALDS CORP': 'MCD', "MCDONALD'S CORP": 'MCD',
  'COCA-COLA CO': 'KO', 'COCA COLA CO': 'KO',
  'PEPSICO INC': 'PEP', 'PEPSICO': 'PEP',
  'PROCTER & GAMBLE': 'PG', 'PROCTER AND GAMBLE': 'PG',
  'WALT DISNEY CO': 'DIS', 'DISNEY': 'DIS', 'DISNEY CO': 'DIS',
  'EXXON MOBIL': 'XOM', 'EXXON MOBIL CORP': 'XOM',
  'CHEVRON CORP': 'CVX', 'CHEVRON': 'CVX',
  'BOEING CO': 'BA', 'BOEING': 'BA',
  'CATERPILLAR INC': 'CAT', 'CATERPILLAR': 'CAT',
  '3M COMPANY': 'MMM', '3M CO': 'MMM',
  'GENERAL ELECTRIC': 'GE', 'GENERAL ELECTRIC CO': 'GE',
  'HONEYWELL INTERNATIONAL': 'HON', 'HONEYWELL': 'HON',
  'LOCKHEED MARTIN': 'LMT', 'LOCKHEED MARTIN CORP': 'LMT',
  'RAYTHEON TECHNOLOGIES': 'RTX', 'RTX CORPORATION': 'RTX',
  'UNION PACIFIC': 'UNP', 'UNION PACIFIC CORP': 'UNP',
  'AT&T INC': 'T', 'AT&T': 'T',
  'VERIZON COMMUNICATIONS': 'VZ', 'VERIZON': 'VZ',
  'T-MOBILE US INC': 'TMUS', 'T-MOBILE': 'TMUS',
  'SPDR S&P 500 ETF': 'SPY', 'SPY': 'SPY',
  'INVESCO QQQ TRUST': 'QQQ', 'QQQ': 'QQQ',
  'ISHARES RUSSELL 2000': 'IWM', 'IWM': 'IWM',
  'SPDR GOLD SHARES': 'GLD', 'GLD': 'GLD',
  'ISHARES MSCI EMERGING': 'EEM', 'EEM': 'EEM',
  'VANGUARD TOTAL STOCK': 'VTI', 'VTI': 'VTI',
  // New mappings based on logs
  'ALIBABA GROUP HOLDING LTD': 'BABA', 'ALIBABA': 'BABA', 'ALIBABA GROUP': 'BABA',
  'CONSTELLATION ENERGY CORPORATION': 'CEG', 'CONSTELLATION ENERGY': 'CEG',
  'COREWEAVE INC': 'CRWV', 'COREWEAVE': 'CRWV',
  'NETEASE INC': 'NTES', 'NETEASE': 'NTES',
  'LULULEMON ATHLETICA INC': 'LULU', 'LULULEMON': 'LULU', 'LULULEMON ATHLETICA': 'LULU',
  'PROGRESSIVE CORP': 'PGR', 'PROGRESSIVE': 'PGR',
};

function underlyingToTicker(underlying: string): string | null {
  const normalized = underlying.toUpperCase().trim();
  
  if (UNDERLYING_TO_TICKER[normalized]) {
    return UNDERLYING_TO_TICKER[normalized];
  }
  
  const cleaned = normalized.replace(/[.,]+$/, '').replace(/\s+/g, ' ').trim();
  if (UNDERLYING_TO_TICKER[cleaned]) {
    return UNDERLYING_TO_TICKER[cleaned];
  }
  
  // Check partial matches
  for (const [key, ticker] of Object.entries(UNDERLYING_TO_TICKER)) {
    if (cleaned.startsWith(key) || key.startsWith(cleaned)) {
      return ticker;
    }
  }
  
  // If looks like a ticker already
  if (/^[A-Z]{1,5}$/.test(cleaned)) {
    return cleaned;
  }
  
  console.log(`[underlyingToTicker] No mapping for: "${underlying}"`);
  return null;
}

// ============ OCC SYMBOL CONVERSION ============

function toOCCSymbol(underlying: string, expiry: string, optionType: 'call' | 'put', strike: number): string | null {
  // First convert underlying name to ticker
  const ticker = underlyingToTicker(underlying);
  if (!ticker) {
    return null;
  }
  
  const date = new Date(expiry);
  const yy = date.getFullYear().toString().slice(-2);
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const type = optionType === 'call' ? 'C' : 'P';
  const strikeFormatted = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${ticker}${yy}${mm}${dd}${type}${strikeFormatted}`;
}

// ============ ISIN RESOLUTION ============

async function resolveIsins(isins: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  if (isins.length === 0) return results;
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
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

// ============ YAHOO FINANCE ============

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

// ============ TRADIER OPTIONS ============

async function fetchTradierOptionPrices(
  options: OptionRequest[],
  apiKey: string
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  if (options.length === 0 || !apiKey) {
    console.log('[Tradier] Skipping - no options or no API key');
    return results;
  }
  
  try {
    // Convert options to OCC symbols, filtering out those without valid tickers
    const occSymbols: { occ: string; originalId: string; original: OptionRequest }[] = [];
    
    for (const opt of options) {
      const occ = toOCCSymbol(opt.underlying, opt.expiry, opt.optionType, opt.strike);
      if (occ) {
        occSymbols.push({ occ, originalId: opt.originalId, original: opt });
      } else {
        // Return error for options we can't convert
        results.set(opt.originalId, {
          symbol: opt.underlying,
          price: null, change: null, changePct: null, bid: null, ask: null, volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error',
          error: `Cannot convert underlying "${opt.underlying}" to ticker`,
        });
      }
    }
    
    if (occSymbols.length === 0) {
      console.log('[Tradier] No valid OCC symbols to fetch');
      return results;
    }
    
    console.log(`[Tradier] Fetching ${occSymbols.length} options: ${occSymbols.slice(0, 3).map(o => o.occ).join(', ')}...`);
    
    const symbols = occSymbols.map(o => o.occ).join(',');
    const url = `https://api.tradier.com/v1/markets/quotes?symbols=${encodeURIComponent(symbols)}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Tradier API error: ${response.status} - ${errorText}`);
      
      for (const opt of occSymbols) {
        results.set(opt.originalId, {
          symbol: opt.occ, price: null, change: null, changePct: null,
          bid: null, ask: null, volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error', error: `Tradier API returned ${response.status}`,
        });
      }
      return results;
    }
    
    const data = await response.json();
    
    let quotes = data?.quotes?.quote || [];
    if (!Array.isArray(quotes)) {
      quotes = quotes ? [quotes] : [];
    }
    
    const quoteMap = new Map<string, any>();
    for (const quote of quotes) {
      quoteMap.set(quote.symbol, quote);
    }
    
    for (const opt of occSymbols) {
      const quote = quoteMap.get(opt.occ);
      
      if (quote) {
        results.set(opt.originalId, {
          symbol: opt.occ,
          price: quote.last ?? quote.close ?? null,
          change: quote.change ?? null,
          changePct: quote.change_percentage ?? null,
          bid: quote.bid ?? null,
          ask: quote.ask ?? null,
          volume: quote.volume ?? null,
          lastUpdated: new Date().toISOString(),
          source: 'tradier',
        });
      } else {
        results.set(opt.originalId, {
          symbol: opt.occ, price: null, change: null, changePct: null,
          bid: null, ask: null, volume: null,
          lastUpdated: new Date().toISOString(),
          source: 'error', error: 'Option not found in Tradier',
        });
      }
    }
  } catch (error) {
    console.error('Tradier fetch error:', error);
    for (const opt of options) {
      results.set(opt.originalId, {
        symbol: opt.underlying, price: null, change: null, changePct: null,
        bid: null, ask: null, volume: null,
        lastUpdated: new Date().toISOString(),
        source: 'error', error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  return results;
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { tickers = [], isins = [], options = [] }: RequestBody = await req.json();
    
    console.log(`[fetch-market-prices] Request: ${tickers.length} tickers, ${isins.length} ISINs, ${options.length} options`);
    
    const tradierApiKey = Deno.env.get('TRADIER_API_KEY') || '';
    
    // Step 1: Resolve ISINs to tickers
    const isinToTicker = await resolveIsins(isins);
    
    // Step 2: Combine tickers from direct input and ISIN resolution
    const allTickers = [...new Set([
      ...tickers.filter(t => t && t.length > 0),
      ...Array.from(isinToTicker.values()),
    ])];
    
    console.log(`[fetch-market-prices] Fetching ${allTickers.length} tickers from Yahoo`);
    
    // Step 3: Fetch all prices in parallel
    const [stockPrices, optionPrices] = await Promise.all([
      fetchYahooPrices(allTickers),
      fetchTradierOptionPrices(options, tradierApiKey),
    ]);
    
    // Step 4: For ISINs that didn't resolve but are ETFs, try JustETF
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
    
    // Step 5: Build response - map ISINs to their resolved prices
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
      fetchedAt: new Date().toISOString(),
    };
    
    console.log(`[fetch-market-prices] Returning ${Object.keys(result.stocks).length} stocks, ${Object.keys(result.options).length} options`);
    
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
        fetchedAt: new Date().toISOString(),
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
