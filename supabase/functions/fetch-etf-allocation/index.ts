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

// Fallback sector allocations for major index ETFs (when scraping fails)
const INDEX_SECTOR_FALLBACKS: Record<string, Record<string, number>> = {
  'MSCI WORLD': {
    'Technology': 24,
    'Financials': 15,
    'Healthcare': 12,
    'Consumer Discretionary': 11,
    'Industrials': 10,
    'Communication Services': 8,
    'Consumer Staples': 7,
    'Energy': 4,
    'Materials': 4,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'S&P 500': {
    'Technology': 32,
    'Healthcare': 12,
    'Financials': 11,
    'Consumer Discretionary': 10,
    'Communication Services': 9,
    'Industrials': 8,
    'Consumer Staples': 6,
    'Energy': 4,
    'Materials': 4,
    'Utilities': 2,
    'Real Estate': 2,
  },
  'S&P500': {
    'Technology': 32,
    'Healthcare': 12,
    'Financials': 11,
    'Consumer Discretionary': 10,
    'Communication Services': 9,
    'Industrials': 8,
    'Consumer Staples': 6,
    'Energy': 4,
    'Materials': 4,
    'Utilities': 2,
    'Real Estate': 2,
  },
  'MSCI EMERGING': {
    'Financials': 22,
    'Technology': 20,
    'Consumer Discretionary': 14,
    'Communication Services': 10,
    'Materials': 8,
    'Energy': 6,
    'Industrials': 6,
    'Consumer Staples': 5,
    'Healthcare': 4,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'MSCI EM': {
    'Financials': 22,
    'Technology': 20,
    'Consumer Discretionary': 14,
    'Communication Services': 10,
    'Materials': 8,
    'Energy': 6,
    'Industrials': 6,
    'Consumer Staples': 5,
    'Healthcare': 4,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'MSCI EUROPE': {
    'Financials': 17,
    'Healthcare': 15,
    'Industrials': 14,
    'Consumer Staples': 11,
    'Consumer Discretionary': 10,
    'Technology': 8,
    'Materials': 8,
    'Energy': 7,
    'Utilities': 4,
    'Communication Services': 3,
    'Real Estate': 3,
  },
  'STOXX EUROPE': {
    'Financials': 17,
    'Healthcare': 15,
    'Industrials': 14,
    'Consumer Staples': 11,
    'Consumer Discretionary': 10,
    'Technology': 8,
    'Materials': 8,
    'Energy': 7,
    'Utilities': 4,
    'Communication Services': 3,
    'Real Estate': 3,
  },
  'EURO STOXX': {
    'Financials': 18,
    'Industrials': 16,
    'Consumer Discretionary': 12,
    'Technology': 12,
    'Healthcare': 10,
    'Consumer Staples': 8,
    'Materials': 7,
    'Energy': 6,
    'Utilities': 5,
    'Communication Services': 3,
    'Real Estate': 3,
  },
  'FTSE ALL-WORLD': {
    'Technology': 23,
    'Financials': 15,
    'Healthcare': 11,
    'Consumer Discretionary': 11,
    'Industrials': 10,
    'Communication Services': 7,
    'Consumer Staples': 6,
    'Energy': 5,
    'Materials': 5,
    'Utilities': 3,
    'Real Estate': 3,
  },
  'FTSE ALL WORLD': {
    'Technology': 23,
    'Financials': 15,
    'Healthcare': 11,
    'Consumer Discretionary': 11,
    'Industrials': 10,
    'Communication Services': 7,
    'Consumer Staples': 6,
    'Energy': 5,
    'Materials': 5,
    'Utilities': 3,
    'Real Estate': 3,
  },
  'NASDAQ': {
    'Technology': 50,
    'Communication Services': 15,
    'Consumer Discretionary': 14,
    'Healthcare': 8,
    'Consumer Staples': 4,
    'Industrials': 4,
    'Financials': 3,
    'Utilities': 1,
    'Energy': 0.5,
    'Real Estate': 0.5,
  },
  'MSCI USA': {
    'Technology': 30,
    'Healthcare': 13,
    'Financials': 12,
    'Consumer Discretionary': 10,
    'Communication Services': 9,
    'Industrials': 8,
    'Consumer Staples': 6,
    'Energy': 4,
    'Materials': 3,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'MSCI JAPAN': {
    'Industrials': 22,
    'Consumer Discretionary': 18,
    'Technology': 15,
    'Financials': 12,
    'Healthcare': 10,
    'Communication Services': 8,
    'Materials': 5,
    'Consumer Staples': 5,
    'Real Estate': 3,
    'Utilities': 2,
  },
  'TOPIX': {
    'Industrials': 22,
    'Consumer Discretionary': 18,
    'Technology': 15,
    'Financials': 12,
    'Healthcare': 10,
    'Communication Services': 8,
    'Materials': 5,
    'Consumer Staples': 5,
    'Real Estate': 3,
    'Utilities': 2,
  },
  'MSCI CHINA': {
    'Consumer Discretionary': 28,
    'Communication Services': 18,
    'Financials': 15,
    'Technology': 12,
    'Industrials': 8,
    'Healthcare': 6,
    'Consumer Staples': 5,
    'Energy': 3,
    'Materials': 3,
    'Real Estate': 2,
  },
  'MSCI ACWI': {
    'Technology': 24,
    'Financials': 15,
    'Healthcare': 11,
    'Consumer Discretionary': 11,
    'Industrials': 10,
    'Communication Services': 7,
    'Consumer Staples': 6,
    'Energy': 5,
    'Materials': 5,
    'Utilities': 3,
    'Real Estate': 3,
  },
};

// Get fallback sector allocations based on ETF name matching common indices
function getIndexFallbackSectors(etfName: string): Record<string, number> {
  const upperName = etfName.toUpperCase();
  
  // Check for specific index matches (more specific first)
  for (const [indexName, sectors] of Object.entries(INDEX_SECTOR_FALLBACKS)) {
    if (upperName.includes(indexName)) {
      console.log(`Using fallback sectors for index: ${indexName}`);
      return { ...sectors }; // Return a copy
    }
  }
  
  // No fallback found
  return {};
}

// Valid GICS sectors for AI validation
const VALID_GICS_SECTORS = [
  'Technology', 'Financials', 'Healthcare',
  'Consumer Discretionary', 'Consumer Staples', 'Industrials',
  'Energy', 'Materials', 'Utilities', 'Real Estate',
  'Communication Services'
];

// Fetch ETF sector allocations using Lovable AI when scraping fails
// Returns multi-sector breakdown with minimum 80% coverage (max 20% in Other)
async function fetchETFSectorsWithAI(
  isin: string,
  etfName: string
): Promise<Record<string, number>> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    console.log('LOVABLE_API_KEY not configured, skipping AI sector lookup for ETF');
    return {};
  }
  
  const prompt = `For the ETF "${etfName}" (ISIN: ${isin}), provide the sector allocation breakdown.

IMPORTANT RULES:
1. Return the TOP 5-8 sectors with their percentage allocations
2. The percentages MUST sum to at least 80% (maximum 20% can go to "Other")
3. Use ONLY these sector names: ${VALID_GICS_SECTORS.join(', ')}, Other
4. For broad market ETFs (MSCI World, S&P 500, FTSE All-World, etc.) distribute across multiple sectors based on typical index weights
5. For thematic/sector ETFs, concentrate on the main sector(s)
6. Be accurate based on your knowledge of the index composition

Respond in this EXACT JSON format only, no explanation:
{"Technology": 24, "Financials": 15, "Healthcare": 12, "Consumer Discretionary": 11, "Industrials": 10, "Communication Services": 8, "Consumer Staples": 7, "Other": 13}`;

  try {
    console.log(`Calling Lovable AI for ETF sectors: ${etfName}...`);
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 250,
      }),
    });
    
    if (!response.ok) {
      console.error(`AI gateway error: ${response.status}`);
      return {};
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI did not return valid JSON for ETF sectors');
      return {};
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate: only valid sectors, percentages are numbers
    const result: Record<string, number> = {};
    let total = 0;
    
    for (const [sector, pct] of Object.entries(parsed)) {
      const isValidSector = VALID_GICS_SECTORS.includes(sector) || sector === 'Other';
      if (isValidSector && typeof pct === 'number' && pct > 0) {
        result[sector] = pct;
        total += pct;
      }
    }
    
    // Validate minimum 80% coverage (max 20% in Other)
    const otherPct = result['Other'] || 0;
    
    if (otherPct <= 20 && total >= 80) {
      console.log(`AI resolved ETF sectors for ${etfName}: ${JSON.stringify(result)}`);
      return result;
    }
    
    // If Other > 20%, redistribute to make it compliant
    if (otherPct > 20 && Object.keys(result).length > 1) {
      const excess = otherPct - 20;
      result['Other'] = 20;
      
      // Distribute excess proportionally to other sectors
      const otherSectors = Object.entries(result).filter(([k]) => k !== 'Other');
      const otherTotal = otherSectors.reduce((s, [, v]) => s + v, 0);
      
      if (otherTotal > 0) {
        for (const [sector, pct] of otherSectors) {
          result[sector] = pct + (excess * pct / otherTotal);
        }
      }
      
      console.log(`AI resolved ETF sectors (adjusted) for ${etfName}: ${JSON.stringify(result)}`);
      return result;
    }
    
    // If total < 80%, the AI response is not useful
    console.log(`AI returned insufficient coverage for ${etfName}: ${total}%`);
    return {};
  } catch (error) {
    console.error('Error fetching ETF sectors with AI:', error);
    return {};
  }
}

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
  sectorAllocations: Record<string, number>;
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
  const sectorAllocations: Record<string, number> = {};
  
  // ==================== COUNTRY ALLOCATIONS ====================
  // Method 1: Look for country rows with specific data-testid (most reliable)
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
  if (Object.keys(currencyAllocations).length === 0) {
    const upperName = (name + ' ' + html.substring(0, 5000)).toUpperCase();
    
    if (upperName.includes('S&P 500') || upperName.includes('NASDAQ') || upperName.includes('US ')) {
      currencyAllocations['USD'] = 100;
    } else if (upperName.includes('MSCI WORLD')) {
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
  
  // ==================== SECTOR ALLOCATIONS ====================
  console.log('Extracting sector allocations...');
  
  // Method 1: Look for sector rows with specific data-testid
  const sectorRowRegex = /data-testid="etf-holdings_sectors_row"[^>]*>[\s\S]*?data-testid="tl_etf-holdings_sectors_value_name"[^>]*>([^<]+)<[\s\S]*?data-testid="tl_etf-holdings_sectors_value_percentage"[^>]*>[\s]*([\d,\.]+)\s*%/gi;
  
  while ((match = sectorRowRegex.exec(html)) !== null) {
    const sector = match[1].trim();
    const percentage = parsePercentage(match[2]);
    
    if (percentage > 0 && sector.length > 1) {
      console.log(`Found sector: ${sector} = ${percentage}%`);
      sectorAllocations[sector] = (sectorAllocations[sector] || 0) + percentage;
    }
  }
  
  // Method 2: Alternative pattern for sectors
  if (Object.keys(sectorAllocations).length === 0) {
    console.log('Sector Method 1 failed, trying Method 2...');
    // Look for patterns in allocation tables
    const altSectorRegex = /<tr[^>]*(?:sector|sectors)[^>]*>[\s\S]*?<td[^>]*>([A-Za-z\s\-]+)<\/td>[\s\S]*?(\d+[.,]\d+)\s*%/gi;
    
    while ((match = altSectorRegex.exec(html)) !== null) {
      const sector = match[1].trim();
      const percentage = parsePercentage(match[2]);
      
      if (percentage > 0 && sector.length > 2) {
        console.log(`Found sector (Method 2): ${sector} = ${percentage}%`);
        sectorAllocations[sector] = (sectorAllocations[sector] || 0) + percentage;
      }
    }
  }
  
  // Method 3: Search for known sectors in the HTML
  if (Object.keys(sectorAllocations).length === 0) {
    console.log('Trying Sector Method 3 (known sector search)...');
    const knownSectors = [
      'Technology', 'Information Technology', 'Financials', 'Financial Services',
      'Healthcare', 'Health Care', 'Consumer Discretionary', 'Consumer Cyclical',
      'Consumer Staples', 'Consumer Defensive', 'Industrials', 'Energy',
      'Materials', 'Basic Materials', 'Utilities', 'Real Estate',
      'Communication Services', 'Telecommunications'
    ];
    
    // Look for sector context section
    const sectorSectionMatch = html.match(/(?:sectors|sector\s*allocation|by\s*sector)/i);
    if (sectorSectionMatch) {
      const sectionStart = sectorSectionMatch.index || 0;
      const sectionHtml = html.substring(sectionStart, sectionStart + 3000);
      
      for (const sector of knownSectors) {
        const sectorPattern = new RegExp(
          sector.replace(/\s+/g, '\\s+') + '[^\\d]{0,50}?(\\d+[.,]\\d+)\\s*%',
          'gi'
        );
        
        const sectorMatch = sectorPattern.exec(sectionHtml);
        if (sectorMatch && !sectorAllocations[sector]) {
          const percentage = parsePercentage(sectorMatch[1]);
          if (percentage > 0 && percentage <= 100) {
            console.log(`Found sector (Method 3): ${sector} = ${percentage}%`);
            sectorAllocations[sector] = percentage;
          }
        }
      }
    }
  }
  
  // Fallback: Use ETF name to infer sector for sector-specific ETFs
  if (Object.keys(sectorAllocations).length === 0) {
    const upperName = name.toUpperCase();
    if (upperName.includes('TECHNOLOGY') || upperName.includes('TECH')) {
      sectorAllocations['Technology'] = 100;
    } else if (upperName.includes('FINANCIAL')) {
      sectorAllocations['Financials'] = 100;
    } else if (upperName.includes('HEALTHCARE') || upperName.includes('HEALTH')) {
      sectorAllocations['Healthcare'] = 100;
    } else if (upperName.includes('ENERGY')) {
      sectorAllocations['Energy'] = 100;
    } else if (upperName.includes('CONSUMER DISCRETIONARY')) {
      sectorAllocations['Consumer Discretionary'] = 100;
    } else if (upperName.includes('CONSUMER STAPLES')) {
      sectorAllocations['Consumer Staples'] = 100;
    } else if (upperName.includes('INDUSTRIAL')) {
      sectorAllocations['Industrials'] = 100;
    } else if (upperName.includes('MATERIALS')) {
      sectorAllocations['Materials'] = 100;
    } else if (upperName.includes('UTILITIES')) {
      sectorAllocations['Utilities'] = 100;
    } else if (upperName.includes('REAL ESTATE')) {
      sectorAllocations['Real Estate'] = 100;
    } else if (upperName.includes('COMMUNICATION') || upperName.includes('TELECOM')) {
      sectorAllocations['Communication Services'] = 100;
    } else {
      // Use INDEX_SECTOR_FALLBACKS for broad market ETFs
      const fallbackSectors = getIndexFallbackSectors(name);
      if (Object.keys(fallbackSectors).length > 0) {
        Object.assign(sectorAllocations, fallbackSectors);
      }
    }
  }
  
  console.log(`Final sector allocations for ${isin}:`, sectorAllocations);
  console.log(`Parsed allocations for ${isin}:`, { countryAllocations, currencyAllocations, sectorAllocations, isHedged });
  
  return {
    name,
    countryAllocations,
    currencyAllocations,
    sectorAllocations,
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
              sectorAllocations: cached.sector_allocations || {},
              topHoldings: [], // No longer returning top holdings
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

    // AI Fallback for ETFs without sector data
    if (Object.keys(data.sectorAllocations).length === 0) {
      console.log(`No sector data scraped for ${isin}, trying Lovable AI...`);
      const aiSectors = await fetchETFSectorsWithAI(isin, data.name);
      
      if (Object.keys(aiSectors).length > 0) {
        Object.assign(data.sectorAllocations, aiSectors);
        console.log(`AI populated sectors for ${data.name}:`, aiSectors);
      }
    }

    // Upsert to cache (no longer storing top_holdings)
    await supabase
      .from('etf_allocations')
      .upsert({
        isin,
        name: data.name,
        country_allocations: data.countryAllocations,
        currency_allocations: data.currencyAllocations,
        sector_allocations: data.sectorAllocations,
        top_holdings: [], // Empty array, no longer used
        is_hedged: data.isHedged,
        last_fetched_at: new Date().toISOString(),
      }, { onConflict: 'isin' });

    return new Response(
      JSON.stringify({
        isin,
        ...data,
        topHoldings: [], // No longer returning top holdings
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
