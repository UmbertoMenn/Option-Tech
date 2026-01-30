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

export interface DoubleDiagonalPosition {
  underlying: string;
  soldExpiryDate: string;    // Shorter expiry (sold options)
  boughtExpiryDate: string;  // Longer expiry (bought options)
  soldPut: Position;
  boughtPut: Position;
  soldCall: Position;
  boughtCall: Position;
  contracts: number;
  totalPremium: number;
  totalProfitLoss: number;
}

export interface NakedPutPosition {
  option: Position;
  underlying: Position | null;
  contracts: number;
}

export interface LeapCallPosition {
  option: Position;
  underlying: Position | null;
  contracts: number;
}

export interface OtherStrategyPosition {
  option: Position;
  underlying: Position | null;
}

export interface GroupedOtherStrategy {
  underlying: string;
  options: OtherStrategyPosition[];
  totalPremium: number;
  totalProfitLoss: number;
}

export interface DerivativeCategories {
  coveredCalls: CoveredCallPosition[];
  longPuts: LongPutPosition[];
  ironCondors: IronCondorPosition[];
  doubleDiagonals: DoubleDiagonalPosition[];
  nakedPuts: NakedPutPosition[];
  leapCalls: LeapCallPosition[];
  otherStrategies: OtherStrategyPosition[];
  groupedOtherStrategies: GroupedOtherStrategy[];
}

/**
 * Categorizes derivatives into Covered Calls and Strategies
 * 
 * Rules:
 * - First, try to detect 4-leg strategies (Iron Condor, Double Diagonal)
 * - If 4 options of same underlying (1 bought call, 1 sold call, 1 bought put, 1 sold put)
 *   don't match Iron Condor or Double Diagonal, put them ALL in "Altre Strategie"
 * - Covered Call: Sold CALL options (negative quantity) where you own the underlying stock
 * - Remaining options go to their respective categories (Naked Put, Leap Call, etc.)
 */
