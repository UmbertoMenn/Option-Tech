import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives, findUnderlyingStock } from '@/lib/derivativeStrategies';
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

export interface OptionTypeDetail {
  ticker: string;
  value: number;
}

export interface OptionTypeBucket {
  total: number;
  details: OptionTypeDetail[];
}

export interface OptionTypeBreakdown {
  sold_put_itm: OptionTypeBucket;
  sold_call_itm: OptionTypeBucket;
  sold_put_otm: OptionTypeBucket;
  sold_call_otm: OptionTypeBucket;
}

export interface NettingResult {
  nettingExCoveredCall: number;
  nettingTotal: number;
  nettingExCCAndNP: number;
  breakdown: NettingBreakdownItem[];
  optionTypeBreakdown: OptionTypeBreakdown;
  optionTypeBreakdownIntrinsic: OptionTypeBreakdown;
  strategyBreakdown: NettingBreakdownItem[];
}

function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) {
    return position.exchange_rate;
  }
  return 1;
}

const emptyOptionTypeBreakdown: OptionTypeBreakdown = {
  sold_put_itm: { total: 0, details: [] },
  sold_call_itm: { total: 0, details: [] },
  sold_put_otm: { total: 0, details: [] },
  sold_call_otm: { total: 0, details: [] },
};

/** Resolve underlying price for a derivative */
function resolveUnderlyingPriceForDerivative(
  derivative: Position,
  allPositions: Position[],
  underlyingPrices?: Record<string, UnderlyingPrice>
): number {
  const stockPositions = allPositions.filter(p => p.asset_type === 'stock');
  const stock = findUnderlyingStock(derivative, stockPositions);
  let price = stock?.snapshot_price ?? stock?.current_price ?? 0;
  if (price <= 0 && underlyingPrices) {
    const key = derivative.underlying || derivative.description || '';
    price = underlyingPrices[key]?.price ?? 0;
  }
  return price;
}

/** Compute option type breakdown (4 buckets: sold PUT/CALL × ITM/OTM) */
function computeOptionTypeBreakdown(
  positions: Position[],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  mode: 'netting_total' | 'netting_ex_cc_np' = 'netting_ex_cc_np'
): OptionTypeBreakdown {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  const result: OptionTypeBreakdown = {
    sold_put_itm: { total: 0, details: [] },
    sold_call_itm: { total: 0, details: [] },
    sold_put_otm: { total: 0, details: [] },
    sold_call_otm: { total: 0, details: [] },
  };

  for (const d of derivatives) {
    if (d.quantity >= 0) continue; // only sold options
    const strike = d.strike_price ?? 0;
    const exchangeRate = getEffectiveExchangeRate(d);
    const contracts = Math.abs(d.quantity);
    const ticker = d.underlying || d.ticker || d.description || '?';
    const underlyingPrice = resolveUnderlyingPriceForDerivative(d, positions, underlyingPrices);
    const marketPrice = d.snapshot_price ?? d.current_price ?? 0;

    if (d.option_type === 'put') {
      if (underlyingPrice > 0 && strike >= underlyingPrice) {
        // ITM PUT
        if (mode === 'netting_total') {
          // Buyback cost (market price from Excel)
          const mv = -(contracts * 100 * marketPrice) / exchangeRate;
          result.sold_put_itm.total += mv;
          result.sold_put_itm.details.push({ ticker, value: mv });
        } else {
          // Intrinsic value (netting_ex_cc_np)
          const intrinsic = -(contracts * 100 * (strike - underlyingPrice)) / exchangeRate;
          result.sold_put_itm.total += intrinsic;
          result.sold_put_itm.details.push({ ticker, value: intrinsic });
        }
      } else {
        // OTM PUT: market value (negative = cost to close)
        const mv = (marketPrice * d.quantity * 100) / exchangeRate;
        result.sold_put_otm.total += mv;
        result.sold_put_otm.details.push({ ticker, value: mv });
      }
    } else if (d.option_type === 'call') {
      if (underlyingPrice > 0 && strike < underlyingPrice) {
        // ITM CALL
        if (mode === 'netting_total') {
          // Buyback cost (market price from Excel)
          const mv = -(contracts * 100 * marketPrice) / exchangeRate;
          result.sold_call_itm.total += mv;
          result.sold_call_itm.details.push({ ticker, value: mv });
        } else {
          // Intrinsic value (netting_ex_cc_np)
          const intrinsic = -(contracts * 100 * (underlyingPrice - strike)) / exchangeRate;
          result.sold_call_itm.total += intrinsic;
          result.sold_call_itm.details.push({ ticker, value: intrinsic });
        }
      } else {
        // OTM CALL: market value (negative = cost to close)
        const mv = (marketPrice * d.quantity * 100) / exchangeRate;
        result.sold_call_otm.total += mv;
        result.sold_call_otm.details.push({ ticker, value: mv });
      }
    }
  }

  // Aggregate details by ticker for each bucket
  for (const key of ['sold_put_itm', 'sold_call_itm', 'sold_put_otm', 'sold_call_otm'] as const) {
    const byTicker = new Map<string, OptionTypeDetail>();
    for (const d of result[key].details) {
      const existing = byTicker.get(d.ticker);
      if (existing) existing.value += d.value;
      else byTicker.set(d.ticker, { ...d });
    }
    result[key].details = [...byTicker.values()].sort((a, b) => a.value - b.value);
  }

  return result;
}

