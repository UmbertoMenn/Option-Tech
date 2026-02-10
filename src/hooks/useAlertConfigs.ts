import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  AlertConfig, 
  AlertType, 
  DISTANCE_ALERT_TYPES,
  ACTION_ALERT_TYPES,
  LEAP_GAIN_ALERT_TYPES,
  DEFAULT_DISTANCE_THRESHOLD_PCT,
  DEFAULT_COOLDOWN_MINUTES,
} from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';

function useEffectiveUserId() {
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  return isAdminMode && adminViewUserId ? adminViewUserId : user?.id;
}

// Fetch alert configs for the effective user
export function useAlertConfigs() {
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useQuery({
    queryKey: ['alert-configs', effectiveUserId],
    queryFn: async (): Promise<AlertConfig[]> => {
      if (!effectiveUserId) return [];
      
      const { data, error } = await supabase
        .from('alert_configs')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('ticker', { ascending: true, nullsFirst: true });
      
      if (error) {
        console.error('Error fetching alert configs:', error);
        throw error;
      }
      
      return (data || []).map(row => ({
        ...row,
        alert_type: row.alert_type as AlertType,
      }));
    },
    enabled: !!user && !!effectiveUserId,
  });
}

// Get effective config for a specific alert type and ticker
export function getEffectiveConfig(
  configs: AlertConfig[],
  alertType: AlertType,
  ticker?: string
): { threshold_pct: number; cooldown_minutes: number; enabled: boolean } {
  // First try to find ticker-specific config
  if (ticker) {
    const tickerConfig = configs.find(
      c => c.alert_type === alertType && c.ticker?.toUpperCase() === ticker.toUpperCase()
    );
    if (tickerConfig) {
      return {
        threshold_pct: tickerConfig.threshold_pct,
        cooldown_minutes: tickerConfig.cooldown_minutes,
        enabled: tickerConfig.enabled,
      };
    }
  }
  
  // Fall back to global config (ticker = null)
  const globalConfig = configs.find(
    c => c.alert_type === alertType && c.ticker === null
  );
  
  if (globalConfig) {
    return {
      threshold_pct: globalConfig.threshold_pct,
      cooldown_minutes: globalConfig.cooldown_minutes,
      enabled: globalConfig.enabled,
    };
  }
  
  // Return defaults if no config found
  const isDistanceAlert = DISTANCE_ALERT_TYPES.includes(alertType);
  return {
    threshold_pct: isDistanceAlert ? DEFAULT_DISTANCE_THRESHOLD_PCT : 0,
    cooldown_minutes: DEFAULT_COOLDOWN_MINUTES,
    enabled: true,
  };
}

// Upsert a single config
export function useUpsertAlertConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (config: {
      alert_type: AlertType;
      ticker?: string | null;
      threshold_pct?: number;
      cooldown_minutes?: number;
      enabled?: boolean;
    }) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('alert_configs')
        .upsert(
          {
            user_id: effectiveUserId,
            alert_type: config.alert_type,
            ticker: config.ticker || null,
            threshold_pct: config.threshold_pct ?? DEFAULT_DISTANCE_THRESHOLD_PCT,
            cooldown_minutes: config.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES,
            enabled: config.enabled ?? true,
          },
          { onConflict: 'user_id,ticker,alert_type' }
        );
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-configs'] });
    },
  });
}

// Batch upsert configs
export function useBatchUpsertAlertConfigs() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (configs: Array<{
      alert_type: AlertType;
      ticker?: string | null;
      threshold_pct?: number;
      cooldown_minutes?: number;
      enabled?: boolean;
    }>) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const upsertData = configs.map(config => ({
        user_id: effectiveUserId,
        alert_type: config.alert_type,
        ticker: config.ticker || null,
        threshold_pct: config.threshold_pct ?? DEFAULT_DISTANCE_THRESHOLD_PCT,
        cooldown_minutes: config.cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES,
        enabled: config.enabled ?? true,
      }));
      
      const { error } = await supabase
        .from('alert_configs')
        .upsert(upsertData, { onConflict: 'user_id,ticker,alert_type' });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-configs'] });
    },
  });
}

// Delete a ticker-specific override
export function useDeleteAlertConfig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (params: { alert_type: AlertType; ticker: string }) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('alert_configs')
        .delete()
        .eq('user_id', effectiveUserId)
        .eq('alert_type', params.alert_type)
        .eq('ticker', params.ticker);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-configs'] });
    },
  });
}

// Initialize default configs for the effective user
export function useInitializeDefaultConfigs() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async () => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const allAlertTypes = [
        ...DISTANCE_ALERT_TYPES,
        ...ACTION_ALERT_TYPES,
        ...LEAP_GAIN_ALERT_TYPES,
      ];
      
      const defaultConfigs = allAlertTypes.map(alertType => ({
        user_id: effectiveUserId,
        alert_type: alertType,
        ticker: null,
        threshold_pct: DISTANCE_ALERT_TYPES.includes(alertType) ? DEFAULT_DISTANCE_THRESHOLD_PCT : 0,
        cooldown_minutes: DEFAULT_COOLDOWN_MINUTES,
        enabled: true,
      }));
      
      const { error } = await supabase
        .from('alert_configs')
        .upsert(defaultConfigs, { 
          onConflict: 'user_id,ticker,alert_type',
          ignoreDuplicates: true 
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-configs'] });
    },
  });
}
