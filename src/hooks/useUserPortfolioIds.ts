import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isUserAggregatedId, getUserIdFromAggregatedId } from '@/contexts/PortfolioContext';

/**
 * Shared hook to fetch portfolio IDs for a specific user.
 * Used by all data hooks when displaying a per-user aggregated view.
 */
export function useUserPortfolioIds(selectedId: string | undefined) {
  const isUserAgg = isUserAggregatedId(selectedId);
  const targetUserId = isUserAgg && selectedId ? getUserIdFromAggregatedId(selectedId) : null;

  const { data: portfolioIds = [] } = useQuery({
    queryKey: ['user-portfolio-ids', targetUserId],
    queryFn: async () => {
      if (!targetUserId) return [];
      const { data, error } = await supabase
        .from('portfolios')
        .select('id')
        .eq('user_id', targetUserId);
      if (error) throw error;
      return data.map(p => p.id);
    },
    enabled: !!targetUserId,
    staleTime: 60000,
  });

  return { portfolioIds, isUserAggregated: isUserAgg, targetUserId };
}
