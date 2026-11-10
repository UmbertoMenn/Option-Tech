import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { AGGREGATED_PORTFOLIO_ID, isAnyAggregatedId, usePortfolioContext } from '@/contexts/PortfolioContext';
import { useUserPortfolioIds } from '@/hooks/useUserPortfolioIds';
import { useFullSnapshot } from '@/hooks/useFullSnapshot';
import { recomputeLatestSnapshot, recomputeHistoricalSnapshot } from '@/lib/uploadSnapshot';
import { saveHistoricalStrategyConfigs } from '@/lib/fullSnapshot';
import {
  HistoricalConfig,
  replaceHistoricalConfigs,
  addHistoricalConfig,
  removeHistoricalConfig,
  cancelHistoricalOverride,
} from '@/lib/historicalConfigEdit';
import { shouldRecomputeAfterBatchSave } from '@/lib/strategyConfigGates';

export interface PositionSignature {
  option_type: string; // 'call' | 'put'
  strike: number;
  expiry: string; // YYYY-MM-DD
  quantity_sign: number; // 1 or -1
  quantity_abs?: number; // number of contracts assigned (default 1)
}

export interface StrategyConfiguration {
  id: string;
  portfolio_id: string;
  underlying: string;
  strategy_type: string;
  position_signatures: PositionSignature[];
  is_synthetic: boolean;
  linked_stock_id: string | null;
  linked_stock_slot_ids: string[];
  sort_order: number;
  config_locked: boolean;
  override_canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertConfigParams {
  underlying: string;
  strategy_type: string;
  position_signatures: PositionSignature[];
  is_synthetic?: boolean;
  linked_stock_id?: string | null;
  linked_stock_slot_ids?: string[];
  sort_order?: number;
  config_locked?: boolean;
  override_canceled_at?: string | null;
}

export const STRATEGY_TYPE_LABELS: Record<string, string> = {
  covered_call: 'Covered Call',
  derisking_covered_call: 'De-Risking Covered Call',
  protection: 'Protezione pura (long PUT)',
  iron_condor: 'Iron Condor',
  double_diagonal: 'Double Diagonal',
  naked_put: 'Naked Put',
  put_spread: 'Put Spread',
  diagonal_put_spread: 'Diagonal Put Spread',
  leap_call: 'LEAP Call',
  other: 'Altre Strategie',
};

export function useStrategyConfigurations() {
  const { portfolio } = usePortfolio();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const portfolioId = portfolio?.id;
  const isGlobalAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;
  const isAggregated = isAnyAggregatedId(portfolioId);
  const { portfolioIds: userPortfolioIds, isUserAggregated } = useUserPortfolioIds(portfolioId);
  const { snapshot: fullSnapshot, isLoading: isSnapshotLoading, isHistoricalActive } = useFullSnapshot();

  const { data: liveConfigurations = [], isLoading: isLiveLoading } = useQuery({
    queryKey: ['strategy-configurations', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      if (isGlobalAggregated && isAdmin) {
      const { data, error } = await supabase.from('strategy_configurations').select('*').order('sort_order', { ascending: true });
        if (error) throw error;
        return (data || []) as unknown as StrategyConfiguration[];
      }
      
      if (isUserAggregated && userPortfolioIds.length > 0) {
        const { data, error } = await supabase
          .from('strategy_configurations').select('*')
          .in('portfolio_id', userPortfolioIds)
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data || []) as unknown as StrategyConfiguration[];
      }
      
      const { data, error } = await supabase
        .from('strategy_configurations').select('*').eq('portfolio_id', portfolioId).order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as StrategyConfiguration[];
    },
    enabled: !isHistoricalActive && !!portfolioId && (!isGlobalAggregated || isAdmin) && (!isUserAggregated || userPortfolioIds.length > 0),
  });

  // Visualizzazione storica: configurazioni congelate dallo snapshot completo
  const configurations = isHistoricalActive
    ? (fullSnapshot?.strategy_configurations ?? [])
    : liveConfigurations;
  const isLoading = isHistoricalActive ? isSnapshotLoading : isLiveLoading;

