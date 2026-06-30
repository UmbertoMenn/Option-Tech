/**
 * Canonical Monitoring Engine
 * 
 * Single source of truth for "Posizioni da monitorare".
 * All monitoring data (card, snapshot, briefing, alerts) derives from this engine.
 * 
 * Key principle: counts (sold calls, shares, contracts) come from RAW positions,
 * not from categories (which may be incomplete in config-only mode).
 * Status checks (ITM, OOR, OOB) come from categories (which are correct for configured strategies).
 */

import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { 
  DerivativeCategories, 
  normalizeForMatching, 
  getCanonicalKey 
} from './derivativeStrategies';
import { StrategyConfiguration, PositionSignature } from '@/hooks/useStrategyConfigurations';

// ============ Types ============

export interface MonitoringUncoveredCall {
  ticker: string;
  uncoveredContracts: number;
  strategies: string[];
}

export interface MonitoringCoveredCallITM {
  ticker: string;
  strike: number;
  contracts: number;
  isDeRisking: boolean;
}

export interface MonitoringDDOOR {
  ticker: string;
  isAlternative: boolean;
}

export interface MonitoringICOOR {
  ticker: string;
}

export interface MonitoringNakedPutITM {
  ticker: string;
  strike: number;
  contracts: number;
}

export interface MonitoringLeapGain {
  ticker: string;
  strike: number;
  contracts: number;
}

export interface MonitoringOtherOOROOB {
  ticker: string;
  strategyName: string;
  status: 'OOR' | 'OOB';
}

export interface MonitoringAvailableCalls {
  ticker: string;
  availableShares: number;
}

export interface MonitoringIncompleteStrategy {
  ticker: string;
  strategyName: string;        // "Iron Condor", "Double Diagonal", "Covered Call", ...
  missingLegs: string[];
}

export interface MonitoringResult {
  uncoveredCalls: MonitoringUncoveredCall[];
  coveredCallsITM: MonitoringCoveredCallITM[];
  doubleDiagonalOOR: MonitoringDDOOR[];
  ironCondorOOR: MonitoringICOOR[];
  nakedPutsITM: MonitoringNakedPutITM[];
  leapCallsInGain: MonitoringLeapGain[];
  otherStrategiesOOROOB: MonitoringOtherOOROOB[];
  incompleteMultiLegStrategies: MonitoringIncompleteStrategy[];
  availableCallsToSell: MonitoringAvailableCalls[];
}

// ============ Helpers ============

function getMatchingKey(text: string): string {
  return getCanonicalKey(text) || normalizeForMatching(text);
}

/** Cache per evitare iterazioni ripetute su underlyingPrices */
let _resolveCachePricesRef: Record<string, UnderlyingPrice> | null = null;
let _resolveCache = new Map<string, string | null>();

function resolveTickerFromPrices(
  text: string,
  underlyingPrices: Record<string, UnderlyingPrice>
): string | null {
  // Invalidate cache if underlyingPrices object changed
  if (_resolveCachePricesRef !== underlyingPrices) {
    _resolveCachePricesRef = underlyingPrices;
    _resolveCache = new Map();
  }

  if (_resolveCache.has(text)) return _resolveCache.get(text)!;

  // 1. Exact lookup O(1)
  if (underlyingPrices[text]?.ticker) {
    _resolveCache.set(text, underlyingPrices[text].ticker);
    return underlyingPrices[text].ticker;
  }

  // 2. Normalized fallback — handles broker prefixes (AZ.), name variations, aliases
  const norm = normalizeForMatching(text);
  const canon = getCanonicalKey(text);

  for (const [key, data] of Object.entries(underlyingPrices)) {
    if (!data.ticker) continue;
    if (canon && getCanonicalKey(key) === canon) {
      _resolveCache.set(text, data.ticker);
      return data.ticker;
    }
    if (normalizeForMatching(key) === norm) {
      _resolveCache.set(text, data.ticker);
      return data.ticker;
    }
  }

  _resolveCache.set(text, null);
  return null;
}

