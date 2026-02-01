import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { Portfolio, Position, PortfolioSummary, AssetType } from '@/types/portfolio';
import { toast } from 'sonner';

export function usePortfolio() {
  const { selectedPortfolio } = usePortfolioContext();
  const queryClient = useQueryClient();

  // Use the portfolio from context instead of fetching directly
  const portfolio = selectedPortfolio;

  const updateInitialValueMutation = useMutation({
    mutationFn: async ({ 
      initialValue, 
      initialDate, 
      deposits, 
      averageBalance,
      averageBalanceDate,
    }: { 
      initialValue: number; 
      initialDate: string; 
      deposits: number; 
      averageBalance: number;
      averageBalanceDate: string;
    }) => {
      if (!portfolio?.id) throw new Error('Portfolio non trovato');
      
      const { error } = await supabase
        .from('portfolios')
        .update({ 
          initial_value: initialValue,
          initial_date: initialDate,
          deposits: deposits,
          average_balance: averageBalance,
          average_balance_date: averageBalanceDate,
        })
        .eq('id', portfolio.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      toast.success('Dati salvati!');
    },
    onError: (error) => {
      toast.error('Errore nel salvataggio', {
        description: error.message,
      });
    },
  });

  const positionsQuery = useQuery({
    queryKey: ['positions', portfolio?.id],
    queryFn: async () => {
      if (!portfolio?.id) return [];
      
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .order('asset_type', { ascending: true });
      
      if (error) throw error;
      return data as unknown as Position[];
    },
    enabled: !!portfolio?.id,
    refetchInterval: 60000, // Poll every 60 seconds for server-side price updates
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchIntervalInBackground: false, // Don't poll when tab is not visible
  });

  const summary: PortfolioSummary | null = positionsQuery.data ? calculateSummary(positionsQuery.data, portfolio?.cash_value || 0) : null;

  const updatePositionsMutation = useMutation({
    mutationFn: async (positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[]) => {
      if (!portfolio?.id) throw new Error('Portfolio non trovato');
      
      // First delete all existing positions
      await supabase
        .from('positions')
        .delete()
        .eq('portfolio_id', portfolio.id);
      
      // Then insert new positions
      const { data, error } = await supabase
        .from('positions')
        .insert(positions.map(p => ({
          ...p,
          portfolio_id: portfolio.id,
        })));
      
      if (error) throw error;
      
      // Update portfolio totals (IMPORTANT: derivatives must NOT be included in total portfolio value)
      const investedNonDerivatives = positions
        .filter(p => p.asset_type !== 'derivative')
        .reduce((sum, p) => sum + (p.market_value || 0), 0);

      // Fetch current cash value from backend to avoid relying on potentially stale query cache
      const { data: portfolioCash, error: cashError } = await supabase
        .from('portfolios')
        .select('cash_value')
        .eq('id', portfolio.id)
        .single();

      if (cashError) throw cashError;

      const cashValue = portfolioCash?.cash_value ?? 0;
      const totalValue = investedNonDerivatives + cashValue;
      await supabase
        .from('portfolios')
        .update({ 
          total_value: totalValue,
          last_updated: new Date().toISOString()
        })
        .eq('id', portfolio.id);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      toast.success('Portfolio aggiornato!');
    },
    onError: (error) => {
      toast.error('Errore aggiornamento portfolio', {
        description: error.message,
      });
    },
  });

  return {
    portfolio,
    positions: positionsQuery.data || [],
    summary,
    isLoading: positionsQuery.isLoading,
    updatePositions: updatePositionsMutation.mutate,
    isUpdating: updatePositionsMutation.isPending,
    updateInitialValue: updateInitialValueMutation.mutate,
    isUpdatingInitialValue: updateInitialValueMutation.isPending,
  };
}

function calculateSummary(positions: Position[], cashValue: number): PortfolioSummary {
  const byAssetType = new Map<AssetType, { value: number; profitLoss: number }>();
  
  let totalValue = cashValue;
  let totalProfitLoss = 0;
  
  positions.forEach(position => {
    // IMPORTANT: derivatives must NEVER be included in dashboard allocation/legend/total.
    // They are managed separately in the Derivatives page.
    if (position.asset_type === 'derivative') {
      return;
    }

    const value = position.market_value || 0;
    const pl = position.profit_loss || 0;

    totalValue += value;
    totalProfitLoss += pl;

    const existing = byAssetType.get(position.asset_type) || { value: 0, profitLoss: 0 };
    byAssetType.set(position.asset_type, {
      value: existing.value + value,
      profitLoss: existing.profitLoss + pl,
    });
  });
  
  // Add cash
  if (cashValue > 0) {
    byAssetType.set('cash', { value: cashValue, profitLoss: 0 });
  }
  
  const byAssetTypeArray = Array.from(byAssetType.entries()).map(([type, data]) => ({
    type,
    value: data.value,
    percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
    profitLoss: data.profitLoss,
  }));
  
  const investedValue = totalValue - cashValue;
  const totalProfitLossPct = investedValue > 0 ? (totalProfitLoss / (investedValue - totalProfitLoss)) * 100 : 0;
  
  return {
    totalValue,
    cashValue,
    investedValue,
    totalProfitLoss,
    totalProfitLossPct,
    byAssetType: byAssetTypeArray,
  };
}