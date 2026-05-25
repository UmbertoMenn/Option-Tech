import { Position } from '@/types/portfolio';
import { 
  DerivativeCategories, 
  LongPutPosition, 
  NakedPutPosition, 
  LeapCallPosition,
  IronCondorPosition,
  DoubleDiagonalPosition,
  GroupedOtherStrategy,
  CoveredCallPosition,
  DeRiskingCoveredCallPosition,
  normalizeForMatching,
  getCanonicalKey
} from './derivativeStrategies';
import { 
  calculateUniversalMaxLoss, 
  positionsToLegs,
  OptionLeg 
} from './universalMaxLoss';
import { resolveTickerKey } from './sectorExposure';
import { resolveUnderlyingIdentity } from './tickerIdentity';

export interface StockRiskDetail {
  underlying: string;
  tickerKey: string;            // Canonical ticker key for consolidation (e.g. "NVDA")
  stockValue: number;           // Valore azioni in valuta originale
  stockQuantity: number;        // Numero azioni
  stockPrice: number;           // Prezzo azione
  protectionStrike: number | null;
  protectionContracts: number;
  protectionOptionPrice: number | null; // Prezzo opzione (mkt se disponibile, fallback avg_cost)
  protectedValue: number;       // Valore protetto in valuta originale
  riskOriginal: number;         // Rischio in valuta originale
  riskEUR: number;              // Rischio convertito in EUR
  currency: string;
  exchangeRate: number;
  hasProtection: boolean;
  isin?: string;                // ISIN for ETF lookups
  isETF: boolean;               // Flag per distinguere ETF da azioni
  // Optional CC/DR-CC ITM caps (for tooltip details)
  ccCappedShares?: number;
  ccCapStrike?: number | null;
  drccCappedShares?: number;
  drccCapPerShare?: number | null;
  // Synthetic CC/DR-CC entry (no real underlying stock)
  isSynthetic?: boolean;
  syntheticType?: 'cc_put' | 'cc_call' | 'drcc_put' | 'drcc_call';
  composition?: string;         // Composizione strategia sintetica (UI)
  syntheticBreakdown?: {
    qty?: number;
    longStrike?: number;
    shortStrike?: number;
    pmc?: number;
    mkt?: number;
    spot?: number | null;
    spotSource?: 'portfolio' | 'ticker_cache' | 'none';
    spotTickerUsed?: string | null;
    pricePerShare?: number;
    priceSource?: 'PMC' | 'mkt';
    putStrike?: number;
    putQty?: number;
    synPutStrike?: number;
    protPutStrike?: number;
    contracts?: number;
    perShare?: number;
  };
}

export interface NakedPutRiskDetail {
  underlying: string;
  tickerKey: string;            // Canonical ticker key for consolidation
  strike: number;
  contracts: number;
  expiry: string;
  riskOriginal: number;         // Strike × Contratti × 100
  riskEUR: number;
  currency: string;
  exchangeRate: number;
}

export interface LeapCallRiskDetail {
  underlying: string;
  tickerKey: string;            // Canonical ticker key for consolidation
  strike: number;
  contracts: number;
  avgCost: number;
  marketPrice: number;          // Prezzo di mercato dell'opzione
  expiry: string;
  marketValue: number;          // Rischio = prezzo mercato × contratti × 100
  riskEUR: number;
  currency: string;
  exchangeRate: number;
}

export interface StrategyRiskDetail {
  strategyName: string;
  underlying: string;
  tickerKey: string;            // Canonical ticker key for consolidation
  maxLoss: number;              // In valuta originale
  maxLossEUR: number;
  currency: string;
  exchangeRate: number;
  calculation: string;          // Descrizione calcolo per tooltip
  hasUnlimitedRisk: boolean;    // Flag per strategie con rischio illimitato (es. Short Strangle)
}

export interface CommodityRiskDetail {
  underlying: string;
  value: number;              // Valore in valuta originale
  quantity: number;
  price: number;
  riskOriginal: number;       // Rischio in valuta originale (= valore)
  riskEUR: number;            // Rischio convertito in EUR
  currency: string;
  exchangeRate: number;
}

export interface BondRiskDetail {
  underlying: string;
  value: number;              // Valore in valuta originale
  quantity: number;
  price: number;
  riskOriginal: number;       // Rischio in valuta originale (= valore)
  riskEUR: number;            // Rischio convertito in EUR
  currency: string;
  exchangeRate: number;
}

export interface RiskAnalysis {
  // Totali EUR
  totalStockRisk: number;       // Rischio totale Azioni + ETF (per retrocompatibilità)
  totalETFRisk: number;         // Rischio solo ETF
  totalPureStockRisk: number;   // Rischio solo Azioni (no ETF, no sintetiche)
  totalCommodityRisk: number;
  totalBondRisk: number;
  totalNakedPutRisk: number;
  totalLeapCallRisk: number;
  totalStrategyRisk: number;
  totalSyntheticCcDrccRisk: number; // Rischio CC e DR-CC sintetiche
  grandTotal: number;
  
