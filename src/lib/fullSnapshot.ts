/**
 * Snapshot COMPLETO del portafoglio per data (tabella portfolio_full_snapshots).
 *
 * Congela in JSONB: posizioni, configurazioni strategie, override derivati,
 * holdings GP, cash. Consente la "Visualizzazione Storica": riprendere il
 * portafoglio in sola lettura ad una data passata, in tutte le sezioni.
 *
 * Scrittura: saveFullSnapshot è chiamata da upsertUploadSnapshot, quindi lo
 * snapshot completo si aggiorna sia all'upload Excel sia al ricalcolo dopo
 * modifiche alle configurazioni. Re-upload di una data ricongela solo quella
 * data (stesso principio di isolamento di snapshot_underlying_prices).
 */
import { supabase } from '@/integrations/supabase/client';
import { Position } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { GPHoldingRow } from '@/hooks/useGPHoldings';
import { configsToFreeze, historicalConfigsEditedAt, HistoricalConfig } from '@/lib/historicalConfigEdit';

export interface FullSnapshot {
  portfolio_id: string;
  snapshot_date: string;
  positions: Position[];
  strategy_configurations: StrategyConfiguration[];
  derivative_overrides: DerivativeOverride[];
  gp_holdings: GPHoldingRow[];
  cash_value: number;
  gp_total_value: number | null;
  restricted_cash_value?: number | null;
  /** Data (ISO) dell'ultima correzione manuale delle config di questo snapshot, o null. */
  configs_edited_at?: string | null;
}

/**
 * Congela lo stato completo del portafoglio per la data indicata.
 * Idempotente: upsert su (portfolio_id, snapshot_date).
 * Non lancia: logga e ritorna (come il resto del flusso snapshot).
 */
export async function saveFullSnapshot(
  portfolioId: string,
  snapshotDate: string,
  cashValue: number
): Promise<void> {
  try {
    const [posRes, cfgRes, ovrRes, gpRes, pfRes] = await Promise.all([
      supabase.from('positions').select('*').eq('portfolio_id', portfolioId),
      supabase.from('strategy_configurations').select('*').eq('portfolio_id', portfolioId),
      supabase.from('derivative_overrides').select('*').eq('portfolio_id', portfolioId),
      supabase.from('gp_holdings').select('*').eq('portfolio_id', portfolioId),
      supabase.from('portfolios').select('gp_total_value, restricted_cash_value').eq('id', portfolioId).single(),
    ]);

    const readError = [posRes, cfgRes, ovrRes, gpRes, pfRes].find(result => result.error)?.error;
    if (readError) {
      console.error('[FullSnapshot] Incomplete read; snapshot not saved:', readError.message);
      return;
    }

    // Config corrette a mano in Visualizzazione Storica: un ricongelamento della data
    // (re-upload / ricalcolo) non le sovrascrive con le config live.
    const { data: existing } = await supabase
      .from('portfolio_full_snapshots')
      .select('strategy_configurations')
      .eq('portfolio_id', portfolioId)
      .eq('snapshot_date', snapshotDate)
      .maybeSingle();
    const frozenConfigs = configsToFreeze(
      (existing?.strategy_configurations ?? null) as unknown as HistoricalConfig[] | null,
      cfgRes.data ?? [],
    );

    const { error } = await supabase
      .from('portfolio_full_snapshots')
      .upsert({
        portfolio_id: portfolioId,
        snapshot_date: snapshotDate,
        positions: (posRes.data ?? []) as unknown as never,
        strategy_configurations: frozenConfigs as unknown as never,
        derivative_overrides: (ovrRes.data ?? []) as unknown as never,
        gp_holdings: (gpRes.data ?? []) as unknown as never,
        cash_value: cashValue,
        gp_total_value: (pfRes.data?.gp_total_value as number | null) ?? null,
        restricted_cash_value: pfRes.data?.restricted_cash_value ?? 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'portfolio_id,snapshot_date' });

    if (error) {
      console.error('[FullSnapshot] Upsert failed:', error.message);
    } else {
      console.log('[FullSnapshot] Saved full snapshot:', {
        portfolioId,
        snapshotDate,
        positions: (posRes.data ?? []).length,
        configs: frozenConfigs.length,
        overrides: (ovrRes.data ?? []).length,
        gpHoldings: (gpRes.data ?? []).length,
      });
    }
  } catch (err) {
    console.error('[FullSnapshot] Unexpected error:', err);
  }
}

/** Legge lo snapshot completo per (portfolio, data). Null se assente. */
export async function fetchFullSnapshot(
  portfolioId: string,
  snapshotDate: string
): Promise<FullSnapshot | null> {
  const { data, error } = await supabase
    .from('portfolio_full_snapshots')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .eq('snapshot_date', snapshotDate)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    portfolio_id: data.portfolio_id,
    snapshot_date: data.snapshot_date,
    positions: (data.positions ?? []) as unknown as Position[],
    strategy_configurations: (data.strategy_configurations ?? []) as unknown as StrategyConfiguration[],
    derivative_overrides: (data.derivative_overrides ?? []) as unknown as DerivativeOverride[],
    gp_holdings: (data.gp_holdings ?? []) as unknown as GPHoldingRow[],
    cash_value: Number(data.cash_value ?? 0),
    gp_total_value: data.gp_total_value != null ? Number(data.gp_total_value) : null,
    restricted_cash_value: data.restricted_cash_value != null ? Number(data.restricted_cash_value) : null,
    configs_edited_at: historicalConfigsEditedAt((data.strategy_configurations ?? []) as unknown as HistoricalConfig[]),
  };
}

/**
 * Scrive le configurazioni strategie corrette di uno snapshot STORICO (solo quella data).
 * Le config live e le altre date non vengono toccate.
 */
export async function saveHistoricalStrategyConfigs(
  portfolioId: string,
  snapshotDate: string,
  configs: HistoricalConfig[],
): Promise<void> {
  const { data, error } = await supabase
    .from('portfolio_full_snapshots')
    .update({ strategy_configurations: configs as unknown as never })
    .eq('portfolio_id', portfolioId)
    .eq('snapshot_date', snapshotDate)
    .select('snapshot_date');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Snapshot storico non trovato o non modificabile');
}

/** Date disponibili per la visualizzazione storica (più recente prima). */
export async function fetchFullSnapshotDates(portfolioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('portfolio_full_snapshots')
    .select('snapshot_date')
    .eq('portfolio_id', portfolioId)
    .order('snapshot_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => r.snapshot_date as string);
}
