import { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SnapshotDeletionResult {
  portfolio_id: string;
  deleted_date: string;
  snapshot_date: string | null;
  restored: boolean;
}

export async function deleteHistoricalSnapshot(portfolioId: string, historyId: string) {
  const { data, error } = await supabase.rpc('delete_historical_snapshot', {
    p_history_id: historyId,
    p_portfolio_id: portfolioId,
  });
  if (error) throw error;
  return data as unknown as SnapshotDeletionResult;
}

// Prefix invalidation covers both single portfolios and cached user/global
// aggregates, including queries that are currently inactive on other pages.
export async function invalidateSnapshotQueries(queryClient: QueryClient) {
  const keys = [
    'historical-data', 'full-snapshot', 'full-snapshot-dates',
    'positions', 'portfolios', 'admin-view-portfolio', 'admin-all-portfolios',
    'admin-latest-client-portfolio', 'strategy-configurations',
    'derivative-overrides', 'gp-holdings', 'performance-attribution',
    'user-portfolio-meta', 'all-portfolios-for-aggregation',
    'aggregated-portfolios', 'aggregated-positions',
  ];
  // Cancel pre-delete reads before refetching so late responses cannot restore
  // obsolete data into the cache.
  await Promise.all(keys.map(key => queryClient.cancelQueries({ queryKey: [key] })));
  await Promise.all(keys.map(key => queryClient.invalidateQueries({ queryKey: [key] })));
}
