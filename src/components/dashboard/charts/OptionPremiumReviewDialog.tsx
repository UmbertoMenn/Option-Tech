import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionPremiumReviewRow } from '@/lib/movementAttribution';
import { TIME_VALUE_METHOD_LABELS, needsTimeValueReview } from '@/lib/optionPremiumSplit';
import { AttributionHelp } from './AttributionHelp';
import { saveManualTimeValue } from '@/lib/movementLedgerIngest';
import { formatDate, formatEUR, parseDecimalInput } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface OptionPremiumReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  rows: OptionPremiumReviewRow[];
  periodLabel: string;
}

const fmt = (value: number | null, digits = 2) =>
  value == null ? '—' : value.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function ReviewRow({ row, portfolioId }: { row: OptionPremiumReviewRow; portfolioId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(row.manualTimeValuePerShare != null ? String(row.manualTimeValuePerShare).replace('.', ',') : '');
  const [saving, setSaving] = useState(false);
  const flagged = needsTimeValueReview(row.method);
  const timeEur = row.timeValuePerShare == null ? null : row.timeValuePerShare * row.contracts * 100 / row.exchangeRate;

  const persist = async (value: number | null) => {
    setSaving(true);
    try {
      await saveManualTimeValue(portfolioId, row.rowKey, value);
      await queryClient.invalidateQueries({ queryKey: ['performance-attribution', portfolioId] });
      toast.success(value == null ? 'Premio temporale riportato al calcolo automatico' : 'Premio temporale salvato');
    } catch (error) {
      toast.error('Salvataggio non riuscito', { description: error instanceof Error ? error.message : 'errore sconosciuto' });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const parsed = parseDecimalInput(draft);
    if (parsed == null || parsed < 0) {
      toast.error('Inserisci il premio temporale per azione, es. 8.30 oppure 8,30');
      return;
    }
    if (parsed > row.premiumPerShare) {
      toast.error(`Il premio temporale non può superare il premio (${fmt(row.premiumPerShare)})`);
      return;
    }
    persist(parsed);
  };

  return (
    <tr className={cn('border-b border-border/60 align-middle', flagged && 'bg-warning/10')}>
      <td className="px-2 py-1.5 tabular-nums">{formatDate(row.date)}</td>
      <td className="px-2 py-1.5 font-mono">{row.descriptor}</td>
      <td className="px-2 py-1.5">{row.side === 'VEN' ? 'Vendita' : 'Acquisto'} ×{row.contracts}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.premiumPerShare)}</td>
      <td className="px-2 py-1.5">
        <span className={cn('inline-flex items-center gap-1', flagged && 'font-medium text-warning')}>
          {flagged && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-label="Vendita ITM senza riferimento" />}
          {TIME_VALUE_METHOD_LABELS[row.method]}
        </span>
        {flagged && <span className="block text-[10px] text-warning">Nessun roll/assegnazione: verifica o correggi</span>}
        {row.reference && <span className="block text-[10px] text-muted-foreground">{row.reference}</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.referenceSpot)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.intrinsicPerShare)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
        {fmt(row.timeValuePerShare)}
        {row.method === 'manual' && (
          <span className="block text-[10px] font-normal text-muted-foreground">auto {fmt(row.automaticTimeValuePerShare)}</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{timeEur == null ? '—' : formatEUR(row.side === 'VEN' ? timeEur : -timeEur)}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') save(); }}
            placeholder={`${row.currency} per azione`}
            aria-label={`Premio temporale manuale per azione in ${row.currency}`}
            inputMode="decimal"
            className="h-7 w-28 text-[11px]"
            disabled={saving}
          />
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={saving} onClick={save}>
            Salva
          </Button>
          {row.manualTimeValuePerShare != null && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => { setDraft(''); persist(null); }}>
              Auto
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function OptionPremiumReviewDialog({ open, onOpenChange, portfolioId, rows, periodLabel }: OptionPremiumReviewDialogProps) {
  const flagged = rows.filter(row => needsTimeValueReview(row.method)).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Premi temporali opzioni — {periodLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            La colonna Premio è il prezzo totale dell’opzione; Premio temporale è la sua componente di valore temporale.
            Nel roll ITM la gamba ricomprata è tutta intrinseco; dopo un’assegnazione lo spot è il prezzo dell’operazione sulle azioni; le opzioni OTM sono tutto premio temporale.
            Il triangolo segnala le vendite ITM senza roll né assegnazione ({flagged} nel periodo): lì il calcolo usa la chiusura del sottostante.
            Ogni riga è modificabile. Valori per azione nella divisa dell’opzione, tranne Premio temporale €.
          </DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nessun dettaglio opzioni disponibile dai file movimenti per il periodo.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border/70">
            <table className="w-full min-w-[980px] border-collapse text-[11px]">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
                <tr>
                  <th className="px-2 py-2 font-medium">Data</th>
                  <th className="px-2 py-2 font-medium">Opzione</th>
                  <th className="px-2 py-2 font-medium">Operazione</th>
                  <th className="px-2 py-2 text-right font-medium">Premio<AttributionHelp label="Premio totale">Prezzo dell’opzione per azione nella sua divisa: intrinseco + valore temporale.</AttributionHelp></th>
                  <th className="px-2 py-2 font-medium">Metodo<AttributionHelp label="Metodo">Origine dello split: correzione manuale, operazione sulle azioni dopo assegnazione, spot implicito da roll, oppure chiusura giornaliera del sottostante. La chiusura è un fallback e può differire dal prezzo al momento dell’eseguito.</AttributionHelp></th>
                  <th className="px-2 py-2 text-right font-medium">Spot rif.<AttributionHelp label="Spot di riferimento">Prezzo del sottostante usato per separare intrinseco e tempo; può essere implicito dal roll o ricavato dall’operazione sulle azioni. Con correzione manuale resta solo un riferimento informativo.</AttributionHelp></th>
                  <th className="px-2 py-2 text-right font-medium">Intrinseco<AttributionHelp label="Intrinseco">Call: max(spot − strike, 0). Put: max(strike − spot, 0). Limitato al premio osservato per mantenere intrinseco + tempo = premio. In modalità manuale è premio − tempo inserito.</AttributionHelp></th>
                  <th className="px-2 py-2 text-right font-medium">Premio temporale<AttributionHelp label="Premio temporale">Premio totale meno intrinseco, per azione. Correggibile manualmente tra zero e il premio totale.</AttributionHelp></th>
                  <th className="px-2 py-2 text-right font-medium">Premio temporale €<AttributionHelp label="Premio temporale in euro">Premio temporale per azione × contratti × 100 / cambio. Qui incassi positivi e pagamenti negativi: segno opposto ai Movimenti netti della tabella principale. Non è da solo il contributo al rendimento, che include anche la variazione delle posizioni aperte.</AttributionHelp></th>
                  <th className="px-2 py-2 font-medium">Premio temporale manuale (per azione)<AttributionHelp label="Premio temporale manuale">Inserisci il premio temporale per azione nella divisa dell’opzione, accettati punto o virgola (es. 8.30 oppure 8,30 = 830 USD per contratto). Sostituisce il calcolo automatico; l’intrinseco diventa premio − valore inserito. “Auto” ripristina il calcolo automatico. Invio o Salva per confermare.</AttributionHelp></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => <ReviewRow key={`${row.rowKey}|${row.manualTimeValuePerShare ?? ''}`} row={row} portfolioId={portfolioId} />)}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
