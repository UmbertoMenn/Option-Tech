import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useArchivedUnderlyings(portfolioId: string | null) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['archived-underlyings', portfolioId],
    queryFn: async () => {
      if (!user || !portfolioId) return [];
      const { data, error } = await supabase
        .from('archived_underlyings' as any)
        .select('underlying_key, display_name')
        .eq('user_id', user.id)
        .eq('portfolio_id', portfolioId);
      if (error) throw error;
      return (data as any[]).map((d: any) => ({
        key: d.underlying_key as string,
        displayName: d.display_name as string,
      }));
    },
    enabled: !!user && !!portfolioId,
  });

  return query;
}

export function useArchiveUnderlying() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ portfolioId, underlyingKey, displayName }: {
      portfolioId: string; underlyingKey: string; displayName: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('archived_underlyings' as any)
        .insert({
          user_id: user.id,
          portfolio_id: portfolioId,
          underlying_key: underlyingKey,
          display_name: displayName,
        } as any);
      if (error) throw error;
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['archived-underlyings', portfolioId] });
    },
  });
}

export function useUnarchiveUnderlying() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ portfolioId, underlyingKey }: {
      portfolioId: string; underlyingKey: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('archived_underlyings' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('portfolio_id', portfolioId)
        .eq('underlying_key', underlyingKey);
      if (error) throw error;
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['archived-underlyings', portfolioId] });
    },
  });
}