  // Dettagli
  stockDetails: StockRiskDetail[];           // SOLO stock/ETF reali
  syntheticCcDrccDetails: StockRiskDetail[]; // SOLO sintetiche CC/DR-CC
  commodityDetails: CommodityRiskDetail[];
  bondDetails: BondRiskDetail[];
  nakedPutDetails: NakedPutRiskDetail[];
  leapCallDetails: LeapCallRiskDetail[];
  strategyDetails: StrategyRiskDetail[];
}

// ============= HELPER FUNCTIONS =============

/**
 * Gets the effective exchange rate for a position.
 * Returns the exchange_rate if available, otherwise defaults to 1 (EUR or fallback).
 */
function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

/**
 * Checks if an option matches a stock using flexible matching logic.
 * This is consistent with derivativeStrategies.ts findUnderlyingStock logic.
 */
function matchesUnderlying(option: Position, stock: Position): boolean {
  // Build full text for matching
  const optionText = normalizeForMatching(
    `${option.underlying || ''} ${option.description || ''} ${option.ticker || ''}`
  );
  const stockText = normalizeForMatching(
    `${stock.ticker || ''} ${stock.description || ''}`
  );
  
  // 1. Direct match
  if (optionText === stockText && optionText.length > 0) return true;
  
  // 2. Check for ticker containment
  if (stock.ticker) {
    const tickerNorm = normalizeForMatching(stock.ticker);
    if (tickerNorm.length > 0 && optionText.includes(tickerNorm)) return true;
  }
  
  // 3. Check for stock name containment
  const stockName = normalizeForMatching(stock.description);
  if (stockName.length > 0 && optionText.includes(stockName)) return true;
  
  // 4. Token-based matching (filter corporate stopwords to avoid false positives)
  const CORPORATE_STOPWORDS = new Set([
    'group', 'holding', 'holdings', 'company', 'companies', 'corp',
    'corporation', 'limited', 'ltd', 'inc', 'incorporated', 'plc',
    'ag', 'sa', 'spa', 'nv', 'bv', 'se', 'the'
  ]);
  const optionTokens = optionText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
  const stockTokens = stockText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
  
  if (stockTokens.length > 0) {
    const matchCount = stockTokens.filter(t => optionTokens.includes(t)).length;
    // For single-word names (e.g., NVIDIA), require 1 match
    // For compound names, require at least half
    const threshold = stockTokens.length === 1 ? 1 : Math.ceil(stockTokens.length / 2);
    if (matchCount >= threshold) return true;
  }
  
  // 5. Special aliases (GOOGLE = ALPHABET, etc.)
  const optionCanonical = getCanonicalKey(optionText);
  const stockCanonical = getCanonicalKey(stockText);
  if (optionCanonical && stockCanonical && optionCanonical === stockCanonical) {
    return true;
  }
  
  return false;
}

// ============= RISK CALCULATION FUNCTIONS =============

/**
 * Calculate stock risk taking into account protective puts.
 * Formula for partial protection:
 * - Risk = (Unprotected Shares × Price) + (Protected Shares × max(0, Price - Strike))
 * 
 * This searches for bought PUTs directly in all positions, bypassing
 * the derivative classification which may group them into "Altre Strategie".
 */
