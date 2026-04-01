import { supabase } from '@/integrations/supabase/client';
import { Position } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { categorizeDerivatives } from './derivativeStrategies';
import { saveStrategyCache } from './strategyCache';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';

/**
 * Refreshes the strategy_cache for a portfolio after an Excel upload.
 * Fetches positions, overrides and underlying prices from the DB,
 * runs categorization, and saves the cache.
 * 
 * This ensures the check-alerts cron always sees up-to-date strikes.
 * Runs in the background (fire-and-forget).
 */
export async function refreshStrategyCacheForPortfolio(portfolioId: string): Promise<void> {
  try {
    // 1. Fetch all positions for this portfolio
    const { data: positionsRaw, error: posErr } = await supabase
      .from('positions')
      .select('*')
      .eq('portfolio_id', portfolioId);

    if (posErr || !positionsRaw) {
      console.error('[refreshStrategyCache] Error fetching positions:', posErr);
      return;
    }

    const positions = positionsRaw as unknown as Position[];
    const derivatives = positions.filter(p => p.asset_type === 'derivative');

    if (derivatives.length === 0) {
      // No derivatives → clear cache
      await supabase.from('strategy_cache').delete().eq('portfolio_id', portfolioId);
      console.log('[refreshStrategyCache] No derivatives, cache cleared');
      return;
    }

    // 1b. Fetch archived underlyings for this portfolio (to exclude from cache)
    const { data: archivedRaw } = await supabase
      .from('archived_underlyings')
      .select('underlying_key')
      .eq('portfolio_id', portfolioId);
    const archivedKeys = new Set(
      (archivedRaw || []).map((a: any) => (a.underlying_key as string).toUpperCase().trim())
    );

    // Filter out archived derivatives
    const activeDerivatives = archivedKeys.size > 0
      ? derivatives.filter(d => {
          const key = (d.underlying || d.description || '').toUpperCase().trim();
          return !archivedKeys.has(key);
        })
      : derivatives;

    if (activeDerivatives.length === 0) {
      await supabase.from('strategy_cache').delete().eq('portfolio_id', portfolioId);
      console.log('[refreshStrategyCache] All derivatives archived, cache cleared');
      return;
    }

    // 2. Fetch derivative overrides
    const { data: overridesRaw } = await supabase
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', portfolioId);

    const overrides = (overridesRaw || []) as unknown as DerivativeOverride[];

    // 3. Fetch underlying prices
    const { data: pricesRaw } = await supabase
      .from('underlying_prices')
      .select('*');

    // 4. Fetch underlying mappings to build the prices map keyed by underlying name
    const { data: mappingsRaw } = await supabase
      .from('underlying_mappings')
      .select('underlying, ticker');

    const tickerToUnderlying = new Map<string, string>();
    (mappingsRaw || []).forEach((m: any) => {
      tickerToUnderlying.set(m.ticker.toUpperCase(), m.underlying);
    });

    // Build underlyingPrices map: keyed by underlying name
    const underlyingPrices: Record<string, UnderlyingPrice> = {};
    (pricesRaw || []).forEach((p: any) => {
      const ticker = p.ticker as string;
      const price: UnderlyingPrice = {
        price: p.price,
        currency: p.currency,
        ticker,
        updatedAt: p.updated_at,
        isStale: false,
      };

      // Map by ticker directly
      underlyingPrices[ticker] = price;

      // Also map by underlying name if mapping exists
      const underlyingName = tickerToUnderlying.get(ticker.toUpperCase());
      if (underlyingName) {
        underlyingPrices[underlyingName] = price;
      }
    });

    // 5. Fetch strategy configurations
    const { data: configsRaw } = await supabase
      .from('strategy_configurations')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const strategyConfigs = (configsRaw || []) as any[];

    // 6. Categorize and save
    const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);
    await saveStrategyCache(portfolioId, categories, underlyingPrices);

    console.log('[refreshStrategyCache] Cache refreshed for portfolio', portfolioId);
  } catch (err) {
    console.error('[refreshStrategyCache] Unexpected error:', err);
  }
}