  /* ---------- Visualizzazione Storica: correzione delle config di QUELLA data ----------
   * Le config congelate nello snapshot possono essere sbagliate (es. quantità non
   * aggiornata dopo una seconda vendita). Le modifiche riscrivono solo
   * portfolio_full_snapshots della data visualizzata e ne ricalcolano le metriche
   * storiche; config live e altre date restano intatte. La data corrente si corregge
   * dalla vista attuale (verrebbe ricongelata dalle config live). */
  const { selectedPortfolio } = usePortfolioContext();
  const histDate = fullSnapshot?.snapshot_date ?? null;
  const histPortfolioId = fullSnapshot?.portfolio_id ?? null;
  const editHistorical = async (next: (cur: HistoricalConfig[], nowIso: string) => HistoricalConfig[]) => {
    if (!histDate || !histPortfolioId) throw new Error('Snapshot storico non caricato');
    if (selectedPortfolio?.snapshot_date && selectedPortfolio.snapshot_date === histDate) {
      throw new Error('È la data corrente del portafoglio: modifica le configurazioni dalla vista attuale');
    }
    const nowIso = new Date().toISOString();
    const updated = next((fullSnapshot?.strategy_configurations ?? []) as HistoricalConfig[], nowIso);
    await saveHistoricalStrategyConfigs(histPortfolioId, histDate, updated);
    const recomputed = await recomputeHistoricalSnapshot(histPortfolioId, histDate);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['full-snapshot', histPortfolioId, histDate] }),
      queryClient.invalidateQueries({ queryKey: ['historical-data'] }),
    ]);
    if (!recomputed) {
      toast.warning('Configurazioni salvate, ma il ricalcolo dei dati storici della data non è riuscito');
    }
  };
  const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const upsertMutation = useMutation({
    mutationFn: async (params: UpsertConfigParams) => {
      if (isHistoricalActive) {
        await editHistorical((cur, now) => addHistoricalConfig(cur, params, histPortfolioId!, now, newId));
        return null;
      }
      if (!portfolioId) throw new Error('No portfolio selected');
      const { data, error } = await supabase
        .from('strategy_configurations')
        .insert({
          portfolio_id: portfolioId,
          underlying: params.underlying,
          strategy_type: params.strategy_type,
          position_signatures: params.position_signatures as any,
          is_synthetic: params.is_synthetic || false,
          linked_stock_id: params.linked_stock_id || null,
          linked_stock_slot_ids: (params.linked_stock_slot_ids || []) as any,
          sort_order: params.sort_order ?? 0,
          config_locked: params.config_locked ?? false,
          override_canceled_at: params.override_canceled_at ?? null,
        })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (isHistoricalActive) return;
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      if (portfolioId) {
        recomputeLatestSnapshot(portfolioId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        });
      }
    },
    onError: (error) => {
      console.error('Failed to save strategy configuration:', error);
      toast.error('Errore nel salvare la configurazione', { description: (error as Error)?.message });
    },
  });

  const upsertBatchMutation = useMutation({
    mutationFn: async (configs: UpsertConfigParams[]) => {
      if (isHistoricalActive) {
        await editHistorical((_cur, now) => replaceHistoricalConfigs(configs, histPortfolioId!, now, newId));
        return;
      }
      if (!portfolioId) throw new Error('No portfolio selected');
      
      // Full replacement is intentional: callers include untouched configs too.
      const { error: deleteError } = await supabase.from('strategy_configurations').delete().eq('portfolio_id', portfolioId);
      // Con un set vuoto la cancellazione È il salvataggio: un errore non può
      // passare in silenzio come "Configurazione strategie salvata".
      if (deleteError) throw deleteError;
      
      if (configs.length === 0) return;
      
      // Save each config as a separate row with sort_order — NO deduplication
      const rows = configs.map((c, index) => ({
        portfolio_id: portfolioId,
        underlying: c.underlying,
        strategy_type: c.strategy_type,
        position_signatures: c.position_signatures as any,
        is_synthetic: c.is_synthetic || false,
        linked_stock_id: c.linked_stock_id || null,
        linked_stock_slot_ids: (c.linked_stock_slot_ids || []) as any,
        sort_order: c.sort_order ?? index,
        config_locked: c.config_locked ?? false,
        override_canceled_at: c.override_canceled_at ?? null,
      }));
      
      const { error } = await supabase.from('strategy_configurations').insert(rows);
      if (error) throw error;
    },
    onSuccess: (_data, configs) => {
      if (isHistoricalActive) {
        toast.success(`Configurazione strategie corretta per lo snapshot del ${histDate ? histDate.split('-').reverse().join('/') : ''}`, {
          description: 'Solo questa data: configurazioni attuali e altre date invariate.',
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      toast.success('Configurazione strategie salvata');
      if (portfolioId && shouldRecomputeAfterBatchSave(configs)) {
        recomputeLatestSnapshot(portfolioId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        });
      }
    },
    onError: (error) => {
      console.error('Failed to batch save strategy configurations:', error);
      toast.error('Errore nel salvare la configurazione', { description: (error as Error)?.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (configId: string) => {
      if (isHistoricalActive) {
        await editHistorical((cur, now) => removeHistoricalConfig(cur, configId, now));
        return;
      }
      const { error } = await supabase.from('strategy_configurations').delete().eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (isHistoricalActive) return;
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      if (portfolioId) {
        recomputeLatestSnapshot(portfolioId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        });

      }
    },
    onError: (error) => {
      console.error('Failed to delete strategy configuration:', error);
      toast.error('Errore nel rimuovere la configurazione');
    },
  });

  const cancelOverrideMutation = useMutation({
    mutationFn: async (configId: string) => {
      if (isHistoricalActive) {
        await editHistorical((cur, now) => cancelHistoricalOverride(cur, configId, now));
        return;
      }
      const { error } = await supabase
        .from('strategy_configurations')
        .update({ config_locked: false, override_canceled_at: new Date().toISOString() })
        .eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (!isHistoricalActive) queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      toast.success('Override annullato: la strategia può essere riconciliata automaticamente');
    },
    onError: () => toast.error("Impossibile annullare l'override"),
  });

  const getConfigForUnderlying = (underlying: string): StrategyConfiguration | undefined => {
    return configurations.find(c => c.underlying === underlying);
  };

  const hasConfigurations = configurations.length > 0;

  return {
    configurations,
    isLoading,
    hasConfigurations,
    upsertConfig: upsertMutation.mutateAsync,
    upsertBatch: upsertBatchMutation.mutateAsync,
    deleteConfig: deleteMutation.mutateAsync,
    cancelOverride: cancelOverrideMutation.mutateAsync,
    getConfigForUnderlying,
    isSaving: upsertMutation.isPending || upsertBatchMutation.isPending,
  };
}