function getDisplayTicker(
  underlyingOrDesc: string,
  underlyingPrices: Record<string, UnderlyingPrice>,
  fallbackTicker?: string | null
): string {
  const resolved = resolveTickerFromPrices(underlyingOrDesc, underlyingPrices);
  if (resolved) return resolved;
  if (fallbackTicker) return fallbackTicker;
  return underlyingOrDesc.split(' ')[0] || 'N/A';
}

function resolveKey(text: string, underlyingPrices: Record<string, UnderlyingPrice>): string {
  const resolved = resolveTickerFromPrices(text, underlyingPrices);
  if (resolved) return resolved.toUpperCase();
  return getMatchingKey(text);
}

/**
 * Resolve a stock position to a canonical key + display ticker.
 * Tries description first (handles AZ. prefix, SPECIAL_ALIASES), then ticker, then fallback.
 */
function resolveStockKey(
  stock: Position,
  underlyingPrices: Record<string, UnderlyingPrice>,
): { key: string; display: string } {
  // 1. Try description first (handles AZ. prefix, matches SPECIAL_ALIASES)
  if (stock.description) {
    const resolved = resolveTickerFromPrices(stock.description, underlyingPrices);
    if (resolved) return { key: resolved.toUpperCase(), display: resolved };
  }
  // 2. Try ticker resolution (handles 9PDA.SG → PDD via canonical key)
  if (stock.ticker) {
    const resolved = resolveTickerFromPrices(stock.ticker, underlyingPrices);
    if (resolved) return { key: resolved.toUpperCase(), display: resolved };
  }
  // 3. Fallback to raw ticker or description
  const fallback = stock.ticker || stock.description?.split(' ')[0] || 'N/A';
  return { key: fallback.toUpperCase(), display: fallback };
}

// ============ Engine ============

/**
 * Compute all monitoring data from raw inputs.
 * 
 * @param categories - Output of categorizeDerivatives() (config-driven)
 * @param allPositions - ALL positions in the portfolio (stock + derivative)
 * @param stockPositions - Only stock/ETF positions
 * @param underlyingPrices - Price data keyed by underlying name
 * @param configs - Strategy configurations (for slot tracking)
 */
export function computeMonitoring(
  categories: DerivativeCategories,
  allPositions: Position[],
  stockPositions: Position[],
  underlyingPrices: Record<string, UnderlyingPrice>,
  configs: StrategyConfiguration[],
  archivedKeys?: string[],
): MonitoringResult {
  return {
    uncoveredCalls: computeUncoveredCalls(allPositions, stockPositions, underlyingPrices, categories),
    coveredCallsITM: computeCoveredCallsITM(categories, underlyingPrices),
    doubleDiagonalOOR: computeDDOOR(categories, underlyingPrices),
    ironCondorOOR: computeICOOR(categories, underlyingPrices),
    nakedPutsITM: computeNakedPutsITM(categories, underlyingPrices),
    leapCallsInGain: computeLeapGain(categories, underlyingPrices),
    otherStrategiesOOROOB: computeOtherOOROOB(categories, underlyingPrices),
    incompleteMultiLegStrategies: computeIncompleteMultiLeg(categories, underlyingPrices),
    availableCallsToSell: computeAvailableCalls(allPositions, stockPositions, underlyingPrices, configs, archivedKeys, categories),
  };
}

/**
 * 1. Uncovered Calls — uses RAW positions to count ALL sold calls vs shares owned.
 * This avoids missing unconfigured sold calls.
 */