export function calculateStockRisk(
  stocks: Position[],
  longPuts: LongPutPosition[],
  coveredCalls: CoveredCallPosition[],
  deRiskingCoveredCalls: DeRiskingCoveredCallPosition[],
  allPositions: Position[]
): StockRiskDetail[] {
  const result: StockRiskDetail[] = [];
  
  // Include only stocks and ETFs (commodities are calculated separately)
  const stockAssetTypes = ['stock', 'etf'];
  
  // Pre-filter all bought PUTs from positions (quantity > 0 = bought)
  const allBoughtPuts = allPositions.filter(p => 
    p.asset_type === 'derivative' && 
    p.option_type === 'put' && 
    (p.quantity || 0) > 0
  );
  
  for (const stock of stocks) {
    if (!stockAssetTypes.includes(stock.asset_type)) continue;
    
    const stockQuantity = stock.quantity || 0;
    const stockPrice = stock.current_price || 0;
    const stockValue = stockQuantity * stockPrice;
    const exchangeRate = getEffectiveExchangeRate(stock);
    const currency = stock.currency || 'USD';

    // Match DR-CCs and CCs for this stock (only "real" ones — synthetics are handled separately)
    const drccMatched = deRiskingCoveredCalls.filter(dr =>
      !dr.isSynthetic && matchesUnderlying(dr.coveredCall.option, stock)
    );
    const ccMatched = coveredCalls.filter(cc =>
      !cc.isSynthetic && matchesUnderlying(cc.option, stock)
    );
    const drccCcIds = new Set(drccMatched.map(dr => dr.coveredCall.option.id));
    const ccOnly = ccMatched.filter(cc => !drccCcIds.has(cc.option.id));

    // ===== Step 1: DR-CC shares & risk (priority over plain CC and protection PUTs) =====
    // Per share:
    //   - spot ≥ strikeCall → max(0, strikeCall - strikeProtPut) × shares
    //   - spot <  strikeCall → max(0, spot      - strikeProtPut) × shares
    let drccSharesRequested = 0;
    let drccRiskRequested = 0;
    let drccPerShareWeightedSum = 0;
    for (const dr of drccMatched) {
      const callStrike = dr.coveredCall.option.strike_price || 0;
      const putStrike = dr.protectionPut?.strike_price || 0;
      const sh = (dr.coveredCall.contractsCovered || 0) * 100;
      const perShare = stockPrice >= callStrike
        ? Math.max(0, callStrike - putStrike)
        : Math.max(0, stockPrice - putStrike);
      drccSharesRequested += sh;
      drccRiskRequested += perShare * sh;
      drccPerShareWeightedSum += perShare * sh;
    }
    const drccShares = Math.min(drccSharesRequested, stockQuantity);
    const drccRisk = drccSharesRequested > 0
      ? drccRiskRequested * (drccShares / drccSharesRequested)
      : 0;
    const drccPerShare = drccSharesRequested > 0
      ? drccPerShareWeightedSum / drccSharesRequested
      : 0;
    let remainingShares = stockQuantity - drccShares;

    // ===== Step 2: CC ITM cap (only OTM falls through to unprotected at spot × shares) =====
    let ccSharesRequested = 0;
    let ccRiskRequested = 0;
    let ccStrikeWeightedSum = 0;
    for (const cc of ccOnly) {
      const callStrike = cc.option.strike_price || 0;
      if (callStrike > 0 && callStrike < stockPrice) {
        const sh = (cc.contractsCovered || 0) * 100;
        ccSharesRequested += sh;
        ccRiskRequested += callStrike * sh;
        ccStrikeWeightedSum += callStrike * sh;
      }
    }
    const ccShares = Math.min(ccSharesRequested, remainingShares);
    const ccCapRisk = ccSharesRequested > 0
      ? ccRiskRequested * (ccShares / ccSharesRequested)
      : 0;
    const ccCapStrike = ccSharesRequested > 0
      ? ccStrikeWeightedSum / ccSharesRequested
      : 0;
    remainingShares -= ccShares;

    // ===== Step 3: Long PUT protections (exclude DR-CC's own protection PUTs) =====
    const drccProtPutIds = new Set(
      drccMatched.map(dr => dr.protectionPut?.id).filter((id): id is string => !!id)
    );
    const classifiedPuts = longPuts.filter(lp =>
      matchesUnderlying(lp.option, stock) && !drccProtPutIds.has(lp.option.id)
    );
    const classifiedPutIds = new Set(classifiedPuts.map(lp => lp.option.id));
    const additionalPuts = allBoughtPuts.filter(p =>
      matchesUnderlying(p, stock) && !drccProtPutIds.has(p.id) && !classifiedPutIds.has(p.id)
    );

    const contractsFromClassified = classifiedPuts.reduce((sum, lp) => sum + lp.contracts, 0);
    const contractsFromPositions = additionalPuts.reduce((sum, p) => sum + (p.quantity || 0), 0);
    const protectionContracts = contractsFromClassified + contractsFromPositions;

    let avgStrike = 0;
    let avgOptionPrice = 0;
    if (protectionContracts > 0) {
      const classifiedWeightedSum = classifiedPuts.reduce((sum, lp) =>
        sum + (lp.option.strike_price || 0) * lp.contracts, 0
      );
      const positionsWeightedSum = additionalPuts.reduce((sum, p) =>
        sum + (p.strike_price || 0) * (p.quantity || 0), 0
      );
      avgStrike = (classifiedWeightedSum + positionsWeightedSum) / protectionContracts;

      const classifiedPriceWeightedSum = classifiedPuts.reduce((sum, lp) => {
        const px = (lp.option.current_price ?? lp.option.avg_cost ?? 0);
        return sum + px * lp.contracts;
      }, 0);
      const positionsPriceWeightedSum = additionalPuts.reduce((sum, p) => {
        const px = (p.current_price ?? p.avg_cost ?? 0);
        return sum + px * (p.quantity || 0);
      }, 0);
      avgOptionPrice = (classifiedPriceWeightedSum + positionsPriceWeightedSum) / protectionContracts;
    }

    const protectedShares = Math.min(protectionContracts * 100, remainingShares);
    const protectedRisk = protectedShares * Math.max(0, stockPrice - avgStrike);
    remainingShares -= protectedShares;

    // ===== Step 4: Fully unprotected shares =====
    const unprotectedRisk = remainingShares * stockPrice;

    const riskOriginal = drccRisk + ccCapRisk + protectedRisk + unprotectedRisk;
    const riskEUR = riskOriginal / exchangeRate;

    // protectedValue still represents the long-PUT floor (used by some UI badges)
    const protectedValue = protectedShares * avgStrike;

    const stockIdentity = resolveUnderlyingIdentity({
      rawTicker: stock.ticker,
      rawName: stock.description,
      description: stock.description,
      isin: stock.isin,
      linkedStock: stock,
    });
    result.push({
      underlying: stock.ticker || stock.description,
      tickerKey: stockIdentity.tickerKey,
      stockValue,
      stockQuantity,
      stockPrice,
      protectionStrike: avgStrike > 0 ? avgStrike : null,
      protectionContracts,
      protectionOptionPrice: avgOptionPrice > 0 ? avgOptionPrice : null,
      protectedValue,
      riskOriginal,
      riskEUR,
      currency,
      exchangeRate,
      hasProtection: protectionContracts > 0,
      isin: stock.isin || undefined,
      isETF: stock.asset_type === 'etf',
      ccCappedShares: ccShares > 0 ? ccShares : undefined,
      ccCapStrike: ccShares > 0 ? ccCapStrike : null,
      drccCappedShares: drccShares > 0 ? drccShares : undefined,
      drccCapPerShare: drccShares > 0 ? drccPerShare : null,
    });
  }
  
  return result;
}

