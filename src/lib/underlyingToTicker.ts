/**
 * Maps descriptive underlying names (from Excel/IBKR) to standard ticker symbols.
 * This is used for option positions where the underlying is stored as a company name.
 */

const UNDERLYING_TO_TICKER: Record<string, string> = {
  // Major US Tech
  'APPLE COMPUTER, INC.': 'AAPL',
  'APPLE COMPUTER INC': 'AAPL',
  'APPLE INC': 'AAPL',
  'APPLE INC.': 'AAPL',
  'NVIDIA CORP': 'NVDA',
  'NVIDIA CORPORATION': 'NVDA',
  'MICROSOFT CORP': 'MSFT',
  'MICROSOFT CORPORATION': 'MSFT',
  'AMAZON.COM.INC': 'AMZN',
  'AMAZON.COM, INC.': 'AMZN',
  'AMAZON.COM INC': 'AMZN',
  'AMAZON COM INC': 'AMZN',
  'META PLATFORMS': 'META',
  'META PLATFORMS INC': 'META',
  'META PLATFORMS, INC.': 'META',
  'FACEBOOK INC': 'META',
  'ALPHABET INC': 'GOOGL',
  'ALPHABET INC.': 'GOOGL',
  'GOOGLE INC.': 'GOOGL',
  'GOOGLE INC. (A)': 'GOOGL',
  'GOOGLE INC. (C)': 'GOOG',
  'ALPHABET INC-CL A': 'GOOGL',
  'ALPHABET INC-CL C': 'GOOG',
  'TESLA INC': 'TSLA',
  'TESLA, INC.': 'TSLA',
  'TESLA MOTORS INC': 'TSLA',
  
  // Other Major US Stocks
  'NETFLIX INC': 'NFLX',
  'NETFLIX, INC.': 'NFLX',
  'ADOBE INC': 'ADBE',
  'ADOBE SYSTEMS INC': 'ADBE',
  'SALESFORCE INC': 'CRM',
  'SALESFORCE.COM INC': 'CRM',
  'PAYPAL HOLDINGS INC': 'PYPL',
  'PAYPAL HOLDINGS': 'PYPL',
  'INTEL CORP': 'INTC',
  'INTEL CORPORATION': 'INTC',
  'AMD': 'AMD',
  'ADVANCED MICRO DEVICES': 'AMD',
  'ADVANCED MICRO DEVICES INC': 'AMD',
  'CISCO SYSTEMS INC': 'CSCO',
  'CISCO SYSTEMS': 'CSCO',
  'ORACLE CORP': 'ORCL',
  'ORACLE CORPORATION': 'ORCL',
  'IBM': 'IBM',
  'INTERNATIONAL BUSINESS MACHINES': 'IBM',
  'QUALCOMM INC': 'QCOM',
  'QUALCOMM INCORPORATED': 'QCOM',
  'BROADCOM INC': 'AVGO',
  'BROADCOM LTD': 'AVGO',
  'UBER TECHNOLOGIES INC': 'UBER',
  'UBER TECHNOLOGIES': 'UBER',
  'AIRBNB INC': 'ABNB',
  'AIRBNB': 'ABNB',
  'COINBASE GLOBAL INC': 'COIN',
  'COINBASE': 'COIN',
  'PALANTIR TECHNOLOGIES INC': 'PLTR',
  'PALANTIR': 'PLTR',
  'SNOWFLAKE INC': 'SNOW',
  'SNOWFLAKE': 'SNOW',
  'CROWDSTRIKE HOLDINGS INC': 'CRWD',
  'CROWDSTRIKE': 'CRWD',
  'DATADOG INC': 'DDOG',
  'DATADOG': 'DDOG',
  'ZOOM VIDEO COMMUNICATIONS': 'ZM',
  'ZOOM VIDEO COMMUNICATIONS INC': 'ZM',
  'SHOPIFY INC': 'SHOP',
  'SHOPIFY': 'SHOP',
  'SPOTIFY TECHNOLOGY': 'SPOT',
  'SPOTIFY TECHNOLOGY SA': 'SPOT',
  'BLOCK INC': 'SQ',
  'SQUARE INC': 'SQ',
  'SERVICENOW INC': 'NOW',
  'SERVICENOW': 'NOW',
  'WORKDAY INC': 'WDAY',
  'WORKDAY': 'WDAY',
  'TWILIO INC': 'TWLO',
  'TWILIO': 'TWLO',
  'MONGODB INC': 'MDB',
  'MONGODB': 'MDB',
  'OKTA INC': 'OKTA',
  'OKTA': 'OKTA',
  
  // Finance
  'JPMORGAN CHASE': 'JPM',
  'JPMORGAN CHASE & CO': 'JPM',
  'JP MORGAN CHASE': 'JPM',
  'BANK OF AMERICA': 'BAC',
  'BANK OF AMERICA CORP': 'BAC',
  'WELLS FARGO': 'WFC',
  'WELLS FARGO & CO': 'WFC',
  'GOLDMAN SACHS': 'GS',
  'GOLDMAN SACHS GROUP': 'GS',
  'MORGAN STANLEY': 'MS',
  'CITIGROUP INC': 'C',
  'CITIGROUP': 'C',
  'VISA INC': 'V',
  'VISA': 'V',
  'MASTERCARD INC': 'MA',
  'MASTERCARD': 'MA',
  'AMERICAN EXPRESS': 'AXP',
  'AMERICAN EXPRESS CO': 'AXP',
  'BERKSHIRE HATHAWAY': 'BRK.B',
  'BERKSHIRE HATHAWAY INC': 'BRK.B',
  'BLACKROCK INC': 'BLK',
  'BLACKROCK': 'BLK',
  
  // Healthcare
  'JOHNSON & JOHNSON': 'JNJ',
  'UNITEDHEALTH GROUP': 'UNH',
  'UNITEDHEALTH GROUP INC': 'UNH',
  'PFIZER INC': 'PFE',
  'PFIZER': 'PFE',
  'MERCK & CO': 'MRK',
  'MERCK': 'MRK',
  'ABBVIE INC': 'ABBV',
  'ABBVIE': 'ABBV',
  'ELI LILLY': 'LLY',
  'ELI LILLY AND CO': 'LLY',
  'MODERNA INC': 'MRNA',
  'MODERNA': 'MRNA',
  
  // Consumer
  'WALMART INC': 'WMT',
  'WALMART': 'WMT',
  'COSTCO WHOLESALE': 'COST',
  'COSTCO WHOLESALE CORP': 'COST',
  'HOME DEPOT INC': 'HD',
  'HOME DEPOT': 'HD',
  'NIKE INC': 'NKE',
  'NIKE': 'NKE',
  'STARBUCKS CORP': 'SBUX',
  'STARBUCKS': 'SBUX',
  'MCDONALDS CORP': 'MCD',
  "MCDONALD'S CORP": 'MCD',
  'COCA-COLA CO': 'KO',
  'COCA COLA CO': 'KO',
  'PEPSICO INC': 'PEP',
  'PEPSICO': 'PEP',
  'PROCTER & GAMBLE': 'PG',
  'PROCTER AND GAMBLE': 'PG',
  'WALT DISNEY CO': 'DIS',
  'DISNEY': 'DIS',
  'DISNEY CO': 'DIS',
  
  // Industrial / Energy
  'EXXON MOBIL': 'XOM',
  'EXXON MOBIL CORP': 'XOM',
  'CHEVRON CORP': 'CVX',
  'CHEVRON': 'CVX',
  'BOEING CO': 'BA',
  'BOEING': 'BA',
  'CATERPILLAR INC': 'CAT',
  'CATERPILLAR': 'CAT',
  '3M COMPANY': 'MMM',
  '3M CO': 'MMM',
  'GENERAL ELECTRIC': 'GE',
  'GENERAL ELECTRIC CO': 'GE',
  'HONEYWELL INTERNATIONAL': 'HON',
  'HONEYWELL': 'HON',
  'LOCKHEED MARTIN': 'LMT',
  'LOCKHEED MARTIN CORP': 'LMT',
  'RAYTHEON TECHNOLOGIES': 'RTX',
  'RTX CORPORATION': 'RTX',
  'UNION PACIFIC': 'UNP',
  'UNION PACIFIC CORP': 'UNP',
  
  // Telecom
  'AT&T INC': 'T',
  'AT&T': 'T',
  'VERIZON COMMUNICATIONS': 'VZ',
  'VERIZON': 'VZ',
  'T-MOBILE US INC': 'TMUS',
  'T-MOBILE': 'TMUS',
  
  // ETFs (common options underlyings)
  'SPDR S&P 500 ETF': 'SPY',
  'SPY': 'SPY',
  'INVESCO QQQ TRUST': 'QQQ',
  'QQQ': 'QQQ',
  'ISHARES RUSSELL 2000': 'IWM',
  'IWM': 'IWM',
  'SPDR GOLD SHARES': 'GLD',
  'GLD': 'GLD',
  'ISHARES MSCI EMERGING': 'EEM',
  'EEM': 'EEM',
  'VANGUARD TOTAL STOCK': 'VTI',
  'VTI': 'VTI',
};

