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
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { fetchLocalPrices, UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { saveFullSnapshot } from '@/lib/fullSnapshot';

interface UploadSnapshotInput {
  portfolioId: string;
  snapshotDate: string; // YYYY-MM-DD
  cashValue: number;
  /**
   * true quando la GP è stata aggiornata NELLO STESSO upload dei flussi CSV
   * (stessa DATA RIFERIMENTO dei titoli): in tal caso la GP è per costruzione
   * allineata allo snapshot e il check sui timestamp va bypassato — il file
   * è tipicamente datato al giorno precedente e i timestamp di scrittura
   * (odierni) risulterebbero sempre "successivi" alla snapshot date.
   */
  gpRefreshedInThisUpload?: boolean;
}

export async function upsertUploadSnapshot({ portfolioId, snapshotDate, cashValue, gpRefreshedInThisUpload }: UploadSnapshotInput): Promise<void> {
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
    const gpAlignedWithSnapshot = gpRefreshedInThisUpload === true
      || (latestGpTs > 0 && latestGpTs <= snapshotDayEnd);

    const gpTotalValue = gpAlignedWithSnapshot ? (portfolioData?.gp_total_value || 0) : 0;

    const totalValue = positionsValue + cashValue + gpTotalValue;

    // 3. Fetch derivative overrides
    const { data: overridesRaw } = await supabase
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const overrides = (overridesRaw || []) as unknown as DerivativeOverride[];

    // 3b. Fetch strategy configurations — DEVONO essere lette PRIMA del netting:
    //     determinano come i derivati vengono raggruppati in strategie (covered call,
    //     naked put, put spread, …) e quindi i valori di Netting Intrinseco (A/B).
    //     In precedenza venivano lette dopo e NON passate al netting: lo snapshot
    //     ricalcolava il netting ignorando del tutto la configurazione appena salvata.
    const { data: configsRaw } = await supabase
      .from('strategy_configurations')
      .select('*')
      .eq('portfolio_id', portfolioId);
    const strategyConfigs = (configsRaw || []) as unknown as StrategyConfiguration[];

    // 3c. Prezzi dei sottostanti CONGELATI per QUESTA data di snapshot.
    //     Principio: il netting non deve muoversi coi prezzi live. Per ogni sottostante
    //     il prezzo è fissato al momento del primo calcolo di QUESTO snapshot e non
    //     cambia più (gli snapshot storici restano quindi immutati per costruzione).
    //     Priorità per ogni underlying:
    //       1) prezzo già congelato in historical_data.snapshot_underlying_prices (questa data)
    //       2) altrimenti prezzo live preso UNA volta da underlying_prices e congelato ora
    //     I sottostanti che sono anche titoli in portafoglio usano il loro snapshot_price
    //     dall'Excel (gestito dentro il netting via associatedUnderlying) e non necessitano
    //     di questa mappa, ma vengono comunque congelati per coerenza/diagnostica.
    const derivativeUnderlyings = Array.from(
      new Set(
        positions
          .filter((p) => p.asset_type === 'derivative')
          .map((p) => p.underlying || p.description || '')
          .filter((u) => !!u),
      ),
    );

    // Prezzi già congelati per questa data (se lo snapshot esiste già)
    const { data: existingSnap } = await supabase
      .from('historical_data')
      .select('snapshot_underlying_prices')
      .eq('portfolio_id', portfolioId)
      .eq('snapshot_date', snapshotDate)
      .maybeSingle();
    const frozen: Record<string, number> = {
      ...(((existingSnap?.snapshot_underlying_prices as Record<string, number>) || {})),
    };

    // Solo i sottostanti non ancora congelati vengono presi dal feed live, una volta
    const missingKeys = derivativeUnderlyings.filter((k) => !(k in frozen) || !(frozen[k] > 0));
    if (missingKeys.length > 0) {
      try {
        const local = await fetchLocalPrices(missingKeys);
        for (const k of missingKeys) {
          const px = local.prices[k]?.price;
          if (typeof px === 'number' && px > 0) frozen[k] = px;
        }
      } catch (e) {
        console.error('[UploadSnapshot] Could not fetch underlying prices to freeze:', e);
      }
    }

    // Mappa nel formato atteso dal netting
    const underlyingPrices: Record<string, UnderlyingPrice> = {};
    for (const [k, px] of Object.entries(frozen)) {
      underlyingPrices[k] = { price: px, currency: 'USD' };
    }

    // 4. Compute netting — con le strategy configs E i prezzi CONGELATI (fissi)
    const nettingResult = computeSinglePortfolioNetting(
      positions,
      overrides,
      underlyingPrices,
      strategyConfigs,
    );
    const nettingTotal = totalValue + nettingResult.totalNetting;
    const nettingIntrinsicA = totalValue + nettingResult.nettingIntrinsicA;
    const nettingIntrinsicB = totalValue + nettingResult.nettingIntrinsicB;

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
        netting_ex_cc: nettingIntrinsicA, // mapped for compatibility
        netting_ex_cc_np: nettingIntrinsicA, // Netting Intrinseco (A)
        netting_intrinsic_b: nettingIntrinsicB,
        equity_exposure_pct: equityExposurePct,
        usd_exposure_pct: usdExposurePct,
        snapshot_underlying_prices: frozen as unknown as Record<string, number>,
        deposits: 0,
        average_balance: 0,
      }, { onConflict: 'portfolio_id,snapshot_date' });

    // Congela anche lo snapshot COMPLETO (posizioni + configs + overrides + GP)
    // per la Visualizzazione Storica. Non blocca il flusso in caso di errore.
    await saveFullSnapshot(portfolioId, snapshotDate, cashValue);

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
    if (error) {
      console.error('[recomputeLatestSnapshot] Error reading portfolio:', error.message);
      return;
    }

    // La data di riferimento è normalmente portfolios.snapshot_date. Se manca
    // (es. portfolio popolato senza un upload che la imposti), ricadiamo sulla
    // data più recente già presente in historical_data: così il record che
    // l'utente sta effettivamente guardando viene comunque riscritto col netting
    // aggiornato, invece di uscire senza fare nulla.
    let snapshotDate = pf?.snapshot_date as string | null;
    if (!snapshotDate) {
      const { data: latest } = await supabase
        .from('historical_data')
        .select('snapshot_date')
        .eq('portfolio_id', portfolioId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshotDate = (latest?.snapshot_date as string) || null;
    }

    if (!snapshotDate) {
      console.log('[recomputeLatestSnapshot] No snapshot_date and no historical_data, skipping', portfolioId);
      return;
    }

    await upsertUploadSnapshot({
      portfolioId,
      snapshotDate,
      cashValue: Number(pf?.cash_value || 0),
    });
    console.log('[recomputeLatestSnapshot] Recomputed snapshot for', portfolioId, 'date', snapshotDate);
  } catch (err) {
    console.error('[recomputeLatestSnapshot] Unexpected error:', err);
  }
}
