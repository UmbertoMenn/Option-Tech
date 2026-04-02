/**
 * Computes portfolio staging values (total_value, netting, exposures)
 * and upserts them into portfolio_latest_values.
 * Used by FileUploader after Excel upload to keep staging data fresh
 * for the auto-snapshot cron job.
 */
import { Position, PortfolioSummary } from '@/types/portfolio';
import { supabase } from '@/integrations/supabase/client';
import { categorizeDerivatives } from './derivativeStrategies';
import { analyzePortfolioRisk } from './riskCalculator';
import { calculateCurrencyExposure } from './currencyExposure';
import { computeSinglePortfolioNetting } from '@/hooks/useDerivativeNetting';
import { DerivativeOverride } from '@/types/derivativeOverrides';

type PartialPosition = Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>;

interface StagingInput {
  portfolioId: string;
  positions: PartialPosition[];
  cashValue: number;
}

export async function computeAndUpsertStagingValues({ portfolioId, positions, cashValue }: StagingInput): Promise<void> {
  try {
    // 1. Calculate total_value from snapshot values
    const positionsValue = positions.reduce((sum, p) => {
      const mv = p.snapshot_market_value ?? p.market_value ?? 0;
      return sum + mv;
    }, 0);
    
    // Fetch GP total value
    const { data: portfolioData } = await supabase
      .from('portfolios')
      .select('gp_total_value')
      .eq('id', portfolioId)
      .single();
    const gpTotalValue = portfolioData?.gp_total_value || 0;
    
    const totalValue = positionsValue + cashValue + gpTotalValue;

    // 2. Fetch derivative_overrides for this portfolio
    const { data: overridesData } = await supabase
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const overrides: DerivativeOverride[] = (overridesData || []) as DerivativeOverride[];

    // 3. Prepare positions with snapshot prices and fill missing fields for calculations
    const now = new Date().toISOString();
    const fullPositions: Position[] = positions.map((p, i) => ({
      ...p,
      id: `staging-${i}`,
      portfolio_id: portfolioId,
      created_at: now,
      updated_at: now,
      current_price: p.snapshot_price ?? p.current_price,
      market_value: p.snapshot_market_value ?? p.market_value,
    }));

    // 4. Compute netting
    const summary: PortfolioSummary = {
      totalValue,
      cashValue,
      investedValue: positionsValue,
      totalProfitLoss: 0,
      totalProfitLossPct: 0,
      byAssetType: [],
    };

    const nettingResult = computeSinglePortfolioNetting(fullPositions, overrides);
    const nettingTotal = totalValue + nettingResult.totalNetting;
    const nettingExCCAndNP = totalValue + nettingResult.nettingExCCAndNP;

    // 5. Fetch strategy configurations
    const { data: configsRaw } = await supabase
      .from('strategy_configurations')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const strategyConfigs = (configsRaw || []) as any[];

    // 6. Compute equity exposure
    const derivatives = fullPositions.filter(p => p.asset_type === 'derivative');
    const categories = categorizeDerivatives(derivatives, fullPositions, overrides, strategyConfigs);
    const riskAnalysis = analyzePortfolioRisk(fullPositions, categories);
    const equityExposurePct = totalValue > 0
      ? Math.max(0, Math.min(1, riskAnalysis.grandTotal / totalValue))
      : 0.6;

    // 6. Compute USD exposure
    const currencyExposures = calculateCurrencyExposure(riskAnalysis);
    const totalExposure = currencyExposures.reduce((sum, c) => sum + c.totalRisk, 0);
    const usdExposure = currencyExposures.find(c => c.currency === 'USD');
    const usdExposurePct = totalExposure > 0 && usdExposure
      ? usdExposure.totalRisk / totalExposure
      : 0;

    // 7. Upsert to portfolio_latest_values
    const { error } = await supabase
      .from('portfolio_latest_values')
      .upsert({
        portfolio_id: portfolioId,
        total_value: totalValue,
        netting_total: nettingTotal,
        netting_ex_cc_np: nettingExCCAndNP,
        equity_exposure_pct: equityExposurePct,
        usd_exposure_pct: usdExposurePct,
      }, { onConflict: 'portfolio_id' });

    if (error) {
      console.warn('[StagingCalculator] Failed to upsert staging values:', error.message);
    } else {
      console.log('[StagingCalculator] Staging values updated:', {
        portfolioId,
        totalValue: Math.round(totalValue),
        nettingTotal: Math.round(nettingTotal),
        nettingExCCAndNP: Math.round(nettingExCCAndNP),
        equityExposurePct: (equityExposurePct * 100).toFixed(1) + '%',
        usdExposurePct: (usdExposurePct * 100).toFixed(1) + '%',
      });
    }
  } catch (err) {
    console.warn('[StagingCalculator] Error computing staging values:', err);
  }
}
