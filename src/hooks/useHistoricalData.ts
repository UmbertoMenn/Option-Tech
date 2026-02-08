import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { HistoricalDataEntry, HistoricalDataInput } from '@/types/historicalData';
import { AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';

// Helper per aggregare dati storici per data
function aggregateHistoricalByDate(data: HistoricalDataEntry[]): HistoricalDataEntry[] {
  const byDate = new Map<string, HistoricalDataEntry>();
  
  data.forEach(entry => {
    const existing = byDate.get(entry.snapshot_date);
    if (existing) {
      byDate.set(entry.snapshot_date, {
        ...existing,
        total_value: (existing.total_value || 0) + (entry.total_value || 0),
        netting_total: (existing.netting_total || 0) + (entry.netting_total || 0),
        netting_ex_cc: (existing.netting_ex_cc || 0) + (entry.netting_ex_cc || 0),
        netting_ex_cc_np: (existing.netting_ex_cc_np || 0) + (entry.netting_ex_cc_np || 0),
        deposits: (existing.deposits || 0) + (entry.deposits || 0),
        average_balance: (existing.average_balance || 0) + (entry.average_balance || 0),
      });
    } else {
      byDate.set(entry.snapshot_date, { ...entry });
    }
  });
  
  return Array.from(byDate.values())
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
}

export function useHistoricalData(portfolioId: string | undefined) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const isAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;

  const historicalDataQuery = useQuery({
    queryKey: ['historical-data', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      // Vista aggregata: fetch tutti i dati e aggrega per data
      if (isAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('historical_data')
          .select('*')
          .order('snapshot_date', { ascending: false });
        
        if (error) throw error;
        return aggregateHistoricalByDate(data as unknown as HistoricalDataEntry[]);
      }
      
      // Query normale per portfolio singolo
      const { data, error } = await supabase
        .from('historical_data')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('snapshot_date', { ascending: false });
      
      if (error) throw error;
      return data as unknown as HistoricalDataEntry[];
    },
    enabled: !!portfolioId && (!isAggregated || isAdmin),
  });

  const upsertMutation = useMutation({
    mutationFn: async (entry: HistoricalDataInput) => {
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      // Build upsert payload - use explicit type to satisfy TypeScript
      const upsertPayload = {
        portfolio_id: portfolioId,
        snapshot_date: entry.snapshot_date,
        total_value: entry.total_value,
        netting_total: entry.netting_total,
        netting_ex_cc: entry.netting_ex_cc,
        netting_ex_cc_np: entry.netting_ex_cc_np,
        deposits: entry.deposits,
        average_balance: entry.average_balance,
        equity_exposure_pct: entry.equity_exposure_pct,
        usd_exposure_pct: entry.usd_exposure_pct,
        ...(entry.id && { id: entry.id }), // Include id only if provided
      };
      
      const { data, error } = await supabase
        .from('historical_data')
        .upsert(upsertPayload, {
          onConflict: entry.id ? 'id' : 'portfolio_id,snapshot_date'
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
