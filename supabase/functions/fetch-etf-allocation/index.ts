import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sector keywords to filter out from country allocations
const SECTOR_KEYWORDS = [
  'Financials', 'Financial', 'Technology', 'Healthcare', 
  'Consumer', 'Energy', 'Industrials', 'Materials', 
  'Utilities', 'Real Estate', 'Communication', 
  'IT', 'Discretionary', 'Staples', 'Services', 
  'Sector', 'Industry', 'Basic', 'Telecom',
  'Information', 'Defensive', 'Cyclical', 'Sensitive',
  'Government', 'Corporate', 'Bond', 'Fixed Income',
  'Equity', 'Stock', 'Cash', 'Money Market'
];

// Map countries to their primary currencies
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  'United States': 'USD',
  'USA': 'USD',
  'Stati Uniti': 'USD',
  'United Kingdom': 'GBP',
  'UK': 'GBP',
  'Gran Bretagna': 'GBP',
  'Regno Unito': 'GBP',
  'Japan': 'JPY',
  'Giappone': 'JPY',
  'Switzerland': 'CHF',
  'Svizzera': 'CHF',
  'Canada': 'CAD',
  'Australia': 'AUD',
  'Germany': 'EUR',
  'Germania': 'EUR',
  'France': 'EUR',
  'Francia': 'EUR',
  'Italy': 'EUR',
  'Italia': 'EUR',
  'Netherlands': 'EUR',
  'Paesi Bassi': 'EUR',
  'Spain': 'EUR',
  'Spagna': 'EUR',
  'Belgium': 'EUR',
  'Belgio': 'EUR',
  'Austria': 'EUR',
  'Finland': 'EUR',
  'Finlandia': 'EUR',
  'Ireland': 'EUR',
  'Irlanda': 'EUR',
  'Portugal': 'EUR',
  'Portogallo': 'EUR',
  'Greece': 'EUR',
  'Grecia': 'EUR',
  'China': 'CNY',
  'Cina': 'CNY',
  'Hong Kong': 'HKD',
  'South Korea': 'KRW',
  'Corea del Sud': 'KRW',
  'Taiwan': 'TWD',
  'India': 'INR',
  'Brazil': 'BRL',
  'Brasile': 'BRL',
  'Mexico': 'MXN',
  'Messico': 'MXN',
  'Singapore': 'SGD',
  'Sweden': 'SEK',
  'Svezia': 'SEK',
  'Norway': 'NOK',
  'Norvegia': 'NOK',
  'Denmark': 'DKK',
  'Danimarca': 'DKK',
  'New Zealand': 'NZD',
  'Nuova Zelanda': 'NZD',
  'South Africa': 'ZAR',
  'Sudafrica': 'ZAR',
  'Russia': 'RUB',
  'Israel': 'ILS',
  'Israele': 'ILS',
  'Poland': 'PLN',
  'Polonia': 'PLN',
  'Czech Republic': 'CZK',
  'Repubblica Ceca': 'CZK',
  'Hungary': 'HUF',
  'Ungheria': 'HUF',
  'Turkey': 'TRY',
  'Turchia': 'TRY',
  'Thailand': 'THB',
  'Tailandia': 'THB',
  'Malaysia': 'MYR',
  'Indonesia': 'IDR',
  'Philippines': 'PHP',
  'Filippine': 'PHP',
  'Vietnam': 'VND',
  'Other': 'OTHER',
  'Altri': 'OTHER',
  'Altro': 'OTHER',
  'Cash': 'EUR',
  'Liquidità': 'EUR',
};

function getCurrencyFromCountry(country: string): string {
  // Try exact match first
  if (COUNTRY_TO_CURRENCY[country]) {
    return COUNTRY_TO_CURRENCY[country];
  }
  
  // Try case-insensitive match
  const lowerCountry = country.toLowerCase();
  for (const [key, value] of Object.entries(COUNTRY_TO_CURRENCY)) {
    if (key.toLowerCase() === lowerCountry) {
      return value;
    }
  }
  
  // Default to OTHER
  return 'OTHER';
}

