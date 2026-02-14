import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID, isUserAggregatedId, getUserIdFromAggregatedId, isAnyAggregatedId } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio, Position, PortfolioSummary, AssetType } from '@/types/portfolio';
import { DerivativeOverride } from '@/types/derivativeOverrides';
import { remapOverridesAfterUpload } from '@/lib/overrideMatching';
import { toast } from 'sonner';

export function usePortfolio() {
  const { selectedPortfolio, isAggregatedView, selectedPortfolioId } = usePortfolioContext();
  const { isAdmin, user } = useAuth();
  const queryClient = useQueryClient();

  const portfolio = selectedPortfolio;
  const selectedId = selectedPortfolioId;
  const isGlobalAggregated = selectedId === AGGREGATED_PORTFOLIO_ID;
  const isUserAgg = isUserAggregatedId(selectedId);
  const targetUserId = isUserAgg && selectedId ? getUserIdFromAggregatedId(selectedId) : null;

  // Fetch portfolio IDs for user-level aggregation
  const userPortfolioIdsQuery = useQuery({
    queryKey: ['user-portfolio-ids', targetUserId],
    queryFn: async () => {
      if (!targetUserId) return [];
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, snapshot_date, cash_value, total_value')
        .eq('user_id', targetUserId);
      if (error) throw error;
      return data;
    },
    enabled: !!targetUserId,
    staleTime: 60000,
  });

  // Query to fetch all portfolios for global aggregated view
  const allPortfoliosQuery = useQuery({
    queryKey: ['all-portfolios-for-aggregation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, snapshot_date, cash_value, total_value');
      if (error) throw error;
      return data;
    },
    enabled: isGlobalAggregated && isAdmin,
  });

  // Unified source for aggregation data
  const aggregationPortfolios = useMemo(() => {
    if (isGlobalAggregated) return allPortfoliosQuery.data || [];
    if (isUserAgg) return userPortfolioIdsQuery.data || [];
    return [];
  }, [isGlobalAggregated, isUserAgg, allPortfoliosQuery.data, userPortfolioIdsQuery.data]);

  const aggregatedSnapshotDate = useMemo(() => {
    const validDates = aggregationPortfolios
      .map(p => p.snapshot_date)
      .filter((d): d is string => !!d);
    if (validDates.length === 0) return null;
    return validDates.sort().reverse()[0];
  }, [aggregationPortfolios]);

  const aggregatedCashValue = useMemo(() => {
    return aggregationPortfolios.reduce((sum, p) => sum + (p.cash_value || 0), 0);
  }, [aggregationPortfolios]);

  const updateInitialValueMutation = useMutation({
    mutationFn: async ({ 
      initialValue, initialDate, deposits, averageBalance, averageBalanceDate,
    }: { 
      initialValue: number; initialDate: string; deposits: number; averageBalance: number; averageBalanceDate: string;
    }) => {
      if (!portfolio?.id) throw new Error('Portfolio non trovato');
      const { error } = await supabase
        .from('portfolios')
        .update({ 
          initial_value: initialValue, initial_date: initialDate,
          deposits: deposits, average_balance: averageBalance, average_balance_date: averageBalanceDate,
        })
        .eq('id', portfolio.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      toast.success('Dati salvati!');
    },
    onError: (error) => {
      toast.error('Errore nel salvataggio', { description: error.message });
    },
  });

  // Positions query - handle all aggregated views
  const positionsQuery = useQuery({
    queryKey: ['positions', isAggregatedView ? selectedId : portfolio?.id],
    queryFn: async () => {
      // Global aggregated: fetch ALL positions
      if (isGlobalAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('positions')
          .select('*')
          .order('asset_type', { ascending: true });
        if (error) throw error;
        return data as unknown as Position[];
      }
      
      // Per-user aggregated: fetch positions for user's portfolios
      if (isUserAgg) {
        const portfolioIds = (userPortfolioIdsQuery.data || []).map(p => p.id);
        if (portfolioIds.length === 0) return [];
        const { data, error } = await supabase
          .from('positions')
          .select('*')
          .in('portfolio_id', portfolioIds)
          .order('asset_type', { ascending: true });
        if (error) throw error;
        return data as unknown as Position[];
      }
      
      if (!portfolio?.id) return [];
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .order('asset_type', { ascending: true });
      if (error) throw error;
      return data as unknown as Position[];
    },
    enabled: !!portfolio?.id || (isGlobalAggregated && isAdmin) || (isUserAgg && (userPortfolioIdsQuery.data || []).length > 0),
  });

  // Aggregated portfolio for any aggregated view
  const aggregatedPortfolio: Portfolio | null = isAggregatedView ? {
    id: selectedId || AGGREGATED_PORTFOLIO_ID,
    user_id: targetUserId || 'aggregated',
    name: isGlobalAggregated ? 'Aggregato - Tutti gli Utenti' : 'Il Mio Aggregato',
    total_value: 0,
    cash_value: aggregatedCashValue,
    initial_value: null,
    initial_date: null,
    deposits: null,
    average_balance: null,
    average_balance_date: null,
    snapshot_date: aggregatedSnapshotDate,
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
  } : null;

  const effectivePortfolio = isAggregatedView ? aggregatedPortfolio : portfolio;
  const summary: PortfolioSummary | null = positionsQuery.data ? calculateSummary(positionsQuery.data, effectivePortfolio?.cash_value || 0) : null;

  const updatePositionsMutation = useMutation({
    mutationFn: async ({ 
      positions, targetPortfolioId 
    }: { 
      positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[]; 
      targetPortfolioId?: string;
    }) => {
      const portfolioId = targetPortfolioId || portfolio?.id;
      if (!portfolioId) throw new Error('Portfolio non trovato');
      
      // ========= STEP 0: Read current state BEFORE delete =========
      const { data: oldPositions } = await supabase
        .from('positions').select('*').eq('portfolio_id', portfolioId);
      const { data: existingOverrides } = await supabase
        .from('derivative_overrides').select('*').eq('portfolio_id', portfolioId);
      
      // ========= STEP 1: Delete + Insert =========
      const { error: deleteError } = await supabase
        .from('positions').delete().eq('portfolio_id', portfolioId);
      if (deleteError) throw deleteError;
      
      const { data: insertedPositions, error } = await supabase
        .from('positions')
        .insert(positions.map(p => ({
          ...p, portfolio_id: portfolioId,
          snapshot_price: p.current_price, snapshot_market_value: p.market_value,
        })))
        .select();
      if (error) throw error;
      
      // ========= STEP 2: Remap overrides =========
      if (existingOverrides && existingOverrides.length > 0 && insertedPositions) {
        const typedOverrides = existingOverrides as unknown as DerivativeOverride[];
        const typedOldPositions = (oldPositions || []) as unknown as Position[];
        const typedNewPositions = insertedPositions as unknown as Position[];
        
        const result = await remapOverridesAfterUpload(portfolioId, typedOldPositions, typedNewPositions, typedOverrides);
        console.log('[OverrideRemap] Result:', result);
        
        if (result.matched > 0 || result.orphaned > 0) {
          if (result.matched > 0 && result.orphaned === 0) {
            toast.info(`Override preservati: ${result.matched}`);
          } else if (result.matched > 0 && result.orphaned > 0) {
            toast.info(`Override preservati: ${result.matched}`, { description: `${result.orphaned} override non più validi rimossi.` });
          } else if (result.orphaned > 0) {
            toast.warning(`${result.orphaned} override rimossi`, { description: 'Le opzioni corrispondenti non sono più presenti.' });
          }
        }
      }
      
      // ========= STEP 3: Update portfolio totals =========
      const investedNonDerivatives = positions
        .filter(p => p.asset_type !== 'derivative')
        .reduce((sum, p) => sum + (p.market_value || 0), 0);

      const { data: portfolioCash, error: cashError } = await supabase
        .from('portfolios').select('cash_value').eq('id', portfolioId).single();
      if (cashError) throw cashError;

      const cashValue = portfolioCash?.cash_value ?? 0;
      const totalValue = investedNonDerivatives + cashValue;
      await supabase
        .from('portfolios')
        .update({ total_value: totalValue, last_updated: new Date().toISOString() })
        .eq('id', portfolioId);
      
      return insertedPositions;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolios'] });
      queryClient.invalidateQueries({ queryKey: ['admin-view-portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides'] });
      toast.success('Portfolio aggiornato!');
    },
    onError: (error) => {
      toast.error('Errore aggiornamento portfolio', { description: error.message });
    },
  });

  return {
    portfolio: effectivePortfolio,
    positions: positionsQuery.data || [],
    summary,
    isLoading: positionsQuery.isLoading,
    isReadOnly: isAggregatedView,
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
    if (position.asset_type === 'derivative') return;
    const value = position.snapshot_market_value ?? position.market_value ?? 0;
    const pl = position.profit_loss || 0;
    totalValue += value;
    totalProfitLoss += pl;
    const existing = byAssetType.get(position.asset_type) || { value: 0, profitLoss: 0 };
    byAssetType.set(position.asset_type, { value: existing.value + value, profitLoss: existing.profitLoss + pl });
  });
  
  if (cashValue > 0) byAssetType.set('cash', { value: cashValue, profitLoss: 0 });
  
  const byAssetTypeArray = Array.from(byAssetType.entries()).map(([type, data]) => ({
    type, value: data.value,
    percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
    profitLoss: data.profitLoss,
  }));
  
  const investedValue = totalValue - cashValue;
  const totalProfitLossPct = investedValue > 0 ? (totalProfitLoss / (investedValue - totalProfitLoss)) * 100 : 0;
  
  return { totalValue, cashValue, investedValue, totalProfitLoss, totalProfitLossPct, byAssetType: byAssetTypeArray };
}
