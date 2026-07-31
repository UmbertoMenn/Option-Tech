import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, TrendingDown, DollarSign, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCallBuybacks, CallBuybackRow } from '@/hooks/useCallBuybacks';
import { useCallBuybackAlerts, useCallBuybackAlertMutations } from '@/hooks/useCallBuybackAlerts';
import { usePriceAlerts, useCreatePriceAlert, useDeletePriceAlert } from '@/hooks/usePriceAlerts';
import {
  BuybackTranche,
  CallBuybackAlertScope,
  callKey,
  evaluateGain,
  triggeredDirection,
} from '@/lib/callBuybackAlerts';

/** Parse tollerante IT/US: "4,55" e "4.55" valgono entrambi 4.55. */
function parseNum(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return parseFloat(t);
}

/** Campo percentuale: vuoto = direzione non monitorata. */
function parseThreshold(s: string): { value: number | null; valid: boolean } {
  if (!s.trim()) return { value: null, valid: true };
  const n = parseNum(s);
  if (!Number.isFinite(n) || n <= 0) return { value: null, valid: false };
  return { value: n, valid: true };
}

const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
};

function toTranche(b: CallBuybackRow): BuybackTranche {
  return {
    id: b.id,
    underlying: b.underlying,
    strike: b.strike,
    expiry_date: b.expiry_date,
    quantity: b.quantity,
    buyback_price: b.buyback_price,
    market_price: b.market_price,
  };
}

/**
 * Riga di configurazione di una soglia, riusata sia per l'aggregato di call sia
 * per la singola tranche: i due campi % sono indipendenti e lasciarli vuoti
 * entrambi rimuove l'avviso.
 */
