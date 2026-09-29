import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const mock = vi.hoisted(() => ({
  scope: { id: 'portfolio-a', owner: 'user-a', actor: 'admin', isAdmin: true },
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: mock.scope.actor }, isAdmin: mock.scope.isAdmin }),
}));
vi.mock('@/contexts/PortfolioContext', () => ({
  AGGREGATED_PORTFOLIO_ID: 'AGGREGATED',
  isUserAggregatedId: (id: string) => id.startsWith('AGGREGATED_USER:'),
  getUserIdFromAggregatedId: (id: string) => id.slice('AGGREGATED_USER:'.length),
  usePortfolioContext: () => ({
    selectedPortfolioId: mock.scope.id,
    selectedPortfolio: { id: mock.scope.id, user_id: mock.scope.owner },
    isReady: true,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_column: string, id: string) => ({ maybeSingle: async () => ({ data: mock.rows.get(id) ?? null, error: null }) }) }),
      upsert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mock.rows.set(row.user_id as string, row);
            return { data: row, error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useStressRollSettings } from '@/hooks/useStressRollSettings';

beforeEach(() => {
  mock.scope = { id: 'portfolio-a', owner: 'user-a', actor: 'admin', isAdmin: true };
  mock.rows.clear();
});

describe('rolling persistito per utente', () => {
  it('admin salva per A; B rimane indipendente; A ritrova i dati al rientro come utente', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender, unmount } = renderHook(() => useStressRollSettings(), { wrapper });
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    act(() => result.current.updateSettings({ enabled: true, triggerPct: 4.5, maxRolls: 8 }));
    act(() => result.current.save());
    await waitFor(() => expect(mock.rows.get('user-a')?.trigger_pct).toBe(4.5));
    expect(mock.rows.get('user-a')?.enabled).toBe(true);
    expect(mock.rows.get('user-a')?.max_rolls).toBe(8);

    mock.scope = { ...mock.scope, id: 'portfolio-b', owner: 'user-b' };
    rerender();
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(result.current.settings.triggerPct).toBe(2);
    expect(result.current.settings.enabled).toBe(false);
    act(() => result.current.setSetting('maxMonthsForward', 6));
    act(() => result.current.save());
    await waitFor(() => expect(mock.rows.get('user-b')?.max_months_forward).toBe(6));
    expect(mock.rows.get('user-a')?.max_months_forward).toBe(12);

    unmount();
    mock.scope = { id: 'portfolio-a', owner: 'user-a', actor: 'user-a', isAdmin: false };
    const own = renderHook(() => useStressRollSettings(), { wrapper });
    await waitFor(() => expect(own.result.current.settings.triggerPct).toBe(4.5));
    expect(own.result.current.settings.enabled).toBe(true);
    own.unmount();
  });

  it('non consente di salvare per un altro utente senza permessi admin o nella vista globale', async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
    mock.scope = { id: 'portfolio-a', owner: 'user-a', actor: 'user-b', isAdmin: false };
    const { result, rerender } = renderHook(() => useStressRollSettings(), { wrapper });
    expect(result.current.canEdit).toBe(false);
    act(() => result.current.save());
    expect(mock.rows.size).toBe(0);
    mock.scope = { ...mock.scope, id: 'AGGREGATED', isAdmin: true };
    rerender();
    expect(result.current.canEdit).toBe(false);
  });
});