export function categorizeDerivatives(
  derivatives: Position[],
  allPositions: Position[]
): DerivativeCategories {
  const coveredCalls: CoveredCallPosition[] = [];
  const longPuts: LongPutPosition[] = [];
  const ironCondors: IronCondorPosition[] = [];
  const doubleDiagonals: DoubleDiagonalPosition[] = [];
  const nakedPuts: NakedPutPosition[] = [];
  const leapCalls: LeapCallPosition[] = [];
  const otherStrategies: OtherStrategyPosition[] = [];
  const usedDerivatives = new Set<string>();
  
  // Get all stock positions
  const stockPositions = allPositions.filter(p => 
    p.asset_type === 'stock' || p.asset_type === 'etf'
  );
  
  // ============ STEP 1: Group derivatives by underlying ============
  const groupedByUnderlying = new Map<string, Position[]>();
  
  for (const d of derivatives) {
    const underlying = normalizeForMatching(d.underlying || d.description);
    
    if (!groupedByUnderlying.has(underlying)) {
      groupedByUnderlying.set(underlying, []);
    }
    groupedByUnderlying.get(underlying)!.push(d);
  }
  
  // ============ STEP 2: For each underlying, try to detect 4-leg strategies ============
  for (const [underlying, group] of groupedByUnderlying.entries()) {
    // Check if we have potential 4-leg combinations
    const soldCalls = group.filter(p => p.option_type === 'call' && p.quantity < 0);
    const boughtCalls = group.filter(p => p.option_type === 'call' && p.quantity > 0);
    const soldPuts = group.filter(p => p.option_type === 'put' && p.quantity < 0);
    const boughtPuts = group.filter(p => p.option_type === 'put' && p.quantity > 0);
    
    // Try to find 4-leg combinations (1 of each type)
    while (soldCalls.length > 0 && boughtCalls.length > 0 && 
           soldPuts.length > 0 && boughtPuts.length > 0) {
      
      // Try Iron Condor first (all same expiry)
      const ironCondorResult = tryMatchIronCondor(soldCalls, boughtCalls, soldPuts, boughtPuts);
      
      if (ironCondorResult) {
        ironCondors.push(ironCondorResult.condor);
        usedDerivatives.add(ironCondorResult.condor.soldPut.id);
        usedDerivatives.add(ironCondorResult.condor.boughtPut.id);
        usedDerivatives.add(ironCondorResult.condor.soldCall.id);
        usedDerivatives.add(ironCondorResult.condor.boughtCall.id);
        // Remove from arrays
        removeFromArray(soldCalls, ironCondorResult.condor.soldCall);
        removeFromArray(boughtCalls, ironCondorResult.condor.boughtCall);
        removeFromArray(soldPuts, ironCondorResult.condor.soldPut);
        removeFromArray(boughtPuts, ironCondorResult.condor.boughtPut);
        continue;
      }
      
      // Try Double Diagonal (sold legs same expiry, bought legs same expiry, different from sold)
      const doubleDiagonalResult = tryMatchDoubleDiagonal(soldCalls, boughtCalls, soldPuts, boughtPuts);
      
      if (doubleDiagonalResult) {
        doubleDiagonals.push(doubleDiagonalResult.diagonal);
        usedDerivatives.add(doubleDiagonalResult.diagonal.soldPut.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.boughtPut.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.soldCall.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.boughtCall.id);
        // Remove from arrays
        removeFromArray(soldCalls, doubleDiagonalResult.diagonal.soldCall);
        removeFromArray(boughtCalls, doubleDiagonalResult.diagonal.boughtCall);
        removeFromArray(soldPuts, doubleDiagonalResult.diagonal.soldPut);
        removeFromArray(boughtPuts, doubleDiagonalResult.diagonal.boughtPut);
        continue;
      }
      
      // If we have 4 legs but don't match Iron Condor or Double Diagonal,
      // put ALL 4 in "Altre Strategie"
      const fourLegResult = tryMatch4LegUnclassified(soldCalls, boughtCalls, soldPuts, boughtPuts);
      
      if (fourLegResult) {
        for (const option of fourLegResult.options) {
          const underlyingStock = findUnderlyingStock(option, stockPositions);
          otherStrategies.push({
            option,
            underlying: underlyingStock || null
          });
          usedDerivatives.add(option.id);
        }
        // Remove from arrays
        removeFromArray(soldCalls, fourLegResult.options.find(o => o.option_type === 'call' && o.quantity < 0)!);
        removeFromArray(boughtCalls, fourLegResult.options.find(o => o.option_type === 'call' && o.quantity > 0)!);
        removeFromArray(soldPuts, fourLegResult.options.find(o => o.option_type === 'put' && o.quantity < 0)!);
        removeFromArray(boughtPuts, fourLegResult.options.find(o => o.option_type === 'put' && o.quantity > 0)!);
        continue;
      }
      
      // No more 4-leg combinations possible
      break;
    }
  }
  
  // ============ STEP 3: Find Covered Calls ============
  const soldCallsForCovered = derivatives.filter(d => 
    d.option_type === 'call' && d.quantity < 0 && !usedDerivatives.has(d.id)
  );
  
  for (const call of soldCallsForCovered) {
    if (!call.underlying) continue;
    
    const underlyingStock = findUnderlyingStock(call, stockPositions);
    
    if (underlyingStock && underlyingStock.quantity > 0) {
      const contractsSold = Math.abs(call.quantity);
      const sharesOwned = underlyingStock.quantity;
      
      const contractsCoverable = Math.floor(sharesOwned / 100);
      const contractsCovered = Math.min(contractsSold, contractsCoverable);
      
      if (contractsCovered > 0) {
        const sharesCovered = contractsCovered * 100;
        
        coveredCalls.push({
          option: {
            ...call,
            quantity: -contractsCovered
          },
          underlying: underlyingStock,
          contractsCovered,
          sharesCovered,
          isFullyCovered: contractsCovered === contractsSold
        });
        
        if (contractsCovered < contractsSold) {
          usedDerivatives.add(`${call.id}-partial-${contractsCovered}`);
        } else {
          usedDerivatives.add(call.id);
        }
      }
    }
  }
  
  // ============ STEP 4: Find Long PUTs (protections) ============
  const boughtPutsForLong = derivatives.filter(d => 
    d.option_type === 'put' && d.quantity > 0 && !usedDerivatives.has(d.id)
  );
  
  for (const put of boughtPutsForLong) {
    const underlyingStock = findUnderlyingStock(put, stockPositions);
    
    longPuts.push({
      option: put,
      underlying: underlyingStock || null,
      contracts: put.quantity
    });
    usedDerivatives.add(put.id);
  }
  
  // ============ STEP 5: Find Naked Puts ============
  const soldPutsForNaked = derivatives.filter(d => 
    d.option_type === 'put' && d.quantity < 0 && !usedDerivatives.has(d.id)
  );
  
  for (const put of soldPutsForNaked) {
    const underlyingStock = findUnderlyingStock(put, stockPositions);
    
    nakedPuts.push({
      option: put,
      underlying: underlyingStock || null,
      contracts: Math.abs(put.quantity)
    });
    usedDerivatives.add(put.id);
  }
  
  // ============ STEP 6: Find Leap Calls ============
  const boughtCallsForLeaps = derivatives.filter(d => 
    d.option_type === 'call' && d.quantity > 0 && !usedDerivatives.has(d.id)
  );
  
  for (const call of boughtCallsForLeaps) {
    const underlyingStock = findUnderlyingStock(call, stockPositions);
    
    leapCalls.push({
      option: call,
      underlying: underlyingStock || null,
      contracts: call.quantity
    });
    usedDerivatives.add(call.id);
  }
  
  // ============ STEP 7: Collect remaining unclassified derivatives ============
  for (const d of derivatives) {
    if (!usedDerivatives.has(d.id)) {
      const underlyingStock = findUnderlyingStock(d, stockPositions);
      otherStrategies.push({
        option: d,
        underlying: underlyingStock || null
      });
      usedDerivatives.add(d.id);
    }
  }
  
  // ============ STEP 8: Group other strategies by underlying ============
  const groupedOtherStrategies = groupOtherStrategiesByUnderlying(otherStrategies);
  
  return { coveredCalls, longPuts, ironCondors, doubleDiagonals, nakedPuts, leapCalls, otherStrategies, groupedOtherStrategies };
}

