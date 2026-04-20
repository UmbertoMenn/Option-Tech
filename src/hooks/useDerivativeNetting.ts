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
  | 'other'
  | 'orphans';

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
  orphans: 'Posizioni Orfane',
};

const ALL_CATEGORIES: StrategySectionCategory[] = [
  'covered_call', 'derisking_cc', 'iron_condor', 'double_diagonal',
  'naked_put', 'put_spread', 'diagonal_put_spread', 'leap_call',
  'long_put', 'other', 'orphans',
];

function getEffectiveExchangeRate(position: Position): number {
  if (position.exchange_rate && position.exchange_rate > 0) return position.exchange_rate;
  return 1;
}

interface CanonicalLeg {
  /** ID della posizione raw originale (per consumo quantità) */
  sourceId: string;
  /** Categoria di destinazione */
  category: StrategySectionCategory;
  /** Posizione virtuale (può avere quantity scalata) */
  position: Position;
  /** Riferimento alla posizione "underlying" associata (per CC/NP intrinsic) */
  associatedUnderlying?: Position | null;
}

/** Mappa lo strategy_type del DB alla categoria di netting */
function mapStrategyTypeToCategory(strategyType: string): StrategySectionCategory {
  switch (strategyType) {
    case 'covered_call': return 'covered_call';
    case 'derisking_covered_call': return 'derisking_cc';
    case 'iron_condor': return 'iron_condor';
    case 'double_diagonal': return 'double_diagonal';
    case 'naked_put': return 'naked_put';
    case 'put_spread': return 'put_spread';
    case 'diagonal_put_spread': return 'diagonal_put_spread';
    case 'leap_call': return 'leap_call';
    case 'long_put': return 'long_put';
    default: return 'other';
  }
}

/**
 * Costruisce la lista canonica di "gambe virtuali" classificate, usando
 * DIRETTAMENTE i resolvedConfigs prodotti da categorizeDerivatives({ configOnly: true }).
 *
 * Questa è la VERA fonte canonica: ogni resolvedConfig porta i suoi matchedPositions
 * (gambe virtuali quantity-aware) e il linkedStock associato. In questo modo qualsiasi
 * config matched/partial consuma davvero le posizioni, e nessuna posizione configurata
 * può rifinire erroneamente in "Posizioni Orfane" solo perché filtrata fuori da una
 * sezione display.
 */
function buildCanonicalLegs(
  derivatives: Position[],
  positions: Position[],
  overrides: DerivativeOverride[],
  strategyConfigs: StrategyConfiguration[]
): CanonicalLeg[] {
  const categories = categorizeDerivatives(
    derivatives, positions, overrides, strategyConfigs,
    { configOnly: true }
  );

  const legs: CanonicalLeg[] = [];

  // FONTE CANONICA: usa direttamente resolvedConfigs.matchedPositions
  for (const rc of categories.resolvedConfigs) {
    if (rc.status === 'unmatched') continue; // niente da consumare
    const cat = mapStrategyTypeToCategory(rc.strategyType);
    for (const matched of rc.matchedPositions) {
      if (matched.asset_type !== 'derivative') continue; // ignora stock virtuali eventuali
      legs.push({
        sourceId: stripVirtualSuffix(matched.id),
        category: cat,
        position: matched,
        associatedUnderlying: rc.linkedStock || null,
      });
    }
  }

  // ============ ORFANI (quantity-aware) ============
  // Calcolare quanto ogni raw position è stata consumata dalle config matchate.
  const consumedByRaw = new Map<string, number>();
  for (const leg of legs) {
    const used = Math.abs(leg.position.quantity);
    consumedByRaw.set(leg.sourceId, (consumedByRaw.get(leg.sourceId) || 0) + used);
  }

  // Per ogni derivato originale, calcolare residuo
  for (const d of derivatives) {
    const totalAbs = Math.abs(d.quantity);
    const consumed = consumedByRaw.get(d.id) || 0;
    const residual = totalAbs - consumed;
    if (residual > 0.0001) {
      const sign = d.quantity >= 0 ? 1 : -1;
      const ratio = residual / totalAbs;
      const virtualOrphan: Position = {
        ...d,
        quantity: sign * residual,
        market_value: d.market_value != null ? d.market_value * ratio : null,
        profit_loss: d.profit_loss != null ? d.profit_loss * ratio : null,
        snapshot_market_value: d.snapshot_market_value != null ? d.snapshot_market_value * ratio : null,
      };
      legs.push({
        sourceId: d.id,
        category: 'orphans',
        position: virtualOrphan,
      });
    }
  }

  return legs;
}

