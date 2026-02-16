import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { DerivativeOverride } from '@/types/derivativeOverrides';

export interface NettingBreakdownDetail {
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

function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

export function useDerivativeNetting(
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = []
): NettingResult {
  return useMemo(() => {
    const emptyResult: NettingResult = {
      nettingExCoveredCall: summary?.totalValue ?? 0,
      nettingTotal: summary?.totalValue ?? 0,
      nettingExCCAndNP: summary?.totalValue ?? 0,
      breakdown: [],
    };

    if (!summary || positions.length === 0) return emptyResult;

    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    if (derivatives.length === 0) {
      return { ...emptyResult, nettingExCoveredCall: summary.totalValue, nettingTotal: summary.totalValue, nettingExCCAndNP: summary.totalValue };
    }

    const categories = categorizeDerivatives(derivatives, positions, overrides);

    const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));
    const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));
    const longPutSet = new Set(categories.longPuts.map(lp => lp.option.id));
    const leapCallSet = new Set(categories.leapCalls.map(lc => lc.option.id));

    // Collect IDs belonging to iron condors, double diagonals, other strategies
    const multiLegSet = new Set<string>();
    categories.ironCondors.forEach(ic => {
      [ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall].forEach(p => multiLegSet.add(p.id));
    });
    categories.doubleDiagonals.forEach(dd => {
      [dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall].forEach(p => multiLegSet.add(p.id));
    });
    categories.otherStrategies.forEach(os => multiLegSet.add(os.option.id));

    // Accumulators per category
    const acc = {
      ccItm: { value: 0, details: [] as NettingBreakdownDetail[] },
      ccOtm: { value: 0, details: [] as NettingBreakdownDetail[] },
      npItm: { value: 0, details: [] as NettingBreakdownDetail[] },
      npOtm: { value: 0, details: [] as NettingBreakdownDetail[] },
      longPut: { value: 0, details: [] as NettingBreakdownDetail[] },
      leapCall: { value: 0, details: [] as NettingBreakdownDetail[] },
      other: { value: 0, details: [] as NettingBreakdownDetail[] },
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

      const ticker = derivative.ticker || derivative.underlying || derivative.description || '?';
      const detail: NettingBreakdownDetail = {
        ticker,
        description: derivative.description,
        value: 0, // will be set per category
        strike: derivative.strike_price ?? undefined,
        expiry: derivative.expiry_date ?? undefined,
      };

      totalNetting += nettingValue;

      const coveredCall = coveredCallMap.get(derivative.id);
      const nakedPut = nakedPutMap.get(derivative.id);

      if (coveredCall) {
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = coveredCall.underlying.snapshot_price ?? coveredCall.underlying.current_price ?? 0;

        if (strikePrice < underlyingPrice) {
          // ITM covered call
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          nettingExCoveredCall -= intrinsicValue;
          nettingExCCAndNP -= intrinsicValue;

          // For total netting breakdown, use market buyback cost
          acc.ccItm.value += nettingValue;
          acc.ccItm.details.push({ ...detail, value: nettingValue });
        } else {
          // OTM covered call
          acc.ccOtm.value += nettingValue;
          acc.ccOtm.details.push({ ...detail, value: nettingValue });
        }
      } else if (nakedPut) {
        const strikePrice = derivative.strike_price ?? 0;
        const underlyingPrice = nakedPut.underlying?.snapshot_price ?? nakedPut.underlying?.current_price ?? 0;

        nettingExCoveredCall += nettingValue;

        if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
          // OTM naked put
          acc.npOtm.value += nettingValue;
          acc.npOtm.details.push({ ...detail, value: nettingValue });
        } else if (underlyingPrice > 0 && strikePrice >= underlyingPrice) {
          // ITM naked put
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (strikePrice - underlyingPrice)) / exchangeRate;
          nettingExCCAndNP -= intrinsicValue;
          acc.npItm.value += nettingValue;
          acc.npItm.details.push({ ...detail, value: nettingValue });
        } else {
          nettingExCCAndNP += nettingValue;
          acc.npItm.value += nettingValue;
          acc.npItm.details.push({ ...detail, value: nettingValue });
        }
      } else if (longPutSet.has(derivative.id)) {
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
        acc.longPut.value += nettingValue;
        acc.longPut.details.push({ ...detail, value: nettingValue });
      } else if (leapCallSet.has(derivative.id)) {
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
        acc.leapCall.value += nettingValue;
        acc.leapCall.details.push({ ...detail, value: nettingValue });
      } else {
        // Multi-leg or uncategorized
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
        acc.other.value += nettingValue;
        acc.other.details.push({ ...detail, value: nettingValue });
      }
    }

    // Build breakdown array (all categories, filter zeros later per view)
    const breakdown: NettingBreakdownItem[] = [];

    const addIfNonZero = (category: string, label: string, value: number, color: 'cost' | 'gain', details: NettingBreakdownDetail[]) => {
      if (Math.abs(value) > 0.01 || details.length > 0) {
        breakdown.push({ category, label, value, color: value < 0 ? 'cost' : (value > 0 ? 'gain' : color), details });
      }
    };

    addIfNonZero('cc_itm', 'Covered Call ITM', acc.ccItm.value, 'cost', acc.ccItm.details);
    addIfNonZero('cc_otm', 'Covered Call OTM', acc.ccOtm.value, 'cost', acc.ccOtm.details);
    addIfNonZero('np_itm', 'Naked Put ITM', acc.npItm.value, 'cost', acc.npItm.details);
    addIfNonZero('np_otm', 'Naked Put OTM', acc.npOtm.value, 'cost', acc.npOtm.details);
    addIfNonZero('long_put', 'Protezioni (Long Put)', acc.longPut.value, 'gain', acc.longPut.details);
    addIfNonZero('leap_call', 'Leap Call', acc.leapCall.value, 'gain', acc.leapCall.details);
    addIfNonZero('other', 'Altre Strategie', acc.other.value, 'cost', acc.other.details);

    return {
      nettingExCoveredCall: summary.totalValue + nettingExCoveredCall,
      nettingTotal: summary.totalValue + totalNetting,
      nettingExCCAndNP: summary.totalValue + nettingExCCAndNP,
      breakdown,
    };
  }, [positions, summary, overrides]);
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
  overrides: DerivativeOverride[] = []
): { items: NettingBreakdownItem[]; finalValue: number } {
  const baseValue = summary?.totalValue ?? 0;

  if (viewMode === 'netting_total') {
    // Show everything at market value
    const items = breakdown.filter(b => Math.abs(b.value) > 0.01);
    const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
    return { items, finalValue };
  }

  // For ex_cc and ex_cc_np, we need to recalculate CC values using intrinsic
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  const categories = categorizeDerivatives(derivatives, positions, overrides);
  const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));

  const result: NettingBreakdownItem[] = [];
  let nettingSum = 0;

  for (const item of breakdown) {
    if (item.category === 'cc_otm') {
      // ex_cc and ex_cc_np: exclude OTM covered calls entirely
      continue;
    }

    if (item.category === 'cc_itm') {
      // Recalculate using intrinsic value
      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      for (const det of item.details) {
        // Find the derivative and its covered call data
        const ccEntry = [...coveredCallMap.values()].find(cc => {
          const t = cc.option.ticker || cc.option.underlying || cc.option.description || '';
          return t === det.ticker;
        });

        if (ccEntry) {
          const strike = ccEntry.option.strike_price ?? 0;
          const underlyingPrice = ccEntry.underlying.snapshot_price ?? ccEntry.underlying.current_price ?? 0;
          const exchangeRate = getEffectiveExchangeRate(ccEntry.option);
          if (strike < underlyingPrice) {
            const contracts = Math.abs(ccEntry.option.quantity);
            const iv = -(contracts * 100 * (underlyingPrice - strike)) / exchangeRate;
            intrinsicTotal += iv;
            intrinsicDetails.push({ ...det, value: iv });
          }
        }
      }

      if (Math.abs(intrinsicTotal) > 0.01) {
        result.push({
          ...item,
          label: 'Covered Call ITM (intrinseco)',
          value: intrinsicTotal,
          color: 'cost',
          details: intrinsicDetails,
        });
        nettingSum += intrinsicTotal;
      }
      continue;
    }

    if (viewMode === 'netting_ex_cc_np' && item.category === 'np_otm') {
      // Exclude OTM naked puts
      continue;
    }

    if (viewMode === 'netting_ex_cc_np' && item.category === 'np_itm') {
      // Recalculate naked put ITM using intrinsic value
      const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));
      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      for (const det of item.details) {
        const npEntry = [...nakedPutMap.values()].find(np => {
          const t = np.option.ticker || np.option.underlying || np.option.description || '';
          return t === det.ticker;
        });

        if (npEntry) {
          const strike = npEntry.option.strike_price ?? 0;
          const underlyingPrice = npEntry.underlying?.snapshot_price ?? npEntry.underlying?.current_price ?? 0;
          const exchangeRate = getEffectiveExchangeRate(npEntry.option);
          if (underlyingPrice > 0 && strike >= underlyingPrice) {
            const contracts = Math.abs(npEntry.option.quantity);
            const iv = -(contracts * 100 * (strike - underlyingPrice)) / exchangeRate;
            intrinsicTotal += iv;
            intrinsicDetails.push({ ...det, value: iv });
          }
        }
      }

      if (Math.abs(intrinsicTotal) > 0.01) {
        result.push({
          ...item,
          label: 'Naked Put ITM (intrinseco)',
          value: intrinsicTotal,
          color: 'cost',
          details: intrinsicDetails,
        });
        nettingSum += intrinsicTotal;
      }
      continue;
    }

    if (Math.abs(item.value) > 0.01) {
      result.push(item);
      nettingSum += item.value;
    }
  }

  return { items: result, finalValue: baseValue + nettingSum };
}
