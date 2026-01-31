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
  isPartial: boolean; // True if net exposure > 0 (protezione parziale)
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
  strategyName: string | null;
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
 * Categorizes derivatives following this priority order:
 * 1. Covered Call: CALL vendute con sottostante in portafoglio
 * 2. Protezioni: PUT acquistate SOLO se possiedo il sottostante
 * 3. Iron Condor: 4 gambe (2 call + 2 put) tutte con stessa scadenza
 * 4. Double Diagonal: 4 gambe con vendite stessa scadenza, acquisti stessa scadenza più lunga
 * 5. Altre Strategie: più gambe raggruppate per sottostante (con riconoscimento nome strategia)
 * 6. Singole gambe: Long Call → LEAP CALL, Short PUT → NAKED PUT, resto → Altre Strategie
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
  
  // Get all stock positions (NOT ETFs for matching)
  const stockPositions = allPositions.filter(p => p.asset_type === 'stock');
  
  // ============ STEP 1: Find Covered Calls ============
  const soldCalls = derivatives.filter(d => d.option_type === 'call' && d.quantity < 0);
  
  for (const call of soldCalls) {
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
        
        usedDerivatives.add(call.id);
      }
    }
  }
  
  // ============ STEP 2: Find Protezioni (Long PUT) ============
  // Protezione totale: esposizione netta <= 0
  // Protezione parziale: esposizione netta > 0 (PUT comprate single-leg non usate in altre strategie)
  
  // Raggruppa le PUT per sottostante
  const putsByUnderlying = new Map<string, { bought: Position[], sold: Position[], stock: Position | null }>();
  
  for (const d of derivatives) {
    if (d.option_type === 'put' && !usedDerivatives.has(d.id)) {
      const underlyingKey = normalizeForMatching(d.underlying || d.description);
      const underlyingStock = findUnderlyingStock(d, stockPositions);
      
      if (!putsByUnderlying.has(underlyingKey)) {
        putsByUnderlying.set(underlyingKey, { bought: [], sold: [], stock: underlyingStock || null });
      }
      
      const group = putsByUnderlying.get(underlyingKey)!;
      if (d.quantity > 0) {
        group.bought.push(d);
      } else {
        group.sold.push(d);
      }
      // Aggiorna stock se trovato
      if (underlyingStock && !group.stock) {
        group.stock = underlyingStock;
      }
    }
  }
  
  // Track PUT comprate per sottostante che hanno il sottostante ma esposizione > 0
  // Queste verranno aggiunte come protezioni parziali se rimangono single-leg
  const partialProtectionCandidates = new Map<string, { puts: Position[], stock: Position }>();
  
  // Verifica esposizione netta per ogni sottostante
  for (const [underlyingKey, group] of putsByUnderlying.entries()) {
    if (!group.stock || group.stock.quantity <= 0) continue;
    
    const stockContracts = Math.floor(group.stock.quantity / 100);
    const boughtContracts = group.bought.reduce((sum, p) => sum + p.quantity, 0);
    const soldContracts = group.sold.reduce((sum, p) => sum + Math.abs(p.quantity), 0);
    
    // Esposizione netta = Titoli/100 - (PUT comprate - PUT vendute)
    const netExposure = stockContracts - (boughtContracts - soldContracts);
    
    if (netExposure <= 0) {
      // Protezione totale: tutte le PUT comprate sono protezioni complete
      for (const put of group.bought) {
        longPuts.push({
          option: put,
          underlying: group.stock,
          contracts: put.quantity,
          isPartial: false
        });
        usedDerivatives.add(put.id);
      }
    } else {
      // Esposizione netta > 0: le PUT comprate potrebbero essere protezioni parziali
      // Ma solo se rimangono single-leg (non associate ad altre strategie)
      partialProtectionCandidates.set(underlyingKey, { puts: group.bought, stock: group.stock });
    }
  }
  
  // ============ STEP 3 & 4: Find Iron Condor and Double Diagonal ============
  // Group remaining derivatives by underlying
  const remainingDerivatives = derivatives.filter(d => !usedDerivatives.has(d.id));
  const groupedByUnderlying = new Map<string, Position[]>();
  
  for (const d of remainingDerivatives) {
    const underlying = normalizeForMatching(d.underlying || d.description);
    
    if (!groupedByUnderlying.has(underlying)) {
      groupedByUnderlying.set(underlying, []);
    }
    groupedByUnderlying.get(underlying)!.push(d);
  }
  
  for (const [, group] of groupedByUnderlying.entries()) {
    const groupSoldCalls = group.filter(p => p.option_type === 'call' && p.quantity < 0 && !usedDerivatives.has(p.id));
    const groupBoughtCalls = group.filter(p => p.option_type === 'call' && p.quantity > 0 && !usedDerivatives.has(p.id));
    const groupSoldPuts = group.filter(p => p.option_type === 'put' && p.quantity < 0 && !usedDerivatives.has(p.id));
    const groupBoughtPuts = group.filter(p => p.option_type === 'put' && p.quantity > 0 && !usedDerivatives.has(p.id));
    
    // Try to match 4-leg strategies
    while (groupSoldCalls.length > 0 && groupBoughtCalls.length > 0 && 
           groupSoldPuts.length > 0 && groupBoughtPuts.length > 0) {
      
      // STEP 3: Try Iron Condor (all same expiry)
      const ironCondorResult = tryMatchIronCondor(groupSoldCalls, groupBoughtCalls, groupSoldPuts, groupBoughtPuts);
      
      if (ironCondorResult) {
        ironCondors.push(ironCondorResult.condor);
        usedDerivatives.add(ironCondorResult.condor.soldPut.id);
        usedDerivatives.add(ironCondorResult.condor.boughtPut.id);
        usedDerivatives.add(ironCondorResult.condor.soldCall.id);
        usedDerivatives.add(ironCondorResult.condor.boughtCall.id);
        removeFromArray(groupSoldCalls, ironCondorResult.condor.soldCall);
        removeFromArray(groupBoughtCalls, ironCondorResult.condor.boughtCall);
        removeFromArray(groupSoldPuts, ironCondorResult.condor.soldPut);
        removeFromArray(groupBoughtPuts, ironCondorResult.condor.boughtPut);
        continue;
      }
      
      // STEP 4: Try Double Diagonal (sold same expiry, bought same longer expiry)
      const doubleDiagonalResult = tryMatchDoubleDiagonal(groupSoldCalls, groupBoughtCalls, groupSoldPuts, groupBoughtPuts);
      
      if (doubleDiagonalResult) {
        doubleDiagonals.push(doubleDiagonalResult.diagonal);
        usedDerivatives.add(doubleDiagonalResult.diagonal.soldPut.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.boughtPut.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.soldCall.id);
        usedDerivatives.add(doubleDiagonalResult.diagonal.boughtCall.id);
        removeFromArray(groupSoldCalls, doubleDiagonalResult.diagonal.soldCall);
        removeFromArray(groupBoughtCalls, doubleDiagonalResult.diagonal.boughtCall);
        removeFromArray(groupSoldPuts, doubleDiagonalResult.diagonal.soldPut);
        removeFromArray(groupBoughtPuts, doubleDiagonalResult.diagonal.boughtPut);
        continue;
      }
      
      // No more 4-leg matches possible
      break;
    }
  }
  
  // ============ STEP 5: Altre Strategie (più di 1 gamba per sottostante) ============
  // Re-group remaining derivatives
  const afterFourLegRemaining = derivatives.filter(d => !usedDerivatives.has(d.id));
  const regrouped = new Map<string, Position[]>();
  
  for (const d of afterFourLegRemaining) {
    const underlying = normalizeForMatching(d.underlying || d.description);
    if (!regrouped.has(underlying)) {
      regrouped.set(underlying, []);
    }
    regrouped.get(underlying)!.push(d);
  }
  
  // For groups with more than 1 option, put in "Altre Strategie"
  for (const [, group] of regrouped.entries()) {
    if (group.length > 1) {
      for (const option of group) {
        const underlyingStock = findUnderlyingStock(option, stockPositions);
        otherStrategies.push({
          option,
          underlying: underlyingStock || null
        });
        usedDerivatives.add(option.id);
      }
    }
  }
  
  // ============ STEP 6: Singole gambe ============
  const singleLegs = derivatives.filter(d => !usedDerivatives.has(d.id));
  
  for (const option of singleLegs) {
    const underlyingStock = findUnderlyingStock(option, stockPositions);
    const underlyingKey = normalizeForMatching(option.underlying || option.description);
    
    // Check if this is a bought PUT that's a partial protection candidate
    if (option.option_type === 'put' && option.quantity > 0) {
      const candidate = partialProtectionCandidates.get(underlyingKey);
      if (candidate && candidate.puts.some(p => p.id === option.id)) {
        // This is a partial protection (single-leg bought PUT with underlying, net exposure > 0)
        longPuts.push({
          option,
          underlying: candidate.stock,
          contracts: option.quantity,
          isPartial: true
        });
        usedDerivatives.add(option.id);
        continue;
      }
    }
    
    if (option.option_type === 'call' && option.quantity > 0) {
      // Long Call → LEAP CALL
      leapCalls.push({
        option,
        underlying: underlyingStock || null,
        contracts: option.quantity
      });
      usedDerivatives.add(option.id);
    } else if (option.option_type === 'put' && option.quantity < 0) {
      // Short PUT → NAKED PUT
      nakedPuts.push({
        option,
        underlying: underlyingStock || null,
        contracts: Math.abs(option.quantity)
      });
      usedDerivatives.add(option.id);
    } else {
      // Altre opzioni singole non classificate → Altre Strategie
      otherStrategies.push({
        option,
        underlying: underlyingStock || null
      });
      usedDerivatives.add(option.id);
    }
  }
  
  // ============ STEP 7: Group other strategies by underlying ============
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
      totalProfitLoss,
      strategyName: detectStrategyName(options)
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
 * Try to match an Iron Condor (all 4 legs same expiry, no strike constraints)
 */
