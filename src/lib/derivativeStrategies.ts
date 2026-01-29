import { Position } from '@/types/portfolio';

export interface CoveredCallPosition {
  option: Position;
  underlying: Position;
  contractsCovered: number;
  sharesCovered: number;
  isFullyCovered: boolean;
}

export interface StrategyPosition {
  positions: Position[];
  strategyType: 'naked_put' | 'naked_call' | 'long_call' | 'long_put' | 'vertical_spread' | 'straddle' | 'strangle' | 'unknown';
  description: string;
}

export interface DerivativeCategories {
  coveredCalls: CoveredCallPosition[];
  strategies: StrategyPosition[];
}

/**
 * Categorizes derivatives into Covered Calls and Strategies
 * 
 * Rules:
 * - Covered Call: Sold CALL options (negative quantity) where you own the underlying stock
 *   - Each option contract = 100 shares
 *   - If sold calls * 100 > shares owned, excess goes to Strategies
 * - Strategies: Everything else (naked puts, bought options, excess calls, combinations)
 */
export function categorizeDerivatives(
  derivatives: Position[],
  allPositions: Position[]
): DerivativeCategories {
  const coveredCalls: CoveredCallPosition[] = [];
  const usedDerivatives = new Set<string>();
  
  // Get all stock positions
  const stockPositions = allPositions.filter(p => 
    p.asset_type === 'stock' || p.asset_type === 'etf'
  );
  
  // Find sold CALL options (negative quantity)
  const soldCalls = derivatives.filter(d => 
    d.option_type === 'call' && d.quantity < 0
  );
  
  // Match sold calls with underlying stocks
  for (const call of soldCalls) {
    if (!call.underlying) continue;
    
    // Find matching stock position
    const underlyingStock = findUnderlyingStock(call.underlying, stockPositions);
    
    if (underlyingStock && underlyingStock.quantity > 0) {
      const contractsSold = Math.abs(call.quantity);
      const sharesNeeded = contractsSold * 100;
      const sharesOwned = underlyingStock.quantity;
      
      // Calculate how many contracts are actually covered
      const contractsCoverable = Math.floor(sharesOwned / 100);
      const contractsCovered = Math.min(contractsSold, contractsCoverable);
      
      if (contractsCovered > 0) {
        const sharesCovered = contractsCovered * 100;
        
        coveredCalls.push({
          option: {
            ...call,
            // Adjust quantity to show only covered portion
            quantity: -contractsCovered
          },
          underlying: underlyingStock,
          contractsCovered,
          sharesCovered,
          isFullyCovered: contractsCovered === contractsSold
        });
        
        // If not fully covered, the excess will be handled in strategies
        if (contractsCovered < contractsSold) {
          // Mark as partially used - we'll create the excess entry later
          usedDerivatives.add(`${call.id}-partial-${contractsCovered}`);
        } else {
          usedDerivatives.add(call.id);
        }
      }
    }
  }
  
  // All remaining derivatives go to strategies
  const strategies: StrategyPosition[] = [];
  
  for (const derivative of derivatives) {
    // Skip fully used derivatives
    if (usedDerivatives.has(derivative.id)) continue;
    
    // Check for partial coverage
    const partialKey = Array.from(usedDerivatives).find(key => 
      key.startsWith(`${derivative.id}-partial-`)
    );
    
    if (partialKey) {
      // This is a partially covered call - add the excess
      const contractsCovered = parseInt(partialKey.split('-partial-')[1]);
      const excessContracts = Math.abs(derivative.quantity) - contractsCovered;
      
      if (excessContracts > 0) {
        strategies.push({
          positions: [{
            ...derivative,
            quantity: -excessContracts // Negative because they're sold
          }],
          strategyType: 'naked_call',
          description: `Naked Call (eccedente da Covered Call)`
        });
      }
      continue;
    }
    
    // Categorize the derivative
    const strategyType = determineStrategyType(derivative);
    strategies.push({
      positions: [derivative],
      strategyType,
      description: getStrategyDescription(strategyType)
    });
  }
  
  return { coveredCalls, strategies };
}

/**
 * Company alias database for intelligent matching
 * Maps common names, tickers, and variations to canonical identifiers
 */
