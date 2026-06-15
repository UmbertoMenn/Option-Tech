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

    // 2. Calculate total_value (non-derivative snapshot values + cash + GP)
    const positionsValue = positions
      .filter(p => p.asset_type !== 'derivative')
      .reduce((sum, p) => sum + (p.snapshot_market_value ?? p.market_value ?? 0), 0);
    
    // Fetch GP total value — but include it in the snapshot ONLY if the GP
    // has not been updated AFTER the portfolio snapshot date. Otherwise the
    // GP belongs to a different (later) point in time and would corrupt the
    // historical value of the portfolio for snapshotDate.
    const { data: portfolioData } = await supabase
      .from('portfolios')
      .select('gp_total_value')
      .eq('id', portfolioId)
      .single();

    const { data: gpRows } = await supabase
      .from('gp_holdings')
      .select('updated_at, created_at')
      .eq('portfolio_id', portfolioId);

    const latestGpTs = (gpRows || []).reduce<number>((max, r: any) => {
      const ts = new Date(r.updated_at || r.created_at || 0).getTime();
      return ts > max ? ts : max;
    }, 0);
    // End-of-day in UTC for the snapshot date
    const snapshotDayEnd = new Date(`${snapshotDate}T23:59:59Z`).getTime();
    const gpAlignedWithSnapshot = latestGpTs > 0 && latestGpTs <= snapshotDayEnd;

    const gpTotalValue = gpAlignedWithSnapshot ? (portfolioData?.gp_total_value || 0) : 0;

    const totalValue = positionsValue + cashValue + gpTotalValue;

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

    // 5. Fetch strategy configurations
    const { data: configsRaw } = await supabase
      .from('strategy_configurations')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const strategyConfigs = (configsRaw || []) as any[];

    // 6. Compute equity exposure — formula allineata al Risk Analyzer:
    //    numeratore = grandTotal (stock+ETF+commodity+naked put+leap+strategie+sintetiche CC/DR-CC)
    //                 + valore stock delle GP allineate alla snapshot date
    //    denominatore = netting_total (NON total_value)
    const derivatives = positions.filter(p => p.asset_type === 'derivative');
    const categories = categorizeDerivatives(derivatives, positions, overrides, strategyConfigs);
    const riskAnalysis = analyzePortfolioRisk(positions, categories);

    // Stock GP allineate alla data snapshot (stessa logica temporale del gpTotalValue)
    const { data: gpStocksRaw } = await supabase
      .from('gp_holdings')
      .select('asset_type, market_value')
      .eq('portfolio_id', portfolioId);
    const gpStockTotalValue = gpAlignedWithSnapshot
      ? (gpStocksRaw || [])
          .filter((h: any) => h.asset_type === 'stock')
          .reduce((sum: number, h: any) => sum + Number(h.market_value || 0), 0)
      : 0;

    const equityNumerator = riskAnalysis.grandTotal + gpStockTotalValue;
    const equityExposurePct = nettingTotal > 0
      ? Math.max(0, Math.min(1, equityNumerator / nettingTotal))
      : 0.6;

    // 7. Compute USD exposure
    const currencyExposures = calculateCurrencyExposure(riskAnalysis);
    const totalExposure = currencyExposures.reduce((sum, c) => sum + c.totalRisk, 0);
    const usdExposure = currencyExposures.find(c => c.currency === 'USD');
    const usdExposurePct = totalExposure > 0 && usdExposure
      ? usdExposure.totalRisk / totalExposure
      : 0;

    // 8. Upsert into historical_data
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

/**
 * Ricalcola lo snapshot della snapshot_date corrente del portfolio,
 * rileggendo strategy_configurations aggiornate. Idempotente.
 * Da chiamare dopo ogni modifica a strategy_configurations.
 */
export async function recomputeLatestSnapshot(portfolioId: string): Promise<void> {
  try {
    if (!portfolioId || portfolioId === 'AGGREGATED' || portfolioId.startsWith('AGGREGATED_')) return;
    const { data: pf, error } = await supabase
      .from('portfolios')
      .select('snapshot_date, cash_value')
      .eq('id', portfolioId)
      .single();
    if (error || !pf?.snapshot_date) {
      console.log('[recomputeLatestSnapshot] No snapshot_date, skipping', portfolioId);
      return;
    }
    await upsertUploadSnapshot({
      portfolioId,
      snapshotDate: pf.snapshot_date as string,
      cashValue: Number(pf.cash_value || 0),
    });
  } catch (err) {
    console.error('[recomputeLatestSnapshot] Unexpected error:', err);
  }
}