// Check if a name is a valid country (not a sector)
function isValidCountry(name: string): boolean {
  // FIRST: Check if it's a known country - if so, always accept it
  const currency = getCurrencyFromCountry(name);
  if (currency !== 'OTHER') {
    return true; // It's a known country, definitely valid
  }
  
  // Check if name is in our country map (exact match)
  if (COUNTRY_TO_CURRENCY[name]) {
    return true;
  }
  
  // Only now check for sector keywords (for unknown names)
  const upperName = name.toUpperCase();
  for (const sector of SECTOR_KEYWORDS) {
    // Use word boundary matching to avoid partial matches
    // e.g., "IT" should not match "Italy"
    const sectorRegex = new RegExp(`\\b${sector.toUpperCase()}\\b`);
    if (sectorRegex.test(upperName)) {
      console.log(`Filtering out sector: ${name}`);
      return false;
    }
  }
  
  // For unknown entries, be conservative - only accept if it looks like a country name
  // (no numbers, reasonable length, no special characters)
  const looksLikeCountry = name.length >= 3 && 
                           name.length <= 30 && 
                           !/\d/.test(name) &&
                           /^[A-Za-z\s\-']+$/.test(name);
  
  return looksLikeCountry;
}

function parsePercentage(text: string): number {
  // Extract percentage from text like "65.23%" or "65,23%"
  const match = text.replace(',', '.').match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : 0;
}

async function scrapeJustETF(isin: string): Promise<{
  name: string;
  countryAllocations: Record<string, number>;
  currencyAllocations: Record<string, number>;
  isHedged: boolean;
}> {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  
  console.log(`Fetching justETF page for ISIN: ${isin}`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch justETF page: ${response.status}`);
  }

  const html = await response.text();
  
  // Extract ETF name
  const nameMatch = html.match(/<h1[^>]*class="[^"]*h1[^"]*"[^>]*>([^<]+)<\/h1>/i) 
    || html.match(/<title>([^|<]+)/i);
  const name = nameMatch ? nameMatch[1].trim() : isin;
  
  // Check if hedged - must be in the ETF name itself, not just anywhere on the page
  // Look for "hedged" specifically in the ETF name/title
  const isHedged = /hedged/i.test(name);
  
  // Extract country allocations from the page using specific data-testid attributes
  const countryAllocations: Record<string, number> = {};
  const currencyAllocations: Record<string, number> = {};
  
  // Method 1: Look for country rows with specific data-testid (most reliable)
  // Pattern: data-testid="etf-holdings_countries_row" with 
  //          data-testid="tl_etf-holdings_countries_value_name" and 
  //          data-testid="tl_etf-holdings_countries_value_percentage"
  const countryRowRegex = /data-testid="etf-holdings_countries_row"[^>]*>[\s\S]*?data-testid="tl_etf-holdings_countries_value_name"[^>]*>([^<]+)<[\s\S]*?data-testid="tl_etf-holdings_countries_value_percentage"[^>]*>[\s]*([\d,\.]+)\s*%/gi;
  
  let match;
  while ((match = countryRowRegex.exec(html)) !== null) {
    const country = match[1].trim();
    const percentage = parsePercentage(match[2]);
    
    if (percentage > 0 && country.length > 1 && isValidCountry(country)) {
      console.log(`Found country: ${country} = ${percentage}%`);
      countryAllocations[country] = (countryAllocations[country] || 0) + percentage;
    }
  }
  
  // Method 2: Alternative pattern - look for table cells with country name and percentage
  if (Object.keys(countryAllocations).length === 0) {
    console.log('Method 1 failed, trying Method 2...');
    // Look for patterns like: <td...>United States</td>...<span...>47.82%</span>
    const altCountryRegex = /<tr[^>]*(?:countries|country)[^>]*>[\s\S]*?<td[^>]*>([A-Za-z\s\-]+)<\/td>[\s\S]*?(\d+[.,]\d+)\s*%/gi;
    
    while ((match = altCountryRegex.exec(html)) !== null) {
      const country = match[1].trim();
      const percentage = parsePercentage(match[2]);
      
      if (percentage > 0 && country.length > 2 && isValidCountry(country)) {
        console.log(`Found country (Method 2): ${country} = ${percentage}%`);
        countryAllocations[country] = (countryAllocations[country] || 0) + percentage;
      }
    }
  }
  
  // Method 3: Look for any pattern with country name followed by percentage
  if (Object.keys(countryAllocations).length === 0) {
    console.log('Method 2 failed, trying Method 3 (country keyword context)...');
    const countryKeywordRegex = /(?:countries|country|Countries|Country)[^<]*<[\s\S]{0,2000}?([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)[^<\d]*(\d+[.,]\d+)\s*%/gi;
    
    while ((match = countryKeywordRegex.exec(html)) !== null) {
      const country = match[1].trim();
      const percentage = parsePercentage(match[2]);
      
      if (percentage > 0 && country.length > 2 && country.length < 30 && isValidCountry(country)) {
        console.log(`Found country (Method 3): ${country} = ${percentage}%`);
        if (!countryAllocations[country]) {
          countryAllocations[country] = percentage;
        }
      }
    }
  }
  
  // Method 4: Search for known country names in the HTML with nearby percentages
  if (Object.keys(countryAllocations).length < 3) {
    console.log('Trying Method 4 (known country search)...');
    const knownCountries = [
      'United States', 'Japan', 'United Kingdom', 'France', 'Germany', 'Canada',
      'Switzerland', 'Australia', 'China', 'Netherlands', 'Hong Kong', 'Sweden',
      'Taiwan', 'South Korea', 'India', 'Denmark', 'Spain', 'Italy', 'Singapore',
      'Brazil', 'Finland', 'Belgium', 'Ireland', 'Norway', 'South Africa',
      'Austria', 'New Zealand', 'Israel', 'Mexico', 'Thailand', 'Indonesia',
      'Malaysia', 'Poland', 'Saudi Arabia', 'UAE', 'Qatar', 'Philippines', 'Other'
    ];
    
    for (const country of knownCountries) {
      // Look for country name followed by a percentage within reasonable distance
      const countryPattern = new RegExp(
        country.replace(/\s+/g, '\\s+') + '[^\\d]{0,100}?(\\d+[.,]\\d+)\\s*%',
        'gi'
      );
      
      const countryMatch = countryPattern.exec(html);
      if (countryMatch && !countryAllocations[country]) {
        const percentage = parsePercentage(countryMatch[1]);
        if (percentage > 0 && percentage <= 100) {
          console.log(`Found country (Method 4): ${country} = ${percentage}%`);
          countryAllocations[country] = percentage;
        }
      }
    }
  }
  
  // Log final results
  console.log(`Final country allocations for ${isin}:`, countryAllocations);
  const totalAllocations = Object.values(countryAllocations).reduce((a, b) => a + b, 0);
  console.log(`Total allocation: ${totalAllocations}%`);
  
  // Validate: if total is way off, something went wrong
  if (totalAllocations > 120) {
    console.warn(`Total ${totalAllocations}% is too high, filtering to known countries only...`);
    for (const [key, value] of Object.entries(countryAllocations)) {
      if (getCurrencyFromCountry(key) === 'OTHER' && !COUNTRY_TO_CURRENCY[key]) {
        console.log(`Removing unknown entry: ${key}`);
        delete countryAllocations[key];
      }
    }
  }
  
  // Convert country allocations to currency allocations
  for (const [country, percentage] of Object.entries(countryAllocations)) {
    const currency = getCurrencyFromCountry(country);
    currencyAllocations[currency] = (currencyAllocations[currency] || 0) + percentage;
  }
  
  // If we couldn't find detailed allocations, use a fallback approach
  // based on common ETF patterns in the name
  if (Object.keys(currencyAllocations).length === 0) {
    const upperName = (name + ' ' + html.substring(0, 5000)).toUpperCase();
    
    if (upperName.includes('S&P 500') || upperName.includes('NASDAQ') || upperName.includes('US ')) {
      currencyAllocations['USD'] = 100;
    } else if (upperName.includes('MSCI WORLD')) {
      // Typical MSCI World allocation
      currencyAllocations['USD'] = 70;
      currencyAllocations['EUR'] = 10;
      currencyAllocations['JPY'] = 6;
      currencyAllocations['GBP'] = 4;
      currencyAllocations['OTHER'] = 10;
    } else if (upperName.includes('MSCI EUROPE') || upperName.includes('STOXX')) {
      currencyAllocations['EUR'] = 60;
      currencyAllocations['GBP'] = 25;
      currencyAllocations['CHF'] = 10;
      currencyAllocations['OTHER'] = 5;
    } else if (upperName.includes('MSCI EMERGING') || upperName.includes('EM ')) {
      currencyAllocations['CNY'] = 30;
      currencyAllocations['TWD'] = 15;
      currencyAllocations['INR'] = 12;
      currencyAllocations['KRW'] = 12;
      currencyAllocations['BRL'] = 8;
      currencyAllocations['OTHER'] = 23;
    } else if (upperName.includes('JAPAN') || upperName.includes('NIKKEI') || upperName.includes('TOPIX')) {
      currencyAllocations['JPY'] = 100;
    } else if (upperName.includes('EURO')) {
      currencyAllocations['EUR'] = 100;
    } else if (upperName.includes('UK ') || upperName.includes('FTSE 100')) {
      currencyAllocations['GBP'] = 100;
    }
  }
  
  console.log(`Parsed allocations for ${isin}:`, { countryAllocations, currencyAllocations, isHedged });
  
  return {
    name,
    countryAllocations,
    currencyAllocations,
    isHedged,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { isin, forceRefresh = false } = await req.json();
    
    if (!isin) {
      return new Response(
        JSON.stringify({ error: "ISIN is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from('etf_allocations')
        .select('*')
        .eq('isin', isin)
        .single();

      if (cached) {
        // Check if cache is less than 7 days old
        const cacheAge = Date.now() - new Date(cached.last_fetched_at).getTime();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        
        if (cacheAge < sevenDays) {
          console.log(`Using cached data for ${isin}`);
          return new Response(
            JSON.stringify({
              isin,
              name: cached.name,
              countryAllocations: cached.country_allocations,
              currencyAllocations: cached.currency_allocations,
              isHedged: cached.is_hedged,
              cached: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Scrape fresh data
    const data = await scrapeJustETF(isin);

    // Upsert to cache
    await supabase
      .from('etf_allocations')
      .upsert({
        isin,
        name: data.name,
        country_allocations: data.countryAllocations,
        currency_allocations: data.currencyAllocations,
        is_hedged: data.isHedged,
        last_fetched_at: new Date().toISOString(),
      }, { onConflict: 'isin' });

    return new Response(
      JSON.stringify({
        isin,
        ...data,
        cached: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});