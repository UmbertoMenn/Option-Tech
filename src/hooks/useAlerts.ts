import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertType, AlertSeverity } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolioContext } from '@/contexts/PortfolioContext';

function useEffectiveUserId() {
  const { user } = useAuth();
  const { isAdminMode, adminViewUserId } = usePortfolioContext();
  return isAdminMode && adminViewUserId ? adminViewUserId : user?.id;
}

// Fetch alerts for the effective user (last 24 hours)
export function useAlerts(portfolioId?: string) {
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useQuery({
    queryKey: ['alerts', effectiveUserId, portfolioId],
    queryFn: async (): Promise<Alert[]> => {
      if (!effectiveUserId) return [];
      
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      let query = supabase
        .from('alerts')
        .select('*')
        .eq('user_id', effectiveUserId)
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false });
      
      if (portfolioId) {
        query = query.eq('portfolio_id', portfolioId);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching alerts:', error);
        throw error;
      }
      
      return (data || []).map(row => ({
        ...row,
        alert_type: row.alert_type as AlertType,
        severity: row.severity as AlertSeverity,
        direction: row.direction as 'up' | 'down' | null,
      }));
    },
    enabled: !!user && !!effectiveUserId,
    refetchInterval: 5 * 60 * 1000,
  });
}

// Fetch unread alerts count
export function useUnreadAlertsCount(portfolioId?: string) {
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useQuery({
    queryKey: ['unread-alerts-count', effectiveUserId, portfolioId],
    queryFn: async (): Promise<number> => {
      if (!effectiveUserId) return 0;
      
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      let query = supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', effectiveUserId)
        .is('read_at', null)
        .gte('created_at', twentyFourHoursAgo.toISOString());
      
      if (portfolioId) {
        query = query.eq('portfolio_id', portfolioId);
      }
      
      const { count, error } = await query;
      
      if (error) {
        console.error('Error fetching unread alerts count:', error);
        return 0;
      }
      
      return count || 0;
    },
    enabled: !!user && !!effectiveUserId,
    refetchInterval: 60 * 1000,
  });
}

// Mark alert as read
export function useMarkAlertAsRead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (alertId: string) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('alerts')
        .update({ read_at: new Date().toISOString() })
        .eq('id', alertId)
        .eq('user_id', effectiveUserId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['unread-alerts-count'] });
    },
  });
}

// Mark all alerts as read
export function useMarkAllAlertsAsRead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (portfolioId?: string) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      let query = supabase
        .from('alerts')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', effectiveUserId)
        .is('read_at', null)
        .gte('created_at', twentyFourHoursAgo.toISOString());
      
      if (portfolioId) {
        query = query.eq('portfolio_id', portfolioId);
      }
      
      const { error } = await query;
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['unread-alerts-count'] });
    },
  });
}

// Delete a single alert
export function useDeleteAlert() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async (alertId: string) => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('alerts')
        .delete()
        .eq('id', alertId)
        .eq('user_id', effectiveUserId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['unread-alerts-count'] });
    },
  });
}

// Reset entire alert system
export function useResetAlertSystem() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveUserId = useEffectiveUserId();
  
  return useMutation({
    mutationFn: async () => {
      if (!user || !effectiveUserId) throw new Error('User not authenticated');
      
      const { error: statesError } = await supabase
        .from('alert_states')
        .delete()
        .eq('user_id', effectiveUserId);
      if (statesError) throw statesError;
      
      const { error: alertsError } = await supabase
        .from('alerts')
        .delete()
        .eq('user_id', effectiveUserId);
      if (alertsError) throw alertsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['unread-alerts-count'] });
    },
  });
}
