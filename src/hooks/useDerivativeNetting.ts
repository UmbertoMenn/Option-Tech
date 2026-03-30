import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';

export interface NettingBreakdownDetail {
  positionId: string;
  ticker: string;
  description: string;
  value: number;
  strike?: number;
  expiry?: string;
}

export interface NettingBreakdownItem {
  category: string;
  label: string;
  value: number;
  color: 'base' | 'cost' | 'gain' | 'total';
  details: NettingBreakdownDetail[];
}

export interface NettingResult {
  nettingExCoveredCall: number;
  nettingTotal: number;
  nettingExCCAndNP: number;
  breakdown: NettingBreakdownItem[];
}

export type StrategySectionCategory =
  | 'covered_call'
  | 'derisking_cc'
  | 'iron_condor'
  | 'double_diagonal'
  | 'naked_put'
  | 'put_spread'
  | 'diagonal_put_spread'
  | 'leap_call'
  | 'long_put'
  | 'other';

export const STRATEGY_SECTION_LABELS: Record<StrategySectionCategory, string> = {
  covered_call: 'Covered Call',
  derisking_cc: 'De-Risking CC',
  iron_condor: 'Iron Condor',
  double_diagonal: 'Double Diagonal',
  naked_put: 'Naked Put',
  put_spread: 'Put Spread',
  diagonal_put_spread: 'Diagonal Put Spread',
  leap_call: 'Leap Call',
  long_put: 'Protezioni',
  other: 'Altre Strategie',
};

function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

interface CategoryAccumulator {
  value: number;
  details: NettingBreakdownDetail[];
}

function makeAcc(): CategoryAccumulator {
  return { value: 0, details: [] };
}

