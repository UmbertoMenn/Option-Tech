import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { PriceAlert, DEFAULT_COOLDOWN_MINUTES } from '@/types/alerts';

function useEffectiveUserId() {
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  return isAdminMode && adminViewUserId ? adminViewUserId : user?.id;
}

// Fetch all price alerts for the effective user
export function usePriceAlerts() {
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useQuery({
    queryKey: ['price-alerts', effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return [];
      
      const { data, error } = await supabase
        .from('price_alerts')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as PriceAlert[];
    },
    enabled: !!user && !!effectiveUserId,
  });
}

// Create a new price alert
export function useCreatePriceAlert() {
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (alert: {
      ticker: string;
      direction: 'above' | 'below';
      target_price: number;
      cooldown_minutes?: number;
      delete_after_trigger?: boolean;
    }) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { data, error } = await supabase
        .from('price_alerts')
        .insert({
          user_id: effectiveUserId,
          ticker: alert.ticker.toUpperCase(),
          direction: alert.direction,
          target_price: alert.target_price,
          cooldown_minutes: alert.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES,
          delete_after_trigger: alert.delete_after_trigger ?? false,
          enabled: true,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as PriceAlert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });
}

// Update an existing price alert
export function useUpdatePriceAlert() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (update: {
      id: string;
      target_price?: number;
      enabled?: boolean;
      cooldown_minutes?: number;
    }) => {
      const { id, ...updateData } = update;
      
      const { data, error } = await supabase
        .from('price_alerts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as PriceAlert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });
}

// Delete a price alert
export function useDeletePriceAlert() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('price_alerts')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });
}

// Toggle price alert enabled state
export function useTogglePriceAlert() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { data, error } = await supabase
        .from('price_alerts')
        .update({ enabled })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as PriceAlert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-alerts'] });
    },
  });
}

// Validate ticker via Yahoo Finance API (frontend helper)
export async function validateTicker(ticker: string): Promise<{
  valid: boolean;
  price?: number;
  currency?: string;
  name?: string;
}> {
  try {
    const response = await supabase.functions.invoke('fetch-underlying-prices', {
      body: { 
        underlyings: [ticker.toUpperCase()],
        forceRefresh: true
      },
    });
    
    if (response.error) {
      return { valid: false };
    }
    
    const data = response.data;
    if (data?.prices && Object.keys(data.prices).length > 0) {
      const priceData = Object.values(data.prices)[0] as any;
      return {
        valid: true,
        price: priceData.price,
        currency: priceData.currency,
        name: priceData.name,
      };
    }
    
    return { valid: false };
  } catch {
    return { valid: false };
  }
}
