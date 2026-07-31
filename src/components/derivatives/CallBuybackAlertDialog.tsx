import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, TrendingUp, TrendingDown, DollarSign, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CallBuybackRow } from '@/hooks/useCallBuybacks';
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

interface CallBuybackAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La tranche da cui è stato aperto il dialog. */
  row: CallBuybackRow;
  /** Tutte le tranche aperte del portafoglio, per l'aggregato di call. */
  allBuybacks: CallBuybackRow[];
  portfolioId: string | null | undefined;
  underlyingPrice?: number | null;
}

export function CallBuybackAlertDialog({
  open,
  onOpenChange,
  row,
  allBuybacks,
  portfolioId,
  underlyingPrice,
}: CallBuybackAlertDialogProps) {
  const today = new Date().toISOString().split('T')[0];
  const { alerts } = useCallBuybackAlerts(portfolioId);
  const { upsert, remove } = useCallBuybackAlertMutations(portfolioId);
  const { data: priceAlerts = [] } = usePriceAlerts();
  const createPriceAlert = useCreatePriceAlert();
  const deletePriceAlert = useDeletePriceAlert();

  const [scope, setScope] = useState<CallBuybackAlertScope>('tranche');
  const [gainPct, setGainPct] = useState('');
  const [lossPct, setLossPct] = useState('');
  const [priceDirection, setPriceDirection] = useState<'above' | 'below'>('above');
  const [targetPrice, setTargetPrice] = useState('');

  const toTranche = (b: CallBuybackRow): BuybackTranche => ({
    id: b.id,
    underlying: b.underlying,
    strike: b.strike,
    expiry_date: b.expiry_date,
    quantity: b.quantity,
    buyback_price: b.buyback_price,
    market_price: b.market_price,
  });

  // Tranche in gioco a seconda dello scope selezionato.
  const subject = useMemo(() => {
    if (scope === 'tranche') return [toTranche(row)];
    const key = callKey(row);
    return allBuybacks.filter(b => b.quantity > 0 && callKey(b) === key).map(toTranche);
  }, [scope, row, allBuybacks]);

  const evaluation = useMemo(() => evaluateGain(subject, today), [subject, today]);

  // Config già salvata per lo scope corrente.
  const existing = useMemo(() => {
    if (scope === 'tranche') {
      return alerts.find(a => a.scope === 'tranche' && a.buyback_id === row.id) ?? null;
    }
    return alerts.find(a => a.scope === 'call' && callKey(a) === callKey(row)) ?? null;
  }, [alerts, scope, row]);

  // Ricarica i campi quando cambia lo scope o arriva la config dal server.
  useEffect(() => {
    setGainPct(existing?.gain_threshold_pct != null ? String(existing.gain_threshold_pct) : '');
    setLossPct(existing?.loss_threshold_pct != null ? String(existing.loss_threshold_pct) : '');
  }, [existing, scope]);

  const relatedPriceAlerts = useMemo(
    () => priceAlerts.filter(pa => pa.context === 'call_buyback' && pa.ticker === row.underlying.toUpperCase()),
    [priceAlerts, row.underlying],
  );

  const saveThresholds = () => {
    const gain = parseThreshold(gainPct);
    const loss = parseThreshold(lossPct);
    if (!gain.valid) return toast.error('Soglia di guadagno non valida', { description: 'Inserisci una percentuale positiva o lascia vuoto.' });
    if (!loss.valid) return toast.error('Soglia di perdita non valida', { description: 'Inserisci una percentuale positiva o lascia vuoto.' });

    upsert.mutate(
      {
        scope,
        buyback_id: scope === 'tranche' ? row.id : null,
        underlying: row.underlying,
        strike: row.strike,
        expiry_date: row.expiry_date,
        gain_threshold_pct: gain.value,
        loss_threshold_pct: loss.value,
      },
      {
        onSuccess: () => {
          toast.success(
            gain.value == null && loss.value == null ? 'Avviso rimosso' : 'Soglie salvate',
            { description: scope === 'tranche' ? 'Livello tranche' : 'Livello call (media ponderata)' },
          );
        },
        onError: (e: unknown) => toast.error('Salvataggio non riuscito', {
          description: e instanceof Error ? e.message : 'errore sconosciuto',
        }),
      },
    );
  };

  const addPriceAlert = () => {
    const target = parseNum(targetPrice);
    if (!Number.isFinite(target) || target <= 0) {
      return toast.error('Prezzo target non valido');
    }
    createPriceAlert.mutate(
      {
        ticker: row.underlying,
        direction: priceDirection,
        target_price: target,
        context: 'call_buyback',
      },
      {
        onSuccess: () => {
          toast.success('Avviso di prezzo creato', {
            description: `${row.underlying} ${priceDirection === 'above' ? 'sopra' : 'sotto'} ${target}`,
          });
          setTargetPrice('');
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'errore sconosciuto';
          toast.error('Creazione non riuscita', {
            description: /duplicate key|unique/i.test(msg)
              ? 'Esiste già un avviso identico su questo ticker.'
              : msg,
          });
        },
      },
    );
  };

  // Anteprima: la soglia scatterebbe adesso?
  const previewDirection = evaluation
    ? triggeredDirection(evaluation.gainPct, parseThreshold(gainPct).value, parseThreshold(lossPct).value)
    : null;

  const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Avvisi — {row.underlying} C {row.strike}
          </DialogTitle>
          <DialogDescription>
            Soglie sul G/P potenziale in % sul premio pagato, e avviso di prezzo sul sottostante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---- Soglie G/P % ---- */}
          <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">G/P potenziale</span>
              <Select value={scope} onValueChange={v => setScope(v as CallBuybackAlertScope)}>
                <SelectTrigger className="h-7 w-56 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tranche" className="text-xs">
                    Questa tranche ({row.quantity} contratti)
                  </SelectItem>
                  <SelectItem value="call" className="text-xs">
                    Tutta la call (media ponderata)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {evaluation ? (
              <p className="text-xs text-muted-foreground">
                Premio di riferimento {fmt(evaluation.referencePrice)} → mercato {fmt(evaluation.marketPrice)} ={' '}
                <span className={evaluation.gainPct >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {evaluation.gainPct >= 0 ? '+' : ''}{fmt(evaluation.gainPct)}%
                </span>{' '}
                su {evaluation.quantity} contratti
              </p>
            ) : (
              <p className="text-xs text-amber-500">
                Prezzo di mercato non ancora disponibile: le soglie si salvano, ma non verranno valutate
                finché il cron opzioni non prezza la call.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-green-500" /> Avvisa se guadagna ≥ %
                </span>
                <Input
                  value={gainPct}
                  onChange={e => setGainPct(e.target.value)}
                  placeholder="es. 20"
                  className="h-8 text-xs"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-red-500" /> Avvisa se perde ≥ %
                </span>
                <Input
                  value={lossPct}
                  onChange={e => setLossPct(e.target.value)}
                  placeholder="es. 15"
                  className="h-8 text-xs"
                  inputMode="decimal"
                />
              </label>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Le due direzioni sono indipendenti: lascia vuoto il campo che non ti interessa.
              Svuotarli entrambi rimuove l'avviso.
              {previewDirection && (
                <span className={previewDirection === 'gain' ? ' text-green-500' : ' text-red-500'}>
                  {' '}Con questi valori l'avviso scatterebbe adesso.
                </span>
              )}
            </p>

            <div className="flex items-center justify-between gap-2">
              {existing ? (
                <Badge variant="outline" className="text-[10px] bg-blue-500/10 border-blue-500/30 text-blue-400">
                  avviso attivo
                </Badge>
              ) : <span />}
              <Button size="sm" className="h-8 text-xs" onClick={saveThresholds} disabled={upsert.isPending}>
                Salva soglie
              </Button>
            </div>
          </div>

          {/* ---- Avviso di prezzo sul sottostante ---- */}
          <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" /> Prezzo del sottostante
              </span>
              {underlyingPrice != null && (
                <span className="text-xs text-muted-foreground">attuale {fmt(underlyingPrice)}</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              È un normale avviso di prezzo su {row.underlying}: cambia solo il titolo, che sarà esplicito
              "Call da rivendere" invece del generico "Avviso Prezzo".
            </p>

            <div className="flex items-end gap-2">
              <Select value={priceDirection} onValueChange={v => setPriceDirection(v as 'above' | 'below')}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above" className="text-xs">Sopra</SelectItem>
                  <SelectItem value="below" className="text-xs">Sotto</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="Prezzo target"
                className="h-8 text-xs flex-1"
                inputMode="decimal"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={addPriceAlert}
                disabled={createPriceAlert.isPending}
              >
                Aggiungi
              </Button>
            </div>

            {relatedPriceAlerts.length > 0 && (
              <div className="space-y-1">
                {relatedPriceAlerts.map(pa => (
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

          {existing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-red-500 hover:bg-red-500/10"
              onClick={() => remove.mutate({ id: existing.id }, {
                onSuccess: () => toast.success('Avviso G/P rimosso'),
              })}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi avviso G/P ({scope === 'tranche' ? 'tranche' : 'call'})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