/**
 * Calculate naked put risk.
 * Formula: Strike × Contratti × 100 / Cambio
 */
export function calculateNakedPutRisk(
  nakedPuts: NakedPutPosition[]
): NakedPutRiskDetail[] {
  return nakedPuts.map(np => {
    const strike = np.option.strike_price || 0;
    const contracts = np.contracts;
    const exchangeRate = getEffectiveExchangeRate(np.option);
    const riskOriginal = strike * contracts * 100;
    const underlying = np.option.underlying || np.option.description;
    const identity = resolveUnderlyingIdentity({
      rawTicker: np.option.ticker,
      rawName: underlying,
      underlyingName: np.option.underlying,
      description: np.option.description,
      linkedStock: np.underlying,
    });

    return {
      underlying,
      tickerKey: identity.tickerKey,
      strike,
      contracts,
      expiry: np.option.expiry_date || '',
      riskOriginal,
      riskEUR: riskOriginal / exchangeRate,
      currency: np.option.currency || 'USD',
      exchangeRate
    };
  });
}

/**
 * Calculate leap call risk.
 * Formula: Prezzo mercato × Contratti × 100 / Cambio (valore di mercato)
 */
export function calculateLeapCallRisk(
  leapCalls: LeapCallPosition[]
): LeapCallRiskDetail[] {
  return leapCalls.map(lc => {
    const contracts = lc.contracts;
    const avgCost = lc.option.avg_cost || 0;
    const marketPrice = lc.option.current_price || avgCost; // Fallback to avgCost if no market price
    const exchangeRate = getEffectiveExchangeRate(lc.option);
    const marketValue = contracts * marketPrice * 100;
    const underlying = lc.option.underlying || lc.option.description;
    const identity = resolveUnderlyingIdentity({
      rawTicker: lc.option.ticker,
      rawName: underlying,
      underlyingName: lc.option.underlying,
      description: lc.option.description,
      linkedStock: lc.underlying,
    });

    return {
      underlying,
      tickerKey: identity.tickerKey,
      strike: lc.option.strike_price || 0,
      contracts,
      avgCost,
      marketPrice,
      expiry: lc.option.expiry_date || '',
      marketValue,
      riskEUR: marketValue / exchangeRate,
      currency: lc.option.currency || 'USD',
      exchangeRate
    };
  });
}

/**
 * Helper: Convert Position objects to OptionLeg format.
 */
function positionToLeg(p: Position): OptionLeg {
  return {
    type: (p.option_type || 'put') as 'call' | 'put',
    strike: p.strike_price || 0,
    quantity: p.quantity || 0,
    avgCost: p.avg_cost || 0
  };
}

/**
 * Calculate Iron Condor max loss using universal formula.
 * This replaces the old name-based calculation with a payoff-based approach.
 */
function calculateIronCondorMaxLoss(ic: IronCondorPosition): { maxLoss: number; calculation: string } {
  const legs: OptionLeg[] = [
    positionToLeg(ic.soldPut),
    positionToLeg(ic.boughtPut),
    positionToLeg(ic.soldCall),
    positionToLeg(ic.boughtCall)
  ];
  
  const result = calculateUniversalMaxLoss(legs);
  
  return {
    maxLoss: result.maxLoss,
    calculation: result.calculation
  };
}

/**
 * Calculate Double Diagonal max loss using universal formula.
 */