const COMPANY_ALIASES: Record<string, string[]> = {
  'ALPHABET': ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
  'AMAZON': ['AMZN', 'AMAZON', 'AMAZON.COM', 'AMAZON COM', 'AMAZON INC', 'AMAZON.COM.INC'],
  'APPLE': ['AAPL', 'APPLE', 'APPLE INC'],
  'NVIDIA': ['NVDA', 'NVIDIA', 'NVIDIA CORP', 'NVIDIA CORPORATION'],
  'TESLA': ['TSLA', 'TESLA', 'TESLA INC', 'TESLA MOTORS'],
  'MICROSOFT': ['MSFT', 'MICROSOFT', 'MICROSOFT CORP', 'MICROSOFT CORPORATION'],
  'AMD': ['AMD', 'ADVANCED MICRO', 'ADVANCED MICRO DEVICES'],
  'PALANTIR': ['PLTR', 'PALANTIR', 'PALANTIR TECHNOLOGIES'],
  'COREWEAVE': ['CRWV', 'COREWEAVE', 'CORE WEAVE', 'CORWEAVE INC'],
  'UNITEDHEALTH': ['UNH', 'UNITEDHEALTH', 'UNITED HEALTH', 'UNITEDHEALTH GROUP'],
  'META': ['META', 'FB', 'FACEBOOK', 'META PLATFORMS'],
  'NETFLIX': ['NFLX', 'NETFLIX', 'NETFLIX INC'],
  'COINBASE': ['COIN', 'COINBASE', 'COINBASE GLOBAL'],
  'INTEL': ['INTC', 'INTEL', 'INTEL CORP', 'INTEL CORPORATION'],
  'BROADCOM': ['AVGO', 'BROADCOM', 'BROADCOM INC'],
  'QUALCOMM': ['QCOM', 'QUALCOMM', 'QUALCOMM INC'],
  'UBER': ['UBER', 'UBER TECHNOLOGIES'],
  'AIRBNB': ['ABNB', 'AIRBNB', 'AIRBNB INC'],
  'DISNEY': ['DIS', 'DISNEY', 'WALT DISNEY'],
  'JPMORGAN': ['JPM', 'JPMORGAN', 'JP MORGAN', 'JPMORGAN CHASE'],
  'GOLDMAN': ['GS', 'GOLDMAN', 'GOLDMAN SACHS'],
  'BERKSHIRE': ['BRK.A', 'BRK.B', 'BERKSHIRE', 'BERKSHIRE HATHAWAY'],
  'VISA': ['V', 'VISA', 'VISA INC'],
  'MASTERCARD': ['MA', 'MASTERCARD', 'MASTERCARD INC'],
  'PAYPAL': ['PYPL', 'PAYPAL', 'PAYPAL HOLDINGS'],
  'ORACLE': ['ORCL', 'ORACLE', 'ORACLE CORP', 'ORACLE CORPORATION'],
  'SALESFORCE': ['CRM', 'SALESFORCE', 'SALESFORCE INC'],
  'ADOBE': ['ADBE', 'ADOBE', 'ADOBE INC', 'ADOBE SYSTEMS'],
  'SNOWFLAKE': ['SNOW', 'SNOWFLAKE', 'SNOWFLAKE INC'],
  'CROWDSTRIKE': ['CRWD', 'CROWDSTRIKE', 'CROWDSTRIKE HOLDINGS'],
  'SHOPIFY': ['SHOP', 'SHOPIFY', 'SHOPIFY INC'],
  'PROGRESSIVE': ['PGR', 'PROGRESSIVE', 'PROGRESSIVE CORP', 'PROGRESSIVE OHIO'],
  'ALLSTATE': ['ALL', 'ALLSTATE', 'ALLSTATE CORP'],
  'CONSTELLATION': ['CEG', 'CONSTELLATION', 'CONSTELLATION ENERGY'],
  'ALIBABA': ['BABA', 'ALIBABA', 'ALIBABA GROUP'],
  'FIRST_REPUBLIC': ['FRC', 'FIRST REPUBLIC', 'FIRST REPUBLIC BANK'],
  'LVMH': ['MC', 'LVMH'],
};

/**
 * Normalizes text for matching - removes common prefixes and suffixes
 */
function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/^AZ\./i, '')  // Remove "AZ." prefix common in Italian brokers
    .replace(/\([^)]*\)/g, '')  // Remove content in parentheses like (OHIO)
    .replace(/[^A-Z0-9\s]/g, ' ')  // Remove special chars
    .replace(/\s+/g, ' ')          // Normalize spaces
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|COMMON|STOCK|DEL|OHIO|CA|THE)\b/gi, '') // Remove common suffixes
    .trim();
}

