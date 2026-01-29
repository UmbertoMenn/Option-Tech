import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio, Position, PortfolioSummary, AssetType } from '@/types/portfolio';
import { toast } from 'sonner';

export function usePortfolio() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const portfolioQuery = useQuery({
    queryKey: ['portfolio', user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      return data as unknown as Portfolio | null;
    },
    enabled: !!user,
  });

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
      if (!portfolioQuery.data?.id) throw new Error('Portfolio non trovato');
      
      const { error } = await supabase
        .from('portfolios')
        .update({ 
          initial_value: initialValue,
          initial_date: initialDate,
          deposits: deposits,
          average_balance: averageBalance,
          average_balance_date: averageBalanceDate,
        })
        .eq('id', portfolioQuery.data.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Dati salvati!');
    },
    onError: (error) => {
      toast.error('Errore nel salvataggio', {
        description: error.message,
      });
    },
  });

  const positionsQuery = useQuery({
    queryKey: ['positions', portfolioQuery.data?.id],
    queryFn: async () => {
      if (!portfolioQuery.data?.id) return [];
      
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('portfolio_id', portfolioQuery.data.id)
        .order('asset_type', { ascending: true });
      
      if (error) throw error;
      return data as unknown as Position[];
    },
    enabled: !!portfolioQuery.data?.id,
  });

  const summary: PortfolioSummary | null = positionsQuery.data ? calculateSummary(positionsQuery.data, portfolioQuery.data?.cash_value || 0) : null;

  const updatePositionsMutation = useMutation({
    mutationFn: async (positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[]) => {
      if (!portfolioQuery.data?.id) throw new Error('Portfolio non trovato');
      
      // First delete all existing positions
      await supabase
        .from('positions')
        .delete()
        .eq('portfolio_id', portfolioQuery.data.id);
      
      // Then insert new positions
      const { data, error } = await supabase
        .from('positions')
        .insert(positions.map(p => ({
          ...p,
          portfolio_id: portfolioQuery.data.id,
        })));
      
      if (error) throw error;
      
      // Update portfolio totals
      const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
      await supabase
        .from('portfolios')
        .update({ 
          total_value: totalValue,
          last_updated: new Date().toISOString()
        })
        .eq('id', portfolioQuery.data.id);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Portfolio aggiornato!');
    },
    onError: (error) => {
      toast.error('Errore aggiornamento portfolio', {
        description: error.message,
      });
    },
  });

  return {
    portfolio: portfolioQuery.data,
    positions: positionsQuery.data || [],
    summary,
    isLoading: portfolioQuery.isLoading || positionsQuery.isLoading,
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
    const value = position.market_value || 0;
    const pl = position.profit_loss || 0;
    
    // Exclude derivatives from total portfolio value calculation
    if (position.asset_type !== 'derivative') {
      totalValue += value;
      totalProfitLoss += pl;
    }
    
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