function calculateDoubleDiagonalMaxLoss(dd: DoubleDiagonalPosition): { maxLoss: number; calculation: string } {
  const legs: OptionLeg[] = [
    positionToLeg(dd.soldPut),
    positionToLeg(dd.boughtPut),
    positionToLeg(dd.soldCall),
    positionToLeg(dd.boughtCall)
  ];
  
  const result = calculateUniversalMaxLoss(legs);
  
  return {
    maxLoss: result.maxLoss,
    calculation: result.calculation
  };
}

/**
 * Calculate strategy risk for grouped other strategies using universal formula.
 */
function calculateGroupedStrategyMaxLoss(group: GroupedOtherStrategy): { 
  maxLoss: number; 
  calculation: string; 
  isUnlimited: boolean;
} {
  const legs = positionsToLegs(group.options.map(o => o.option));
  
  if (legs.length === 0) {
    return { maxLoss: 0, calculation: 'Nessuna gamba', isUnlimited: false };
  }
  
  const result = calculateUniversalMaxLoss(legs);
  
  // Add strategy name to calculation if available
  const strategyPrefix = group.strategyName ? `${group.strategyName}: ` : '';
  
  return {
    maxLoss: result.maxLoss,
    calculation: `${strategyPrefix}${result.calculation}`,
    isUnlimited: result.isUnlimited
  };
}

/**
 * Calculate strategy risk for all complex strategies.
 */
export function calculateStrategyRisk(categories: DerivativeCategories): StrategyRiskDetail[] {
  const result: StrategyRiskDetail[] = [];

  // Build a quick index: normalized underlying -> linkedStock from resolved configs.
  // This lets IC/DD/Other strategies inherit the canonical identity discovered by
  // the strategy engine (most reliable source).
  const linkedStockByUnderlying = new Map<string, Position>();
  for (const cfg of categories.resolvedConfigs) {
    if (cfg.linkedStock) {
      const key = normalizeForMatching(cfg.underlying);
      if (key && !linkedStockByUnderlying.has(key)) {
        linkedStockByUnderlying.set(key, cfg.linkedStock);
      }
    }
  }
  const findLinkedStock = (underlying: string): Position | null => {
    const key = normalizeForMatching(underlying);
    return linkedStockByUnderlying.get(key) || null;
  };

  // Iron Condors
  for (const ic of categories.ironCondors) {
    const exchangeRate = getEffectiveExchangeRate(ic.soldPut);
    const currency = ic.soldPut.currency || 'USD';
    const { maxLoss, calculation } = calculateIronCondorMaxLoss(ic);
    const identity = resolveUnderlyingIdentity({
      rawTicker: ic.soldPut.ticker,
      rawName: ic.underlying,
      underlyingName: ic.underlying,
      description: ic.soldPut.description,
      linkedStock: findLinkedStock(ic.underlying),
    });

    result.push({
      strategyName: 'Iron Condor',
      underlying: ic.underlying,
      tickerKey: identity.tickerKey,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation,
      hasUnlimitedRisk: false
    });
  }
  
  // Double Diagonals
  for (const dd of categories.doubleDiagonals) {
    const exchangeRate = getEffectiveExchangeRate(dd.soldPut);
    const currency = dd.soldPut.currency || 'USD';
    const { maxLoss, calculation } = calculateDoubleDiagonalMaxLoss(dd);
    const identity = resolveUnderlyingIdentity({
      rawTicker: dd.soldPut.ticker,
      rawName: dd.underlying,
      underlyingName: dd.underlying,
      description: dd.soldPut.description,
      linkedStock: findLinkedStock(dd.underlying),
    });

    result.push({
      strategyName: 'Double Diagonal',
      underlying: dd.underlying,
      tickerKey: identity.tickerKey,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation,
      hasUnlimitedRisk: false
    });
  }
  
  // Build set of underlyings covered by Covered Calls or De-Risking Covered Calls
  // Sold calls on these underlyings are simply additional covered calls → risk = 0
  const coveredUnderlyings = new Set<string>();
  for (const cc of categories.coveredCalls) {
    const u = normalizeForMatching(cc.option.underlying || cc.option.description || '');
    if (u) coveredUnderlyings.add(u);
  }
  for (const dr of categories.deRiskingCoveredCalls) {
    const u = normalizeForMatching(dr.coveredCall.option.underlying || dr.coveredCall.option.description || '');
    if (u) coveredUnderlyings.add(u);
  }
  
  // Grouped Other Strategies
  for (const group of categories.groupedOtherStrategies) {
    if (group.options.length === 0) continue;
    
    const groupUnderlying = normalizeForMatching(group.underlying);
    const isCoveredUnderlying = coveredUnderlyings.has(groupUnderlying);
    
    // If underlying is covered, filter out sold calls (they are just extra covered calls)
    let effectiveGroup = group;
    if (isCoveredUnderlying) {
      const nonSoldCallOptions = group.options.filter(o => {
        const isSoldCall = o.option.option_type === 'call' && (o.option.quantity || 0) < 0;
        return !isSoldCall;
      });
      // If all options were sold calls on a covered underlying → skip entirely
      if (nonSoldCallOptions.length === 0) continue;
      // Otherwise recalculate with remaining legs only
      effectiveGroup = { ...group, options: nonSoldCallOptions };
    }
    
    const firstOption = effectiveGroup.options[0].option;
    const exchangeRate = getEffectiveExchangeRate(firstOption);
    const currency = firstOption.currency || 'USD';
    const { maxLoss, calculation, isUnlimited } = calculateGroupedStrategyMaxLoss(effectiveGroup);
    const linkedFromOption = effectiveGroup.options.find(o => o.underlying)?.underlying || null;
    const identity = resolveUnderlyingIdentity({
      rawTicker: firstOption.ticker,
      rawName: effectiveGroup.underlying,
      underlyingName: effectiveGroup.underlying,
      description: firstOption.description,
      linkedStock: findLinkedStock(effectiveGroup.underlying) || linkedFromOption,
    });

    result.push({
      strategyName: effectiveGroup.strategyName || 'Strategia Complessa',
      underlying: effectiveGroup.underlying,
      tickerKey: identity.tickerKey,
      maxLoss,
      maxLossEUR: maxLoss / exchangeRate,
      currency,
      exchangeRate,
      calculation,
      hasUnlimitedRisk: isUnlimited
    });
  }
  
  return result;
}

