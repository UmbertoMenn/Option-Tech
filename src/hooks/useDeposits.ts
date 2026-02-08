import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DepositEntry, DepositInput } from '@/types/deposits';
import { AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';

export function useDeposits(portfolioId: string | undefined) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const isAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;

  const depositsQuery = useQuery({
    queryKey: ['deposits', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      // Vista aggregata: fetch tutti i depositi
      if (isAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('deposits')
          .select('*')
          .order('deposit_date', { ascending: false });
        
        if (error) throw error;
        return data as unknown as DepositEntry[];
      }
      
      // Query normale per portfolio singolo
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('deposit_date', { ascending: false });
      
      if (error) throw error;
      return data as unknown as DepositEntry[];
    },
    enabled: !!portfolioId && (!isAggregated || isAdmin),
  });

  const upsertMutation = useMutation({
    mutationFn: async (entry: DepositInput & { id?: string }) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      if (entry.id) {
        // Update existing
        const { data, error } = await supabase
          .from('deposits')
          .update({
            deposit_date: entry.deposit_date,
            amount: entry.amount,
            description: entry.description || null,
          })
          .eq('id', entry.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('deposits')
          .insert({
            portfolio_id: portfolioId,
            deposit_date: entry.deposit_date,
            amount: entry.amount,
            description: entry.description || null,
          })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      toast.success('Movimento salvato!');
    },
    onError: (error) => {
      toast.error('Errore nel salvataggio', {
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('deposits')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      toast.success('Movimento eliminato');
    },
    onError: (error) => {
      toast.error('Errore nell\'eliminazione', {
        description: error.message,
      });
    },
  });

  // Calculate total deposits
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
