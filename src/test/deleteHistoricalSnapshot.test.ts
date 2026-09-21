import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { deleteHistoricalSnapshot, invalidateSnapshotQueries } from '@/lib/deleteHistoricalSnapshot';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

describe('historical snapshot deletion', () => {
  beforeEach(() => rpc.mockReset());

  it('uses one atomic RPC scoped to the selected portfolio', async () => {
    const result = { portfolio_id: 'silvias-portfolio', deleted_date: '2026-09-21',
      snapshot_date: '2026-09-09', restored: true };
    rpc.mockResolvedValue({ data: result, error: null });
    expect(await deleteHistoricalSnapshot('silvias-portfolio', 'history-id')).toEqual(result);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_historical_snapshot', {
      p_history_id: 'history-id', p_portfolio_id: 'silvias-portfolio',
    });
  });

  it('propagates restoration errors instead of reporting a successful deletion', async () => {
    const error = new Error('Snapshot completo non disponibile');
    rpc.mockResolvedValue({ data: null, error });
    await expect(deleteHistoricalSnapshot('portfolio', 'history')).rejects.toThrow(error);
  });

  it('invalidates dashboard, derivatives, Stress Lab inputs, historical views and aggregates', async () => {
    const client = new QueryClient();
    const affected = [
      ['historical-data', 'portfolio'], ['positions', 'portfolio'],
      ['positions', 'AGGREGATED'], ['positions', 'AGGREGATED_USER:user'],
      ['portfolios', 'user'], ['admin-view-portfolio', 'portfolio'],
      ['strategy-configurations', 'portfolio'], ['derivative-overrides', 'portfolio'],
      ['gp-holdings', 'portfolio'], ['full-snapshot', 'portfolio', '2026-09-21'],
      ['full-snapshot-dates', 'portfolio'], ['performance-attribution', 'portfolio'],
      ['user-portfolio-meta', 'user'], ['all-portfolios-for-aggregation'],
      ['aggregated-portfolios'], ['aggregated-positions'], ['admin-all-portfolios'],
    ];
    for (const key of affected) client.setQueryData(key, { old: true });
    client.setQueryData(['underlying-prices'], { live: true });
    await invalidateSnapshotQueries(client);
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['underlying-prices'])?.isInvalidated).toBe(false);
    client.clear();
  });

  it('cancels pre-delete reads so a late response cannot overwrite restored data', async () => {
    const client = new QueryClient();
    let resolveOld!: (data: string[]) => void;
    const pending = client.fetchQuery({ queryKey: ['positions', 'portfolio'],
      queryFn: () => new Promise<string[]>(resolve => { resolveOld = resolve; }) });
    // Cancellation rejects the original caller, as expected.
    const cancellation = pending.catch(() => undefined);
    await invalidateSnapshotQueries(client);
    client.setQueryData(['positions', 'portfolio'], ['restored']);
    resolveOld(['deleted-date']);
    await cancellation;
    expect(client.getQueryData(['positions', 'portfolio'])).toEqual(['restored']);
    client.clear();
  });
});