/** Compute netting for a single portfolio's positions */
export function computeSinglePortfolioNetting(
  positions: Position[],
  overrides: DerivativeOverride[],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = []
): { totalNetting: number; nettingExCoveredCall: number; nettingExCCAndNP: number; breakdown: NettingBreakdownItem[] } {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  if (derivatives.length === 0) {
    return { totalNetting: 0, nettingExCoveredCall: 0, nettingExCCAndNP: 0, breakdown: [] };
  }

  const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);

  // Build position ID → category sets
  const positionCategory = new Map<string, StrategySectionCategory>();

  // Covered Calls
  for (const cc of categories.coveredCalls) {
    positionCategory.set(cc.option.id, 'covered_call');
    // synthetic put is part of CC too
    if (cc.syntheticPut) positionCategory.set(cc.syntheticPut.id, 'covered_call');
  }

  // De-Risking Covered Calls
  for (const dcc of categories.deRiskingCoveredCalls) {
    positionCategory.set(dcc.coveredCall.option.id, 'derisking_cc');
    positionCategory.set(dcc.protectionPut.id, 'derisking_cc');
    if (dcc.syntheticPut) positionCategory.set(dcc.syntheticPut.id, 'derisking_cc');
  }

  // Iron Condors
  for (const ic of categories.ironCondors) {
    [ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall].forEach(p => positionCategory.set(p.id, 'iron_condor'));
  }

  // Double Diagonals
  for (const dd of categories.doubleDiagonals) {
    [dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall].forEach(p => positionCategory.set(p.id, 'double_diagonal'));
  }

  // Naked Puts
  for (const np of categories.nakedPuts) {
    positionCategory.set(np.option.id, 'naked_put');
  }

  // Long Puts (Protezioni)
  for (const lp of categories.longPuts) {
    positionCategory.set(lp.option.id, 'long_put');
  }

  // Leap Calls
  for (const lc of categories.leapCalls) {
    positionCategory.set(lc.option.id, 'leap_call');
  }

  // Put Spread & Diagonal Put Spread from groupedOtherStrategies
  for (const group of categories.groupedOtherStrategies) {
    const configMatch = strategyConfigs.find(c =>
      c.underlying === group.underlying && (c.strategy_type === 'put_spread' || c.strategy_type === 'diagonal_put_spread')
    );
    let cat: StrategySectionCategory = 'other';
    if (configMatch?.strategy_type === 'put_spread' || (!configMatch && group.strategyName === 'Put Spread')) {
      cat = 'put_spread';
    } else if (configMatch?.strategy_type === 'diagonal_put_spread' || (!configMatch && group.strategyName === 'Diagonal Put Spread')) {
      cat = 'diagonal_put_spread';
    }
    for (const os of group.options) {
      // Only set if not already assigned (avoid overwriting)
      if (!positionCategory.has(os.option.id)) {
        positionCategory.set(os.option.id, cat);
      }
    }
  }

  // Any remaining otherStrategies not yet assigned
  for (const os of categories.otherStrategies) {
    if (!positionCategory.has(os.option.id)) {
      positionCategory.set(os.option.id, 'other');
    }
  }

  // Build coveredCall and nakedPut maps for intrinsic value calculations
  const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));
  const deRiskingCCMap = new Map(categories.deRiskingCoveredCalls.map(dcc => [dcc.coveredCall.option.id, dcc]));
  const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));

  // Accumulators per strategy section
  const acc: Record<StrategySectionCategory, CategoryAccumulator> = {
    covered_call: makeAcc(),
    derisking_cc: makeAcc(),
    iron_condor: makeAcc(),
    double_diagonal: makeAcc(),
    naked_put: makeAcc(),
    put_spread: makeAcc(),
    diagonal_put_spread: makeAcc(),
    leap_call: makeAcc(),
    long_put: makeAcc(),
    other: makeAcc(),
  };

  let totalNetting = 0;
  let nettingExCoveredCall = 0;
  let nettingExCCAndNP = 0;

  for (const derivative of derivatives) {
    const price = derivative.snapshot_price ?? derivative.current_price ?? 0;
    const quantity = derivative.quantity;
    const multiplier = 100;
    const exchangeRate = getEffectiveExchangeRate(derivative);
    const nettingValue = (price * quantity * multiplier) / exchangeRate;

    const ticker = derivative.underlying || derivative.ticker || derivative.description || '?';
    const detail: NettingBreakdownDetail = {
      positionId: derivative.id,
      ticker,
      description: derivative.description,
      value: nettingValue,
      strike: derivative.strike_price ?? undefined,
      expiry: derivative.expiry_date ?? undefined,
    };

    totalNetting += nettingValue;

    const cat = positionCategory.get(derivative.id) || 'other';
    acc[cat].value += nettingValue;
    acc[cat].details.push(detail);

    const resolveUnderlyingPrice = (): number => {
      const key = derivative.underlying || derivative.description || '';
      // Try coveredCall underlying first
      const cc = coveredCallMap.get(derivative.id);
      if (cc) return cc.underlying.snapshot_price ?? cc.underlying.current_price ?? 0;
      // Try derisking CC
      const dcc = deRiskingCCMap.get(derivative.id);
      if (dcc) return dcc.coveredCall.underlying.snapshot_price ?? dcc.coveredCall.underlying.current_price ?? 0;
      // Try nakedPut underlying
      const np = nakedPutMap.get(derivative.id);
      if (np) {
        let p = np.underlying?.snapshot_price ?? np.underlying?.current_price ?? 0;
        if (p <= 0 && underlyingPrices) p = underlyingPrices[key]?.price ?? 0;
        return p;
      }
      // Fallback
      if (underlyingPrices) return underlyingPrices[key]?.price ?? 0;
      return 0;
    };

    // Calculate nettingExCoveredCall and nettingExCCAndNP
    if (cat === 'covered_call') {
      const cc = coveredCallMap.get(derivative.id);
      if (cc) {
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = cc.underlying.snapshot_price ?? cc.underlying.current_price ?? 0;
        if (strikePrice < underlyingPrice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          nettingExCoveredCall -= intrinsicValue;
          nettingExCCAndNP -= intrinsicValue;
        }
        // OTM covered calls: no contribution to ex CC / ex CC&NP
      } else {
        // synthetic put leg of CC - counts as full netting for ex calculations
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
      }
    } else if (cat === 'derisking_cc') {
      const dcc = deRiskingCCMap.get(derivative.id);
      if (dcc) {
        // The sold call leg: same logic as covered call for ex CC calculations
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = dcc.coveredCall.underlying.snapshot_price ?? dcc.coveredCall.underlying.current_price ?? 0;
        if (strikePrice < underlyingPrice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          nettingExCoveredCall -= intrinsicValue;
          nettingExCCAndNP -= intrinsicValue;
        }
      } else {
        // Protection put or synthetic put legs — full market value
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
      }
    } else if (cat === 'naked_put') {
      const np = nakedPutMap.get(derivative.id);
      nettingExCoveredCall += nettingValue;
      if (np) {
        const strikePrice = derivative.strike_price ?? 0;
        const uprice = resolveUnderlyingPrice();
        if (uprice > 0 && strikePrice < uprice) {
          // OTM naked put: no contribution to ex CC&NP
        } else if (uprice > 0 && strikePrice >= uprice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (strikePrice - uprice)) / exchangeRate;
          // Cap: intrinsic loss cannot exceed market value (cost to close)
          const cappedIntrinsic = Math.max(-intrinsicValue, nettingValue);
          nettingExCCAndNP += cappedIntrinsic;
        } else {
          nettingExCCAndNP += nettingValue;
        }
      } else {
        nettingExCCAndNP += nettingValue;
      }
    } else {
      // All other categories: full market value
      nettingExCoveredCall += nettingValue;
      nettingExCCAndNP += nettingValue;
    }
  }

  // Aggregate details by ticker within each category
  const allCategories: StrategySectionCategory[] = [
    'covered_call', 'derisking_cc', 'iron_condor', 'double_diagonal',
    'naked_put', 'put_spread', 'diagonal_put_spread', 'leap_call', 'long_put', 'other'
  ];

  for (const cat of allCategories) {
    const byTicker = new Map<string, NettingBreakdownDetail>();
    for (const d of acc[cat].details) {
      const key = d.ticker;
      const existing = byTicker.get(key);
      if (existing) {
        existing.value += d.value;
      } else {
        byTicker.set(key, { ...d, strike: undefined, expiry: undefined });
      }
    }
    acc[cat].details = [...byTicker.values()];
  }

  const breakdown: NettingBreakdownItem[] = [];
  for (const cat of allCategories) {
    const a = acc[cat];
    if (Math.abs(a.value) > 0.01 || a.details.length > 0) {
      breakdown.push({
        category: cat,
        label: STRATEGY_SECTION_LABELS[cat],
        value: a.value,
        color: a.value < 0 ? 'cost' : (a.value > 0 ? 'gain' : 'cost'),
        details: a.details,
      });
    }
  }

  return { totalNetting, nettingExCoveredCall, nettingExCCAndNP, breakdown };
}

