import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, TrendingDown, DollarSign, Percent, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCallBuybacks, CallBuybackRow } from '@/hooks/useCallBuybacks';
import { useCallBuybackAlerts, useCallBuybackAlertMutations } from '@/hooks/useCallBuybackAlerts';
import {
  BuybackTranche,
  CallBuybackAlertMode,
  CallBuybackPriceDirection,
  DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT,
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

/** Campo numerico positivo: vuoto = valore non impostato. */
function parsePositive(s: string): { value: number | null; valid: boolean } {
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

interface EditorValue {
  alertMode: CallBuybackAlertMode;
  gain: number | null;
  loss: number | null;
  priceDirection: CallBuybackPriceDirection | null;
  priceTarget: number | null;
}

/**
 * Editor della singola call. La modalità è esclusiva: la stessa configurazione
 * monitora il G/P percentuale oppure il prezzo del sottostante.
 */
function AlertEditor({
  label,
  sublabel,
  ticker,
  tranches,
  today,
  existingMode,
  existingGain,
  existingLoss,
  existingPriceDirection,
  existingPriceTarget,
  onSave,
  isSaving,
}: {
  label: string;
  sublabel: string;
  ticker: string;
  tranches: BuybackTranche[];
  today: string;
  existingMode: CallBuybackAlertMode;
  existingGain: number | null;
  existingLoss: number | null;
  existingPriceDirection: CallBuybackPriceDirection | null;
  existingPriceTarget: number | null;
  onSave: (value: EditorValue) => void;
  isSaving: boolean;
}) {
  const [mode, setMode] = useState<CallBuybackAlertMode>(existingMode);
  const [gain, setGain] = useState(existingGain != null ? String(existingGain) : '');
  const [loss, setLoss] = useState(existingLoss != null ? String(existingLoss) : '');
  const [priceDirection, setPriceDirection] = useState<CallBuybackPriceDirection>(existingPriceDirection ?? 'above');
  const [priceTarget, setPriceTarget] = useState(existingPriceTarget != null ? String(existingPriceTarget) : '');

  const evaluation = useMemo(() => evaluateGain(tranches, today), [tranches, today]);
  const preview = mode === 'gain_pct' && evaluation
    ? triggeredDirection(evaluation.gainPct, parsePositive(gain).value, parsePositive(loss).value)
    : null;

  const dirty = mode !== existingMode
    || (mode === 'gain_pct' && (
      gain !== (existingGain != null ? String(existingGain) : '')
      || loss !== (existingLoss != null ? String(existingLoss) : '')
    ))
    || (mode === 'price' && (
      priceDirection !== (existingPriceDirection ?? 'above')
      || priceTarget !== (existingPriceTarget != null ? String(existingPriceTarget) : '')
    ));

  const save = () => {
    if (mode === 'gain_pct') {
      const g = parsePositive(gain);
      const l = parsePositive(loss);
      if (!g.valid || g.value == null) return toast.error('Soglia di guadagno non valida', { description: 'Inserisci una percentuale positiva.' });
      if (!l.valid) return toast.error('Soglia di perdita non valida', { description: 'Percentuale positiva, oppure vuoto.' });
      onSave({
        alertMode: mode,
        gain: g.value,
        loss: l.value,
        priceDirection: null,
        priceTarget: null,
      });
      return;
    }

    const target = parsePositive(priceTarget);
    if (!target.valid || target.value == null) return toast.error('Prezzo target non valido', { description: 'Inserisci un prezzo positivo.' });
    onSave({
      alertMode: mode,
      gain: null,
      loss: null,
      priceDirection: target.value == null ? null : priceDirection,
      priceTarget: target.value,
    });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            {label}
          </div>
          <div className="text-xs text-muted-foreground">{sublabel}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium">Tipo di avviso</span>
        <div className="inline-flex rounded-md border p-0.5 bg-muted/30" role="group" aria-label="Tipo di avviso">
          <Button
            type="button"
            size="sm"
            variant={mode === 'gain_pct' ? 'default' : 'ghost'}
            className="h-7 px-3 text-xs gap-1.5"
            onClick={() => setMode('gain_pct')}
          >
            <Percent className="w-3.5 h-3.5" /> Gain %
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'price' ? 'default' : 'ghost'}
            className="h-7 px-3 text-xs gap-1.5"
            onClick={() => setMode('price')}
          >
            <DollarSign className="w-3.5 h-3.5" /> Prezzo
          </Button>
        </div>
      </div>

      {mode === 'gain_pct' ? (
        <>
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
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Avvisa quando il prezzo del sottostante {ticker} attraversa la soglia impostata.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Direzione</Label>
              <Select value={priceDirection} onValueChange={v => setPriceDirection(v as CallBuybackPriceDirection)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above" className="text-xs">Sopra</SelectItem>
                  <SelectItem value="below" className="text-xs">Sotto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Prezzo target</Label>
              <Input value={priceTarget} onChange={e => setPriceTarget(e.target.value)} placeholder="es. 250" className="h-8 text-xs" inputMode="decimal" />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {mode === 'gain_pct' && preview
            ? (preview === 'gain' ? 'Scatterebbe adesso (guadagno).' : 'Scatterebbe adesso (perdita).')
            : 'L’avviso resta sempre attivo; puoi modificarne il parametro.'}
        </span>
        <Button size="sm" variant={dirty ? 'default' : 'outline'} className="h-7 text-xs" onClick={save} disabled={isSaving}>
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Salva'}
        </Button>
      </div>
    </div>
  );
}

/** Gestione degli avvisi sulle "call da rivendere", dentro il dialog avvisi. */
export function CallBuybackAlertsPanel({ portfolioId }: { portfolioId: string | null | undefined }) {
  const today = new Date().toISOString().split('T')[0];
  const { buybacks, isLoading } = useCallBuybacks([portfolioId]);
  const { alerts } = useCallBuybackAlerts(portfolioId);
  const { upsert } = useCallBuybackAlertMutations(portfolioId);

  // Una riga per ogni gamba inserita nella card: nessun aggregato di call.
  const rows = useMemo(
    () => buybacks
      .filter(b => b.quantity > 0)
      .sort((a, b) =>
        a.underlying.localeCompare(b.underlying)
        || a.strike - b.strike
        || a.expiry_date.localeCompare(b.expiry_date)
        || a.buyback_date.localeCompare(b.buyback_date)),
    [buybacks],
  );

  const saveAlert = (row: CallBuybackRow, value: EditorValue) => {
    upsert.mutate(
      {
        scope: 'tranche',
        buyback_id: row.id,
        underlying: row.underlying,
        strike: row.strike,
        expiry_date: row.expiry_date,
        alert_mode: value.alertMode,
        gain_threshold_pct: value.gain,
        loss_threshold_pct: value.loss,
        price_direction: value.priceDirection,
        price_target: value.priceTarget,
      },
      {
        onSuccess: () => toast.success(
          'Avviso salvato',
          { description: `${row.underlying} C ${row.strike} — riga del ${fmtDate(row.buyback_date)}` },
        ),
        onError: (e: unknown) => toast.error('Salvataggio non riuscito', {
          description: e instanceof Error ? e.message : 'errore sconosciuto',
        }),
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
        Per ogni riga della card "Covered Call da rivendere" scegli un solo tipo di avviso:
        variazione percentuale del premio oppure prezzo del sottostante.
      </p>

      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nessuna call da rivendere aperta su questo portafoglio.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Le call riacquistate si registrano dalla card "Covered Call da rivendere" nella pagina Derivati.
          </p>
        </div>
      )}

      {rows.map(row => {
        const alert = alerts.find(a => a.scope === 'tranche' && a.buyback_id === row.id) ?? null;
        return (
          <AlertEditor
            key={`${row.id}-${alert?.id ?? 'new'}-${alert?.updated_at ?? ''}`}
            label={`${row.underlying} C ${row.strike} — scad. ${fmtDate(row.expiry_date)}`}
            sublabel={`${row.quantity} contratti riacquistati il ${fmtDate(row.buyback_date)} a ${fmt(row.buyback_price)} ${row.currency}`}
            ticker={row.underlying}
            tranches={[toTranche(row)]}
            today={today}
            existingMode={alert?.alert_mode ?? 'gain_pct'}
            existingGain={alert?.gain_threshold_pct ?? DEFAULT_CALL_BUYBACK_GAIN_THRESHOLD_PCT}
            existingLoss={alert?.loss_threshold_pct ?? null}
            existingPriceDirection={alert?.price_direction ?? null}
            existingPriceTarget={alert?.price_target ?? null}
            onSave={(value) => saveAlert(row, value)}
            isSaving={upsert.isPending}
          />
        );
      })}
    </div>
  );
}