/**
 * Groups other strategies by underlying asset
 */
function groupOtherStrategiesByUnderlying(otherStrategies: OtherStrategyPosition[]): GroupedOtherStrategy[] {
  const grouped = new Map<string, OtherStrategyPosition[]>();
  
  for (const os of otherStrategies) {
    const underlyingKey = normalizeForMatching(os.option.underlying || os.option.description);
    
    if (!grouped.has(underlyingKey)) {
      grouped.set(underlyingKey, []);
    }
    grouped.get(underlyingKey)!.push(os);
  }
  
  const result: GroupedOtherStrategy[] = [];
  
  for (const [key, options] of grouped.entries()) {
    // Use the first option's underlying name as display name
    const displayName = options[0].option.underlying || options[0].option.description;
    
    const totalPremium = options.reduce((sum, os) => sum + (os.option.market_value || 0), 0);
    const totalProfitLoss = options.reduce((sum, os) => sum + (os.option.profit_loss || 0), 0);
    
    result.push({
      underlying: displayName,
      options,
      totalPremium,
      totalProfitLoss
    });
  }
  
  return result;
}

/**
 * Helper to remove an item from an array
 */
function removeFromArray(arr: Position[], item: Position): void {
  const idx = arr.findIndex(p => p.id === item.id);
  if (idx >= 0) arr.splice(idx, 1);
}

/**
 * Try to match an Iron Condor (all 4 legs same expiry)
 */
