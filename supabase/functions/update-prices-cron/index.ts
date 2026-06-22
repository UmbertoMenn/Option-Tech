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

// Exchange rate cache to avoid multiple calls per currency
const exchangeRateCache: Map<string, number> = new Map();

// Helper function to chunk array for batch processing
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Fetch exchange rate from Yahoo Finance (e.g., EURUSD=X)
async function fetchExchangeRate(pair: string): Promise<number> {
  // Check cache first
  if (exchangeRateCache.has(pair)) {
    return exchangeRateCache.get(pair)!;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.log(`Yahoo API returned ${response.status} for ${pair}`);
      return 1;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      console.log(`No result in Yahoo response for ${pair}`);
      return 1;
    }
    
    const rate = result.meta?.regularMarketPrice || result.meta?.previousClose;
    
    if (!rate || rate <= 0) {
      console.log(`Invalid rate for ${pair}: ${rate}`);
      return 1;
    }
    
    // Cache the result
    exchangeRateCache.set(pair, rate);
    console.log(`Fetched exchange rate ${pair}: ${rate}`);
    
    return rate;
  } catch (error) {
    console.error(`Error fetching exchange rate for ${pair}:`, error);
    return 1; // fallback to no conversion
  }
}

// Get exchange rate for a currency (EUR = 1, others use Yahoo Finance)
async function getExchangeRateForCurrency(currency: string | null): Promise<number> {
  if (!currency || currency === 'EUR') {
    return 1;
  }
  
  const pairMap: Record<string, string> = {
    'USD': 'EURUSD=X',
    'HKD': 'EURHKD=X',
    'GBP': 'EURGBP=X',
    'CHF': 'EURCHF=X',
  };
  
  const pair = pairMap[currency];
  if (!pair) {
    console.log(`Unknown currency ${currency}, using rate 1`);
    return 1;
  }
  
  return await fetchExchangeRate(pair);
}