/**
 * Gets the canonical company key for any variation
 */
function getCanonicalKey(text: string): string | null {
  const normalized = normalizeForMatching(text);
  
  for (const [canonical, aliases] of Object.entries(COMPANY_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatching(alias);
      // Check for exact match or if normalized text contains the alias
      if (normalized === normalizedAlias || 
          normalized.includes(normalizedAlias) || 
          normalizedAlias.includes(normalized)) {
        return canonical;
      }
    }
  }
  
  return null;
}

/**
 * Finds the underlying stock for an option using intelligent matching
 * IMPORTANT: Only matches stocks, never ETFs
 */
function findUnderlyingStock(
  underlying: string,
  stocks: Position[]
): Position | undefined {
  // CRITICAL: Filter to only stocks, never match with ETFs
  const stocksOnly = stocks.filter(s => s.asset_type === 'stock');
  
  const underlyingNormalized = normalizeForMatching(underlying);
  
  // First, try canonical company matching (most reliable)
  const optionCanonical = getCanonicalKey(underlying);
  if (optionCanonical) {
    const canonicalMatch = stocksOnly.find(stock => {
      const stockCanonical = getCanonicalKey(stock.description) || 
                              getCanonicalKey(stock.ticker || '');
      return stockCanonical === optionCanonical;
    });
    if (canonicalMatch) return canonicalMatch;
  }
  
  // Second, try exact ticker match
  const exactMatch = stocksOnly.find(stock => 
    stock.ticker?.toUpperCase() === underlyingNormalized
  );
  if (exactMatch) return exactMatch;
  
  // Third, try normalized description matching
  for (const stock of stocksOnly) {
    const stockNormalized = normalizeForMatching(stock.description);
    
    // Check if key words match
    if (underlyingNormalized === stockNormalized) return stock;
    
    // Check for significant word overlap
    const underlyingWords = underlyingNormalized.split(' ').filter(w => w.length > 2);
    const stockWords = stockNormalized.split(' ').filter(w => w.length > 2);
    
    // If the first significant word matches and they share multiple words, it's a match
    if (underlyingWords.length > 0 && stockWords.length > 0) {
      const firstWordMatch = underlyingWords[0] === stockWords[0];
      const sharedWords = underlyingWords.filter(w => stockWords.includes(w)).length;
      
      if (firstWordMatch && sharedWords >= 1) {
        return stock;
      }
    }
  }
  
  return undefined;
}

/**
 * Determines the strategy type for a single derivative
 */
function determineStrategyType(derivative: Position): StrategyPosition['strategyType'] {
  const isSold = derivative.quantity < 0;
  const isCall = derivative.option_type === 'call';
  const isPut = derivative.option_type === 'put';
  
  if (isCall) {
    return isSold ? 'naked_call' : 'long_call';
  }
  
  if (isPut) {
    return isSold ? 'naked_put' : 'long_put';
  }
  
  return 'unknown';
}

/**
 * Gets a human-readable description for a strategy type
 */
function getStrategyDescription(strategyType: StrategyPosition['strategyType']): string {
  const descriptions: Record<StrategyPosition['strategyType'], string> = {
    'naked_put': 'Naked Put (PUT venduta)',
    'naked_call': 'Naked Call (CALL venduta)',
    'long_call': 'Long Call (CALL comprata)',
    'long_put': 'Long Put (PUT comprata)',
    'vertical_spread': 'Vertical Spread',
    'straddle': 'Straddle',
    'strangle': 'Strangle',
    'unknown': 'Strategia sconosciuta'
  };
  
  return descriptions[strategyType];
}

/**
 * Formats the option description for display
 */
export function formatOptionDescription(option: Position): string {
  const parts: string[] = [];
  
  if (option.underlying) {
    parts.push(option.underlying);
  }
  
  if (option.option_type) {
    parts.push(option.option_type.toUpperCase());
  }
  
  if (option.strike_price) {
    parts.push(`$${option.strike_price}`);
  }
  
  if (option.expiry_date) {
    const date = new Date(option.expiry_date);
    const month = date.toLocaleString('it-IT', { month: 'short' }).toUpperCase();
    const year = date.getFullYear().toString().slice(-2);
    parts.push(`${month}/${year}`);
  }
  
  return parts.join(' ') || option.description;
}
