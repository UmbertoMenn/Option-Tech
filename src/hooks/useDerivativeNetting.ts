import { useMemo } from 'react';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import type { DynamicAliases } from '@/lib/tickerIdentity';

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
  nettingTotal: number;
  /** Netting Intrinseco (A): vendute e comprate entrambe a solo intrinseco */
  nettingIntrinsicA: number;
  /** Netting Intrinseco (B): vendute a intrinseco, comprate a market value */
  nettingIntrinsicB: number;
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
  strategyConfigs: StrategyConfiguration[],
  dynamicAliases?: DynamicAliases,
): CanonicalLeg[] {
  const categories = categorizeDerivatives(
    derivatives, positions, overrides, strategyConfigs,
    { configOnly: true, dynamicAliases }
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

/**
 * Costruisce le gambe senza mai far incrociare posizioni/configurazioni di
 * portafogli diversi. È importante nella vista aggregata: due clienti possono
 * avere lo stesso sottostante e firme identiche, ma ogni config deve consumare
 * soltanto le posizioni del proprio portfolio.
 */
function buildCanonicalLegsByPortfolio(
  positions: Position[],
  overrides: DerivativeOverride[],
  strategyConfigs: StrategyConfiguration[],
  dynamicAliases?: DynamicAliases,
): CanonicalLeg[] {
  const byPortfolio = new Map<string, Position[]>();
  for (const p of positions) {
    if (!byPortfolio.has(p.portfolio_id)) byPortfolio.set(p.portfolio_id, []);
    byPortfolio.get(p.portfolio_id)!.push(p);
  }

  const overridesByPortfolio = new Map<string, DerivativeOverride[]>();
  for (const o of overrides) {
    if (!overridesByPortfolio.has(o.portfolio_id)) overridesByPortfolio.set(o.portfolio_id, []);
    overridesByPortfolio.get(o.portfolio_id)!.push(o);
  }

  const configsByPortfolio = new Map<string, StrategyConfiguration[]>();
  for (const c of strategyConfigs) {
    if (!configsByPortfolio.has(c.portfolio_id)) configsByPortfolio.set(c.portfolio_id, []);
    configsByPortfolio.get(c.portfolio_id)!.push(c);
  }

  const legs: CanonicalLeg[] = [];
  for (const [portfolioId, portfolioPositions] of byPortfolio) {
    const derivatives = portfolioPositions.filter(p => p.asset_type === 'derivative');
    if (derivatives.length === 0) continue;
    legs.push(...buildCanonicalLegs(
      derivatives,
      portfolioPositions,
      overridesByPortfolio.get(portfolioId) || [],
      configsByPortfolio.get(portfolioId) || [],
      dynamicAliases,
    ));
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

// ─────────────────────────────────────────────────────────────────────────────
// VALUTAZIONE INTRINSECA PER GAMBA
// Le due viste intrinseche si applicano a OGNI gamba opzione, indipendentemente
// dalla categoria di strategia (non più solo Covered Call e Naked Put):
//   • Netting Intrinseco (A): opzioni VENDUTE a solo valore intrinseco
//     (negativo se ITM, 0 se OTM); opzioni COMPRATE anch'esse a solo valore
//     intrinseco (positivo se ITM, 0 se OTM). Il valore temporale non conta mai.
//   • Netting Intrinseco (B): opzioni VENDUTE a solo valore intrinseco
//     (negativo se ITM, 0 se OTM); opzioni COMPRATE a valore di mercato pieno
//     (premio compreso).
// Gambe non-opzione: sempre valore di mercato. Se il prezzo del sottostante
// non è risolvibile, fallback prudente al valore di mercato (mai 0 silenzioso).
// ─────────────────────────────────────────────────────────────────────────────
function computeIntrinsicContribs(
  p: Position,
  spot: number,
  marketValue: number,
  exchangeRate: number
): { a: number; b: number } {
  const isCall = p.option_type === 'call';
  const isPut = p.option_type === 'put';
  if (!isCall && !isPut) return { a: marketValue, b: marketValue };
  if (!(spot > 0)) return { a: marketValue, b: marketValue }; // spot ignoto → fallback a MTM

  const strike = p.strike_price ?? 0;
  const perShare = isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const contracts = Math.abs(p.quantity);
  const intrinsicMag = (contracts * 100 * perShare) / exchangeRate; // ≥ 0

  if (p.quantity < 0) {
    // venduta: −intrinseco (ITM), 0 (OTM) — identico in A e B
    return { a: -intrinsicMag, b: -intrinsicMag };
  }
  // comprata: A → +intrinseco (ITM), 0 (OTM); B → market value
  return { a: intrinsicMag, b: marketValue };
}

/** Compute netting per un singolo portafoglio usando la fonte canonica */
export function computeSinglePortfolioNetting(
  positions: Position[],
  overrides: DerivativeOverride[],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = [],
  dynamicAliases?: DynamicAliases,
): { totalNetting: number; nettingIntrinsicA: number; nettingIntrinsicB: number; breakdown: NettingBreakdownItem[] } {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  if (derivatives.length === 0) {
    return { totalNetting: 0, nettingIntrinsicA: 0, nettingIntrinsicB: 0, breakdown: [] };
  }

  const legs = buildCanonicalLegs(derivatives, positions, overrides, strategyConfigs, dynamicAliases);

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
  let nettingIntrinsicA = 0;
  let nettingIntrinsicB = 0;

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

    // Risoluzione prezzo underlying (per valutazione intrinseca)
    const resolveUnderlyingPrice = (): number => {
      if (leg.associatedUnderlying) {
        const up = leg.associatedUnderlying.snapshot_price ?? leg.associatedUnderlying.current_price ?? 0;
        if (up > 0) return up;
      }
      const key = p.underlying || p.description || '';
      if (underlyingPrices) return underlyingPrices[key]?.price ?? 0;
      return 0;
    };

    const { a, b } = computeIntrinsicContribs(p, resolveUnderlyingPrice(), nettingValue, exchangeRate);
    nettingIntrinsicA += a;
    nettingIntrinsicB += b;
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

  return { totalNetting, nettingIntrinsicA, nettingIntrinsicB, breakdown };
}

/**
 * Confronto metodologico per-gamba: per ogni gamba canonica calcola
 *  - marketValue  = price * qty * 100 / fx  (mark-to-market pieno, segno incluso)
 *  - intrinsicA   = contributo alla vista Netting Intrinseco (A):
 *                   vendute e comprate entrambe a solo intrinseco (OTM 0)
 *  - intrinsicB   = contributo alla vista Netting Intrinseco (B):
 *                   vendute a intrinseco (ITM negativo, OTM 0), comprate a market value
 *
 * Gestisce automaticamente il caso multi-portfolio (somma per portfolio).
 */
export interface NettingCompareRow {
  portfolioId: string;
  category: StrategySectionCategory;
  ticker: string;
  description: string;
  optionType: string | null;
  quantity: number;
  strike: number | null;
  expiry: string | null;
  price: number;
  underlyingPrice: number;
  marketValue: number;
  intrinsicA: number;
  intrinsicB: number;
}

export interface NettingCompareResult {
  rows: NettingCompareRow[];
  totals: { marketValue: number; intrinsicA: number; intrinsicB: number };
  baseValue: number;
  finalMarket: number;      // baseValue + Σ marketValue  (= netting totale)
  finalIntrinsicA: number;  // baseValue + Σ intrinsicA   (= Netting Intrinseco A)
  finalIntrinsicB: number;  // baseValue + Σ intrinsicB   (= Netting Intrinseco B)
}

export function compareNettingMethods(
  positions: Position[],
  baseValue: number,
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = [],
  dynamicAliases?: DynamicAliases,
): NettingCompareResult {
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

  const rows: NettingCompareRow[] = [];

  for (const [pid, pPositions] of byPortfolio) {
    const derivatives = pPositions.filter(p => p.asset_type === 'derivative');
    if (derivatives.length === 0) continue;
    const legs = buildCanonicalLegs(
      derivatives, pPositions,
      overridesByPortfolio.get(pid) || [],
      configsByPortfolio.get(pid) || [],
      dynamicAliases,
    );

    for (const leg of legs) {
      const p = leg.position;
      const cat = leg.category;
      const price = p.snapshot_price ?? p.current_price ?? 0;
      const quantity = p.quantity;
      const multiplier = 100;
      const fx = getEffectiveExchangeRate(p);
      const marketValue = (price * quantity * multiplier) / fx;

      const underlyingPrice = (() => {
        if (leg.associatedUnderlying) {
          const up = leg.associatedUnderlying.snapshot_price ?? leg.associatedUnderlying.current_price ?? 0;
          if (up > 0) return up;
        }
        const key = p.underlying || p.description || '';
        return underlyingPrices?.[key]?.price ?? 0;
      })();

      const { a, b } = computeIntrinsicContribs(p, underlyingPrice, marketValue, fx);

      rows.push({
        portfolioId: pid,
        category: cat,
        ticker: p.underlying || p.ticker || p.description || '?',
        description: p.description,
        optionType: p.option_type ?? null,
        quantity,
        strike: p.strike_price ?? null,
        expiry: p.expiry_date ?? null,
        price,
        underlyingPrice,
        marketValue,
        intrinsicA: a,
        intrinsicB: b,
      });
    }
  }

  const totals = rows.reduce(
    (t, r) => {
      t.marketValue += r.marketValue;
      t.intrinsicA += r.intrinsicA;
      t.intrinsicB += r.intrinsicB;
      return t;
    },
    { marketValue: 0, intrinsicA: 0, intrinsicB: 0 }
  );

  return {
    rows,
    totals,
    baseValue,
    finalMarket: baseValue + totals.marketValue,
    finalIntrinsicA: baseValue + totals.intrinsicA,
    finalIntrinsicB: baseValue + totals.intrinsicB,
  };
}

export function useDerivativeNetting(
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  isAggregatedView: boolean = false,
  strategyConfigs: StrategyConfiguration[] = [],
  dynamicAliases?: DynamicAliases,
): NettingResult {
  return useMemo(() => {
    const emptyResult: NettingResult = {
      nettingTotal: summary?.totalValue ?? 0,
      nettingIntrinsicA: summary?.totalValue ?? 0,
      nettingIntrinsicB: summary?.totalValue ?? 0,
      breakdown: [],
    };

    if (!summary || positions.length === 0) return emptyResult;

    // Split per portfolio in QUALSIASI vista aggregata (admin globale o utente).
    // Rilevamento robusto: se le positions abbracciano più portfolio_id, è aggregata.
    const distinctPortfolios = new Set(positions.map(p => p.portfolio_id));
    const needsSplit = isAggregatedView || distinctPortfolios.size > 1;

    if (needsSplit) {
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
      let mergedIntrinsicA = 0;
      let mergedIntrinsicB = 0;
      const mergedBreakdown: NettingBreakdownItem[] = [];

      for (const [pid, pPositions] of byPortfolio) {
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const result = computeSinglePortfolioNetting(pPositions, pOverrides, underlyingPrices, pConfigs, dynamicAliases);
        mergedTotalNetting += result.totalNetting;
        mergedIntrinsicA += result.nettingIntrinsicA;
        mergedIntrinsicB += result.nettingIntrinsicB;
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
        nettingIntrinsicA: summary.totalValue + mergedIntrinsicA,
        nettingIntrinsicB: summary.totalValue + mergedIntrinsicB,
        breakdown: [...byCat.values()].filter(b => Math.abs(b.value) > 0.01 || b.details.length > 0),
      };
    }

    const result = computeSinglePortfolioNetting(positions, overrides, underlyingPrices, strategyConfigs, dynamicAliases);

    return {
      nettingTotal: summary.totalValue + result.totalNetting,
      nettingIntrinsicA: summary.totalValue + result.nettingIntrinsicA,
      nettingIntrinsicB: summary.totalValue + result.nettingIntrinsicB,
      breakdown: result.breakdown,
    };
  }, [positions, summary, overrides, underlyingPrices, isAggregatedView, strategyConfigs, dynamicAliases]);
}

/**
 * Per la vista netting_total il breakdown già contiene i valori CORRETTI a market value.
 * Per le viste intrinseche (A/B) ricalcoliamo ogni gamba usando la fonte canonica
 * (stessa logica di computeSinglePortfolioNetting / computeIntrinsicContribs).
 */
export function getBreakdownForViewMode(
  breakdown: NettingBreakdownItem[],
  viewMode: 'netting_total' | 'netting_intrinsic_a' | 'netting_intrinsic_b',
  positions: Position[],
  summary: PortfolioSummary | null,
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = [],
  dynamicAliases?: DynamicAliases,
): { items: NettingBreakdownItem[]; finalValue: number } {
  const baseValue = summary?.totalValue ?? 0;

  if (viewMode === 'netting_total') {
    const items = breakdown.filter(b => Math.abs(b.value) > 0.01 || b.details.length > 0);
    const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
    return { items, finalValue };
  }

  // Viste intrinseche: ricalcola per gamba usando la fonte canonica.
  const legs = buildCanonicalLegsByPortfolio(positions, overrides, strategyConfigs, dynamicAliases);

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

    const { a, b } = computeIntrinsicContribs(p, resolveUnderlyingPrice(), nettingValue, exchangeRate);
    const contribValue = viewMode === 'netting_intrinsic_a' ? a : b;

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
      items.push({
        category: cat,
        label: STRATEGY_SECTION_LABELS[cat],
        value: a.value,
        color: a.value < 0 ? 'cost' : (a.value > 0 ? 'gain' : 'cost'),
        details: a.details,
      });
    }
  }

  const finalValue = baseValue + items.reduce((sum, b) => sum + b.value, 0);
  return { items, finalValue };
}

// ─────────────────────────────────────────────────────────────────────────────
// DECOMPOSIZIONE PER GAMBA (intrinseco + valore temporale)
// Usata dalla tabella di dettaglio nel carousel "Valore Portafoglio" della dashboard.
// Per ogni gamba canonica scompone il contributo al netting in:
//   • perdita/valore intrinseco  = max(0, S−K)|max(0, K−S) × q × mult / fx   (segno della posizione)
//   • valore temporale           = MTM − intrinseco                          (segno della posizione)
// La somma dei contributi conteggiati riconcilia con il netting della vista:
//   Σ contribEUR (netting_total)        = totalNetting − baseValue
//   Σ contribEUR (netting_intrinsic_a)  = nettingIntrinsicA − baseValue  (tutte le opzioni a intrinseco)
//   Σ contribEUR (netting_intrinsic_b)  = nettingIntrinsicB − baseValue  (solo vendute a intrinseco)
// ─────────────────────────────────────────────────────────────────────────────

export interface LegDecompositionRow {
  positionId: string;
  category: StrategySectionCategory;
  ticker: string;
  optionType: 'call' | 'put' | null;
  strike: number | null;
  expiry: string | null;
  /** contratti firmati (>0 long, <0 short) */
  quantity: number;
  /** prezzo del sottostante risolto (snapshot linkedStock → underlyingPrices fallback), null se ignoto */
  spot: number | null;
  /** prezzo opzione nativo (per azione), snapshot_price → current_price */
  optionPrice: number;
  exchangeRate: number;
  /** mark-to-market pieno della gamba, in EUR, con segno */
  marketValueEUR: number;
  /** contributo intrinseco conteggiato nel totale di QUESTA vista (EUR, con segno) */
  intrinsicCountedEUR: number;
  /** contributo valore temporale conteggiato nel totale di QUESTA vista (EUR, con segno) */
  timeValueCountedEUR: number;
  /** valore temporale ESCLUSO dal totale (gambe valutate a intrinseco nelle viste A/B); 0 altrimenti */
  timeValueExcludedEUR: number;
  /** contributo totale della gamba a QUESTA vista = intrinsicCounted + timeValueCounted */
  contribEUR: number;
  /** true se la gamba è valutata solo a intrinseco in questa vista */
  atIntrinsic: boolean;
  /** true se la gamba è OTM ed esclusa integralmente (contributo 0) */
  isOTM: boolean;
}

export function computeLegDecomposition(
  viewMode: 'netting_total' | 'netting_intrinsic_a' | 'netting_intrinsic_b',
  positions: Position[],
  overrides: DerivativeOverride[] = [],
  underlyingPrices?: Record<string, UnderlyingPrice>,
  strategyConfigs: StrategyConfiguration[] = [],
  dynamicAliases?: DynamicAliases,
): LegDecompositionRow[] {
  const derivatives = positions.filter(p => p.asset_type === 'derivative');
  if (derivatives.length === 0) return [];

  const legs = buildCanonicalLegsByPortfolio(positions, overrides, strategyConfigs, dynamicAliases);
  const rows: LegDecompositionRow[] = [];

  for (const leg of legs) {
    const p = leg.position;
    const cat = leg.category;
    const price = p.snapshot_price ?? p.current_price ?? 0;
    const quantity = p.quantity;
    const multiplier = 100;
    const exchangeRate = getEffectiveExchangeRate(p);
    const marketValueEUR = (price * quantity * multiplier) / exchangeRate;
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

    const spotRaw = resolveUnderlyingPrice();
    const spot = spotRaw > 0 ? spotRaw : null;
    const strike = p.strike_price ?? null;
    const isCall = p.option_type === 'call';
    const isPut = p.option_type === 'put';
    const contracts = Math.abs(quantity);
    const sign = quantity >= 0 ? 1 : -1;

    // Intrinseco per azione (magnitudine ≥ 0) e in EUR (magnitudine ≥ 0)
    let intrinsicPerShare = 0;
    if (spot != null && strike != null) {
      intrinsicPerShare = isCall
        ? Math.max(0, spot - strike)
        : isPut
          ? Math.max(0, strike - spot)
          : 0;
    }
    const intrinsicMagEUR = (intrinsicPerShare * contracts * multiplier) / exchangeRate; // ≥ 0
    const intrinsicSignedEUR = sign * intrinsicMagEUR;                                    // long +, short −
    const timeValueSignedEUR = marketValueEUR - intrinsicSignedEUR;                       // MTM − intrinseco

    let intrinsicCountedEUR = intrinsicSignedEUR;
    let timeValueCountedEUR = timeValueSignedEUR;
    let timeValueExcludedEUR = 0;
    let contribEUR = marketValueEUR;
    let atIntrinsic = false;
    let isOTM = false;

    if (viewMode !== 'netting_total' && (isCall || isPut) && spot != null && strike != null) {
      // Vista A: TUTTE le gambe opzione (vendute e comprate) sono valutate a intrinseco.
      // Vista B: solo le gambe VENDUTE sono valutate a intrinseco; le comprate restano a MTM.
      const valuedAtIntrinsic = quantity < 0 || viewMode === 'netting_intrinsic_a';

      if (valuedAtIntrinsic) {
        atIntrinsic = true;
        if (intrinsicMagEUR > 0) {
          intrinsicCountedEUR = intrinsicSignedEUR;
          timeValueCountedEUR = 0;
          timeValueExcludedEUR = marketValueEUR - intrinsicSignedEUR; // time value non conteggiato
          contribEUR = intrinsicSignedEUR;
        } else {
          isOTM = true;
          intrinsicCountedEUR = 0;
          timeValueCountedEUR = 0;
          timeValueExcludedEUR = marketValueEUR; // tutto MTM escluso (OTM: solo time value)
          contribEUR = 0;
        }
      }
      // gambe comprate in vista A → MTM pieno, decomposizione naturale (già impostata sopra)
    }
    // netting_total (o spot ignoto → fallback a MTM) → MTM pieno per tutte le gambe

    rows.push({
      positionId: p.id,
      category: cat,
      ticker,
      optionType: p.option_type ?? null,
      strike,
      expiry: p.expiry_date ?? null,
      quantity,
      spot,
      optionPrice: price,
      exchangeRate,
      marketValueEUR,
      intrinsicCountedEUR,
      timeValueCountedEUR,
      timeValueExcludedEUR,
      contribEUR,
      atIntrinsic,
      isOTM,
    });
  }

  return rows;
}
