import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ParsedOrder } from '@/lib/orderFileParser';

export interface CoveredCallPremium {
  id: string;
  portfolio_id: string;
  ticker: string;
  underlying: string;
  orders_json: ParsedOrder[];
  transaction_cost: number;
  net_per_share: number;
  first_operation_date: string | null;
  last_operation_date: string | null;
  contracts_count: number;
  created_at: string;
  updated_at: string;
}

interface UpsertPremiumData {
  ticker: string;
  underlying: string;
  orders_json: ParsedOrder[];
  transaction_cost: number;
  net_per_share: number;
  first_operation_date: string | null;
  last_operation_date: string | null;
  contracts_count: number;
}

export function useCoveredCallPremiums(portfolioId: string | undefined) {
  const queryClient = useQueryClient();
  
  // Query to fetch all premiums for the portfolio
  const { data: premiums = [], isLoading, refetch } = useQuery({
    queryKey: ['covered-call-premiums', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      const { data, error } = await supabase
        .from('covered_call_premiums')
        .select('*')
        .eq('portfolio_id', portfolioId);
      
      if (error) throw error;
      
      // Parse orders_json from JSON to array
      return (data || []).map(row => ({
        ...row,
        orders_json: (row.orders_json as unknown as ParsedOrder[]) || [],
      })) as CoveredCallPremium[];
    },
    enabled: !!portfolioId,
  });
  
  // Get premium by ticker
  const getPremiumByTicker = (ticker: string): CoveredCallPremium | undefined => {
    return premiums.find(p => p.ticker.toUpperCase() === ticker.toUpperCase());
  };
  
  // Upsert mutation (insert or update)
  const upsertMutation = useMutation({
    mutationFn: async (data: UpsertPremiumData) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      const payload = {
        portfolio_id: portfolioId,
        ticker: data.ticker.toUpperCase(),
        underlying: data.underlying,
        orders_json: JSON.parse(JSON.stringify(data.orders_json)),
        transaction_cost: data.transaction_cost,
        net_per_share: data.net_per_share,
        first_operation_date: data.first_operation_date,
        last_operation_date: data.last_operation_date,
        contracts_count: data.contracts_count,
      };
      
      const { data: result, error } = await supabase
        .from('covered_call_premiums')
        .upsert([payload] as any, { onConflict: 'portfolio_id,ticker' })
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['covered-call-premiums', portfolioId] });
    },
  });
  
  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ticker: string) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      const { error } = await supabase
        .from('covered_call_premiums')
        .delete()
        .eq('portfolio_id', portfolioId)
        .eq('ticker', ticker.toUpperCase());
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['covered-call-premiums', portfolioId] });
    },
  });
  
  // Delete multiple tickers not in the active list
  const deleteOrphanedMutation = useMutation({
    mutationFn: async (activeTickers: string[]) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      const upperTickers = activeTickers.map(t => t.toUpperCase());
      
      // Get all premiums for this portfolio
      const { data: existing, error: fetchError } = await supabase
        .from('covered_call_premiums')
        .select('ticker')
        .eq('portfolio_id', portfolioId);
      
      if (fetchError) throw fetchError;
      
      // Find tickers to delete
      const tickersToDelete = (existing || [])
        .map(row => row.ticker)
        .filter(ticker => !upperTickers.includes(ticker.toUpperCase()));
      
      if (tickersToDelete.length === 0) return { deleted: 0 };
      
      const { error: deleteError } = await supabase
        .from('covered_call_premiums')
        .delete()
        .eq('portfolio_id', portfolioId)
        .in('ticker', tickersToDelete);
      
      if (deleteError) throw deleteError;
      
      return { deleted: tickersToDelete.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['covered-call-premiums', portfolioId] });
    },
  });
  
  return {
    premiums,
    isLoading,
    refetch,
    getPremiumByTicker,
    upsertPremium: upsertMutation.mutateAsync,
    deletePremium: deleteMutation.mutateAsync,
    deleteOrphanedPremiums: deleteOrphanedMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