/**
 * Helper to check if a position is an EUROFOREX instrument (excluded from risk analysis).
 */
function isEuroforexInstrument(name: string | undefined | null): boolean {
  return name?.toUpperCase().includes('EUROFOREX') || false;
}

/**
 * Resolver for spot price of a synthetic position's underlying.
 * Returns null if no spot can be resolved.
 */
export type SpotResolver = (underlyingName: string, optionTicker?: string | null) => number | null;

/**
 * Calculate risk for synthetic CC and DR-CC positions (no real underlying stock).
 *
 * Formulas (in option currency, then /exchangeRate):
 * - CC sintetica con syntheticCall (Long CALL ITM + Short CALL):
 *     spot >  strike_shortCall → PMC_longCall (avg_cost) × qty × 100
 *     spot <= strike_shortCall → mkt_longCall (current_price) × qty × 100
 *     spot ignoto              → fallback mkt_longCall (o avg_cost) × qty × 100
 *   NOTA: anche le DR-CC sintetiche con syntheticCall ricadono qui (la protezione PUT
 *   è irrilevante quando la long CALL ITM funge da sottostante).
 * - CC sintetica con syntheticPut:                          strike_PUT × |qty_PUT| × 100
 * - DR-CC sintetica con syntheticPut + protectionPut: (strike_synPut − strike_protPut) × contracts × 100
 */
