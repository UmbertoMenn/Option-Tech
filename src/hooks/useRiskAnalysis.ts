import { useMemo } from 'react';
import { usePortfolio } from './usePortfolio';
import { useDerivativeOverrides } from './useDerivativeOverrides';
import { useStrategyConfigurations, StrategyConfiguration } from './useStrategyConfigurations';
import { useUnderlyingPrices } from './useUnderlyingPrices';
import { useFrozenUnderlyingPrices } from './useFrozenUnderlyingPrices';
import { useUnderlyingMappings } from './useUnderlyingMappings';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { analyzePortfolioRisk, RiskAnalysis, SpotResolver, SpotResolution } from '@/lib/riskCalculator';
import { Position } from '@/types/portfolio';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import {
  buildDynamicAliasMap,
  resolveUnderlyingIdentity,
  normalizeTickerCandidate,
} from '@/lib/tickerIdentity';

/** Replace live prices with Excel snapshot values for Dashboard/Risk Analyzer */
function toSnapshotPositions(positions: Position[]): Position[] {
  return positions.map(p => ({
    ...p,
    current_price: p.snapshot_price ?? p.current_price,
    market_value: p.snapshot_market_value ?? p.market_value,
  }));
}

export function useRiskAnalysis(): RiskAnalysis & { isLoading: boolean } {
  const { positions, isLoading, portfolio } = usePortfolio();
  const { overrides, isLoading: isLoadingOverrides } = useDerivativeOverrides();
  const { configurations: strategyConfigs, isLoading: isLoadingConfigs } = useStrategyConfigurations();
  const { selectedPortfolioId } = usePortfolioContext();

  // Underlying names used by derivatives (per la cache prezzi)
  const derivativeUnderlyings = useMemo(
    () => (positions || [])
      .filter(p => p.asset_type === 'derivative')
      .map(p => p.underlying || p.description)
      .filter((u): u is string => !!u),
    [positions],
  );
  const { prices: livePrices } = useUnderlyingPrices(derivativeUnderlyings);
  // Il resolver spot dà già precedenza ai prezzi snapshot delle posizioni in portafoglio;
  // per i sottostanti NON detenuti (es. naked put) il fallback deve essere la mappa
  // CONGELATA dello snapshot, non i prezzi live — coerenza con Dashboard/StatsCards.
  const underlyingPrices = useFrozenUnderlyingPrices(portfolio, livePrices);

  // Mappings backend → alias dinamici (CEG, APP, ...)
  const { allMappings } = useUnderlyingMappings();
  const dynamicAliases = useMemo(
    () => buildDynamicAliasMap(allMappings.data || []),
    [allMappings.data],
  );

  const isGlobalAggregate = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;

  // Build a resolver factory: closes over snapshotPositions + underlyingPrices.
  const buildResolver = (snapshotPositions: Position[]): SpotResolver => {
    const stocks = snapshotPositions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');
    // Indexes
    const byTicker = new Map<string, Position>();
    for (const s of stocks) {
      const t = (s.ticker || '').toUpperCase();
      if (t) byTicker.set(t, s);
    }

    const pickPortfolioPrice = (p: Position): number | null => {
      const px = (p as any).snapshot_price ?? p.current_price ?? null;
      return typeof px === 'number' && px > 0 ? px : null;
    };

    return (underlyingName: string, optionTicker?: string | null): SpotResolution => {
      const target = (underlyingName || '').toUpperCase();

      // 1) match in portafoglio by ticker o nome
      let match = stocks.find(s => {
        const t = (s.ticker || '').toUpperCase();
        const d = (s.description || '').toUpperCase();
        return (t && target.includes(t)) || (d && (target.includes(d) || d.includes(target)));
      });

      if (match) {
        const px = pickPortfolioPrice(match);
        if (px != null) return { spot: px, source: 'portfolio', tickerUsed: match.ticker ?? null };
      }

      // 2) underlying_prices map: prima per nome esatto
      if (underlyingPrices && underlyingPrices[underlyingName]) {
        const up = underlyingPrices[underlyingName];
        if (up.price > 0) {
          return { spot: up.price, source: 'ticker_cache', tickerUsed: up.ticker ?? null };
        }
      }

      // 3) risolvi ticker canonico e cerca direttamente in stocks/portafoglio/cache
      const identity = resolveUnderlyingIdentity(
        {
          rawTicker: optionTicker || null,
          rawName: underlyingName,
          underlyingName,
        },
        { dynamicAliases },
      );
      const canonical = (identity.displayTicker || identity.tickerKey || '').toUpperCase();
      if (canonical && !canonical.startsWith('NAME:')) {
        // 3a) ticker matches portfolio stock
        const stk = byTicker.get(canonical);
        if (stk) {
          const px = pickPortfolioPrice(stk);
          if (px != null) return { spot: px, source: 'portfolio', tickerUsed: stk.ticker ?? null };
        }
        // 3b) trova nella cache underlying_prices qualunque chiave con ticker === canonical
        if (underlyingPrices) {
          for (const [, up] of Object.entries(underlyingPrices)) {
            if ((up.ticker || '').toUpperCase() === canonical && up.price > 0) {
              return { spot: up.price, source: 'ticker_cache', tickerUsed: up.ticker ?? null };
            }
          }
        }
      }

      // 4) fallback: ticker option-derivato grezzo (es. "AAPL")
      const raw = normalizeTickerCandidate(optionTicker || null).toUpperCase();
      if (raw) {
        const stk = byTicker.get(raw);
        if (stk) {
          const px = pickPortfolioPrice(stk);
          if (px != null) return { spot: px, source: 'portfolio', tickerUsed: stk.ticker ?? null };
        }
        if (underlyingPrices) {
          for (const [, up] of Object.entries(underlyingPrices)) {
            if ((up.ticker || '').toUpperCase() === raw && up.price > 0) {
              return { spot: up.price, source: 'ticker_cache', tickerUsed: up.ticker ?? null };
            }
          }
        }
      }

      return { spot: null, source: 'none', tickerUsed: canonical || raw || null };
    };
  };

  const analysis = useMemo(() => {
    const empty: RiskAnalysis = {
      totalStockRisk: 0, totalETFRisk: 0, totalPureStockRisk: 0,
      totalCommodityRisk: 0, totalBondRisk: 0, totalNakedPutRisk: 0,
      totalLeapCallRisk: 0, totalStrategyRisk: 0, totalSyntheticCcDrccRisk: 0,
      grandTotal: 0,
      stockDetails: [], syntheticCcDrccDetails: [], commodityDetails: [], bondDetails: [],
      nakedPutDetails: [], leapCallDetails: [], strategyDetails: []
    };

    if (!positions || positions.length === 0) return empty;

    if (isGlobalAggregate) {
      const byPortfolio = new Map<string, Position[]>();
      positions.forEach(p => {
        if (!byPortfolio.has(p.portfolio_id)) byPortfolio.set(p.portfolio_id, []);
        byPortfolio.get(p.portfolio_id)!.push(p);
      });

      const overridesByPortfolio = new Map<string, typeof overrides>();
      overrides.forEach(o => {
        if (!overridesByPortfolio.has(o.portfolio_id)) overridesByPortfolio.set(o.portfolio_id, []);
        overridesByPortfolio.get(o.portfolio_id)!.push(o);
      });

      const configsByPortfolio = new Map<string, StrategyConfiguration[]>();
      strategyConfigs.forEach(c => {
        if (!configsByPortfolio.has(c.portfolio_id)) configsByPortfolio.set(c.portfolio_id, []);
        configsByPortfolio.get(c.portfolio_id)!.push(c);
      });

      const merged = { ...empty };

      for (const [pid, pPositions] of byPortfolio) {
        const snap = toSnapshotPositions(pPositions);
        const derivs = snap.filter(p => p.asset_type === 'derivative');
        const pOverrides = overridesByPortfolio.get(pid) || [];
        const pConfigs = configsByPortfolio.get(pid) || [];
        const cats = categorizeDerivatives(derivs, snap, pOverrides, pConfigs, { dynamicAliases });
        const resolver = buildResolver(snap);
        const result = analyzePortfolioRisk(snap, cats, resolver);

        merged.totalStockRisk += result.totalStockRisk;
        merged.totalETFRisk += result.totalETFRisk;
        merged.totalPureStockRisk += result.totalPureStockRisk;
        merged.totalCommodityRisk += result.totalCommodityRisk;
        merged.totalBondRisk += result.totalBondRisk;
        merged.totalNakedPutRisk += result.totalNakedPutRisk;
        merged.totalLeapCallRisk += result.totalLeapCallRisk;
        merged.totalStrategyRisk += result.totalStrategyRisk;
        merged.totalSyntheticCcDrccRisk += result.totalSyntheticCcDrccRisk;
        merged.grandTotal += result.grandTotal;
        merged.stockDetails.push(...result.stockDetails);
        merged.syntheticCcDrccDetails.push(...result.syntheticCcDrccDetails);
        merged.commodityDetails.push(...result.commodityDetails);
        merged.bondDetails.push(...result.bondDetails);
        merged.nakedPutDetails.push(...result.nakedPutDetails);
        merged.leapCallDetails.push(...result.leapCallDetails);
        merged.strategyDetails.push(...result.strategyDetails);
      }

      return merged;
    }

    // Single portfolio / user aggregate: standard logic
    const snapshotPositions = toSnapshotPositions(positions);
    const derivatives = snapshotPositions.filter(p => p.asset_type === 'derivative');
    const categories = categorizeDerivatives(derivatives, snapshotPositions, overrides, strategyConfigs, { dynamicAliases });
    const resolver = buildResolver(snapshotPositions);
    return analyzePortfolioRisk(snapshotPositions, categories, resolver);
  }, [positions, overrides, strategyConfigs, isGlobalAggregate, underlyingPrices, dynamicAliases]);

  return {
    ...analysis,
    isLoading: isLoading || isLoadingOverrides || isLoadingConfigs
  };
}
