import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, Activity, Pencil, Lock } from 'lucide-react';
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
  beta_manual: boolean;
}

async function loadRows(): Promise<Row[]> {
  const [positionsRes, mappingsRes, fundamentalsRes, pricesRes] = await Promise.all([
    supabase.from('positions').select('ticker, underlying, description, asset_type'),
    supabase.from('underlying_mappings').select('underlying, ticker'),
    supabase.from('ticker_fundamentals').select('ticker, name, beta, beta_source, beta_updated_at, beta_manual'),
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
    // 1. Mapping diretto (priorità massima: copre RAMBUS→RMBS, APPLE→AAPL, ecc.)
    const d = direct.get(raw) || direct.get(up);
    if (d) return d.toUpperCase();
    // 2. Mapping normalizzato
    const n = normMap.get(normalizeUnderlying(raw));
    if (n) return n.toUpperCase();
    // 3. Solo se NON c'è mapping, accetta come ticker pulito
    if (VALID_TICKER_RE.test(up)) return up;
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
      beta_manual: !!f?.beta_manual,
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
  const [missingBusy, setMissingBusy] = useState(false);
  const [missingProgress, setMissingProgress] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const { data: rows, isLoading } = useQuery({ queryKey: ['admin-beta-refresh'], queryFn: loadRows });

  const missing = useMemo(() => (rows || []).filter((r) => r.beta == null), [rows]);

  // Opzioni filtro: estraggo tutte le sorgenti uniche dai dati
  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach((r) => {
      if (r.beta_manual) set.add('__manual__');
      else if (r.beta_source) {
        // Split su "+" per avere fonti singole (es. "Yahoo+GuruFocus" -> Yahoo, GuruFocus)
        r.beta_source.split('+').forEach((s) => set.add(s.trim()));
      } else if (r.beta == null) set.add('__none__');
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (sourceFilter === 'all') return rows || [];
    if (sourceFilter === '__manual__') return (rows || []).filter((r) => r.beta_manual);
    if (sourceFilter === '__none__') return (rows || []).filter((r) => r.beta == null && !r.beta_manual);
    if (sourceFilter === '__auto_only__') return (rows || []).filter((r) => !r.beta_manual && r.beta != null);
    // Filtro per sorgente singola (anche dentro media multipla)
    return (rows || []).filter((r) => {
      if (r.beta_manual) return false;
      if (!r.beta_source) return false;
      return r.beta_source.split('+').map((s) => s.trim()).includes(sourceFilter);
    });
  }, [rows, sourceFilter]);

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
        toast.warning(`${ticker}: beta non disponibile su Yahoo, GuruFocus, TradingView, Investing`);
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
      toast.success(`Batch: ${data?.updated ?? 0} aggiornati, ${data?.skipped ?? 0} saltati, ${data?.errors ?? 0} errori`);
      qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
    } catch (e: any) {
      toast.error(`Errore batch: ${e?.message || e}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const refetchMissing = async () => {
    const targets = (rows || []).filter((r) => r.beta == null && !r.beta_manual).map((r) => r.ticker);
    if (!targets.length) {
      toast.info('Nessun ticker senza beta da aggiornare');
      return;
    }
    setMissingBusy(true);
    setMissingProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      try {
        const { data, error } = await supabase.functions.invoke('fetch-ticker-fundamentals', {
          body: { ticker: t, force: true },
        });
        if (error) throw error;
        if (data?.beta != null) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setMissingProgress({ done: i + 1, total: targets.length });
    }
    setMissingBusy(false);
    setMissingProgress(null);
    toast.success(`Senza beta: ${ok} risolti, ${fail} ancora mancanti (su ${targets.length})`);
    qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
  };

  const openEdit = (r: Row) => {
    setEditing(r);
    setEditValue(r.beta != null ? String(r.beta) : '');
  };

  const saveManual = async () => {
    if (!editing) return;
    const v = parseFloat(editValue.replace(',', '.'));
    if (!isFinite(v) || Math.abs(v) > 10) {
      toast.error('Beta non valido (deve essere un numero, |β| < 10)');
      return;
    }
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('ticker_fundamentals')
        .upsert({
          ticker: editing.ticker,
          beta: v,
          beta_source: 'Manuale (admin)',
          beta_manual: true,
          beta_updated_at: nowIso,
          updated_at: nowIso,
        }, { onConflict: 'ticker' });
      if (error) throw error;
      toast.success(`${editing.ticker}: β manuale = ${v.toFixed(3)}`);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
    } catch (e: any) {
      toast.error(`Errore salvataggio: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const clearManual = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ticker_fundamentals')
        .update({ beta_manual: false, updated_at: new Date().toISOString() })
        .eq('ticker', editing.ticker);
      if (error) throw error;
      toast.success(`${editing.ticker}: beta manuale rimosso, tornerà ad aggiornarsi automaticamente`);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin-beta-refresh'] });
    } catch (e: any) {
      toast.error(`Errore: ${e?.message || e}`);
    } finally {
      setSaving(false);
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
        <div className="flex items-center gap-2">
          <Button
            onClick={refetchMissing}
            disabled={missingBusy || batchBusy || missing.length === 0}
            size="sm"
            variant="outline"
          >
            {missingBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {missingProgress
              ? `Senza beta ${missingProgress.done}/${missingProgress.total}`
              : `Fetch solo senza beta (${missing.length})`}
          </Button>
          <Button onClick={refetchAll} disabled={batchBusy || missingBusy} size="sm">
            {batchBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refetch tutti
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Fonti automatiche: Yahoo Finance, GuruFocus, TradingView, Investing (media semplice tra quelle disponibili).
          I valori manuali hanno priorità e non vengono mai sovrascritti dal cron.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <Label className="text-xs text-muted-foreground">Filtra per fonte:</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[260px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte ({rows?.length ?? 0})</SelectItem>
              <SelectItem value="__manual__">🔒 Solo manuali</SelectItem>
              <SelectItem value="__auto_only__">Solo automatici (no manuali)</SelectItem>
              <SelectItem value="__none__">Senza beta</SelectItem>
              {sourceOptions
                .filter((s) => s !== '__manual__' && s !== '__none__')
                .map((s) => (
                  <SelectItem key={s} value={s}>
                    Contiene: {s}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredRows.length} risultati
          </span>
        </div>
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
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.ticker} className={r.beta == null ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-mono font-semibold">{r.ticker}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.name ?? '-'}</TableCell>
                    <TableCell className="text-right">{r.positions}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.beta != null ? r.beta.toFixed(3) : <span className="text-destructive">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {r.beta_manual && <Lock className="w-3 h-3 text-amber-500" />}
                        {r.beta_source ?? '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.beta_updated_at ? formatDate(r.beta_updated_at) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => refetchOne(r.ticker)}
                          disabled={busy === r.ticker || r.beta_manual}
                          title={r.beta_manual ? 'Beta manuale: rimuovi il lock per refetchare' : 'Refetch da Yahoo/GuruFocus/TradingView/Investing'}
                        >
                          {busy === r.ticker ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(r)}
                          title="Inserisci/modifica beta manualmente"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Beta manuale — {editing?.ticker}</DialogTitle>
            <DialogDescription>
              Il valore inserito viene marcato come <strong>manuale</strong> e non sarà più sovrascritto
              dal cron automatico né dai refetch. Per riattivare l'aggiornamento automatico usa "Rimuovi manuale".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="manual-beta">Beta</Label>
              <Input
                id="manual-beta"
                type="number"
                step="0.001"
                min={-10}
                max={10}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="es. 1.234"
              />
            </div>
            {editing?.beta != null && (
              <p className="text-xs text-muted-foreground">
                Valore attuale: <span className="font-mono">{editing.beta.toFixed(3)}</span>
                {editing.beta_source ? ` (${editing.beta_source})` : ''}
                {editing.beta_manual && ' — manuale'}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            {editing?.beta_manual && (
              <Button variant="outline" onClick={clearManual} disabled={saving}>
                Rimuovi manuale
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Annulla
            </Button>
            <Button onClick={saveManual} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
