import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useDismissedUnresolvedTickers(portfolioId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dismissed-unresolved-tickers', portfolioId],
    queryFn: async () => {
      if (!user || !portfolioId) return [];
      const { data, error } = await supabase
        .from('dismissed_unresolved_tickers' as any)
        .select('underlying')
        .eq('user_id', user.id)
        .eq('portfolio_id', portfolioId);
      if (error) throw error;
      return (data as any[]).map((d: any) => d.underlying as string);
    },
    enabled: !!user && !!portfolioId,
  });
}

export function useDismissUnresolvedTicker() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ portfolioId, underlying }: { portfolioId: string; underlying: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('dismissed_unresolved_tickers' as any)
        .insert({ user_id: user.id, portfolio_id: portfolioId, underlying } as any);
      if (error) throw error;
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['dismissed-unresolved-tickers', portfolioId] });
    },
  });
}