export function calculateSyntheticCcDrccRisk(
  coveredCalls: CoveredCallPosition[],
  deRiskingCoveredCalls: DeRiskingCoveredCallPosition[],
  spotResolver?: SpotResolver
): StockRiskDetail[] {
  const result: StockRiskDetail[] = [];

  // Avoid double-counting: skip plain CCs whose option is already part of a DR-CC
  const drccCcOptionIds = new Set(deRiskingCoveredCalls.map(dr => dr.coveredCall.option.id));

  const buildEntry = (
    refPosition: Position,
    underlyingName: string,
    riskOriginal: number,
    syntheticType: 'cc_put' | 'cc_call' | 'drcc_put' | 'drcc_call',
    composition: string,
    syntheticBreakdown?: StockRiskDetail['syntheticBreakdown']
  ): StockRiskDetail => {
    const exchangeRate = getEffectiveExchangeRate(refPosition);
    const currency = refPosition.currency || 'USD';
    const identity = resolveUnderlyingIdentity({
      rawTicker: refPosition.ticker,
      rawName: underlyingName,
      underlyingName,
      description: refPosition.description,
    });
    return {
      underlying: underlyingName,
      tickerKey: identity.tickerKey,
      stockValue: 0,
      stockQuantity: 0,
      stockPrice: 0,
      protectionStrike: null,
      protectionContracts: 0,
      protectionOptionPrice: null,
      protectedValue: 0,
      riskOriginal,
      riskEUR: riskOriginal / exchangeRate,
      currency,
      exchangeRate,
      hasProtection: false,
      isETF: false,
      isSynthetic: true,
      syntheticType,
      composition,
      syntheticBreakdown,
    };
  };

  // Shared helper for CC syntheticCall logic (also used by DR-CC syntheticCall)
  const buildCallBasedEntry = (
    longCall: Position,
    shortStrike: number,
    underlyingName: string,
    shortCallTicker: string | null,
    protectionPutStrike: number | null
  ): StockRiskDetail => {
    const qty = longCall.quantity || 0;
    const longStrike = longCall.strike_price || 0;
    const pmc = longCall.avg_cost || 0;
    const mkt = longCall.current_price ?? pmc;
    const spot = spotResolver
      ? spotResolver(underlyingName, longCall.ticker ?? shortCallTicker ?? null)
      : null;

    let pricePerShare: number;
    let priceLabel: string;
    let priceSource: 'PMC' | 'mkt';
    if (spot != null && spot > shortStrike) {
      pricePerShare = pmc;
      priceLabel = `PMC ${pmc.toFixed(2)}`;
      priceSource = 'PMC';
    } else if (spot != null) {
      pricePerShare = mkt;
      priceLabel = `mkt ${mkt.toFixed(2)}`;
      priceSource = 'mkt';
    } else {
      pricePerShare = mkt;
      priceLabel = `mkt ${mkt.toFixed(2)}`;
      priceSource = 'mkt';
    }

    const riskOriginal = pricePerShare * qty * 100;
    const spotPart = spot != null ? ` (spot ${spot.toFixed(2)})` : '';
    const protPart = protectionPutStrike != null && protectionPutStrike > 0
      ? ` + Protezione PUT ${protectionPutStrike}`
      : '';
    const composition = `Long CALL ${longStrike} ITM (${priceLabel}) + Short CALL ${shortStrike}${spotPart}${protPart}`;
    return buildEntry(longCall, underlyingName, riskOriginal, 'cc_call', composition, {
      qty,
      longStrike,
      shortStrike,
      pmc,
      mkt,
      spot,
      pricePerShare,
      priceSource,
      protPutStrike: protectionPutStrike ?? undefined,
    });
  };

  // Synthetic Covered Calls
  for (const cc of coveredCalls) {
    if (!cc.isSynthetic) continue;
    if (drccCcOptionIds.has(cc.option.id)) continue; // Will be counted in DR-CC

    const shortCall = cc.option;
    const shortStrike = shortCall.strike_price || 0;
    const underlyingName = shortCall.underlying || shortCall.description || '';

    if (cc.syntheticCall) {
      result.push(buildCallBasedEntry(cc.syntheticCall, shortStrike, underlyingName, shortCall.ticker ?? null, null));
    } else if (cc.syntheticPut) {
      const qty = Math.abs(cc.syntheticPut.quantity || 0);
      const strike = cc.syntheticPut.strike_price || 0;
      const riskOriginal = strike * qty * 100;
      const composition = `Short PUT ${strike} ITM + Short CALL ${shortStrike}`;
      result.push(buildEntry(cc.syntheticPut, underlyingName, riskOriginal, 'cc_put', composition, {
        putStrike: strike,
        putQty: qty,
        shortStrike,
      }));
    }
  }

  // Synthetic De-Risking Covered Calls
  for (const dr of deRiskingCoveredCalls) {
    if (!dr.isSynthetic) continue;

    const shortCall = dr.coveredCall.option;
    const shortStrike = shortCall.strike_price || 0;
    const contracts = dr.coveredCall.contractsCovered || 0;
    const underlyingName = shortCall.underlying || shortCall.description || '';
    const protStrike = dr.protectionPut?.strike_price || 0;

    if (dr.syntheticCall) {
      // Per spec: Long CALL ITM + Short CALL è SEMPRE trattata come CC sintetica,
      // anche se in DB esiste una protection PUT (irrilevante in questa configurazione).
      result.push(buildCallBasedEntry(
        dr.syntheticCall,
        shortStrike,
        underlyingName,
        shortCall.ticker ?? null,
        protStrike > 0 ? protStrike : null
      ));
    } else if (dr.syntheticPut) {
      const synStrike = dr.syntheticPut.strike_price || 0;
      const perShare = Math.max(0, synStrike - protStrike);
      const riskOriginal = perShare * contracts * 100;
      const composition = `Short PUT ${synStrike} ITM + Short CALL ${shortStrike} + Protezione PUT ${protStrike}`;
      result.push(buildEntry(dr.syntheticPut, underlyingName, riskOriginal, 'drcc_put', composition, {
        synPutStrike: synStrike,
        protPutStrike: protStrike,
        shortStrike,
        contracts,
        perShare,
      }));
    }
  }


  return result;
}


/**
 * Main function: analyze portfolio risk across all categories.
 */
