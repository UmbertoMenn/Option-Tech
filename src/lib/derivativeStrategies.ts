import { Position } from '@/types/portfolio';

export interface CoveredCallPosition {
  option: Position;
  underlying: Position;
  contractsCovered: number;
  sharesCovered: number;
  isFullyCovered: boolean;
}

export interface LongPutPosition {
  option: Position;
  underlying: Position | null;
  contracts: number;
}

export interface StrategyPosition {
  positions: Position[];
  strategyType: 'naked_put' | 'naked_call' | 'long_call' | 'long_put' | 'vertical_spread' | 'straddle' | 'strangle' | 'unknown';
  description: string;
}

export interface IronCondorPosition {
  underlying: string;
  expiryDate: string;
  soldPut: Position;      // Higher strike PUT (sold)
  boughtPut: Position;    // Lower strike PUT (bought) - protection
  soldCall: Position;     // Lower strike CALL (sold)
  boughtCall: Position;   // Higher strike CALL (bought) - protection
  contracts: number;
  totalPremium: number;
  totalProfitLoss: number;
}

export interface NakedPutPosition {
  option: Position;
  contracts: number;
}

export interface LeapCallPosition {
  option: Position;
  underlying: Position | null;
  contracts: number;
}

export interface DerivativeCategories {
  coveredCalls: CoveredCallPosition[];
  longPuts: LongPutPosition[];
  ironCondors: IronCondorPosition[];
  nakedPuts: NakedPutPosition[];
  leapCalls: LeapCallPosition[];
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
  const longPuts: LongPutPosition[] = [];
  const ironCondors: IronCondorPosition[] = [];
  const nakedPuts: NakedPutPosition[] = [];
  const leapCalls: LeapCallPosition[] = [];
  const usedDerivatives = new Set<string>();
  
  // Get all stock positions
  const stockPositions = allPositions.filter(p => 
    p.asset_type === 'stock' || p.asset_type === 'etf'
  );
  
  // ============ STEP 1: Detect Iron Condors first ============
  // Group derivatives by underlying + expiry
  const groupedByUnderlyingExpiry = new Map<string, Position[]>();
  
  for (const d of derivatives) {
    const underlying = normalizeForMatching(d.underlying || d.description);
    const expiry = d.expiry_date || '';
    const key = `${underlying}|${expiry}`;
    
    if (!groupedByUnderlyingExpiry.has(key)) {
      groupedByUnderlyingExpiry.set(key, []);
    }
    groupedByUnderlyingExpiry.get(key)!.push(d);
  }
  
  // For each group, try to find Iron Condor patterns
  for (const [key, group] of groupedByUnderlyingExpiry.entries()) {
    const detectedCondors = findIronCondors(group);
    
    for (const condor of detectedCondors) {
      ironCondors.push(condor);
      usedDerivatives.add(condor.soldPut.id);
      usedDerivatives.add(condor.boughtPut.id);
      usedDerivatives.add(condor.soldCall.id);
      usedDerivatives.add(condor.boughtCall.id);
    }
  }
  
  // ============ STEP 2: Find Covered Calls ============
  // Find sold CALL options (negative quantity)
  const soldCalls = derivatives.filter(d => 
    d.option_type === 'call' && d.quantity < 0 && !usedDerivatives.has(d.id)
  );
  
