import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { DerivativeOverride, OverrideCategory, OverrideStrategyType } from '@/types/derivativeOverrides';
import { toast } from 'sonner';
import { AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';

interface CreateSingleOverrideParams {
  positionId: string;
  targetCategory: OverrideCategory;
  linkedStockId?: string;
}

interface CreateMultiLegOverrideParams {
  strategyType: OverrideStrategyType;
  soldPutId: string;
  boughtPutId: string;
  soldCallId: string;
  boughtCallId: string;
}

export function useDerivativeOverrides() {
  const { portfolio } = usePortfolio();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const portfolioId = portfolio?.id;
  const isAggregated = portfolioId === AGGREGATED_PORTFOLIO_ID;

  // Fetch all overrides for this portfolio
  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ['derivative-overrides', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      // Vista aggregata: fetch tutti gli override
      if (isAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('derivative_overrides')
          .select('*');
        
        if (error) throw error;
        return data as DerivativeOverride[];
      }
      
      // Query normale
      const { data, error } = await supabase
        .from('derivative_overrides')
        .select('*')
        .eq('portfolio_id', portfolioId);
      
      if (error) throw error;
      return data as DerivativeOverride[];
    },
    enabled: !!portfolioId && (!isAggregated || isAdmin),
  });

  // Create or update a single override
  const createSingleOverrideMutation = useMutation({
    mutationFn: async ({ positionId, targetCategory, linkedStockId }: CreateSingleOverrideParams) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      // Upsert: if override exists for this position, update it
      const { data, error } = await supabase
        .from('derivative_overrides')
        .upsert({
          portfolio_id: portfolioId,
          override_type: 'single',
          position_id: positionId,
          target_category: targetCategory,
          linked_stock_id: linkedStockId || null,
        }, {
          onConflict: 'portfolio_id,position_id'
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Override salvato');
    },
    onError: (error) => {
      console.error('Failed to create override:', error);
      toast.error('Errore nel salvare l\'override');
    },
  });

  // Create a multi-leg override (Iron Condor / Double Diagonal)
  const createMultiLegOverrideMutation = useMutation({
    mutationFn: async ({ strategyType, soldPutId, boughtPutId, soldCallId, boughtCallId }: CreateMultiLegOverrideParams) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      const { data, error } = await supabase
        .from('derivative_overrides')
        .insert({
          portfolio_id: portfolioId,
          override_type: 'multi_leg',
          strategy_type: strategyType,
          sold_put_id: soldPutId,
          bought_put_id: boughtPutId,
          sold_call_id: soldCallId,
          bought_call_id: boughtCallId,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Strategia creata');
    },
    onError: (error) => {
      console.error('Failed to create multi-leg override:', error);
      toast.error('Errore nel creare la strategia');
    },
  });

  // Remove an override by position ID (for single overrides)
  const removeOverrideMutation = useMutation({
    mutationFn: async (positionId: string) => {
      if (!portfolioId) throw new Error('No portfolio selected');
      
      const { error } = await supabase
        .from('derivative_overrides')
        .delete()
        .eq('portfolio_id', portfolioId)
        .eq('position_id', positionId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Override rimosso');
    },
    onError: (error) => {
      console.error('Failed to remove override:', error);
      toast.error('Errore nel rimuovere l\'override');
    },
  });

  // Remove a multi-leg override by ID
  const removeMultiLegOverrideMutation = useMutation({
    mutationFn: async (overrideId: string) => {
      const { error } = await supabase
        .from('derivative_overrides')
        .delete()
        .eq('id', overrideId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Strategia rimossa');
    },
    onError: (error) => {
      console.error('Failed to remove multi-leg override:', error);
      toast.error('Errore nel rimuovere la strategia');
    },
  });

  // Helper to get override for a specific position
  const getOverrideForPosition = (positionId: string): DerivativeOverride | undefined => {
    return overrides.find(o => o.override_type === 'single' && o.position_id === positionId);
  };

  // Helper to check if a position is part of a multi-leg override
  const isPositionInMultiLeg = (positionId: string): boolean => {
    return overrides.some(o => 
      o.override_type === 'multi_leg' && (
        o.sold_put_id === positionId ||
        o.bought_put_id === positionId ||
        o.sold_call_id === positionId ||
        o.bought_call_id === positionId
      )
    );
  };

  return {
    overrides,
    isLoading,
    
    // Single override operations
    createSingleOverride: createSingleOverrideMutation.mutateAsync,
    removeOverride: removeOverrideMutation.mutateAsync,
    isCreating: createSingleOverrideMutation.isPending,
    isRemoving: removeOverrideMutation.isPending,
    
    // Multi-leg override operations
    createMultiLegOverride: createMultiLegOverrideMutation.mutateAsync,
    removeMultiLegOverride: removeMultiLegOverrideMutation.mutateAsync,
    
    // Helpers
    getOverrideForPosition,
    isPositionInMultiLeg,
  };
}
