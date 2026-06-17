import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DepositEntry, DepositInput } from '@/types/deposits';
import { AGGREGATED_PORTFOLIO_ID, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPortfolioIds } from '@/hooks/useUserPortfolioIds';

export function useDeposits(portfolioId: string | undefined) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const isGlobalAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;
  const isAggregated = isAnyAggregatedId(portfolioId);
  const { portfolioIds: userPortfolioIds, isUserAggregated } = useUserPortfolioIds(portfolioId);

  const depositsQuery = useQuery({
    queryKey: ['deposits', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      // Global aggregated
      if (isGlobalAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('deposits').select('*').order('deposit_date', { ascending: false });
        if (error) throw error;
        return data as unknown as DepositEntry[];
      }
      
      // Per-user aggregated
      if (isUserAggregated && userPortfolioIds.length > 0) {
        const { data, error } = await supabase
          .from('deposits').select('*')
          .in('portfolio_id', userPortfolioIds)
          .order('deposit_date', { ascending: false });
        if (error) throw error;
        return data as unknown as DepositEntry[];
      }
      
      // Single portfolio
      const { data, error } = await supabase
        .from('deposits').select('*').eq('portfolio_id', portfolioId)
        .order('deposit_date', { ascending: false });
      if (error) throw error;
      return data as unknown as DepositEntry[];
    },
    enabled: !!portfolioId && (!isGlobalAggregated || isAdmin) && (!isUserAggregated || userPortfolioIds.length > 0),
  });

  const upsertMutation = useMutation({
    mutationFn: async (entry: DepositInput & { id?: string }) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      if (entry.id) {
        const { data, error } = await supabase
          .from('deposits').update({ deposit_date: entry.deposit_date, amount: entry.amount, description: entry.description || null })
          .eq('id', entry.id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('deposits').insert({ portfolio_id: portfolioId, deposit_date: entry.deposit_date, amount: entry.amount, description: entry.description || null })
          .select().single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Movimento salvato!');
    },
    onError: (error) => { toast.error('Errore nel salvataggio', { description: error.message }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('deposits').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Movimento eliminato');
    },
    onError: (error) => { toast.error('Errore nell\'eliminazione', { description: error.message }); },
  });

  const totalDeposits = depositsQuery.data?.reduce((sum, d) => sum + d.amount, 0) || 0;

  return {
    deposits: depositsQuery.data || [],
    isLoading: depositsQuery.isLoading,
    totalDeposits,
    upsertDeposit: upsertMutation.mutate,
    deleteDeposit: deleteMutation.mutate,
    isUpserting: upsertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