/** Compute strategy section breakdown for the chart */
function computeStrategyBreakdown(
  positions: Position[],
  overrides: DerivativeOverride[],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = []
): NettingBreakdownItem[] {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  if (derivatives.length === 0) return [];

  const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);
  const multiplier = 100;

  const calcNettingValue = (p: Position) => {
    const price = p.snapshot_price ?? p.current_price ?? 0;
    return (price * p.quantity * multiplier) / getEffectiveExchangeRate(p);
  };

  // Compute per section, grouping details by underlying
  const sections: { key: string; label: string; positions: Position[] }[] = [];

  // Covered Calls
  if (categories.coveredCalls.length > 0) {
    sections.push({ key: 'str_covered_call', label: 'Covered Call', positions: categories.coveredCalls.map(cc => cc.option) });
  }
  // De-Risking CC
  if (categories.deRiskingCoveredCalls.length > 0) {
    const legs: Position[] = [];
    categories.deRiskingCoveredCalls.forEach(dr => {
      legs.push(dr.coveredCall.option, dr.protectionPut);
      if (dr.syntheticPut) legs.push(dr.syntheticPut);
    });
    sections.push({ key: 'str_derisking_cc', label: 'De-Risking CC', positions: legs });
  }
  // Iron Condors
  if (categories.ironCondors.length > 0) {
    const legs: Position[] = [];
    categories.ironCondors.forEach(ic => legs.push(ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall));
    sections.push({ key: 'str_iron_condor', label: 'Iron Condor', positions: legs });
  }
  // Double Diagonals
  if (categories.doubleDiagonals.length > 0) {
    const legs: Position[] = [];
    categories.doubleDiagonals.forEach(dd => legs.push(dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall));
    sections.push({ key: 'str_double_diagonal', label: 'Double Diagonal', positions: legs });
  }
  // Naked Puts
  if (categories.nakedPuts.length > 0) {
    sections.push({ key: 'str_naked_put', label: 'Naked Put', positions: categories.nakedPuts.map(np => np.option) });
  }
  // Leap Calls
  if (categories.leapCalls.length > 0) {
    sections.push({ key: 'str_leap_call', label: 'Leap Call', positions: categories.leapCalls.map(lc => lc.option) });
  }
  // Protezioni
  if (categories.longPuts.length > 0) {
    sections.push({ key: 'str_protezioni', label: 'Protezioni', positions: categories.longPuts.map(lp => lp.option) });
  }
  // Other strategies
  if (categories.otherStrategies.length > 0) {
    sections.push({ key: 'str_other', label: 'Altre Strategie', positions: categories.otherStrategies.map(os => os.option) });
  }

  const result: NettingBreakdownItem[] = [];
  for (const section of sections) {
    // Group by underlying and sum
    const byUnderlying = new Map<string, number>();
    for (const p of section.positions) {
      const underlying = p.underlying || p.description || '?';
      byUnderlying.set(underlying, (byUnderlying.get(underlying) || 0) + calcNettingValue(p));
    }

    const totalValue = [...byUnderlying.values()].reduce((s, v) => s + v, 0);
    const details: NettingBreakdownDetail[] = [...byUnderlying.entries()]
      .map(([ticker, value]) => ({ positionId: '', ticker, description: ticker, value }))
      .sort((a, b) => a.value - b.value);

    if (Math.abs(totalValue) > 0.01) {
      result.push({
        category: section.key,
        label: section.label,
        value: totalValue,
        color: totalValue < 0 ? 'cost' : 'gain',
        details,
      });
    }
  }

  return result;
}

