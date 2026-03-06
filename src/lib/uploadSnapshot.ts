/**
 * Computes portfolio metrics from freshly-saved positions and upserts
 * a historical_data record for the given snapshot date.
 * Called immediately after Excel upload — replaces the old EOD cron approach.
 */
import { supabase } from '@/integrations/supabase/client';
import { Position, PortfolioSummary } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { categorizeDerivatives } from './derivativeStrategies';
import { analyzePortfolioRisk } from './riskCalculator';
import { calculateCurrencyExposure } from './currencyExposure';
import { computeSinglePortfolioNetting } from '@/hooks/useDerivativeNetting';

interface UploadSnapshotInput {
  portfolioId: string;
  snapshotDate: string; // YYYY-MM-DD
  cashValue: number;
}

export async function upsertUploadSnapshot({ portfolioId, snapshotDate, cashValue }: UploadSnapshotInput): Promise<void> {
  try {
    // 1. Fetch freshly-saved positions
    const { data: positionsRaw, error: posErr } = await supabase
      .from('positions')
      .select('*')
      .eq('portfolio_id', portfolioId);

    if (posErr || !positionsRaw) {
      console.error('[UploadSnapshot] Error fetching positions:', posErr);
      return;
    }

    const positions = positionsRaw as unknown as Position[];

    // 2. Calculate total_value (non-derivative snapshot values + cash)
    const positionsValue = positions
      .filter(p => p.asset_type !== 'derivative')
      .reduce((sum, p) => sum + (p.snapshot_market_value ?? p.market_value ?? 0), 0);
    const totalValue = positionsValue + cashValue;

    // 3. Fetch derivative overrides
    const { data: overridesRaw } = await supabase
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const overrides = (overridesRaw || []) as unknown as DerivativeOverride[];

    // 4. Compute netting
    const nettingResult = computeSinglePortfolioNetting(positions, overrides);
    const nettingTotal = totalValue + nettingResult.totalNetting;
    const nettingExCCAndNP = totalValue + nettingResult.nettingExCCAndNP;

    // 5. Compute equity exposure
    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    const categories = categorizeDerivatives(derivatives, positions, overrides);
    const riskAnalysis = analyzePortfolioRisk(positions, categories);
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

    // 7. Upsert into historical_data
    const { error } = await supabase
      .from('historical_data')
      .upsert({
        portfolio_id: portfolioId,
        snapshot_date: snapshotDate,
        total_value: totalValue,
        netting_total: nettingTotal,
        netting_ex_cc: nettingExCCAndNP, // mapped for compatibility
        netting_ex_cc_np: nettingExCCAndNP,
        equity_exposure_pct: equityExposurePct,
        usd_exposure_pct: usdExposurePct,
        deposits: 0,
        average_balance: 0,
      }, { onConflict: 'portfolio_id,snapshot_date' });

    if (error) {
      console.error('[UploadSnapshot] Upsert failed:', error.message);
    } else {
      console.log('[UploadSnapshot] Snapshot saved:', {
        portfolioId,
        snapshotDate,
        totalValue: Math.round(totalValue),
        nettingTotal: Math.round(nettingTotal),
        equityExposurePct: (equityExposurePct * 100).toFixed(1) + '%',
        usdExposurePct: (usdExposurePct * 100).toFixed(1) + '%',
      });
    }
  } catch (err) {
    console.error('[UploadSnapshot] Unexpected error:', err);
  }
}
