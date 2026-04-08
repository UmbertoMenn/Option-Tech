import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { AGGREGATED_PORTFOLIO_ID, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useUserPortfolioIds } from '@/hooks/useUserPortfolioIds';

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
}

export const STRATEGY_TYPE_LABELS: Record<string, string> = {
  covered_call: 'Covered Call',
  derisking_covered_call: 'De-Risking Covered Call',
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

  const { data: configurations = [], isLoading } = useQuery({
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
    enabled: !!portfolioId && (!isGlobalAggregated || isAdmin) && (!isUserAggregated || userPortfolioIds.length > 0),
  });

  const upsertMutation = useMutation({
    mutationFn: async (params: UpsertConfigParams) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      const { data, error } = await supabase
        .from('strategy_configurations')
        .upsert({
          portfolio_id: portfolioId,
          underlying: params.underlying,
          strategy_type: params.strategy_type,
          position_signatures: params.position_signatures as any,
          is_synthetic: params.is_synthetic || false,
          linked_stock_id: params.linked_stock_id || null,
          linked_stock_slot_ids: (params.linked_stock_slot_ids || []) as any,
        }, { onConflict: 'portfolio_id,underlying,strategy_type' })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
    },
    onError: (error) => {
      console.error('Failed to save strategy configuration:', error);
      toast.error('Errore nel salvare la configurazione');
    },
  });

  const upsertBatchMutation = useMutation({
    mutationFn: async (configs: UpsertConfigParams[]) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      // Delete existing configs for this portfolio first
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
      }));
      
      const { error } = await supabase.from('strategy_configurations').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
      toast.success('Configurazione strategie salvata');
    },
    onError: (error) => {
      console.error('Failed to batch save strategy configurations:', error);
      toast.error('Errore nel salvare la configurazione');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase.from('strategy_configurations').delete().eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configurations', portfolioId] });
    },
    onError: (error) => {
      console.error('Failed to delete strategy configuration:', error);
      toast.error('Errore nel rimuovere la configurazione');
    },
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
    getConfigForUnderlying,
    isSaving: upsertMutation.isPending || upsertBatchMutation.isPending,
  };
}
