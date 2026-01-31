import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DepositEntry, DepositInput } from '@/types/deposits';

export function useDeposits(portfolioId: string | undefined) {
  const queryClient = useQueryClient();

  const depositsQuery = useQuery({
    queryKey: ['deposits', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('deposit_date', { ascending: false });
      
      if (error) throw error;
      return data as unknown as DepositEntry[];
    },
    enabled: !!portfolioId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (entry: DepositInput) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      const { data, error } = await supabase
        .from('deposits')
        .upsert({
          portfolio_id: portfolioId,
          deposit_date: entry.deposit_date,
          amount: entry.amount,
          description: entry.description || null,
        }, {
          onConflict: 'portfolio_id,deposit_date'
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      toast.success('Versamento salvato!');
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
      toast.success('Versamento eliminato');
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
