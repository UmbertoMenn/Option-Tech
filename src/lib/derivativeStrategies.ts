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
  // Format: 'canonical_key': ['all', 'possible', 'variations']
  'ALPHABET': ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
  'AMAZON': ['AMZN', 'AMAZON', 'AMAZON.COM', 'AMAZON COM', 'AMAZON INC'],
  'APPLE': ['AAPL', 'APPLE', 'APPLE INC'],
  'NVIDIA': ['NVDA', 'NVIDIA', 'NVIDIA CORP', 'NVIDIA CORPORATION'],
  'TESLA': ['TSLA', 'TESLA', 'TESLA INC', 'TESLA MOTORS'],
  'MICROSOFT': ['MSFT', 'MICROSOFT', 'MICROSOFT CORP', 'MICROSOFT CORPORATION'],
  'AMD': ['AMD', 'ADVANCED MICRO', 'ADVANCED MICRO DEVICES'],
  'PALANTIR': ['PLTR', 'PALANTIR', 'PALANTIR TECHNOLOGIES'],
  'COREWEAVE': ['CRWV', 'COREWEAVE', 'CORE WEAVE'],
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
};

/**
 * Gets the canonical company key for any variation
 */
function getCanonicalKey(text: string): string | null {
  const upperText = text.toUpperCase().trim();
  
  for (const [canonical, aliases] of Object.entries(COMPANY_ALIASES)) {
    if (aliases.some(alias => upperText.includes(alias) || alias.includes(upperText))) {
      return canonical;
    }
  }
  
  return null;
}

/**
 * Normalizes text for fuzzy matching
 */
function normalizeForMatching(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')  // Remove special chars
    .replace(/\s+/g, ' ')          // Normalize spaces
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CLASS\s*[A-Z]?|COMMON|STOCK)\b/g, '') // Remove common suffixes
    .trim();
}

/**
 * Calculates similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeForMatching(str1);
  const s2 = normalizeForMatching(str2);
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Check for word overlap
  const words1 = new Set(s1.split(' ').filter(w => w.length > 1));
  const words2 = new Set(s2.split(' ').filter(w => w.length > 1));
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  const totalWords = Math.max(words1.size, words2.size);
  return totalWords > 0 ? matches / totalWords : 0;
}

/**
 * Finds the underlying stock for an option using intelligent matching
 */
function findUnderlyingStock(
  underlying: string,
  stocks: Position[]
): Position | undefined {
  const underlyingUpper = underlying.toUpperCase().trim();
  
  // First, try exact ticker match
  const exactMatch = stocks.find(stock => 
    stock.ticker?.toUpperCase() === underlyingUpper
  );
  if (exactMatch) return exactMatch;
  
  // Second, try canonical company matching
  const optionCanonical = getCanonicalKey(underlyingUpper);
  if (optionCanonical) {
    const canonicalMatch = stocks.find(stock => {
      const stockCanonical = getCanonicalKey(stock.description) || 
                              getCanonicalKey(stock.ticker || '');
      return stockCanonical === optionCanonical;
    });
    if (canonicalMatch) return canonicalMatch;
  }
  
  // Third, try fuzzy matching on description
  let bestMatch: Position | undefined;
  let bestScore = 0;
  
  for (const stock of stocks) {
    // Check description similarity
    const descScore = calculateSimilarity(underlyingUpper, stock.description);
    
    // Check ticker similarity if available
    const tickerScore = stock.ticker 
      ? calculateSimilarity(underlyingUpper, stock.ticker) 
      : 0;
    
    const score = Math.max(descScore, tickerScore);
    
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = stock;
    }
  }
  
  return bestMatch;
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