function computeUncoveredCalls(
  allPositions: Position[],
  stockPositions: Position[],
  underlyingPrices: Record<string, UnderlyingPrice>,
  categories: DerivativeCategories,
): MonitoringUncoveredCall[] {
  const balance = new Map<string, { owned: number; netSoldCalls: number; syntheticCovered: number; displayTicker: string }>();

  const ensure = (key: string, displayTicker?: string) => {
    if (!balance.has(key)) {
      balance.set(key, { owned: 0, netSoldCalls: 0, syntheticCovered: 0, displayTicker: displayTicker || key });
    }
  };

  // Count shares
  for (const stock of stockPositions) {
    const { key, display } = resolveStockKey(stock, underlyingPrices);
    ensure(key, display);
    balance.get(key)!.owned += stock.quantity;
  }

  // Build set di id di long calls usate come synthetic underlying (vanno escluse
  // dal decremento, perché contate separatamente via syntheticCovered).
  const syntheticCallIds = new Set<string>();
  for (const cc of categories.coveredCalls) {
    if (cc.isSynthetic && cc.syntheticCall) syntheticCallIds.add(cc.syntheticCall.id);
  }
  for (const dr of categories.deRiskingCoveredCalls) {
    if (dr.isSynthetic && dr.syntheticCall) syntheticCallIds.add(dr.syntheticCall.id);
  }

  // Count ALL sold and bought calls from raw derivative positions
  const derivatives = allPositions.filter(p => p.asset_type === 'derivative' && p.option_type === 'call');
  for (const d of derivatives) {
    const underlyingText = d.underlying || d.description || '';
    const key = resolveKey(underlyingText, underlyingPrices);
    ensure(key);
    if (d.quantity < 0) {
      balance.get(key)!.netSoldCalls += Math.abs(d.quantity);
    } else if (!syntheticCallIds.has(d.id)) {
      balance.get(key)!.netSoldCalls -= d.quantity; // bought calls offset (skip synthetic)
    }
  }

  // Count synthetic covered contracts (deep ITM sold puts or bought calls acting as stock)
  for (const cc of categories.coveredCalls) {
    if (cc.isSynthetic) {
      const underlyingKey = cc.option.underlying || '';
      const key = resolveKey(underlyingKey, underlyingPrices);
      ensure(key);
      balance.get(key)!.syntheticCovered += cc.contractsCovered;
    }
  }
  for (const dr of categories.deRiskingCoveredCalls) {
    if (dr.isSynthetic) {
      const underlyingKey = dr.coveredCall.option.underlying || '';
      const key = resolveKey(underlyingKey, underlyingPrices);
      ensure(key);
      balance.get(key)!.syntheticCovered += dr.coveredCall.contractsCovered;
    }
  }

  const result: MonitoringUncoveredCall[] = [];
  for (const [, data] of balance) {
    const coveredContracts = Math.floor(data.owned / 100) + data.syntheticCovered;
    const net = Math.max(0, data.netSoldCalls); // don't go negative
    if (net > coveredContracts) {
      result.push({
        ticker: data.displayTicker,
        uncoveredContracts: net - coveredContracts,
        strategies: [],
      });
    }
  }

  return result.sort((a, b) => b.uncoveredContracts - a.uncoveredContracts);
}

/**
 * 2. Covered Call ITM — from categories (config-driven, correct for configured strategies)
 */
