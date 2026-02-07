import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { HistoricalDataEntry, HistoricalDataInput } from '@/types/historicalData';

export function useHistoricalData(portfolioId: string | undefined) {
  const queryClient = useQueryClient();

  const historicalDataQuery = useQuery({
    queryKey: ['historical-data', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      const { data, error } = await supabase
        .from('historical_data')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('snapshot_date', { ascending: false });
      
      if (error) throw error;
      return data as unknown as HistoricalDataEntry[];
    },
    enabled: !!portfolioId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (entry: HistoricalDataInput) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      const { data, error } = await supabase
        .from('historical_data')
        .upsert({
          portfolio_id: portfolioId,
          snapshot_date: entry.snapshot_date,
          total_value: entry.total_value,
          netting_total: entry.netting_total,
          netting_ex_cc: entry.netting_ex_cc,
          netting_ex_cc_np: entry.netting_ex_cc_np,
          deposits: entry.deposits,
          average_balance: entry.average_balance,
          equity_exposure_pct: entry.equity_exposure_pct,
        }, {
          onConflict: 'portfolio_id,snapshot_date'
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Dati storici salvati!');
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
        .from('historical_data')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historical-data'] });
      toast.success('Dato storico eliminato');
    },
    onError: (error) => {
      toast.error('Errore nell\'eliminazione', {
        description: error.message,
      });
    },
  });

  // Get the earliest entry for initial value calculation
  const earliestEntry = historicalDataQuery.data?.length 
    ? historicalDataQuery.data[historicalDataQuery.data.length - 1] 
    : null;

  // Get the latest entry for current comparison
  const latestEntry = historicalDataQuery.data?.[0] || null;

  return {
    historicalData: historicalDataQuery.data || [],
    isLoading: historicalDataQuery.isLoading,
    earliestEntry,
    latestEntry,
    upsertHistoricalData: upsertMutation.mutate,
    deleteHistoricalData: deleteMutation.mutate,
    isUpserting: upsertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