function tryMatchIronCondor(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): { condor: IronCondorPosition } | null {
  
  for (const soldPut of soldPuts) {
    const expiry = soldPut.expiry_date;
    const contracts = Math.abs(soldPut.quantity);
    const soldPutStrike = soldPut.strike_price || 0;
    
    // Find bought PUT with same expiry, lower strike, same contracts
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date === expiry &&
      (bp.strike_price || 0) < soldPutStrike &&
      bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    // Find sold CALL with same expiry, strike above sold PUT, same contracts
    const matchingSoldCall = soldCalls.find(sc =>
      sc.expiry_date === expiry &&
      (sc.strike_price || 0) > soldPutStrike &&
      Math.abs(sc.quantity) === contracts
    );
    if (!matchingSoldCall) continue;
    
    const soldCallStrike = matchingSoldCall.strike_price || 0;
    
    // Find bought CALL with same expiry, strike above sold CALL, same contracts
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date === expiry &&
      (bc.strike_price || 0) > soldCallStrike &&
      bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    // We have an Iron Condor!
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
    
    return {
      condor: {
        underlying: soldPut.underlying || soldPut.description,
        expiryDate: expiry || '',
        soldPut,
        boughtPut: matchingBoughtPut,
        soldCall: matchingSoldCall,
        boughtCall: matchingBoughtCall,
        contracts,
        totalPremium,
        totalProfitLoss
      }
    };
  }
  
  return null;
}

/**
 * Try to match a Double Diagonal (sold legs same expiry, bought legs same longer expiry)
 */
function tryMatchDoubleDiagonal(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): { diagonal: DoubleDiagonalPosition } | null {
  
  for (const soldPut of soldPuts) {
    const soldExpiry = soldPut.expiry_date;
    const soldExpiryTime = soldExpiry ? new Date(soldExpiry).getTime() : 0;
    const contracts = Math.abs(soldPut.quantity);
    const soldPutStrike = soldPut.strike_price || 0;
    
    // Find sold CALL with SAME expiry as sold PUT, strike above sold PUT, same contracts
    const matchingSoldCall = soldCalls.find(sc =>
      sc.expiry_date === soldExpiry &&
      (sc.strike_price || 0) > soldPutStrike &&
      Math.abs(sc.quantity) === contracts
    );
    if (!matchingSoldCall) continue;
    
    // Find bought PUT with LONGER expiry, same contracts (no strike constraint)
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date && new Date(bp.expiry_date).getTime() > soldExpiryTime &&
      bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    const boughtExpiry = matchingBoughtPut.expiry_date;
    
    // Find bought CALL with SAME expiry as bought PUT, same contracts
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date === boughtExpiry &&
      bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    // We have a Double Diagonal!
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
    
    return {
      diagonal: {
        underlying: soldPut.underlying || soldPut.description,
        soldExpiryDate: soldExpiry || '',
        boughtExpiryDate: boughtExpiry || '',
        soldPut,
        boughtPut: matchingBoughtPut,
        soldCall: matchingSoldCall,
        boughtCall: matchingBoughtCall,
        contracts,
        totalPremium,
        totalProfitLoss
      }
    };
  }
  
  return null;
}

/**
 * Try to match any 4-leg combination that doesn't fit Iron Condor or Double Diagonal
 * Returns the 4 options to put in "Altre Strategie"
 */
function tryMatch4LegUnclassified(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): { options: Position[] } | null {
  
  if (soldCalls.length === 0 || boughtCalls.length === 0 ||
      soldPuts.length === 0 || boughtPuts.length === 0) {
    return null;
  }
  
  // Take first of each type
  const soldCall = soldCalls[0];
  const boughtCall = boughtCalls[0];
  const soldPut = soldPuts[0];
  const boughtPut = boughtPuts[0];
  
  // Check if quantities match (same number of contracts)
  const contracts = Math.abs(soldCall.quantity);
  if (Math.abs(soldPut.quantity) !== contracts ||
      boughtCall.quantity !== contracts ||
      boughtPut.quantity !== contracts) {
    return null;
  }
  
  return {
    options: [soldCall, boughtCall, soldPut, boughtPut]
  };
}

/**
 * Special-case aliasing
 * Only keep the explicit GOOGLE ↔ ALPHABET equivalence requested.
 */

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