export function analyzePortfolioRisk(
  positions: Position[],
  categories: DerivativeCategories,
  spotResolver?: SpotResolver
): RiskAnalysis {
  // Get stock/ETF positions (excluding commodities and bonds)
  const stockAssetTypes = ['stock', 'etf'];
  const stocks = positions.filter(p => stockAssetTypes.includes(p.asset_type));
  const commodities = positions.filter(p => p.asset_type === 'commodity');
  const bonds = positions.filter(p => p.asset_type === 'bond');

  // Default spot resolver: lookup matching stock/ETF by name in positions
  const resolver: SpotResolver = spotResolver || ((underlyingName: string) => {
    const target = (underlyingName || '').toUpperCase();
    const match = stocks.find(s => {
      const t = (s.ticker || '').toUpperCase();
      const d = (s.description || '').toUpperCase();
      return (t && target.includes(t)) || (d && (target.includes(d) || d.includes(target)));
    });
    if (!match) return null;
    const px = (match as any).snapshot_price ?? match.current_price ?? null;
    return typeof px === 'number' && px > 0 ? px : null;
  });

  const stockDetails = calculateStockRisk(stocks, categories.longPuts, categories.coveredCalls, categories.deRiskingCoveredCalls, positions);
  const syntheticCcDrccDetails = calculateSyntheticCcDrccRisk(categories.coveredCalls, categories.deRiskingCoveredCalls, resolver);
  const commodityDetails = calculateCommodityRisk(commodities);
  const bondDetails = calculateBondRisk(bonds);

  const filteredNakedPuts = categories.nakedPuts.filter(
    np => !isEuroforexInstrument(np.option.underlying || np.option.description)
  );
  const nakedPutDetails = calculateNakedPutRisk(filteredNakedPuts);
  const filteredLeapCalls = categories.leapCalls.filter(
    lc => !isEuroforexInstrument(lc.option.underlying || lc.option.description)
  );
  const leapCallDetails = calculateLeapCallRisk(filteredLeapCalls);
  const strategyDetails = calculateStrategyRisk(categories);

  // Totali: stockDetails contiene SOLO stock/ETF reali. Sintetiche separate.
  const totalETFRisk = stockDetails.filter(s => s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalPureStockRisk = stockDetails.filter(s => !s.isETF).reduce((sum, s) => sum + s.riskEUR, 0);
  const totalStockRisk = totalETFRisk + totalPureStockRisk;
  const totalCommodityRisk = commodityDetails.reduce((sum, c) => sum + c.riskEUR, 0);
  const totalBondRisk = bondDetails.reduce((sum, b) => sum + b.riskEUR, 0);
  const totalNakedPutRisk = nakedPutDetails.reduce((sum, n) => sum + n.riskEUR, 0);
  const totalLeapCallRisk = leapCallDetails.reduce((sum, l) => sum + l.riskEUR, 0);
  const totalStrategyRisk = strategyDetails.reduce((sum, s) => sum + s.maxLossEUR, 0);
  const totalSyntheticCcDrccRisk = syntheticCcDrccDetails.reduce((sum, s) => sum + s.riskEUR, 0);
  const grandTotal = totalStockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk + totalSyntheticCcDrccRisk;

  return {
    totalStockRisk,
    totalETFRisk,
    totalPureStockRisk,
    totalCommodityRisk,
    totalBondRisk,
    totalNakedPutRisk,
    totalLeapCallRisk,
    totalStrategyRisk,
    totalSyntheticCcDrccRisk,
    grandTotal,
    stockDetails,
    syntheticCcDrccDetails,
    commodityDetails,
    bondDetails,
    nakedPutDetails,
    leapCallDetails,
    strategyDetails
  };
}

/**
 * Calculate commodity risk.
 * Formula: Quantità × Prezzo / Cambio (no protection available for commodities)
 */
export function calculateCommodityRisk(
  commodities: Position[]
): CommodityRiskDetail[] {
  return commodities.map(commodity => {
    const quantity = commodity.quantity || 0;
    const price = commodity.current_price || 0;
    const value = quantity * price;
    const exchangeRate = getEffectiveExchangeRate(commodity);
    const currency = commodity.currency || 'USD';
    
    return {
      underlying: commodity.ticker || commodity.description,
      value,
      quantity,
      price,
      riskOriginal: value,
      riskEUR: value / exchangeRate,
      currency,
      exchangeRate
    };
  });
}

/**
 * Calculate bond risk.
 * Formula: Quantità × Prezzo / Cambio (no protection available for bonds)
 */
export function calculateBondRisk(
  bonds: Position[]
): BondRiskDetail[] {
  return bonds.map(bond => {
    const quantity = bond.quantity || 0;
    const price = bond.current_price || 0;
    // Bonds are quoted as percentage of face value (e.g., 98.5 = 98.5% of 100)
    // So we multiply by quantity and divide by 100 to get actual value
    const value = (quantity * price) / 100;
    const exchangeRate = getEffectiveExchangeRate(bond);
    const currency = bond.currency || 'EUR';
    
    return {
      underlying: bond.ticker || bond.description,
      value,
      quantity,
      price,
      riskOriginal: value,
      riskEUR: value / exchangeRate,
      currency,
      exchangeRate
    };
  });
}