export function useDerivativeNetting(
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  isGlobalAggregate: boolean = false,
  strategyConfigs: StrategyConfiguration[] = []
): NettingResult {
  return useMemo(() => {
    const emptyResult: NettingResult = {
      nettingExCoveredCall: summary?.totalValue ?? 0,
      nettingTotal: summary?.totalValue ?? 0,
      nettingExCCAndNP: summary?.totalValue ?? 0,
      breakdown: [],
    };

    if (!summary || positions.length === 0) return emptyResult;

    if (isGlobalAggregate) {
      const byPortfolio = new Map<string, Position[]>();
      positions.forEach(p => {
        if (!byPortfolio.has(p.portfolio_id)) byPortfolio.set(p.portfolio_id, []);
        byPortfolio.get(p.portfolio_id)!.push(p);
      });

      const overridesByPortfolio = new Map<string, DerivativeOverride[]>();
      overrides.forEach(o => {
        if (!overridesByPortfolio.has(o.portfolio_id)) overridesByPortfolio.set(o.portfolio_id, []);
        overridesByPortfolio.get(o.portfolio_id)!.push(o);
      });

      const configsByPortfolio = new Map<string, StrategyConfiguration[]>();
      strategyConfigs.forEach(c => {
        if (!configsByPortfolio.has(c.portfolio_id)) configsByPortfolio.set(c.portfolio_id, []);
        configsByPortfolio.get(c.portfolio_id)!.push(c);
      });

      let mergedTotalNetting = 0;
      let mergedNettingExCC = 0;
      let mergedNettingExCCAndNP = 0;
      const mergedBreakdown: NettingBreakdownItem[] = [];

      for (const [pid, pPositions] of byPortfolio) {
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const result = computeSinglePortfolioNetting(pPositions, pOverrides, underlyingPrices, pConfigs);
        mergedTotalNetting += result.totalNetting;
        mergedNettingExCC += result.nettingExCoveredCall;
        mergedNettingExCCAndNP += result.nettingExCCAndNP;
        mergedBreakdown.push(...result.breakdown);
      }

      const byCat = new Map<string, NettingBreakdownItem>();
      for (const item of mergedBreakdown) {
        const existing = byCat.get(item.category);
        if (existing) {
          existing.value += item.value;
          existing.details.push(...item.details);
        } else {
          byCat.set(item.category, { ...item, details: [...item.details] });
        }
      }

      return {
        nettingTotal: summary.totalValue + mergedTotalNetting,
        nettingExCoveredCall: summary.totalValue + mergedNettingExCC,
        nettingExCCAndNP: summary.totalValue + mergedNettingExCCAndNP,
        breakdown: [...byCat.values()].filter(b => Math.abs(b.value) > 0.01),
      };
    }

    const result = computeSinglePortfolioNetting(positions, overrides, underlyingPrices, strategyConfigs);

    return {
      nettingExCoveredCall: summary.totalValue + result.nettingExCoveredCall,
      nettingTotal: summary.totalValue + result.totalNetting,
      nettingExCCAndNP: summary.totalValue + result.nettingExCCAndNP,
      breakdown: result.breakdown,
    };
  }, [positions, summary, overrides, underlyingPrices, isGlobalAggregate, strategyConfigs]);
}

