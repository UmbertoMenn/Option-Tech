import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { Portfolio, Position, PortfolioSummary, AssetType } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { remapOverridesAfterUpload } from '@/lib/overrideMatching';
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
  });

  const summary: PortfolioSummary | null = positionsQuery.data ? calculateSummary(positionsQuery.data, portfolio?.cash_value || 0) : null;

  const updatePositionsMutation = useMutation({
    mutationFn: async ({ 
      positions, 
      targetPortfolioId 
    }: { 
      positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[]; 
      targetPortfolioId?: string;
    }) => {
      // IMPORTANTE: usa targetPortfolioId se fornito, altrimenti fallback al portfolio corrente
      const portfolioId = targetPortfolioId || portfolio?.id;
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      // ========= STEP 0: Read current state BEFORE delete =========
      const { data: oldPositions } = await supabase
        .from('positions')
        .select('*')
        .eq('portfolio_id', portfolioId);
      
      const { data: existingOverrides } = await supabase
        .from('derivative_overrides')
        .select('*')
        .eq('portfolio_id', portfolioId);
      
      // ========= STEP 1: Delete + Insert (as before) =========
      const { error: deleteError } = await supabase
        .from('positions')
        .delete()
        .eq('portfolio_id', portfolioId);
      
      if (deleteError) throw deleteError;
      
      // Insert new positions and return them with their new IDs
      const { data: insertedPositions, error } = await supabase
        .from('positions')
        .insert(positions.map(p => ({
          ...p,
          portfolio_id: portfolioId,
        })))
        .select();
      
      if (error) throw error;
      
      // ========= STEP 2: Remap overrides =========
      if (existingOverrides && existingOverrides.length > 0 && insertedPositions) {
        const typedOverrides = existingOverrides as unknown as DerivativeOverride[];
        const typedOldPositions = (oldPositions || []) as unknown as Position[];
        const typedNewPositions = insertedPositions as unknown as Position[];
        
        const result = await remapOverridesAfterUpload(
          portfolioId,
          typedOldPositions,
          typedNewPositions,
          typedOverrides
        );
        
        console.log('[OverrideRemap] Result:', result);
        
        if (result.matched > 0 || result.orphaned > 0) {
          if (result.matched > 0 && result.orphaned === 0) {
            toast.info(`Override preservati: ${result.matched}`);
          } else if (result.matched > 0 && result.orphaned > 0) {
            toast.info(`Override preservati: ${result.matched}`, {
              description: `${result.orphaned} override non più validi rimossi.`
            });
          } else if (result.orphaned > 0) {
            toast.warning(`${result.orphaned} override rimossi`, {
              description: 'Le opzioni corrispondenti non sono più presenti.'
            });
          }
        }
      }
      
      // ========= STEP 3: Update portfolio totals =========
      // IMPORTANT: derivatives must NOT be included in total portfolio value
      const investedNonDerivatives = positions
        .filter(p => p.asset_type !== 'derivative')
        .reduce((sum, p) => sum + (p.market_value || 0), 0);

      // Fetch current cash value from backend to avoid relying on potentially stale query cache
      const { data: portfolioCash, error: cashError } = await supabase
        .from('portfolios')
        .select('cash_value')
        .eq('id', portfolioId)
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
        .eq('id', portfolioId);
      
      return insertedPositions;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides'] });
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
    updatePositions: (args: { 
      positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[]; 
      targetPortfolioId?: string;
    }) => updatePositionsMutation.mutate(args),
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