function ThresholdEditor({
  scope,
  label,
  sublabel,
  tranches,
  today,
  existingGain,
  existingLoss,
  enabled,
  onSave,
  onToggleEnabled,
  isSaving,
}: {
  scope: CallBuybackAlertScope;
  label: string;
  sublabel: string;
  tranches: BuybackTranche[];
  today: string;
  existingGain: number | null;
  existingLoss: number | null;
  enabled: boolean | null;
  onSave: (gain: number | null, loss: number | null) => void;
  onToggleEnabled: (enabled: boolean) => void;
  isSaving: boolean;
}) {
  const [gain, setGain] = useState(existingGain != null ? String(existingGain) : '');
  const [loss, setLoss] = useState(existingLoss != null ? String(existingLoss) : '');

  const evaluation = useMemo(() => evaluateGain(tranches, today), [tranches, today]);
  const preview = evaluation
    ? triggeredDirection(evaluation.gainPct, parseThreshold(gain).value, parseThreshold(loss).value)
    : null;

  const dirty = gain !== (existingGain != null ? String(existingGain) : '')
    || loss !== (existingLoss != null ? String(existingLoss) : '');

  const save = () => {
    const g = parseThreshold(gain);
    const l = parseThreshold(loss);
    if (!g.valid) return toast.error('Soglia di guadagno non valida', { description: 'Percentuale positiva, oppure vuoto.' });
    if (!l.valid) return toast.error('Soglia di perdita non valida', { description: 'Percentuale positiva, oppure vuoto.' });
    onSave(g.value, l.value);
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${scope === 'call' ? 'bg-muted/30' : 'bg-background'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            {label}
            {enabled === false && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">disattivo</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{sublabel}</div>
        </div>
        {enabled !== null && (
          <Switch checked={enabled} onCheckedChange={onToggleEnabled} aria-label={`Attiva ${label}`} />
        )}
      </div>

      {evaluation ? (
        <p className="text-xs text-muted-foreground">
          Premio {fmt(evaluation.referencePrice)} → mercato {fmt(evaluation.marketPrice)} ={' '}
          <span className={evaluation.gainPct >= 0 ? 'text-green-500' : 'text-red-500'}>
            {evaluation.gainPct >= 0 ? '+' : ''}{fmt(evaluation.gainPct)}%
          </span>
        </p>
      ) : (
        <p className="text-xs text-amber-500">
          Prezzo di mercato non disponibile: la soglia si salva ma non viene valutata.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-green-500" /> Guadagno ≥ %
          </Label>
          <Input value={gain} onChange={e => setGain(e.target.value)} placeholder="es. 20" className="h-8 text-xs" inputMode="decimal" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <TrendingDown className="w-3 h-3 text-red-500" /> Perdita ≥ %
          </Label>
          <Input value={loss} onChange={e => setLoss(e.target.value)} placeholder="es. 15" className="h-8 text-xs" inputMode="decimal" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {preview
            ? (preview === 'gain' ? 'Scatterebbe adesso (guadagno).' : 'Scatterebbe adesso (perdita).')
            : 'Vuoti entrambi = avviso rimosso.'}
        </span>
        <Button size="sm" variant={dirty ? 'default' : 'outline'} className="h-7 text-xs" onClick={save} disabled={isSaving}>
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Salva'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Gestione degli avvisi sulle "call da rivendere", dentro il dialog avvisi.
 *
 * Gerarchia esplicita: per ogni call si imposta una soglia sull'AGGREGATO
 * (media ponderata di tutte le tranche aperte) e, opzionalmente, soglie sulle
 * singole TRANCHE. I due livelli generano avvisi separati e non si escludono.
 */
export function CallBuybackAlertsPanel({ portfolioId }: { portfolioId: string | null | undefined }) {
  const today = new Date().toISOString().split('T')[0];
  const { buybacks, isLoading } = useCallBuybacks([portfolioId]);
  const { alerts } = useCallBuybackAlerts(portfolioId);
  const { upsert, setEnabled } = useCallBuybackAlertMutations(portfolioId);
  const { data: priceAlerts = [] } = usePriceAlerts();
  const createPriceAlert = useCreatePriceAlert();
  const deletePriceAlert = useDeletePriceAlert();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [priceTicker, setPriceTicker] = useState('');
  const [priceDirection, setPriceDirection] = useState<'above' | 'below'>('above');
  const [priceTarget, setPriceTarget] = useState('');

  // Le call aperte, raggruppate: una scheda per call, le tranche dentro.
  const calls = useMemo(() => {
    const map = new Map<string, { underlying: string; strike: number; expiry_date: string; rows: CallBuybackRow[] }>();
    for (const b of buybacks) {
      if (b.quantity <= 0) continue;
      const key = callKey(b);
      const entry = map.get(key);
      if (entry) entry.rows.push(b);
      else map.set(key, { underlying: b.underlying, strike: b.strike, expiry_date: b.expiry_date, rows: [b] });
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [buybacks]);

  const buybackTickers = useMemo(
    () => Array.from(new Set(calls.map(c => c.underlying.toUpperCase()))).sort(),
    [calls],
  );

  const contextPriceAlerts = useMemo(
    () => priceAlerts.filter(pa => pa.context === 'call_buyback'),
    [priceAlerts],
  );

  const saveThreshold = (
    scope: CallBuybackAlertScope,
    call: { underlying: string; strike: number; expiry_date: string },
    buybackId: string | null,
    gain: number | null,
    loss: number | null,
  ) => {
    upsert.mutate(
      {
        scope,
        buyback_id: buybackId,
        underlying: call.underlying,
        strike: call.strike,
        expiry_date: call.expiry_date,
        gain_threshold_pct: gain,
        loss_threshold_pct: loss,
      },
      {
        onSuccess: () => toast.success(
          gain == null && loss == null ? 'Avviso rimosso' : 'Soglie salvate',
          { description: `${call.underlying} C ${call.strike} — ${scope === 'call' ? 'intera call' : 'singola tranche'}` },
        ),
        onError: (e: unknown) => toast.error('Salvataggio non riuscito', {
          description: e instanceof Error ? e.message : 'errore sconosciuto',
        }),
      },
    );
  };

  const addPriceAlert = () => {
    const ticker = priceTicker.trim().toUpperCase();
    const target = parseNum(priceTarget);
    if (!ticker) return toast.error('Seleziona un sottostante');
    if (!Number.isFinite(target) || target <= 0) return toast.error('Prezzo target non valido');
    createPriceAlert.mutate(
      { ticker, direction: priceDirection, target_price: target, context: 'call_buyback' },
      {
        onSuccess: () => {
          toast.success('Avviso di prezzo creato', {
            description: `${ticker} ${priceDirection === 'above' ? 'sopra' : 'sotto'} ${target}`,
          });
          setPriceTarget('');
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'errore sconosciuto';
          toast.error('Creazione non riuscita', {
            description: /duplicate key|unique/i.test(msg) ? 'Esiste già un avviso identico.' : msg,
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Avvisi indipendenti dalle regole delle strategie: valgono solo sulle call riacquistate e non
        ancora rivendute, e si impostano una call alla volta.
      </p>

      {calls.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nessuna call da rivendere aperta su questo portafoglio.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Le call riacquistate si registrano dalla card "Covered Call da rivendere" nella pagina Derivati.
          </p>
        </div>
      )}

      {calls.map(call => {
        const callAlert = alerts.find(a => a.scope === 'call' && callKey(a) === call.key) ?? null;
        const isOpen = expanded[call.key] ?? false;
        const tranchesWithAlert = call.rows.filter(r =>
          alerts.some(a => a.scope === 'tranche' && a.buyback_id === r.id),
        ).length;
        const totalQty = call.rows.reduce((s, r) => s + r.quantity, 0);

        return (
          <div key={call.key} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span className="text-sm font-semibold">
                  {call.underlying} C {call.strike}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  scad. {fmtDate(call.expiry_date)} · {totalQty} contratti · {call.rows.length}{' '}
                  {call.rows.length === 1 ? 'tranche' : 'tranche'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {callAlert && (
                  <Badge variant="outline" className="text-[10px] bg-blue-500/10 border-blue-500/30 text-blue-400">
                    soglia sulla call
                  </Badge>
                )}
                {tranchesWithAlert > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-purple-500/10 border-purple-500/30 text-purple-400">
                    {tranchesWithAlert} su tranche
                  </Badge>
                )}
              </div>
            </div>

            <ThresholdEditor
              key={`call-${call.key}-${callAlert?.id ?? 'new'}`}
              scope="call"
              label="Intera call"
              sublabel={`Media ponderata di tutte le tranche aperte (${totalQty} contratti)`}
              tranches={call.rows.map(toTranche)}
              today={today}
              existingGain={callAlert?.gain_threshold_pct ?? null}
              existingLoss={callAlert?.loss_threshold_pct ?? null}
              enabled={callAlert ? callAlert.enabled : null}
              onToggleEnabled={(en) => callAlert && setEnabled.mutate({ id: callAlert.id, enabled: en })}
              onSave={(g, l) => saveThreshold('call', call, null, g, l)}
              isSaving={upsert.isPending}
            />

            {call.rows.length > 1 && (
              <button
                type="button"
                onClick={() => setExpanded(p => ({ ...p, [call.key]: !isOpen }))}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isOpen ? '▲ Nascondi' : '▼ Mostra'} le {call.rows.length} tranche singole
              </button>
            )}

            {(isOpen || call.rows.length === 1) && call.rows.map(row => {
              const trancheAlert = alerts.find(a => a.scope === 'tranche' && a.buyback_id === row.id) ?? null;
              return (
                <ThresholdEditor
                  key={`tranche-${row.id}-${trancheAlert?.id ?? 'new'}`}
                  scope="tranche"
                  label={`Tranche ${row.quantity} × ${fmt(row.buyback_price)} ${row.currency}`}
                  sublabel={`Riacquisto del ${fmtDate(row.buyback_date)}`}
                  tranches={[toTranche(row)]}
                  today={today}
                  existingGain={trancheAlert?.gain_threshold_pct ?? null}
                  existingLoss={trancheAlert?.loss_threshold_pct ?? null}
                  enabled={trancheAlert ? trancheAlert.enabled : null}
                  onToggleEnabled={(en) => trancheAlert && setEnabled.mutate({ id: trancheAlert.id, enabled: en })}
                  onSave={(g, l) => saveThreshold('tranche', call, row.id, g, l)}
                  isSaving={upsert.isPending}
                />
              );
            })}
          </div>
        );
      })}

      {/* Avvisi di prezzo sul sottostante, con titolo dedicato */}
      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Prezzo del sottostante
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Normale avviso di prezzo, ma l'avviso generato si intitola "Call da rivendere" invece del
            generico "Avviso Prezzo", così lo riconosci subito nella campanella.
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Sottostante</Label>
            <Select value={priceTicker} onValueChange={setPriceTicker}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Scegli…" /></SelectTrigger>
              <SelectContent>
                {buybackTickers.map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Direzione</Label>
            <Select value={priceDirection} onValueChange={v => setPriceDirection(v as 'above' | 'below')}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="above" className="text-xs">Sopra</SelectItem>
                <SelectItem value="below" className="text-xs">Sotto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[120px]">
            <Label className="text-[11px] text-muted-foreground">Prezzo target</Label>
            <Input value={priceTarget} onChange={e => setPriceTarget(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addPriceAlert} disabled={createPriceAlert.isPending}>
            Aggiungi
          </Button>
        </div>

        {contextPriceAlerts.length > 0 && (
          <div className="space-y-1">
            {contextPriceAlerts.map(pa => (
              <div key={pa.id} className="flex items-center justify-between text-xs rounded border px-2 py-1">
                <span>
                  {pa.ticker} {pa.direction === 'above' ? 'sopra' : 'sotto'} {fmt(pa.target_price)}
                  {!pa.enabled && <span className="ml-1 text-muted-foreground">(disattivo)</span>}
                </span>
                <button
                  type="button"
                  onClick={() => deletePriceAlert.mutate(pa.id)}
                  className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500"
                  aria-label="Elimina avviso di prezzo"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