function computeCoveredCallsITM(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringCoveredCallITM[] {
  const result: MonitoringCoveredCallITM[] = [];

  categories.coveredCalls.forEach(cc => {
    const strike = cc.option.strike_price || 0;
    const underlyingKey = cc.option.underlying || '';
    const price = underlyingPrices[underlyingKey]?.price || 0;
    if (price > 0 && strike < price) {
      result.push({
        ticker: getDisplayTicker(underlyingKey, underlyingPrices, cc.underlying.ticker),
        strike,
        contracts: cc.contractsCovered,
        isDeRisking: false,
      });
    }
  });

  categories.deRiskingCoveredCalls.forEach(dr => {
    const cc = dr.coveredCall;
    const strike = cc.option.strike_price || 0;
    const underlyingKey = cc.option.underlying || '';
    const price = underlyingPrices[underlyingKey]?.price || 0;
    if (price > 0 && strike < price) {
      result.push({
        ticker: getDisplayTicker(underlyingKey, underlyingPrices, cc.underlying.ticker),
        strike,
        contracts: cc.contractsCovered,
        isDeRisking: true,
      });
    }
  });

  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 3. Double Diagonal OOR
 */
function computeDDOOR(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringDDOOR[] {
  const result: MonitoringDDOOR[] = [];

  categories.doubleDiagonals.forEach(dd => {
    const price = underlyingPrices[dd.underlying]?.price || 0;
    if (price > 0) {
      const sp = dd.soldPut.strike_price || 0;
      const sc = dd.soldCall.strike_price || 0;
      if (!(price >= sp && price <= sc)) {
        result.push({ ticker: getDisplayTicker(dd.underlying, underlyingPrices), isAlternative: false });
      }
    }
  });

  categories.groupedOtherStrategies
    .filter(g => g.strategyName === 'Alternative Double Diagonal')
    .forEach(group => {
      const price = underlyingPrices[group.underlying]?.price || 0;
      if (price > 0) {
        const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
        const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
        if (soldPut && soldCall) {
          const sp = soldPut.option.strike_price || 0;
          const sc = soldCall.option.strike_price || 0;
          if (!(price >= sp && price <= sc)) {
            result.push({ ticker: getDisplayTicker(group.underlying, underlyingPrices), isAlternative: true });
          }
        }
      }
    });

  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 4. Iron Condor OOR
 */
function computeICOOR(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringICOOR[] {
  const result: MonitoringICOOR[] = [];
  categories.ironCondors.forEach(ic => {
    const price = underlyingPrices[ic.underlying]?.price || 0;
    if (price > 0) {
      const sp = ic.soldPut.strike_price || 0;
      const sc = ic.soldCall.strike_price || 0;
      if (!(price >= sp && price <= sc)) {
        result.push({ ticker: getDisplayTicker(ic.underlying, underlyingPrices) });
      }
    }
  });
  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 5. Naked Put ITM
 */
function computeNakedPutsITM(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringNakedPutITM[] {
  const result: MonitoringNakedPutITM[] = [];
  categories.nakedPuts.forEach(np => {
    const strike = np.option.strike_price || 0;
    const underlyingKey = np.option.underlying || np.option.description;
    const price = (np.option.underlying ? underlyingPrices[np.option.underlying]?.price : 0) || 0;
    if (price > 0 && strike > price) {
      result.push({
        ticker: getDisplayTicker(underlyingKey, underlyingPrices, np.option.ticker),
        strike,
        contracts: np.contracts,
      });
    }
  });
  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 6. Leap Call in Gain
 */
function computeLeapGain(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringLeapGain[] {
  const result: MonitoringLeapGain[] = [];
  categories.leapCalls.forEach(lc => {
    const currentPrice = lc.option.current_price || 0;
    const avgCost = lc.option.avg_cost || 0;
    if (avgCost > 0 && currentPrice > avgCost) {
      const underlyingKey = lc.option.underlying || lc.option.description;
      result.push({
        ticker: getDisplayTicker(underlyingKey, underlyingPrices, lc.option.ticker),
        strike: lc.option.strike_price || 0,
        contracts: lc.contracts,
      });
    }
  });
  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 7. Other Strategies OOR/OOB
 */
function computeOtherOOROOB(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringOtherOOROOB[] {
  const result: MonitoringOtherOOROOB[] = [];
  const rangeBasedStrategies = ['Short Strangle', 'Put Spread', 'Call Spread', 'Diagonal Put Spread', 'Diagonal Call Spread'];

  categories.groupedOtherStrategies
    .filter(g => g.strategyName && g.strategyName !== 'Alternative Double Diagonal')
    .forEach(group => {
      const price = underlyingPrices[group.underlying]?.price || 0;
      if (price <= 0) return;

      const strategyName = group.strategyName || 'Strategia';
      const isRangeBased = rangeBasedStrategies.some(s => strategyName.includes(s));

      let isInBadState = false;
      let status: 'OOR' | 'OOB';

      if (isRangeBased) {
        status = 'OOR';
        if (strategyName.includes('Short Strangle')) {
          const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
          const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
          if (soldPut && soldCall) {
            const sp = soldPut.option.strike_price || 0;
            const sc = soldCall.option.strike_price || 0;
            isInBadState = !(price >= sp && price <= sc);
          }
        } else if (strategyName.includes('Put Spread') || strategyName.includes('Diagonal Put Spread')) {
          const soldPut = group.options.find(o => o.option.option_type === 'put' && o.option.quantity < 0);
          if (soldPut) isInBadState = price < (soldPut.option.strike_price || 0);
        } else if (strategyName.includes('Call Spread') || strategyName.includes('Diagonal Call Spread')) {
          const soldCall = group.options.find(o => o.option.option_type === 'call' && o.option.quantity < 0);
          if (soldCall) isInBadState = price > (soldCall.option.strike_price || 0);
        }
      } else {
        status = 'OOB';
        isInBadState = group.totalProfitLoss < 0;
      }

      if (isInBadState) {
        result.push({
          ticker: getDisplayTicker(group.underlying, underlyingPrices),
          strategyName: strategyName.replace('Alternative ', '').replace('Diagonal ', 'Diag. '),
          status,
        });
      }
    });

  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * 8. Call da rivendere — uses RAW positions + configs for accurate counting.
 * 
 * Logic: for each stock position, count total shares. Then count ALL sold calls
 * from raw derivative positions for that underlying. Available = floor(shares/100) - soldCalls.
 * 
 * This avoids the bug where config-only mode drops some sold calls from categories,
 * making it look like more shares are available than they actually are.
 */
function computeAvailableCalls(
  allPositions: Position[],
  stockPositions: Position[],
  underlyingPrices: Record<string, UnderlyingPrice>,
  configs: StrategyConfiguration[],
  archivedKeys?: string[],
  categories?: DerivativeCategories,
): MonitoringAvailableCalls[] {
  // Build archived set using resolveKey for proper ticker matching
  const archivedResolved = new Set<string>();
  // Raw archived keys (as stored by the wizard: canonical or normalized)
  const archivedRaw = new Set<string>();
  for (const k of (archivedKeys || [])) {
    const trimmed = (k || '').trim();
    if (!trimmed) continue;
    archivedResolved.add(resolveKey(trimmed, underlyingPrices));
    archivedResolved.add(normalizeForMatching(trimmed));
    archivedRaw.add(trimmed.toUpperCase());
  }

  // Replica della logica wizard getUnderlyingKey per stock/etf
  const computeWizardStockKey = (stock: Position): string[] => {
    const out: string[] = [];
    const desc = stock.description ?? '';
    const tkr = stock.ticker ?? '';
    const full = `${desc} ${tkr}`.trim();
    const c1 = getCanonicalKey(full);
    if (c1) out.push(c1.toUpperCase());
    const c2 = getCanonicalKey(desc);
    if (c2) out.push(c2.toUpperCase());
    out.push(normalizeForMatching(full).toUpperCase());
    out.push(normalizeForMatching(desc).toUpperCase());
    return out;
  };

  const balance = new Map<string, { owned: number; soldCalls: number; syntheticCovered: number; displayTicker: string; stockKeys: string[] }>();

  const ensure = (key: string, displayTicker?: string, stockKeys?: string[]) => {
    if (!balance.has(key)) {
      balance.set(key, { owned: 0, soldCalls: 0, syntheticCovered: 0, displayTicker: displayTicker || key, stockKeys: stockKeys || [] });
    } else if (stockKeys && stockKeys.length) {
      const cur = balance.get(key)!;
      cur.stockKeys = Array.from(new Set([...cur.stockKeys, ...stockKeys]));
    }
  };

  // Count shares
  for (const stock of stockPositions) {
    const { key, display } = resolveStockKey(stock, underlyingPrices);
    ensure(key, display, computeWizardStockKey(stock));
    balance.get(key)!.owned += stock.quantity;
  }

  // Count ALL sold calls from RAW derivative positions (not categories)
  const soldCalls = allPositions.filter(
    p => p.asset_type === 'derivative' && p.option_type === 'call' && p.quantity < 0
  );
  for (const d of soldCalls) {
    const underlyingText = d.underlying || d.description || '';
    const key = resolveKey(underlyingText, underlyingPrices);
    ensure(key);
    balance.get(key)!.soldCalls += Math.abs(d.quantity);
  }

  // Aggiunge le componenti sintetiche di CC e DR-CC come "share equivalent":
  // - Long Call ITM (syntheticCall) ⇒ +|quantity| contratti coperti
  // - Short Put ITM (syntheticPut)  ⇒ +|quantity| contratti coperti
  if (categories) {
    const addSynth = (underlyingText: string, qty: number) => {
      const key = resolveKey(underlyingText, underlyingPrices);
      ensure(key);
      balance.get(key)!.syntheticCovered += qty;
    };
    for (const cc of categories.coveredCalls) {
      if (!cc.isSynthetic) continue;
      const underlyingText = cc.option.underlying || cc.option.description || '';
      if (cc.syntheticCall) addSynth(underlyingText, Math.abs(cc.syntheticCall.quantity));
      if (cc.syntheticPut) addSynth(underlyingText, Math.abs(cc.syntheticPut.quantity));
    }
    for (const dr of categories.deRiskingCoveredCalls) {
      if (!dr.isSynthetic) continue;
      const underlyingText = dr.coveredCall.option.underlying || dr.coveredCall.option.description || '';
      if (dr.syntheticCall) addSynth(underlyingText, Math.abs(dr.syntheticCall.quantity));
      if (dr.syntheticPut) addSynth(underlyingText, Math.abs(dr.syntheticPut.quantity));
    }
    // Incomplete synthetic CC/DR-CC (Short Call mancante): la long call / short put
    // sintetica c'è già ed è una "share equivalent" — va contata.
    for (const inc of categories.incompleteStrategies) {
      if (!inc.isSynthetic) continue;
      if (inc.strategyType !== 'covered_call' && inc.strategyType !== 'derisking_covered_call') continue;
      const longCall = inc.presentLegs.find(p => p.option_type === 'call' && p.quantity > 0);
      const shortPut = inc.presentLegs.find(p => p.option_type === 'put' && p.quantity < 0);
      if (longCall) addSynth(inc.underlying, Math.abs(longCall.quantity));
      else if (shortPut) addSynth(inc.underlying, Math.abs(shortPut.quantity));
    }
  }

  const result: MonitoringAvailableCalls[] = [];
  for (const [key, data] of balance) {
    // Skip archived underlyings
    if (archivedResolved.size > 0 || archivedRaw.size > 0) {
      if (
        archivedResolved.has(key) ||
        archivedResolved.has(normalizeForMatching(key)) ||
        archivedResolved.has(normalizeForMatching(data.displayTicker)) ||
        archivedRaw.has(key.toUpperCase()) ||
        data.stockKeys.some(sk => archivedRaw.has(sk))
      ) continue;
    }
    const potential = Math.floor(data.owned / 100) + data.syntheticCovered;
    const available = potential - data.soldCalls;
    if (available >= 1) {
      result.push({ ticker: data.displayTicker, availableShares: available * 100 });
    }
  }


  return result.sort((a, b) => b.availableShares - a.availableShares);
}

/**
 * 9. Strategie multi-gamba incomplete (config-only).
 */
function computeIncompleteMultiLeg(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>,
): MonitoringIncompleteStrategy[] {
  const STRATEGY_LABELS: Record<string, string> = {
    covered_call: 'Covered Call',
    derisking_covered_call: 'De-Risking CC',
    iron_condor: 'Iron Condor',
    double_diagonal: 'Double Diagonal',
  };
  const result: MonitoringIncompleteStrategy[] = [];
  for (const inc of categories.incompleteStrategies || []) {
    result.push({
      ticker: getDisplayTicker(inc.underlying, underlyingPrices),
      strategyName: STRATEGY_LABELS[inc.strategyType] || inc.strategyType,
      missingLegs: inc.missingLegs,
    });
  }
  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ============ Snapshot builder (for monitoring_snapshot table) ============

export function buildSnapshotSections(monitoring: MonitoringResult): { title: string; emoji: string; badge?: string; items: string[] }[] {
  const sections: { title: string; emoji: string; badge?: string; items: string[] }[] = [];

  if (monitoring.uncoveredCalls.length > 0) {
    sections.push({
      title: 'Call non coperte',
      emoji: 'red',
      items: monitoring.uncoveredCalls.map(uc => `${uc.ticker}: ${uc.uncoveredContracts}NC`),
    });
  }
  if (monitoring.coveredCallsITM.length > 0) {
    sections.push({
      title: 'Covered Call',
      emoji: 'amber',
      badge: 'ITM',
      items: monitoring.coveredCallsITM.map(cc => `${cc.isDeRisking ? 'DR ' : ''}${cc.ticker} $${cc.strike} ×${cc.contracts}`),
    });
  }
  if (monitoring.doubleDiagonalOOR.length > 0) {
    sections.push({
      title: 'Double Diagonal',
      emoji: 'purple',
      badge: 'OOR',
      items: monitoring.doubleDiagonalOOR.map(dd => `${dd.ticker}${dd.isAlternative ? ' (Alt)' : ''}`),
    });
  }
  if (monitoring.ironCondorOOR.length > 0) {
    sections.push({
      title: 'Iron Condor',
      emoji: 'amber',
      badge: 'OOR',
      items: monitoring.ironCondorOOR.map(ic => ic.ticker),
    });
  }
  if (monitoring.nakedPutsITM.length > 0) {
    sections.push({
      title: 'Naked Put',
      emoji: 'orange',
      badge: 'ITM',
      items: monitoring.nakedPutsITM.map(np => `${np.ticker} $${np.strike} ×${np.contracts}`),
    });
  }
  if (monitoring.leapCallsInGain.length > 0) {
    sections.push({
      title: 'Leap Call',
      emoji: 'green',
      badge: 'G',
      items: monitoring.leapCallsInGain.map(lc => `${lc.ticker} $${lc.strike} ×${lc.contracts}`),
    });
  }
  if (monitoring.otherStrategiesOOROOB.length > 0) {
    sections.push({
      title: 'Altre Strategie',
      emoji: 'cyan',
      badge: 'OOR/OOB',
      items: monitoring.otherStrategiesOOROOB.map(os => `${os.ticker} ${os.strategyName} ${os.status}`),
    });
  }
  if (monitoring.incompleteMultiLegStrategies.length > 0) {
    sections.push({
      title: 'Strategie incomplete',
      emoji: 'orange',
      badge: 'MANCA GAMBA',
      items: monitoring.incompleteMultiLegStrategies.map(
        s => `${s.ticker} ${s.strategyName} (manca: ${s.missingLegs.join(', ')})`
      ),
    });
  }
  if (monitoring.availableCallsToSell.length > 0) {
    sections.push({
      title: 'Covered Call / D-R CC da rivendere',
      emoji: 'green',
      items: monitoring.availableCallsToSell.map(item => `${item.ticker} ${item.availableShares}az`),
    });
  }

  return sections;
}