/**
 * Converts an underlying description to a ticker symbol.
 * Uses exact match first, then tries partial matching for common patterns.
 */
export function underlyingToTicker(underlying: string | null | undefined): string | null {
  if (!underlying) return null;
  
  // Normalize input
  const normalized = underlying.toUpperCase().trim();
  
  // Try exact match first
  if (UNDERLYING_TO_TICKER[normalized]) {
    return UNDERLYING_TO_TICKER[normalized];
  }
  
  // Try without trailing periods, commas, and extra spaces
  const cleaned = normalized
    .replace(/[.,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (UNDERLYING_TO_TICKER[cleaned]) {
    return UNDERLYING_TO_TICKER[cleaned];
  }
  
  // Try partial matching for common patterns
  for (const [key, ticker] of Object.entries(UNDERLYING_TO_TICKER)) {
    // Check if the underlying starts with a known key
    if (cleaned.startsWith(key) || key.startsWith(cleaned)) {
      return ticker;
    }
    
    // Check for word-level match (e.g., "APPLE" matches "APPLE COMPUTER, INC.")
    const keyWords = key.split(/\s+/);
    const cleanedWords = cleaned.split(/\s+/);
    
    if (keyWords[0] === cleanedWords[0] && keyWords.length > 1 && cleanedWords.length > 1) {
      // First word matches, check if it's a likely match
      if (keyWords.slice(0, 2).join(' ') === cleanedWords.slice(0, 2).join(' ')) {
        return ticker;
      }
    }
  }
  
  // If underlying looks like a ticker already (1-5 uppercase letters), return it
  if (/^[A-Z]{1,5}$/.test(cleaned)) {
    return cleaned;
  }
  
  console.log(`[underlyingToTicker] No mapping found for: "${underlying}"`);
  return null;
}

/**
 * Get all known mappings for debugging/logging
 */
export function getAllUnderlyingMappings(): Record<string, string> {
  return { ...UNDERLYING_TO_TICKER };
}
