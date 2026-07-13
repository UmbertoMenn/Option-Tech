import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { AGGREGATED_PORTFOLIO_ID, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useUserPortfolioIds } from '@/hooks/useUserPortfolioIds';
import { useFullSnapshot } from '@/hooks/useFullSnapshot';
import { recomputeLatestSnapshot } from '@/lib/uploadSnapshot';

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

  const upsertMutation = useMutation({
    mutationFn: async (params: UpsertConfigParams) => {
      if (isHistoricalActive) throw new Error('Visualizzazione storica attiva: sola lettura');
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
          config_locked: params.config_locked ?? true,
          override_canceled_at: params.override_canceled_at ?? null,
        })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      if (portfolioId) {
        recomputeLatestSnapshot(portfolioId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        });
      }
    },
    onError: (error) => {
      console.error('Failed to save strategy configuration:', error);
      toast.error('Errore nel salvare la configurazione');
    },
  });

  const upsertBatchMutation = useMutation({
    mutationFn: async (configs: UpsertConfigParams[]) => {
      if (isHistoricalActive) throw new Error('Visualizzazione storica attiva: sola lettura');
      if (!portfolioId) throw new Error('No portfolio selected');
      
      // Full replacement is intentional: callers include untouched configs too.
      await supabase.from('strategy_configurations').delete().eq('portfolio_id', portfolioId);
      
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
        config_locked: c.config_locked ?? true,
        override_canceled_at: c.override_canceled_at ?? null,
      }));
      
      const { error } = await supabase.from('strategy_configurations').insert(rows);
      if (error) throw error;
    },
    onSuccess: (_data, configs) => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      toast.success('Configurazione strategie salvata');
      if (portfolioId && configs.some(config => !config.config_locked)) {
        recomputeLatestSnapshot(portfolioId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['historical-data'] });
        });
      }
    },
    onError: (error) => {
      console.error('Failed to batch save strategy configurations:', error);
      toast.error('Errore nel salvare la configurazione');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (configId: string) => {
      if (isHistoricalActive) throw new Error('Visualizzazione storica attiva: sola lettura');
      const { error } = await supabase.from('strategy_configurations').delete().eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
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
      if (isHistoricalActive) throw new Error('Visualizzazione storica attiva: sola lettura');
      const { error } = await supabase
        .from('strategy_configurations')
        .update({ config_locked: false, override_canceled_at: new Date().toISOString() })
        .eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
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