/** Compute netting for a single portfolio's positions */
export function computeSinglePortfolioNetting(
  positions: Position[],
  overrides: DerivativeOverride[],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = []
): { totalNetting: number; nettingExCoveredCall: number; nettingExCCAndNP: number; breakdown: NettingBreakdownItem[]; optionTypeBreakdown: OptionTypeBreakdown; optionTypeBreakdownIntrinsic: OptionTypeBreakdown; strategyBreakdown: NettingBreakdownItem[] } {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  if (derivatives.length === 0) {
    return { totalNetting: 0, nettingExCoveredCall: 0, nettingExCCAndNP: 0, breakdown: [], optionTypeBreakdown: { ...emptyOptionTypeBreakdown, sold_put_itm: { total: 0, details: [] }, sold_call_itm: { total: 0, details: [] }, sold_put_otm: { total: 0, details: [] }, sold_call_otm: { total: 0, details: [] } }, optionTypeBreakdownIntrinsic: { ...emptyOptionTypeBreakdown, sold_put_itm: { total: 0, details: [] }, sold_call_itm: { total: 0, details: [] }, sold_put_otm: { total: 0, details: [] }, sold_call_otm: { total: 0, details: [] } }, strategyBreakdown: [] };
  }

  const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);

  const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));
  const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));
  const longPutSet = new Set(categories.longPuts.map(lp => lp.option.id));
  const leapCallSet = new Set(categories.leapCalls.map(lc => lc.option.id));

  const multiLegSet = new Set<string>();
  categories.ironCondors.forEach(ic => {
    [ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall].forEach(p => multiLegSet.add(p.id));
  });
  categories.doubleDiagonals.forEach(dd => {
    [dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall].forEach(p => multiLegSet.add(p.id));
  });
  categories.otherStrategies.forEach(os => multiLegSet.add(os.option.id));

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
      positionId: derivative.id,
      ticker,
      description: derivative.description,
      value: 0,
      strike: derivative.strike_price ?? undefined,
      expiry: derivative.expiry_date ?? undefined,
    };

    totalNetting += nettingValue;

    const resolveUnderlyingPrice = (stock: Position | null | undefined): number => {
      let price = stock?.snapshot_price ?? stock?.current_price ?? 0;
      if (price <= 0 && underlyingPrices) {
        const key = derivative.underlying || derivative.description || '';
        price = underlyingPrices[key]?.price ?? 0;
      }
      return price;
    };

    const coveredCall = coveredCallMap.get(derivative.id);
    const nakedPut = nakedPutMap.get(derivative.id);

    if (coveredCall) {
      const strikePrice = derivative.strike_price ?? 0;
      const underlyingPrice = coveredCall.underlying.snapshot_price ?? coveredCall.underlying.current_price ?? 0;

      if (strikePrice < underlyingPrice) {
        const contracts = Math.abs(quantity);
        const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
        nettingExCoveredCall -= intrinsicValue;
        nettingExCCAndNP -= intrinsicValue;
        acc.ccItm.value += nettingValue;
        acc.ccItm.details.push({ ...detail, value: nettingValue });
      } else {
        acc.ccOtm.value += nettingValue;
        acc.ccOtm.details.push({ ...detail, value: nettingValue });
      }
    } else if (nakedPut) {
      const strikePrice = derivative.strike_price ?? 0;
      const underlyingPrice = resolveUnderlyingPrice(nakedPut.underlying);

      nettingExCoveredCall += nettingValue;

      if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
        acc.npOtm.value += nettingValue;
        acc.npOtm.details.push({ ...detail, value: nettingValue });
      } else if (underlyingPrice > 0 && strikePrice >= underlyingPrice) {
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
      nettingExCoveredCall += nettingValue;
      nettingExCCAndNP += nettingValue;
      acc.other.value += nettingValue;
      acc.other.details.push({ ...detail, value: nettingValue });
    }
  }

  // Aggregate other details by ticker
  const otherByTicker = new Map<string, NettingBreakdownDetail>();
  for (const d of acc.other.details) {
    const key = d.ticker;
    const existing = otherByTicker.get(key);
    if (existing) {
      existing.value += d.value;
    } else {
      otherByTicker.set(key, { ...d, strike: undefined, expiry: undefined });
    }
  }
  acc.other.details = [...otherByTicker.values()];

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

  // Compute option type breakdown
  const optionTypeBreakdown = computeOptionTypeBreakdown(positions, underlyingPrices);

  // Compute strategy breakdown
  const strategyBreakdown = computeStrategyBreakdown(positions, overrides, underlyingPrices, strategyConfigs);

  return { totalNetting, nettingExCoveredCall, nettingExCCAndNP, breakdown, optionTypeBreakdown, strategyBreakdown };
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
    const emptyBreakdown: OptionTypeBreakdown = {
      sold_put_itm: { total: 0, details: [] },
      sold_call_itm: { total: 0, details: [] },
      sold_put_otm: { total: 0, details: [] },
      sold_call_otm: { total: 0, details: [] },
    };
    const emptyResult: NettingResult = {
      nettingExCoveredCall: summary?.totalValue ?? 0,
      nettingTotal: summary?.totalValue ?? 0,
      nettingExCCAndNP: summary?.totalValue ?? 0,
      breakdown: [],
      optionTypeBreakdown: emptyBreakdown,
      strategyBreakdown: [],
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
      const mergedOTB: OptionTypeBreakdown = { ...emptyBreakdown, sold_put_itm: { total: 0, details: [] }, sold_call_itm: { total: 0, details: [] }, sold_put_otm: { total: 0, details: [] }, sold_call_otm: { total: 0, details: [] } };
      const mergedStrategyBreakdown: NettingBreakdownItem[] = [];

      for (const [pid, pPositions] of byPortfolio) {
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const result = computeSinglePortfolioNetting(pPositions, pOverrides, underlyingPrices, pConfigs);
        mergedTotalNetting += result.totalNetting;
        mergedNettingExCC += result.nettingExCoveredCall;
        mergedNettingExCCAndNP += result.nettingExCCAndNP;
        mergedBreakdown.push(...result.breakdown);
        mergedStrategyBreakdown.push(...result.strategyBreakdown);

        // Merge option type breakdown
        for (const key of ['sold_put_itm', 'sold_call_itm', 'sold_put_otm', 'sold_call_otm'] as const) {
          mergedOTB[key].total += result.optionTypeBreakdown[key].total;
          mergedOTB[key].details.push(...result.optionTypeBreakdown[key].details);
        }
      }

      // Merge breakdown items by category
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

      // Merge strategy breakdown by category
      const byStratCat = new Map<string, NettingBreakdownItem>();
      for (const item of mergedStrategyBreakdown) {
        const existing = byStratCat.get(item.category);
        if (existing) {
          existing.value += item.value;
          // Merge details by ticker
          for (const d of item.details) {
            const existingDetail = existing.details.find(ed => ed.ticker === d.ticker);
            if (existingDetail) existingDetail.value += d.value;
            else existing.details.push({ ...d });
          }
        } else {
          byStratCat.set(item.category, { ...item, details: [...item.details] });
        }
      }

      // Re-aggregate option type details by ticker
      for (const key of ['sold_put_itm', 'sold_call_itm', 'sold_put_otm', 'sold_call_otm'] as const) {
        const byTicker = new Map<string, OptionTypeDetail>();
        for (const d of mergedOTB[key].details) {
          const existing = byTicker.get(d.ticker);
          if (existing) existing.value += d.value;
          else byTicker.set(d.ticker, { ...d });
        }
        mergedOTB[key].details = [...byTicker.values()].sort((a, b) => a.value - b.value);
      }

      return {
        nettingTotal: summary.totalValue + mergedTotalNetting,
        nettingExCoveredCall: summary.totalValue + mergedNettingExCC,
        nettingExCCAndNP: summary.totalValue + mergedNettingExCCAndNP,
        breakdown: [...byCat.values()].filter(b => Math.abs(b.value) > 0.01),
        optionTypeBreakdown: mergedOTB,
        strategyBreakdown: [...byStratCat.values()].filter(b => Math.abs(b.value) > 0.01),
      };
    }

    // Standard single-portfolio logic
    const result = computeSinglePortfolioNetting(positions, overrides, underlyingPrices, strategyConfigs);

    return {
      nettingExCoveredCall: summary.totalValue + result.nettingExCoveredCall,
      nettingTotal: summary.totalValue + result.totalNetting,
      nettingExCCAndNP: summary.totalValue + result.nettingExCCAndNP,
      breakdown: result.breakdown,
      optionTypeBreakdown: result.optionTypeBreakdown,
      strategyBreakdown: result.strategyBreakdown,
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
  underlyingPrices?: Record<string, UnderlyingPrice>
): { items: NettingBreakdownItem[]; finalValue: number } {
  const baseValue = summary?.totalValue ?? 0;

  if (viewMode === 'netting_total') {
    const items = breakdown.filter(b => Math.abs(b.value) > 0.01);
    const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
    return { items, finalValue };
  }

  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  const categories = categorizeDerivatives(derivatives, positions, overrides);
  const coveredCallMap = new Map(categories.coveredCalls.map(cc => [cc.option.id, cc]));

  const result: NettingBreakdownItem[] = [];
  let nettingSum = 0;

  for (const item of breakdown) {
    if (item.category === 'cc_otm') continue;

    if (item.category === 'cc_itm') {
      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      for (const det of item.details) {
        const ccEntry = coveredCallMap.get(det.positionId);
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

    if (viewMode === 'netting_ex_cc_np' && item.category === 'np_otm') continue;

    if (viewMode === 'netting_ex_cc_np' && item.category === 'np_itm') {
      const nakedPutMap = new Map(categories.nakedPuts.map(np => [np.option.id, np]));
      let intrinsicTotal = 0;
      const intrinsicDetails: NettingBreakdownDetail[] = [];

      for (const det of item.details) {
        const npEntry = nakedPutMap.get(det.positionId);
        if (npEntry) {
          const strike = npEntry.option.strike_price ?? 0;
          let underlyingPrice = npEntry.underlying?.snapshot_price ?? npEntry.underlying?.current_price ?? 0;
          if (underlyingPrice <= 0 && underlyingPrices) {
            const key = npEntry.option.underlying || npEntry.option.description || '';
            underlyingPrice = underlyingPrices[key]?.price ?? 0;
          }
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