function tryMatchIronCondor(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): { condor: IronCondorPosition } | null {
  
  for (const soldCall of soldCalls) {
    const expiry = soldCall.expiry_date;
    const contracts = Math.abs(soldCall.quantity);
    
    // Find bought CALL with same expiry and same contracts
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date === expiry && bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    // Find sold PUT with same expiry and same contracts
    const matchingSoldPut = soldPuts.find(sp =>
      sp.expiry_date === expiry && Math.abs(sp.quantity) === contracts
    );
    if (!matchingSoldPut) continue;
    
    // Find bought PUT with same expiry and same contracts
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date === expiry && bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    // We have an Iron Condor!
    const totalPremium = 
      (matchingSoldPut.market_value || 0) + 
      (matchingBoughtPut.market_value || 0) +
      (soldCall.market_value || 0) +
      (matchingBoughtCall.market_value || 0);
    
    const totalProfitLoss =
      (matchingSoldPut.profit_loss || 0) +
      (matchingBoughtPut.profit_loss || 0) +
      (soldCall.profit_loss || 0) +
      (matchingBoughtCall.profit_loss || 0);
    
    return {
      condor: {
        underlying: soldCall.underlying || soldCall.description,
        expiryDate: expiry || '',
        soldPut: matchingSoldPut,
        boughtPut: matchingBoughtPut,
        soldCall,
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
 * Try to match a Double Diagonal:
 * - Sold CALL and sold PUT on same expiry
 * - Bought CALL and bought PUT on same longer expiry
 */
function tryMatchDoubleDiagonal(
  soldCalls: Position[],
  boughtCalls: Position[],
  soldPuts: Position[],
  boughtPuts: Position[]
): { diagonal: DoubleDiagonalPosition } | null {
  
  for (const soldCall of soldCalls) {
    const soldExpiry = soldCall.expiry_date;
    const soldExpiryTime = soldExpiry ? new Date(soldExpiry).getTime() : 0;
    const contracts = Math.abs(soldCall.quantity);
    
    // Find sold PUT with SAME expiry as sold CALL, same contracts
    const matchingSoldPut = soldPuts.find(sp =>
      sp.expiry_date === soldExpiry && Math.abs(sp.quantity) === contracts
    );
    if (!matchingSoldPut) continue;
    
    // Find bought CALL with LONGER expiry, same contracts
    const matchingBoughtCall = boughtCalls.find(bc =>
      bc.expiry_date && new Date(bc.expiry_date).getTime() > soldExpiryTime &&
      bc.quantity === contracts
    );
    if (!matchingBoughtCall) continue;
    
    const boughtExpiry = matchingBoughtCall.expiry_date;
    
    // Find bought PUT with SAME expiry as bought CALL, same contracts
    const matchingBoughtPut = boughtPuts.find(bp =>
      bp.expiry_date === boughtExpiry && bp.quantity === contracts
    );
    if (!matchingBoughtPut) continue;
    
    // We have a Double Diagonal!
    const totalPremium = 
      (matchingSoldPut.market_value || 0) + 
      (matchingBoughtPut.market_value || 0) +
      (soldCall.market_value || 0) +
      (matchingBoughtCall.market_value || 0);
    
    const totalProfitLoss =
      (matchingSoldPut.profit_loss || 0) +
      (matchingBoughtPut.profit_loss || 0) +
      (soldCall.profit_loss || 0) +
      (matchingBoughtCall.profit_loss || 0);
    
    return {
      diagonal: {
        underlying: soldCall.underlying || soldCall.description,
        soldExpiryDate: soldExpiry || '',
        boughtExpiryDate: boughtExpiry || '',
        soldPut: matchingSoldPut,
        boughtPut: matchingBoughtPut,
        soldCall,
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
 * Detects known strategy names for grouped options
 */
function detectStrategyName(options: OtherStrategyPosition[]): string | null {
  if (options.length !== 2) return null;
  
  const opt1 = options[0].option;
  const opt2 = options[1].option;
  
  // Straddle: Same strike, same expiry, 1 CALL + 1 PUT
  if (opt1.option_type !== opt2.option_type &&
      opt1.expiry_date === opt2.expiry_date &&
      opt1.strike_price === opt2.strike_price) {
    if (opt1.quantity < 0 && opt2.quantity < 0) return 'Short Straddle';
    if (opt1.quantity > 0 && opt2.quantity > 0) return 'Long Straddle';
  }
  
  // Strangle: Different strikes, same expiry, 1 CALL + 1 PUT
  if (opt1.option_type !== opt2.option_type &&
      opt1.expiry_date === opt2.expiry_date &&
      opt1.strike_price !== opt2.strike_price) {
    if (opt1.quantity < 0 && opt2.quantity < 0) return 'Short Strangle';
    if (opt1.quantity > 0 && opt2.quantity > 0) return 'Long Strangle';
  }
  
  // Vertical Spread (Call): 1 bought CALL + 1 sold CALL, same expiry
  if (opt1.option_type === 'call' && opt2.option_type === 'call' &&
      opt1.expiry_date === opt2.expiry_date &&
      ((opt1.quantity > 0 && opt2.quantity < 0) || (opt1.quantity < 0 && opt2.quantity > 0))) {
    return 'Vertical Spread (Call)';
  }
  
  // Vertical Spread (Put): 1 bought PUT + 1 sold PUT, same expiry
  if (opt1.option_type === 'put' && opt2.option_type === 'put' &&
      opt1.expiry_date === opt2.expiry_date &&
      ((opt1.quantity > 0 && opt2.quantity < 0) || (opt1.quantity < 0 && opt2.quantity > 0))) {
    return 'Vertical Spread (Put)';
  }
  
  return null;
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