  // Match sold calls with underlying stocks
  for (const call of soldCalls) {
    if (!call.underlying) continue;
    
    // Find matching stock position
    const underlyingStock = findUnderlyingStock(call, stockPositions);
    
    if (underlyingStock && underlyingStock.quantity > 0) {
      const contractsSold = Math.abs(call.quantity);
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
  
  // ============ STEP 3: Find Long PUTs (protections) ============
  // Find bought PUT options (positive quantity) - these go to Long PUT section
  const boughtPuts = derivatives.filter(d => 
    d.option_type === 'put' && d.quantity > 0 && !usedDerivatives.has(d.id)
  );
  
  for (const put of boughtPuts) {
    // Try to find underlying stock for price reference
    const underlyingStock = findUnderlyingStock(put, stockPositions);
    
    longPuts.push({
      option: put,
      underlying: underlyingStock || null,
      contracts: put.quantity
    });
    usedDerivatives.add(put.id);
  }
  
  // ============ STEP 4: Find Naked Puts ============
  // Naked Put = sold PUT options (negative quantity) not used in other strategies
  const soldPuts = derivatives.filter(d => 
    d.option_type === 'put' && d.quantity < 0 && !usedDerivatives.has(d.id)
  );
  
  for (const put of soldPuts) {
    nakedPuts.push({
      option: put,
      contracts: Math.abs(put.quantity)
    });
    usedDerivatives.add(put.id);
  }
  
  // ============ STEP 5: Find Leap Calls ============
  // Leap Call = bought CALL options (positive quantity) not used in other strategies
  const boughtCalls = derivatives.filter(d => 
    d.option_type === 'call' && d.quantity > 0 && !usedDerivatives.has(d.id)
  );
  
  // Get all stock positions for underlying reference
  for (const call of boughtCalls) {
    const underlyingStock = findUnderlyingStock(call, stockPositions);
    
    leapCalls.push({
      option: call,
      underlying: underlyingStock || null,
      contracts: call.quantity
    });
    usedDerivatives.add(call.id);
  }
  
  return { coveredCalls, longPuts, ironCondors, nakedPuts, leapCalls };
}

/**
 * Find Iron Condor patterns within a group of options (same underlying, same expiry)
 * 
 * Iron Condor = 4 legs:
 * - 1 sold PUT (higher strike in the put spread)
 * - 1 bought PUT (lower strike - protection)
 * - 1 sold CALL (lower strike in the call spread)
 * - 1 bought CALL (higher strike - protection)
 * 
 * Pattern: Bought PUT < Sold PUT < Sold CALL < Bought CALL
 */
function findIronCondors(group: Position[]): IronCondorPosition[] {
  const condors: IronCondorPosition[] = [];
  
  // Separate by type and direction
  const soldPuts = group.filter(p => p.option_type === 'put' && p.quantity < 0)
    .sort((a, b) => (b.strike_price || 0) - (a.strike_price || 0)); // Higher strike first
  const boughtPuts = group.filter(p => p.option_type === 'put' && p.quantity > 0)
    .sort((a, b) => (a.strike_price || 0) - (b.strike_price || 0)); // Lower strike first
  const soldCalls = group.filter(p => p.option_type === 'call' && p.quantity < 0)
    .sort((a, b) => (a.strike_price || 0) - (b.strike_price || 0)); // Lower strike first
  const boughtCalls = group.filter(p => p.option_type === 'call' && p.quantity > 0)
    .sort((a, b) => (b.strike_price || 0) - (a.strike_price || 0)); // Higher strike first
  
  // Track used positions
  const usedIds = new Set<string>();
  
  // Try to match Iron Condors
  for (const soldPut of soldPuts) {
    if (usedIds.has(soldPut.id)) continue;
    
    const soldPutStrike = soldPut.strike_price || 0;
    const contracts = Math.abs(soldPut.quantity);
    
    // Find matching bought PUT (lower strike, same quantity)
    const matchingBoughtPut = boughtPuts.find(bp => 
      !usedIds.has(bp.id) &&
      (bp.strike_price || 0) < soldPutStrike &&
      bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    // Find matching sold CALL (strike above sold PUT, same quantity)
    const matchingSoldCall = soldCalls.find(sc =>
      !usedIds.has(sc.id) &&
      (sc.strike_price || 0) > soldPutStrike &&
      Math.abs(sc.quantity) === contracts
    );
    if (!matchingSoldCall) continue;
    
    const soldCallStrike = matchingSoldCall.strike_price || 0;
    
    // Find matching bought CALL (higher strike than sold call, same quantity)
    const matchingBoughtCall = boughtCalls.find(bc =>
      !usedIds.has(bc.id) &&
      (bc.strike_price || 0) > soldCallStrike &&
      bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    // We have a complete Iron Condor!
    usedIds.add(soldPut.id);
    usedIds.add(matchingBoughtPut.id);
    usedIds.add(matchingSoldCall.id);
    usedIds.add(matchingBoughtCall.id);
    
    // Calculate totals
    const totalPremium = 
      (soldPut.market_value || 0) + 
      (matchingBoughtPut.market_value || 0) +
      (matchingSoldCall.market_value || 0) +
      (matchingBoughtCall.market_value || 0);
    
    const totalProfitLoss =
      (soldPut.profit_loss || 0) +
      (matchingBoughtPut.profit_loss || 0) +
      (matchingSoldCall.profit_loss || 0) +
      (matchingBoughtCall.profit_loss || 0);
    
    condors.push({
      underlying: soldPut.underlying || soldPut.description,
      expiryDate: soldPut.expiry_date || '',
      soldPut,
      boughtPut: matchingBoughtPut,
      soldCall: matchingSoldCall,
      boughtCall: matchingBoughtCall,
      contracts,
      totalPremium,
      totalProfitLoss
    });
  }
  
  return condors;
}

/**
 * Special-case aliasing
 * Only keep the explicit GOOGLE ↔ ALPHABET equivalence requested.
 */
const SPECIAL_ALIASES: Record<string, string[]> = {
  ALPHABET: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC', 'ALPHABET CLASS'],
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
  
  for (const [canonical, aliases] of Object.entries(SPECIAL_ALIASES)) {
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
 * Finds the underlying stock for an option.
 *
 * Rule (as requested): if the option text contains the name of one of the stock
 * positions, match them. Only exception: GOOGLE/ALPHABET which are treated as
 * the same company.
 *
 * IMPORTANT: Only matches stocks, never ETFs.
 */
function findUnderlyingStock(option: Position, stocks: Position[]): Position | undefined {
  const stocksOnly = stocks.filter(s => s.asset_type === 'stock');

  const optionText = `${option.underlying ?? ''} ${option.description ?? ''} ${option.ticker ?? ''}`;
  const optionNormalized = normalizeForMatching(optionText);

  // 0) Hard rule: GOOGLE/GOOG/GOOGL must always map to ALPHABET.
  // This must override any broker mis-parsing of the `underlying` field.
  const googleSignalText = `${option.description ?? ''} ${option.ticker ?? ''} ${option.underlying ?? ''}`;
  const googleSignal = normalizeForMatching(googleSignalText);
  const isGoogleLike = /\b(GOOGLE|GOOG|GOOGL)\b/.test(googleSignal);
  if (isGoogleLike) {
    const alphabetStock = stocksOnly.find(stock => {
      const stockText = `${stock.description ?? ''} ${stock.ticker ?? ''}`;
      const stockNorm = normalizeForMatching(stockText);
      return /\bALPHABET\b/.test(stockNorm) || /\b(GOOG|GOOGL|GOOGLE)\b/.test(stockNorm);
    });
    if (alphabetStock) return alphabetStock;
  }

  // 1) Special-case GOOGLE/ALPHABET equivalence
  const optionCanonical = getCanonicalKey(optionText);
  if (optionCanonical) {
    const canonicalMatch = stocksOnly.find(stock => {
      const stockCanonical = getCanonicalKey(stock.description) || getCanonicalKey(stock.ticker || '');
      return stockCanonical === optionCanonical;
    });
    if (canonicalMatch) return canonicalMatch;
  }

  // 2) Simple containment: if option contains stock ticker or normalized name
  const optionTokens = optionNormalized.split(' ').filter(w => w.length > 2);

  for (const stock of stocksOnly) {
    const stockName = normalizeForMatching(stock.description);
    const stockTokens = stockName.split(' ').filter(w => w.length > 2);

    // Ticker containment (when available)
    if (stock.ticker) {
      const t = normalizeForMatching(stock.ticker);
      if (t && optionNormalized.includes(t)) return stock;
    }

    // Name containment / token overlap
    if (stockName && optionNormalized.includes(stockName)) return stock;

    if (stockTokens.length > 0) {
      const shared = stockTokens.filter(t => optionTokens.includes(t)).length;
      const required = Math.min(2, stockTokens.length); // 1 token for single-word names, 2 when possible
      if (shared >= required) return stock;
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
