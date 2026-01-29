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
 * Finds the underlying stock for an option
 */
function findUnderlyingStock(
  underlying: string,
  stocks: Position[]
): Position | undefined {
  const underlyingUpper = underlying.toUpperCase().trim();
  
  return stocks.find(stock => {
    // Match by ticker
    if (stock.ticker?.toUpperCase() === underlyingUpper) return true;
    
    // Match by description containing the underlying name
    const desc = stock.description.toUpperCase();
    
    // Common patterns: "NVIDIA CORP", "APPLE INC", etc.
    if (desc.includes(underlyingUpper)) return true;
    
    // Try matching company name variations
    const companyMappings: Record<string, string[]> = {
      'NVDA': ['NVIDIA', 'NVIDIA CORP'],
      'NVIDIA': ['NVDA', 'NVIDIA CORP'],
      'AAPL': ['APPLE', 'APPLE INC'],
      'AMD': ['AMD', 'ADVANCED MICRO'],
      'PLTR': ['PALANTIR'],
      'PALANTIR': ['PLTR'],
      'CRWV': ['COREWEAVE', 'CORE WEAVE'],
      'COREWEAVE': ['CRWV'],
      'UNH': ['UNITEDHEALTH', 'UNITED HEALTH'],
      'UNITEDHEALTH': ['UNH'],
      'TSLA': ['TESLA'],
      'TESLA': ['TSLA'],
      'GOOGL': ['GOOGLE', 'ALPHABET'],
      'MSFT': ['MICROSOFT'],
      'AMZN': ['AMAZON'],
    };
    
    const mappings = companyMappings[underlyingUpper] || [];
    for (const mapping of mappings) {
      if (desc.includes(mapping)) return true;
      if (stock.ticker?.toUpperCase() === mapping) return true;
    }
    
    return false;
  });
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
