/**
 * Dati per la simulazione del Portafoglio virtuale:
 *  - universo degli strumenti detenuti da TUTTI i clienti (ultimo caricamento di ogni
 *    portafoglio) con spot e smile di IV per sottostante;
 *  - mix empirico delle put vendute dagli snapshot storici completi (on demand);
 *  - catene di strike quotati e risk-free.
 * Sola lettura (RLS admin: tutti i portafogli; altrimenti solo i propri).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  buildUniverse,
  buildEmpiricalPutStats,
  EmpiricalStats,
  HistoricalSnapshotInput,
  ListedChain,
  RawPosition,
  Universe,
} from '@/lib/virtualSimulation';

const PAGE = 1000;
const DEFAULT_RISK_FREE = 0.04;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function fetchAll<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const toSpotMap = (raw: unknown): Record<string, number> => {
  const m: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0) m[k] = n;
    }
  }
  return m;
};

interface UniverseRaw {
  portfolios: { id: string; snapshot_date: string | null }[];
  positions: RawPosition[];
  spotsByPortfolioDate: Record<string, Record<string, number>>;
  liveSpots: Record<string, { price: number; currency?: string }>;
  mappings: { underlying: string; ticker: string }[];
  riskFree: number;
}

export function useClientUniverse(enabled = true) {
  const q = useQuery({
    queryKey: ['virtual-sim-universe'],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<UniverseRaw> => {
      const [pfs, positions, hist, live, maps, rf] = await Promise.all([
        supabase.from('portfolios').select('id, snapshot_date'),
        fetchAll<RawPosition>((a, b) =>
          supabase
            .from('positions')
            .select('portfolio_id, asset_type, description, underlying, ticker, option_type, strike_price, expiry_date, quantity, snapshot_price, current_price, currency, exchange_rate')
            .in('asset_type', ['derivative', 'stock', 'etf'])
            .order('id')
            .range(a, b) as unknown as Page<never>,
        ),
        fetchAll<{ portfolio_id: string; snapshot_date: string; snapshot_underlying_prices: unknown }>((a, b) =>
          supabase
            .from('historical_data')
            .select('portfolio_id, snapshot_date, snapshot_underlying_prices')
            .order('snapshot_date')
            .order('portfolio_id')
            .range(a, b) as unknown as Page<never>,
        ),
        fetchAll<{ ticker: string; price: number; currency: string }>((a, b) =>
          supabase.from('underlying_prices').select('ticker, price, currency').order('ticker').range(a, b) as unknown as Page<never>,
        ),
        fetchAll<{ underlying: string; ticker: string }>((a, b) =>
          supabase.from('underlying_mappings').select('underlying, ticker').order('underlying').range(a, b) as unknown as Page<never>,
        ),
        supabase.from('ticker_fundamentals').select('risk_free').not('risk_free', 'is', null).limit(500),
      ]);
      if (pfs.error) throw pfs.error;
      const spotsByPortfolioDate: Record<string, Record<string, number>> = {};
      for (const h of hist) spotsByPortfolioDate[`${h.portfolio_id}|${h.snapshot_date}`] = toSpotMap(h.snapshot_underlying_prices);
      const liveSpots: Record<string, { price: number; currency?: string }> = {};
      for (const r of live) {
        const px = Number(r.price);
        if (px > 0) liveSpots[String(r.ticker).toUpperCase()] = { price: px, currency: r.currency };
      }
      const rfs = ((rf.data ?? []) as { risk_free: number | null }[])
        .map((r) => Number(r.risk_free))
        .filter((x) => x > 0 && x < 1);
      return {
        portfolios: (pfs.data ?? []) as { id: string; snapshot_date: string | null }[],
        positions,
        spotsByPortfolioDate,
        liveSpots,
        mappings: maps,
        riskFree: rfs.length ? rfs.reduce((a, b) => a + b, 0) / rfs.length : DEFAULT_RISK_FREE,
      };
    },
  });

  const universe: Universe | null = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    const snapshotSpots: Record<string, Record<string, number>> = {};
    for (const p of d.portfolios) {
      if (p.snapshot_date) snapshotSpots[p.id] = d.spotsByPortfolioDate[`${p.id}|${p.snapshot_date}`] ?? {};
    }
    return buildUniverse({
      portfolios: d.portfolios,
      positions: d.positions,
      snapshotSpots,
      liveSpots: d.liveSpots,
      mappings: d.mappings,
      riskFree: d.riskFree,
    });
  }, [q.data]);

  const tickers = useMemo(() => (universe?.underlyings ?? []).map((u) => u.ticker).sort(), [universe]);
  const chainsQuery = useQuery({
    queryKey: ['virtual-sim-chains', tickers.join(',')],
    enabled: enabled && tickers.length > 0,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAll<{ ticker: string; expiry: string; put_strikes: number[] }>((a, b) =>
        supabase.from('option_listed_strikes').select('ticker, expiry, put_strikes').in('ticker', tickers).order('ticker').range(a, b) as unknown as Page<never>,
      );
      const m: Record<string, ListedChain[]> = {};
      for (const r of rows) {
        const t = String(r.ticker).toUpperCase();
        (m[t] = m[t] || []).push({ expiry: r.expiry, strikes: (r.put_strikes ?? []).map(Number).filter((k) => k > 0) });
      }
      return m;
    },
  });

  return {
    universe,
    chains: chainsQuery.data ?? {},
    riskFree: q.data?.riskFree ?? DEFAULT_RISK_FREE,
    spotsByPortfolioDate: q.data?.spotsByPortfolioDate ?? null,
    mappings: q.data?.mappings ?? [],
    isLoading: q.isLoading,
    error: q.error as Error | null,
  };
}

/** Mix empirico delle put vendute dagli snapshot storici completi (caricato on demand). */
export function useEmpiricalPutMix(
  enabled: boolean,
  spotsByPortfolioDate: Record<string, Record<string, number>> | null,
  atmBand: number,
  sinceDate: string | null,
) {
  const q = useQuery({
    queryKey: ['virtual-sim-full-snapshots'],
    enabled,
    staleTime: 30 * 60 * 1000,
    queryFn: async () =>
      fetchAll<HistoricalSnapshotInput>((a, b) =>
        supabase
          .from('portfolio_full_snapshots')
          .select('portfolio_id, snapshot_date, positions')
          .order('snapshot_date')
          .order('portfolio_id')
          .range(a, b) as unknown as Page<never>,
      ),
  });
  const stats: EmpiricalStats | null = useMemo(() => {
    if (!q.data || !spotsByPortfolioDate) return null;
    return buildEmpiricalPutStats(q.data, spotsByPortfolioDate, atmBand, sinceDate);
  }, [q.data, spotsByPortfolioDate, atmBand, sinceDate]);
  return { stats, isLoading: q.isLoading, error: q.error as Error | null };
}