// Sector mapping based on well-known tickers and patterns
const KNOWN_SECTORS: Record<string, { sector: string; industry: string }> = {
  // Tech
  'NVDA': { sector: 'Technology', industry: 'Semiconductors' },
  'AAPL': { sector: 'Technology', industry: 'Consumer Electronics' },
  'MSFT': { sector: 'Technology', industry: 'Software - Infrastructure' },
  'GOOGL': { sector: 'Technology', industry: 'Internet Content & Information' },
  'GOOG': { sector: 'Technology', industry: 'Internet Content & Information' },
  'META': { sector: 'Communication Services', industry: 'Internet Content & Information' },
  'AMZN': { sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  'TSLA': { sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
  'AMD': { sector: 'Technology', industry: 'Semiconductors' },
  'INTC': { sector: 'Technology', industry: 'Semiconductors' },
  'AVGO': { sector: 'Technology', industry: 'Semiconductors' },
  'CRM': { sector: 'Technology', industry: 'Software - Application' },
  'ORCL': { sector: 'Technology', industry: 'Software - Infrastructure' },
  'ADBE': { sector: 'Technology', industry: 'Software - Application' },
  'NFLX': { sector: 'Communication Services', industry: 'Entertainment' },
  'CSCO': { sector: 'Technology', industry: 'Communication Equipment' },
  'IBM': { sector: 'Technology', industry: 'Information Technology Services' },
  'QCOM': { sector: 'Technology', industry: 'Semiconductors' },
  'TXN': { sector: 'Technology', industry: 'Semiconductors' },
  'NOW': { sector: 'Technology', industry: 'Software - Application' },
  'PLTR': { sector: 'Technology', industry: 'Software - Application' },
  'CRWV': { sector: 'Technology', industry: 'Software - Infrastructure' },
  'SNOW': { sector: 'Technology', industry: 'Software - Application' },
  
  // Healthcare
  'JNJ': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  'UNH': { sector: 'Healthcare', industry: 'Healthcare Plans' },
  'PFE': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  'ABBV': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  'MRK': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  'LLY': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  'NVO': { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  
  // Financials
  'JPM': { sector: 'Financial Services', industry: 'Banks - Diversified' },
  'V': { sector: 'Financial Services', industry: 'Credit Services' },
  'MA': { sector: 'Financial Services', industry: 'Credit Services' },
  'BAC': { sector: 'Financial Services', industry: 'Banks - Diversified' },
  'GS': { sector: 'Financial Services', industry: 'Capital Markets' },
  'MS': { sector: 'Financial Services', industry: 'Capital Markets' },
  'BRK-B': { sector: 'Financial Services', industry: 'Insurance - Diversified' },
  'PYPL': { sector: 'Financial Services', industry: 'Credit Services' },
  
  // Energy
  'XOM': { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  'CVX': { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  'COP': { sector: 'Energy', industry: 'Oil & Gas Exploration & Production' },
  'ENI.MI': { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  'CEG': { sector: 'Utilities', industry: 'Utilities - Independent Power Producers' },
  
  // Consumer
  'WMT': { sector: 'Consumer Defensive', industry: 'Discount Stores' },
  'PG': { sector: 'Consumer Defensive', industry: 'Household & Personal Products' },
  'KO': { sector: 'Consumer Defensive', industry: 'Beverages - Non-Alcoholic' },
  'PEP': { sector: 'Consumer Defensive', industry: 'Beverages - Non-Alcoholic' },
  'COST': { sector: 'Consumer Defensive', industry: 'Discount Stores' },
  'DIS': { sector: 'Communication Services', industry: 'Entertainment' },
  
  // Chinese tech
  'BABA': { sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  '9988.HK': { sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  'NTES': { sector: 'Communication Services', industry: 'Electronic Gaming & Multimedia' },
  '1211.HK': { sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
  'BYD': { sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
  
  // Defense/Aerospace
  'LMT': { sector: 'Industrials', industry: 'Aerospace & Defense' },
  'RTX': { sector: 'Industrials', industry: 'Aerospace & Defense' },
  'BA': { sector: 'Industrials', industry: 'Aerospace & Defense' },
  'GE': { sector: 'Industrials', industry: 'Specialty Industrial Machinery' },
};

// Infer sector from ticker patterns for ETFs and unknown stocks
function inferSectorFromName(ticker: string, description?: string): { sector: string | null; industry: string | null } {
  // Check known sectors first
  const upperTicker = ticker.toUpperCase();
  const baseTicker = upperTicker.replace(/\.(L|DE|MI|PA|AS|SW|HK)$/, '');
  
  if (KNOWN_SECTORS[upperTicker]) {
    return KNOWN_SECTORS[upperTicker];
  }
  if (KNOWN_SECTORS[baseTicker]) {
    return KNOWN_SECTORS[baseTicker];
  }
  
  // Try to infer from description
  const desc = (description || '').toUpperCase();
  const tickerDesc = `${upperTicker} ${desc}`;
  
  // ETFs don't have sectors (they're diversified)
  if (tickerDesc.includes('ETF') || tickerDesc.includes('ISHARES') || 
      tickerDesc.includes('VANGUARD') || tickerDesc.includes('SPDR') ||
      tickerDesc.includes('INVESCO') || tickerDesc.includes('XTRACKERS')) {
    return { sector: 'ETF', industry: 'Exchange Traded Fund' };
  }
  
  // Gold/Commodities
  if (tickerDesc.includes('GOLD') || tickerDesc.includes('GLD') || 
      tickerDesc.includes('SGLD') || tickerDesc.includes('IAU')) {
    return { sector: 'Commodities', industry: 'Gold' };
  }
  
  return { sector: null, industry: null };
}

// Valid GICS sectors for AI validation
const VALID_GICS_SECTORS = [
  'Technology', 'Financials', 'Financial Services', 'Healthcare',
  'Consumer Discretionary', 'Consumer Cyclical', 'Consumer Staples', 'Consumer Defensive',
  'Industrials', 'Energy', 'Materials', 'Basic Materials',
  'Utilities', 'Real Estate', 'Communication Services'
];

// Fetch sector using Lovable AI when other methods fail
async function fetchSectorWithAI(
  ticker: string, 
  description: string
): Promise<{ sector: string | null; industry: string | null }> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    console.log('LOVABLE_API_KEY not configured, skipping AI sector lookup');
    return { sector: null, industry: null };
  }
  
  const prompt = `For the stock with ticker "${ticker}" (${description}), 
    provide the GICS sector classification.
    Valid sectors: ${VALID_GICS_SECTORS.join(', ')}.
    Respond with ONLY the sector name, nothing else. No explanation.`;
  
  try {
    console.log(`Calling Lovable AI for sector of ${ticker}...`);
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
      }),
    });
    
    if (!response.ok) {
      console.error(`AI gateway error: ${response.status}`);
      return { sector: null, industry: null };
    }
    
    const data = await response.json();
    const sectorText = data.choices?.[0]?.message?.content?.trim();
    
    // Validate it's a known sector
    const normalizedSector = VALID_GICS_SECTORS.find(s => 
      s.toLowerCase() === sectorText?.toLowerCase()
    );
    
    if (normalizedSector) {
      console.log(`AI resolved sector for ${ticker}: ${normalizedSector}`);
      return { sector: normalizedSector, industry: null };
    }
    
    console.log(`AI returned invalid sector for ${ticker}: ${sectorText}`);
    return { sector: null, industry: null };
  } catch (error) {
    console.error('Error fetching sector with AI:', error);
    return { sector: null, industry: null };
  }
}

// NEW: Use AI to infer stock ticker from company name
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
    
    // Clean up the response - remove any extra text
    const ticker = tickerRaw?.split(/[\s,.\n]/)[0];
    
    if (ticker && ticker !== 'UNKNOWN' && ticker.length >= 1 && ticker.length <= 5 && /^[A-Z]+$/.test(ticker)) {
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

// Fetch sector/industry - uses known mappings first, then tries Yahoo API, then AI fallback
async function fetchYahooSectorInfo(ticker: string, description?: string): Promise<{
  sector: string | null;
  industry: string | null;
}> {
  // 1. Check known sectors
  const knownInfo = inferSectorFromName(ticker, description);
  if (knownInfo.sector) {
    console.log(`Using known sector for ${ticker}: ${knownInfo.sector}`);
    return knownInfo;
  }
  
  // 2. Try Yahoo Finance quote API (v7) with cookies - sometimes works
  try {
    // First get a crumb cookie
    const crumbUrl = 'https://fc.yahoo.com/';
    await fetch(crumbUrl);
    
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=sector,industry`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const quote = data.quoteResponse?.result?.[0];
      
      if (quote?.sector) {
        console.log(`Yahoo v7 returned sector for ${ticker}: ${quote.sector}`);
        return {
          sector: quote.sector,
          industry: quote.industry || null,
        };
      }
    }
  } catch (error) {
    // Silently fail, will try AI fallback
  }
  
  // 3. NEW: Fallback to Lovable AI
  if (description) {
    console.log(`Yahoo failed for ${ticker}, trying Lovable AI...`);
    const aiResult = await fetchSectorWithAI(ticker, description);
    if (aiResult.sector) {
      return aiResult;
    }
  }
  
  console.log(`No sector found for ${ticker}`);
  return { sector: null, industry: null };
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

// Yahoo Finance Search API - for ISIN resolution (now also returns sector/industry)
async function searchYahooByISIN(isin: string): Promise<{ 
  ticker: string; 
  name: string; 
  exchange: string;
  sector?: string;
  industry?: string;
} | null> {
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
      sector: bestMatch.sector || null,
      industry: bestMatch.industry || null,
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
  
  // 4. NUOVO: Fetch sector/industry using the Quote Summary API
  const sectorInfo = await fetchYahooSectorInfo(searchResult.ticker);
  console.log(`Fetched sector info for ${searchResult.ticker}: ${sectorInfo.sector || 'N/A'}`);
  
  // 5. Save to cache with sector info from Quote Summary API
  const upsertData: any = {
    isin,
    ticker: searchResult.ticker,
    exchange: searchResult.exchange,
    source: 'yahoo_search',
    last_verified_at: new Date().toISOString(),
  };
  
  // Add sector and industry from Quote Summary API
  if (sectorInfo.sector) {
    upsertData.sector = sectorInfo.sector;
  }
  if (sectorInfo.industry) {
    upsertData.industry = sectorInfo.industry;
  }
  
  await supabase
    .from('isin_mappings')
    .upsert(upsertData, { onConflict: 'isin' });
  
  console.log(`Saved mapping: ${isin} -> ${searchResult.ticker} (sector: ${sectorInfo.sector || 'N/A'})`);
  return searchResult.ticker;
}

// Update sectors for ISINs that are missing sector data
async function updateMissingSectors(supabase: any, isins?: string[]): Promise<{
  updated: number;
  failed: number;
}> {
  let query = supabase
    .from('isin_mappings')
    .select('isin, ticker')
    .is('sector', null);
  
  // If specific ISINs provided, filter by them
  if (isins && isins.length > 0) {
    query = query.in('isin', isins);
  }
  
  const { data: missing, error } = await query;
  
  if (error) {
    console.error('Error fetching missing sectors:', error);
    return { updated: 0, failed: 0 };
  }
  
  console.log(`Found ${missing?.length || 0} mappings with missing sectors`);
  
  let updated = 0;
  let failed = 0;
  
  for (const row of missing || []) {
    if (row.ticker) {
      const sectorInfo = await fetchYahooSectorInfo(row.ticker);
      
      if (sectorInfo.sector) {
        const { error: updateError } = await supabase
          .from('isin_mappings')
          .update({
            sector: sectorInfo.sector,
            industry: sectorInfo.industry,
            last_verified_at: new Date().toISOString(),
          })
          .eq('isin', row.isin);
        
        if (updateError) {
          console.error(`Failed to update sector for ${row.isin}:`, updateError);
          failed++;
        } else {
          console.log(`Updated sector for ${row.ticker}: ${sectorInfo.sector}`);
          updated++;
        }
      } else {
        console.log(`No sector found for ${row.ticker}`);
        failed++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return { updated, failed };
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

  // Parse request body to check for mode
  let body: { mode?: string; isins?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // No body or invalid JSON, use default mode
  }

  // Handle update-sectors mode
  if (body.mode === 'update-sectors') {
    console.log('Running in update-sectors mode');
    const startTime = Date.now();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const result = await updateMissingSectors(supabase, body.isins);
    const duration = Date.now() - startTime;
    
    console.log(`Sector update completed in ${duration}ms: ${result.updated} updated, ${result.failed} failed`);
    
    return new Response(
      JSON.stringify({
        success: true,
        mode: 'update-sectors',
        duration: `${duration}ms`,
        updated: result.updated,
        failed: result.failed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // NEW: Handle resolve-and-get-sectors mode - creates/updates isin_mappings with sectors
  if (body.mode === 'resolve-and-get-sectors') {
    console.log('Running in resolve-and-get-sectors mode');
    const startTime = Date.now();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const isins = body.isins || [];
    const descriptions = (body as any).descriptions || {};
    const names = (body as any).names || []; // NEW: derivative underlying names
    const results: Array<{ isin: string; ticker?: string; sector?: string | null; source: string; error?: string }> = [];
    const nameResults: Array<{ name: string; ticker?: string; sector?: string | null; industry?: string | null; source: string }> = [];
    
    console.log(`Resolving sectors for ${isins.length} ISINs and ${names.length} names`);
    
    // =================== PROCESS ISINs (PARALLEL BATCHES) ===================
    const BATCH_SIZE = 5;
    const isinBatches = chunkArray(isins, BATCH_SIZE);
    console.log(`Processing ${isins.length} ISINs in ${isinBatches.length} batches of ${BATCH_SIZE}`);
    
    for (let batchIndex = 0; batchIndex < isinBatches.length; batchIndex++) {
      const batch = isinBatches[batchIndex];
      console.log(`Processing ISIN batch ${batchIndex + 1}/${isinBatches.length}...`);
      
      const batchPromises = batch.map(async (isin) => {
        // 1. Check if mapping already exists with sector
        const { data: existing } = await supabase
          .from('isin_mappings')
          .select('ticker, sector, industry')
          .eq('isin', isin)
          .single();
        
        if (existing?.sector) {
          console.log(`Cache hit for ${isin}: ${existing.sector}`);
          return { isin, ticker: existing.ticker, sector: existing.sector, source: 'cache' };
        }
        
        // 2. Need to resolve or update
        let ticker = existing?.ticker || null;
        const description = descriptions[isin] || '';
        
        // 3. If no ticker, resolve ISIN via Yahoo Search
        if (!ticker) {
          console.log(`Resolving ticker for ISIN ${isin}...`);
          const searchResult = await searchYahooByISIN(isin);
          
          if (searchResult) {
            ticker = searchResult.ticker;
            console.log(`Yahoo Search resolved ${isin} to ${ticker}`);
          } else {
            console.log(`Failed to resolve ticker for ISIN ${isin}`);
            return { isin, sector: null, source: 'error', error: 'Could not resolve ticker' };
          }
        }
        
        // 4. Get sector using Yahoo + AI fallback
        console.log(`Fetching sector for ${ticker} (${description})...`);
        const sectorInfo = await fetchYahooSectorInfo(ticker, description);
        
        console.log(`Sector result for ${ticker}:`, { 
          sector: sectorInfo.sector || 'null', 
          industry: sectorInfo.industry || 'null' 
        });
        
        // 5. Save to database (UPSERT)
        const upsertData: any = {
          isin,
          ticker,
          source: sectorInfo.sector ? 'ai' : 'unknown',
          last_verified_at: new Date().toISOString(),
        };
        
        if (sectorInfo.sector) {
          upsertData.sector = sectorInfo.sector;
        }
        if (sectorInfo.industry) {
          upsertData.industry = sectorInfo.industry;
        }
        
        const { error: upsertError } = await supabase
          .from('isin_mappings')
          .upsert(upsertData, { onConflict: 'isin' });
        
        if (upsertError) {
          console.error(`Failed to upsert mapping for ${isin}:`, upsertError);
          return { isin, ticker, sector: null, source: 'error', error: upsertError.message };
        }
        
        console.log(`Saved sector for ${isin} (${ticker}): ${sectorInfo.sector || 'unknown'}`);
        return { 
          isin, 
          ticker, 
          sector: sectorInfo.sector, 
          source: sectorInfo.sector ? 'resolved' : 'unknown' 
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Short delay between batches to avoid rate limiting
      if (batchIndex < isinBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // =================== PROCESS DERIVATIVE NAMES (PARALLEL BATCHES) ===================
    // These are underlying names without ISINs (e.g., "IREN LTD", "MARA HOLDINGS")
    
    // Special case mappings for known derivatives - EXPANDED
    const specialMappings: Record<string, string> = {
      // Original mappings
      'IREN LTD': 'IREN',
      'MARA HOLDINGS': 'MARA', 
      'MARATHON DIGITAL': 'MARA',
      'RIOT PLATFORMS': 'RIOT',
      'RIOT BLOCKCHAIN': 'RIOT',
      'COINBASE': 'COIN',
      'MICROSTRATEGY': 'MSTR',
      'ALPHABET': 'GOOGL',
      'NETEASE': 'NTES',
      'PALANTIR': 'PLTR',
      'CONSTELLATION': 'CEG',
      
      // Common names that fail regex
      'AMAZON': 'AMZN',
      'AMAZON.COM': 'AMZN',
      'ORACLE': 'ORCL',
      'ADVANCED MICRO DEVICES': 'AMD',
      'AMD': 'AMD',
      'MICRON': 'MU',
      'ACCENTURE': 'ACN',
      'APPLOVIN': 'APP',
      'WESTERN DIGITAL': 'WDC',
      'CELESTICA': 'CLS',
      'REDDIT': 'RDDT',
      'REDDITI': 'RDDT',
      'REGULUS': 'RGLS',
      'SALESFORCE': 'CRM',
      'JD.COM': 'JD',
      'JD(JD.COM': 'JD',
      'NVIDIA': 'NVDA',
      'BROADCOM': 'AVGO',
      'QUALCOMM': 'QCOM',
      'CISCO': 'CSCO',
      'INTEL': 'INTC',
      'ADOBE': 'ADBE',
      'PAYPAL': 'PYPL',
      'TESLA': 'TSLA',
      'APPLE': 'AAPL',
      'APPLE COMPUTER': 'AAPL',
      'MICROSOFT': 'MSFT',
      'META': 'META',
      'META PLATFORMS': 'META',
      'NETFLIX': 'NFLX',
      'DISNEY': 'DIS',
      'VISA': 'V',
      'MASTERCARD': 'MA',
      'JPMORGAN': 'JPM',
      'J.P. MORGAN': 'JPM',
      'JP MORGAN': 'JPM',
      'GOLDMAN': 'GS',
      'OKLO': 'OKLO',
      'ROCKET LAB': 'RKLB',
      'ROCKETLAB': 'RKLB',
      'ASTERA': 'ALAB',
      'KLA': 'KLAC',
      'UBER': 'UBER',
      'UBER TECHNOLOGIES': 'UBER',
      'UNITEDHEALTH': 'UNH',
      'UNITED HEALTH': 'UNH',
      'LULULEMON': 'LULU',
      'PROGRESSIVE': 'PGR',
      'COREWEAVE': 'CRWV',
      'EUROFOREX': 'SKIP', // Currency-related, not a stock
    };
    
    const nameBatches = chunkArray(names, BATCH_SIZE);
    console.log(`Processing ${names.length} derivative names in ${nameBatches.length} batches of ${BATCH_SIZE}`);
    
    for (let batchIndex = 0; batchIndex < nameBatches.length; batchIndex++) {
      const batch = nameBatches[batchIndex];
      console.log(`Processing name batch ${batchIndex + 1}/${nameBatches.length}...`);
      
      const batchPromises = batch.map(async (name) => {
        console.log(`Processing derivative underlying: ${name}`);
        
        // 1. Try to extract/infer ticker from name
        const upperName = name.toUpperCase();
        
        // Common patterns to extract ticker
        const tickerPatterns = [
          /^([A-Z]{1,5})(?:\s|$)/, // First word if uppercase
          /\b([A-Z]{2,5})\s+(?:INC|CORP|LTD|HOLDINGS?|CO|LLC|PLC|AG|SE)\b/i, // Before company suffix
        ];
        
        let inferredTicker: string | null = null;
        for (const pattern of tickerPatterns) {
          const match = upperName.match(pattern);
          if (match && match[1]) {
            inferredTicker = match[1];
            break;
          }
        }
        
        // Check special mappings
        for (const [pattern, ticker] of Object.entries(specialMappings)) {
          if (upperName.includes(pattern)) {
            if (ticker === 'SKIP') {
              console.log(`Skipping non-stock underlying: ${name}`);
              return { name, sector: null, source: 'skipped' };
            }
            inferredTicker = ticker;
            break;
          }
        }
        
        // If still no ticker, use AI to infer it
        if (!inferredTicker) {
          console.log(`Asking AI to infer ticker from: ${name}`);
          inferredTicker = await inferTickerWithAI(name);
        }
        
        if (!inferredTicker) {
          console.log(`Could not infer ticker from name: ${name}`);
          return { name, sector: null, source: 'error' };
        }
        
        // 2. Check DB for existing mapping first
        const { data: existingMappings } = await supabase
          .from('isin_mappings')
          .select('sector, industry')
          .or(`ticker.eq.${inferredTicker.toUpperCase()},isin.eq.TICKER:${inferredTicker.toUpperCase()}`)
          .not('sector', 'is', null)
          .limit(1);
        
        if (existingMappings && existingMappings.length > 0 && existingMappings[0].sector) {
          console.log(`Using cached DB sector for ${inferredTicker}: ${existingMappings[0].sector}`);
          return {
            name,
            ticker: inferredTicker,
            sector: existingMappings[0].sector,
            industry: existingMappings[0].industry,
            source: 'db_cache',
          };
        }
        
        // 3. Get sector using AI (fallback)
        console.log(`Getting sector for ${inferredTicker} (from name: ${name}) via AI...`);
        const sectorInfo = await fetchSectorWithAI(inferredTicker, name);
        
        console.log(`Sector for ${name} (${inferredTicker}): ${sectorInfo.sector || 'unknown'}`);
        
        return {
          name,
          ticker: inferredTicker,
          sector: sectorInfo.sector,
          industry: sectorInfo.industry,
          source: sectorInfo.sector ? 'ai' : 'unknown',
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      nameResults.push(...batchResults);
      
      // Short delay between batches
      if (batchIndex < nameBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const duration = Date.now() - startTime;
    const resolvedIsins = results.filter(r => r.sector).length;
    const resolvedNames = nameResults.filter(r => r.sector).length;
    
    console.log(`Sector resolution completed in ${duration}ms: ${resolvedIsins}/${isins.length} ISINs, ${resolvedNames}/${names.length} names`);
    
    return new Response(
      JSON.stringify({
        success: true,
        mode: 'resolve-and-get-sectors',
        duration: `${duration}ms`,
        total: isins.length + names.length,
        resolved: resolvedIsins + resolvedNames,
        results,
        nameResults, // NEW: include name resolution results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
      .select('id, description, isin, ticker, current_price, asset_type, quantity, currency, portfolio_id')
      .in('asset_type', ['stock', 'Stock']);

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

          // Get live exchange rate for the position's currency
          const exchangeRate = await getExchangeRateForCurrency(position.currency);
          
          // Calculate new market value in EUR
          const newMarketValue = (priceData.price * position.quantity) / exchangeRate;
          
          // Update position with price, market value, and exchange rate
          const { error: updateError } = await supabase
            .from('positions')
            .update({
              current_price: priceData.price,
              market_value: newMarketValue,
              exchange_rate: exchangeRate,
              ticker: ticker,
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