/**
 * Filters breakdown items based on the view mode and recalculates values
 * for categories that use intrinsic value instead of market value.
 */
export function getBreakdownForViewMode(
  breakdown: NettingBreakdownItem[],
  viewMode: 'netting_total' | 'netting_ex_cc' | 'netting_ex_cc_np',
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = []
): { items: NettingBreakdownItem[]; finalValue: number } {
  const baseValue = summary?.totalValue ?? 0;

  if (viewMode === 'netting_total') {
    const items = breakdown.filter(b => Math.abs(b.value) > 0.01);
    const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
    return { items, finalValue };
  }

  // For netting_ex_cc_np: recalculate covered_call, derisking_cc, naked_put with intrinsic values
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);
  const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));
  const deRiskingCCMap = new Map(categories.deRiskingCoveredCalls.map(dcc => [dcc.coveredCall.option.id, dcc]));
  const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));

  const result: NettingBreakdownItem[] = [];
  let nettingSum = 0;

  for (const item of breakdown) {
    // For covered_call and derisking_cc: show only intrinsic value of ITM options
    if (item.category === 'covered_call' || item.category === 'derisking_cc') {
      const lookupMap = item.category === 'covered_call' ? coveredCallMap : null;
      const dccMap = item.category === 'derisking_cc' ? deRiskingCCMap : null;

      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      // We need to go through original positions for this category
      for (const det of item.details) {
        // For aggregated details (by ticker), we need to recalculate from source
        // Find all CC/DCC entries matching this ticker
        let tickerIntrinsic = 0;

        if (lookupMap) {
          for (const [posId, ccEntry] of lookupMap) {
            const posTicker = ccEntry.option.underlying || ccEntry.option.ticker || ccEntry.option.description || '?';
            if (posTicker !== det.ticker) continue;
            const strike = ccEntry.option.strike_price ?? 0;
            const underlyingPrice = ccEntry.underlying.snapshot_price ?? ccEntry.underlying.current_price ?? 0;
            if (strike < underlyingPrice) {
              const contracts = Math.abs(ccEntry.option.quantity);
              const exchangeRate = getEffectiveExchangeRate(ccEntry.option);
              tickerIntrinsic += -(contracts * 100 * (underlyingPrice - strike)) / exchangeRate;
            }
          }
        }
        if (dccMap) {
          for (const [posId, dccEntry] of dccMap) {
            const posTicker = dccEntry.coveredCall.option.underlying || dccEntry.coveredCall.option.ticker || dccEntry.coveredCall.option.description || '?';
            if (posTicker !== det.ticker) continue;
            const strike = dccEntry.coveredCall.option.strike_price ?? 0;
            const underlyingPrice = dccEntry.coveredCall.underlying.snapshot_price ?? dccEntry.coveredCall.underlying.current_price ?? 0;
            if (strike < underlyingPrice) {
              const contracts = Math.abs(dccEntry.coveredCall.option.quantity);
              const exchangeRate = getEffectiveExchangeRate(dccEntry.coveredCall.option);
              tickerIntrinsic += -(contracts * 100 * (underlyingPrice - strike)) / exchangeRate;
            }
          }
          // Also include market value of protection put and synthetic put legs for this ticker
          for (const [, dccEntry] of dccMap) {
            const posTicker = dccEntry.protectionPut.underlying || dccEntry.protectionPut.ticker || dccEntry.protectionPut.description || '?';
            if (posTicker !== det.ticker) continue;
            const price = dccEntry.protectionPut.snapshot_price ?? dccEntry.protectionPut.current_price ?? 0;
            const exchangeRate = getEffectiveExchangeRate(dccEntry.protectionPut);
            tickerIntrinsic += (price * dccEntry.protectionPut.quantity * 100) / exchangeRate;
          }
        }

        // Cap: intrinsic cannot exceed market value in absolute terms
        if (tickerIntrinsic < det.value) {
          tickerIntrinsic = det.value;
        }
        if (Math.abs(tickerIntrinsic) > 0.01) {
          intrinsicDetails.push({ ...det, value: tickerIntrinsic });
          intrinsicTotal += tickerIntrinsic;
        }
      }

      if (Math.abs(intrinsicTotal) > 0.01) {
        result.push({
          ...item,
          label: `${STRATEGY_SECTION_LABELS[item.category as StrategySectionCategory]} (intrinseco)`,
          value: intrinsicTotal,
          color: 'cost',
          details: intrinsicDetails,
        });
        nettingSum += intrinsicTotal;
      }
      continue;
    }

    // For naked_put: show only intrinsic ITM value
    if (viewMode === 'netting_ex_cc_np' && item.category === 'naked_put') {
      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      for (const det of item.details) {
        let tickerIntrinsic = 0;
        for (const [, npEntry] of nakedPutMap) {
          const posTicker = npEntry.option.underlying || npEntry.option.ticker || npEntry.option.description || '?';
          if (posTicker !== det.ticker) continue;
          const strike = npEntry.option.strike_price ?? 0;
          let underlyingPrice = npEntry.underlying?.snapshot_price ?? npEntry.underlying?.current_price ?? 0;
          if (underlyingPrice <= 0 && underlyingPrices) {
            const key = npEntry.option.underlying || npEntry.option.description || '';
            underlyingPrice = underlyingPrices[key]?.price ?? 0;
          }
          const exchangeRate = getEffectiveExchangeRate(npEntry.option);
          if (underlyingPrice > 0 && strike >= underlyingPrice) {
            const contracts = Math.abs(npEntry.option.quantity);
            tickerIntrinsic += -(contracts * 100 * (strike - underlyingPrice)) / exchangeRate;
          }
        }
        if (Math.abs(tickerIntrinsic) > 0.01) {
          intrinsicDetails.push({ ...det, value: tickerIntrinsic });
          intrinsicTotal += tickerIntrinsic;
        }
      }

      if (Math.abs(intrinsicTotal) > 0.01) {
        result.push({
          ...item,
          label: 'Naked Put (intrinseco)',
          value: intrinsicTotal,
          color: 'cost',
          details: intrinsicDetails,
        });
        nettingSum += intrinsicTotal;
      }
      continue;
    }

    // All other categories: keep market value
    if (Math.abs(item.value) > 0.01) {
      result.push(item);
      nettingSum += item.value;
    }
  }

  return { items: result, finalValue: baseValue + nettingSum };
}