/** Rimuove i suffissi virtuali __opt_slot_N e __slot_N per risalire all'ID raw originale */
function stripVirtualSuffix(id: string): string {
  return id.replace(/__opt_slot_\d+$/, '').replace(/__slot_\d+$/, '');
}

interface CategoryAccumulator {
  value: number;
  details: NettingBreakdownDetail[];
}

function makeAcc(): CategoryAccumulator {
  return { value: 0, details: [] };
}

/** Compute netting per un singolo portafoglio usando la fonte canonica */
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

  const legs = buildCanonicalLegs(derivatives, positions, overrides, strategyConfigs);

  // Accumulators per categoria
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
    orphans: makeAcc(),
  };

  let totalNetting = 0;
  let nettingExCoveredCall = 0;
  let nettingExCCAndNP = 0;

  for (const leg of legs) {
    const p = leg.position;
    const cat = leg.category;
    const price = p.snapshot_price ?? p.current_price ?? 0;
    const quantity = p.quantity;
    const multiplier = 100;
    const exchangeRate = getEffectiveExchangeRate(p);
    const nettingValue = (price * quantity * multiplier) / exchangeRate;

    const ticker = p.underlying || p.ticker || p.description || '?';
    const detail: NettingBreakdownDetail = {
      positionId: p.id,
      ticker,
      description: p.description,
      value: nettingValue,
      strike: p.strike_price ?? undefined,
      expiry: p.expiry_date ?? undefined,
    };

    totalNetting += nettingValue;
    acc[cat].value += nettingValue;
    acc[cat].details.push(detail);

    // Risoluzione prezzo underlying per CC/NP (intrinsic value)
    const resolveUnderlyingPrice = (): number => {
      if (leg.associatedUnderlying) {
        const up = leg.associatedUnderlying.snapshot_price ?? leg.associatedUnderlying.current_price ?? 0;
        if (up > 0) return up;
      }
      const key = p.underlying || p.description || '';
      if (underlyingPrices) return underlyingPrices[key]?.price ?? 0;
      return 0;
    };

    // Calcolo netting ex CC e netting ex CC&NP
    if (cat === 'covered_call' || cat === 'derisking_cc') {
      // Solo le sold CALL contribuiscono con perdita intrinseca; le altre gambe (put protezione,
      // syntheticPut) contribuiscono a market value pieno
      if (p.option_type === 'call' && quantity < 0) {
        const strikePrice = p.strike_price ?? 0;
        const underlyingPrice = resolveUnderlyingPrice();
        if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          // Cap: perdita intrinseca non può superare costo di chiusura
          const cappedIntrinsic = Math.max(-intrinsicValue, nettingValue);
          nettingExCoveredCall += cappedIntrinsic;
          nettingExCCAndNP += cappedIntrinsic;
        }
        // OTM: 0 contributo
      } else {
        // protection put / synthetic put / etc → market value pieno
        nettingExCoveredCall += nettingValue;
        nettingExCCAndNP += nettingValue;
      }
    } else if (cat === 'naked_put') {
      // ex CC: sempre market value
      nettingExCoveredCall += nettingValue;
      // ex CC&NP: solo perdita intrinseca ITM
      const strikePrice = p.strike_price ?? 0;
      const uprice = resolveUnderlyingPrice();
      if (uprice > 0 && strikePrice >= uprice) {
        const contracts = Math.abs(quantity);
        const intrinsicValue = (contracts * multiplier * (strikePrice - uprice)) / exchangeRate;
        const cappedIntrinsic = Math.max(-intrinsicValue, nettingValue);
        nettingExCCAndNP += cappedIntrinsic;
      }
      // OTM: 0 contributo per ex CC&NP
    } else {
      // Tutte le altre categorie + orphans: market value pieno per entrambe
      nettingExCoveredCall += nettingValue;
      nettingExCCAndNP += nettingValue;
    }
  }

  // Aggrega dettagli per ticker dentro ogni categoria
  for (const cat of ALL_CATEGORIES) {
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
  for (const cat of ALL_CATEGORIES) {
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
  isAggregatedView: boolean = false,
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
        breakdown: [...byCat.values()].filter(b => Math.abs(b.value) > 0.01 || b.details.length > 0),
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
 * Per il view mode, il breakdown già contiene i valori CORRETTI a market value.
 * Per netting_ex_cc / netting_ex_cc_np dobbiamo ricalcolare CC/DCC/NP usando
 * la fonte canonica (stessa logica di computeSinglePortfolioNetting).
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
    const items = breakdown.filter(b => Math.abs(b.value) > 0.01 || b.details.length > 0);
    const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
    return { items, finalValue };
  }

  // Per netting_ex_cc e netting_ex_cc_np: ricalcola usando la fonte canonica.
  // Costruisci breakdown alternativo con valori intrinseci/market a seconda della categoria.
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  const legs = buildCanonicalLegs(derivatives, positions, overrides, strategyConfigs);

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
    orphans: makeAcc(),
  };

  for (const leg of legs) {
    const p = leg.position;
    const cat = leg.category;
    const price = p.snapshot_price ?? p.current_price ?? 0;
    const quantity = p.quantity;
    const multiplier = 100;
    const exchangeRate = getEffectiveExchangeRate(p);
    const nettingValue = (price * quantity * multiplier) / exchangeRate;

    const ticker = p.underlying || p.ticker || p.description || '?';

    const resolveUnderlyingPrice = (): number => {
      if (leg.associatedUnderlying) {
        const up = leg.associatedUnderlying.snapshot_price ?? leg.associatedUnderlying.current_price ?? 0;
        if (up > 0) return up;
      }
      const key = p.underlying || p.description || '';
      if (underlyingPrices) return underlyingPrices[key]?.price ?? 0;
      return 0;
    };

    let contribValue = nettingValue;

    if (cat === 'covered_call' || cat === 'derisking_cc') {
      if (p.option_type === 'call' && quantity < 0) {
        const strikePrice = p.strike_price ?? 0;
        const underlyingPrice = resolveUnderlyingPrice();
        if (underlyingPrice > 0 && strikePrice < underlyingPrice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (underlyingPrice - strikePrice)) / exchangeRate;
          contribValue = Math.max(-intrinsicValue, nettingValue);
        } else {
          contribValue = 0; // OTM: nessun contributo
        }
      }
      // protection put / synthetic put → market value pieno (contribValue rimane = nettingValue)
    } else if (cat === 'naked_put') {
      if (viewMode === 'netting_ex_cc_np') {
        const strikePrice = p.strike_price ?? 0;
        const uprice = resolveUnderlyingPrice();
        if (uprice > 0 && strikePrice >= uprice) {
          const contracts = Math.abs(quantity);
          const intrinsicValue = (contracts * multiplier * (strikePrice - uprice)) / exchangeRate;
          contribValue = Math.max(-intrinsicValue, nettingValue);
        } else {
          contribValue = 0;
        }
      }
      // viewMode === 'netting_ex_cc' → market value pieno
    }
    // Tutte le altre categorie + orphans: contribValue = nettingValue (market value)

    if (Math.abs(contribValue) > 0.0001) {
      acc[cat].value += contribValue;
      acc[cat].details.push({
        positionId: p.id,
        ticker,
        description: p.description,
        value: contribValue,
        strike: p.strike_price ?? undefined,
        expiry: p.expiry_date ?? undefined,
      });
    }
  }

  // Aggrega dettagli per ticker
  for (const cat of ALL_CATEGORIES) {
    const byTicker = new Map<string, NettingBreakdownDetail>();
    for (const d of acc[cat].details) {
      const existing = byTicker.get(d.ticker);
      if (existing) existing.value += d.value;
      else byTicker.set(d.ticker, { ...d, strike: undefined, expiry: undefined });
    }
    acc[cat].details = [...byTicker.values()];
  }

  const items: NettingBreakdownItem[] = [];
  for (const cat of ALL_CATEGORIES) {
    const a = acc[cat];
    if (Math.abs(a.value) > 0.01 || a.details.length > 0) {
      const isIntrinsic = (cat === 'covered_call' || cat === 'derisking_cc') ||
        (viewMode === 'netting_ex_cc_np' && cat === 'naked_put');
      items.push({
        category: cat,
        label: isIntrinsic
          ? `${STRATEGY_SECTION_LABELS[cat]} (intrinseco)`
          : STRATEGY_SECTION_LABELS[cat],
        value: a.value,
        color: a.value < 0 ? 'cost' : (a.value > 0 ? 'gain' : 'cost'),
        details: a.details,
      });
    }
  }

  const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
  return { items, finalValue };
}
