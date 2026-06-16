import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeUnderlying } from '@/hooks/useUnderlyingMappings';
import { formatDate } from '@/lib/formatters';

const VALID_TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

interface Row {
  ticker: string;
  name: string | null;
  positions: number;
  beta: number | null;
  beta_source: string | null;
  beta_updated_at: string | null;
}

async function loadRows(): Promise<Row[]> {
  const [positionsRes, mappingsRes, fundamentalsRes, pricesRes] = await Promise.all([
    supabase.from('positions').select('ticker, underlying, description, asset_type'),
    supabase.from('underlying_mappings').select('underlying, ticker'),
    supabase.from('ticker_fundamentals').select('ticker, name, beta, beta_source, beta_updated_at'),
    supabase.from('underlying_prices').select('ticker'),
  ]);

  const direct = new Map<string, string>();
  const normMap = new Map<string, string>();
  (mappingsRes.data || []).forEach((m) => {
    direct.set(m.underlying, m.ticker);
    const k = normalizeUnderlying(m.underlying);
    if (!normMap.has(k)) normMap.set(k, m.ticker);
  });

  const knownTickers = new Set<string>();
  (pricesRes.data || []).forEach((p: any) => knownTickers.add(String(p.ticker).toUpperCase()));

  const resolve = (raw: string | null): string | null => {
    if (!raw) return null;
    const up = raw.trim().toUpperCase();
    if (VALID_TICKER_RE.test(up) && knownTickers.has(up)) return up;
    if (VALID_TICKER_RE.test(up)) return up;
    const d = direct.get(raw);
    if (d) return d.toUpperCase();
    const n = normMap.get(normalizeUnderlying(raw));
    if (n) return n.toUpperCase();
    return null;
  };

  const counts = new Map<string, number>();
  (positionsRes.data || []).forEach((p: any) => {
    if (p.asset_type === 'bond') return;
    let key: string | null = null;
    if (p.asset_type === 'derivative') key = resolve(p.underlying);
    else key = resolve(p.ticker || p.description);
    if (key && VALID_TICKER_RE.test(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });

  const funds = new Map<string, any>();
  (fundamentalsRes.data || []).forEach((f: any) => funds.set(f.ticker, f));

  const rows: Row[] = [];
  counts.forEach((n, ticker) => {
    const f = funds.get(ticker);
    rows.push({
      ticker,
      name: f?.name ?? null,
      positions: n,
      beta: f?.beta ?? null,
      beta_source: f?.beta_source ?? null,
      beta_updated_at: f?.beta_updated_at ?? null,
    });
  });
  rows.sort((a, b) => {
    if ((a.beta == null) !== (b.beta == null)) return a.beta == null ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  });
  return rows;
}

export function BetaRefreshPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const { data: rows, isLoading } = useQuery({ queryKey: ['admin-beta-refresh'], queryFn: loadRows });

  const missing = useMemo(() => (rows || []).filter((r) => r.beta == null), [rows]);

  const refetchOne = async (ticker: string) => {
    setBusy(ticker);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-ticker-fundamentals', {
        body: { ticker, force: true },
      });
      if (error) throw error;
      if (data?.beta != null) {
        toast.success(`${ticker}: β = ${Number(data.beta).toFixed(3)} (${data.betaSource})`);
      } else {
        toast.warning(`${ticker}: beta non disponibile su Yahoo né GuruFocus`);
      }
      qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
    } catch (e: any) {
      toast.error(`Errore ${ticker}: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const refetchAll = async () => {
    setBatchBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-beta-cron', { body: {} });
      if (error) throw error;
      toast.success(`Batch completato: ${data?.updated ?? 0} aggiornati, ${data?.skipped ?? 0} saltati, ${data?.errors ?? 0} errori`);
      qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
    } catch (e: any) {
      toast.error(`Errore batch: ${e?.message || e}`);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Beta &amp; Fundamentals</CardTitle>
          <Badge variant="secondary">{rows?.length ?? 0}</Badge>
          {missing.length > 0 && (
            <Badge variant="destructive">{missing.length} senza beta</Badge>
          )}
        </div>
        <Button onClick={refetchAll} disabled={batchBusy} size="sm">
          {batchBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Refetch tutti
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Caricamento...</div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-right">Posizioni</TableHead>
                  <TableHead className="text-right">Beta</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Aggiornato</TableHead>
                  <TableHead className="text-right">Azione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows || []).map((r) => (
                  <TableRow key={r.ticker} className={r.beta == null ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-mono font-semibold">{r.ticker}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.name ?? '-'}</TableCell>
                    <TableCell className="text-right">{r.positions}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.beta != null ? r.beta.toFixed(3) : <span className="text-destructive">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.beta_source ?? '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.beta_updated_at ? formatDate(r.beta_updated_at) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refetchOne(r.ticker)}
                        disabled={busy === r.ticker}
                      >
                        {busy === r.ticker ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
