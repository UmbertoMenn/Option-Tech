import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolio } from './usePortfolio';
import { 
  DerivativeOverride, 
  OverrideCategory, 
  MultiLegStrategyType,
  AvailableStock,
  CreateSingleOverrideParams,
  CreateMultiLegOverrideParams
} from '@/types/derivativeOverrides';
import { Position } from '@/types/portfolio';
import { toast } from 'sonner';
import { useMemo } from 'react';

// Helper to normalize underlying names for matching
function normalizeForMatching(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bAZ\.\s*/gi, '')
    .replace(/\bAZ\s*/gi, '')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CO|COMPANY|CLASS\s*[A-Z]?|CL\s*[A-Z]?|COMMON|STOCK|ORD|ORDINARY|ADR|SPA|AG|SA|NV|PLC)\b/gi, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export function useDerivativeOverrides() {
  const queryClient = useQueryClient();
  const { portfolio, positions } = usePortfolio();
  const portfolioId = portfolio?.id;

  // Fetch all overrides for the current portfolio
  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ['derivative-overrides', portfolioId],
    queryFn: async () => {
      if (!portfolioId) return [];
      
      const { data, error } = await supabase
        .from('derivative_overrides')
        .select('*')
        .eq('portfolio_id', portfolioId);
      
      if (error) throw error;
      return data as DerivativeOverride[];
    },
    enabled: !!portfolioId
  });

  // Get stock positions
  const stockPositions = useMemo(() => 
    positions.filter(p => p.asset_type === 'stock' && p.quantity > 0),
    [positions]
  );

  // Get derivative positions
  const derivativePositions = useMemo(() => 
    positions.filter(p => p.asset_type === 'derivative'),
    [positions]
  );

  // Calculate available stocks for covered calls
  const calculateAvailableStocks = useMemo(() => {
    return (targetUnderlying?: string): AvailableStock[] => {
      // Group stock positions by normalized underlying
      const stocksByUnderlying = new Map<string, { positions: Position[], totalShares: number }>();
      
      for (const stock of stockPositions) {
        const key = normalizeForMatching(stock.description);
        if (!stocksByUnderlying.has(key)) {
          stocksByUnderlying.set(key, { positions: [], totalShares: 0 });
        }
        const group = stocksByUnderlying.get(key)!;
        group.positions.push(stock);
        group.totalShares += stock.quantity;
      }

      // Calculate used shares from existing covered calls (automatic + manual)
      const usedSharesByUnderlying = new Map<string, number>();

      // From automatic covered calls: check CALL vendute with matching stock
      const soldCalls = derivativePositions.filter(d => 
        d.option_type === 'call' && d.quantity < 0
      );

      for (const call of soldCalls) {
        const underlyingKey = normalizeForMatching(call.underlying || call.description);
        const hasOverride = overrides.some(o => 
          o.override_type === 'single' && o.position_id === call.id
        );
        
        // Only count if NOT manually overridden (will be counted separately)
        if (!hasOverride && stocksByUnderlying.has(underlyingKey)) {
          const contractsSold = Math.abs(call.quantity);
          const sharesUsed = contractsSold * 100;
          const current = usedSharesByUnderlying.get(underlyingKey) || 0;
          usedSharesByUnderlying.set(underlyingKey, current + sharesUsed);
        }
      }

      // From manual overrides (covered_call type)
      for (const override of overrides) {
        if (override.override_type === 'single' && 
            override.target_category === 'covered_call' && 
            override.linked_stock_id) {
          const option = derivativePositions.find(p => p.id === override.position_id);
          if (option) {
            const stockPos = positions.find(p => p.id === override.linked_stock_id);
            if (stockPos) {
              const underlyingKey = normalizeForMatching(stockPos.description);
              const contractsSold = Math.abs(option.quantity);
              const sharesUsed = contractsSold * 100;
              const current = usedSharesByUnderlying.get(underlyingKey) || 0;
              usedSharesByUnderlying.set(underlyingKey, current + sharesUsed);
            }
          }
        }
      }

      // Build available stocks list
      const result: AvailableStock[] = [];

      for (const [key, group] of stocksByUnderlying.entries()) {
        // Filter by target underlying if specified
        if (targetUnderlying) {
          const targetKey = normalizeForMatching(targetUnderlying);
          if (key !== targetKey) continue;
        }

        const usedShares = usedSharesByUnderlying.get(key) || 0;
        const availableShares = Math.max(0, group.totalShares - usedShares);
        const availableContracts = Math.floor(availableShares / 100);

        // Use first position as representative
        const mainPosition = group.positions[0];

        result.push({
          positionId: mainPosition.id,
          description: mainPosition.description,
          ticker: mainPosition.ticker,
          underlying: key,
          totalShares: group.totalShares,
          usedShares,
          availableShares,
          availableContracts
        });
      }

      return result;
    };
  }, [stockPositions, derivativePositions, overrides, positions]);

  // Get unassigned options (not used in any override)
  const getUnassignedOptions = useMemo(() => {
    return (): Position[] => {
      const overriddenPositionIds = new Set<string>();

      for (const override of overrides) {
        if (override.override_type === 'single' && override.position_id) {
          overriddenPositionIds.add(override.position_id);
        } else if (override.override_type === 'multi_leg') {
          if (override.sold_put_id) overriddenPositionIds.add(override.sold_put_id);
          if (override.bought_put_id) overriddenPositionIds.add(override.bought_put_id);
          if (override.sold_call_id) overriddenPositionIds.add(override.sold_call_id);
          if (override.bought_call_id) overriddenPositionIds.add(override.bought_call_id);
        }
      }

      return derivativePositions.filter(d => !overriddenPositionIds.has(d.id));
    };
  }, [derivativePositions, overrides]);

  // Check if a position has an override
  const getOverrideForPosition = (positionId: string): DerivativeOverride | null => {
    return overrides.find(o => 
      (o.override_type === 'single' && o.position_id === positionId) ||
      (o.override_type === 'multi_leg' && (
        o.sold_put_id === positionId ||
        o.bought_put_id === positionId ||
        o.sold_call_id === positionId ||
        o.bought_call_id === positionId
      ))
    ) || null;
  };

  // Create single override mutation
  const createSingleOverride = useMutation({
    mutationFn: async (params: CreateSingleOverrideParams) => {
      if (!portfolioId) throw new Error('No portfolio selected');

      const { data, error } = await supabase
        .from('derivative_overrides')
        .insert({
          portfolio_id: portfolioId,
          override_type: 'single',
          position_id: params.positionId,
          target_category: params.targetCategory,
          linked_stock_id: params.linkedStockId || null
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Override creato con successo');
    },
    onError: (error) => {
      console.error('Error creating override:', error);
      toast.error('Errore durante la creazione dell\'override');
    }
  });

  // Create multi-leg override mutation
  const createMultiLegOverride = useMutation({
    mutationFn: async (params: CreateMultiLegOverrideParams) => {
      if (!portfolioId) throw new Error('No portfolio selected');

      const { data, error } = await supabase
        .from('derivative_overrides')
        .insert({
          portfolio_id: portfolioId,
          override_type: 'multi_leg',
          strategy_type: params.strategyType,
          sold_put_id: params.soldPutId,
          bought_put_id: params.boughtPutId,
          sold_call_id: params.soldCallId,
          bought_call_id: params.boughtCallId
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Strategia manuale creata con successo');
    },
    onError: (error) => {
      console.error('Error creating multi-leg override:', error);
      toast.error('Errore durante la creazione della strategia');
    }
  });

  // Remove override mutation
  const removeOverride = useMutation({
    mutationFn: async (overrideId: string) => {
      const { error } = await supabase
        .from('derivative_overrides')
        .delete()
        .eq('id', overrideId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Override rimosso');
    },
    onError: (error) => {
      console.error('Error removing override:', error);
      toast.error('Errore durante la rimozione dell\'override');
    }
  });

  // Remove override by position ID
  const removeOverrideByPositionId = useMutation({
    mutationFn: async (positionId: string) => {
      const override = getOverrideForPosition(positionId);
      if (!override) throw new Error('No override found for this position');

      const { error } = await supabase
        .from('derivative_overrides')
        .delete()
        .eq('id', override.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['derivative-overrides', portfolioId] });
      toast.success('Override rimosso');
    },
    onError: (error) => {
      console.error('Error removing override:', error);
      toast.error('Errore durante la rimozione dell\'override');
    }
  });

  return {
    overrides,
    isLoading,
    
    // Single override operations
    createSingleOverride: createSingleOverride.mutateAsync,
    isCreatingSingle: createSingleOverride.isPending,
    
    // Multi-leg operations
    createMultiLegOverride: createMultiLegOverride.mutateAsync,
    isCreatingMultiLeg: createMultiLegOverride.isPending,
    
    // Remove operations
    removeOverride: removeOverride.mutateAsync,
    removeOverrideByPositionId: removeOverrideByPositionId.mutateAsync,
    isRemoving: removeOverride.isPending || removeOverrideByPositionId.isPending,
    
    // Utilities
    getAvailableStocks: calculateAvailableStocks,
    getUnassignedOptions,
    getOverrideForPosition,
    
    // Data
    stockPositions,
    derivativePositions
  };
}
