import { useState } from 'react';
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
import { TIME_VALUE_METHOD_LABELS } from '@/lib/optionPremiumSplit';
import { saveManualTimeValue } from '@/lib/movementLedgerIngest';
import { formatDate, formatEUR } from '@/lib/formatters';
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
  const flagged = row.method === 'close_itm_estimate';
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
    const parsed = Number(draft.replace(/\./g, '').replace(',', '.'));
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < 0) {
      toast.error('Inserisci un premio temporale per azione ≥ 0');
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
        <span className={cn(flagged && 'font-medium text-warning')}>{TIME_VALUE_METHOD_LABELS[row.method]}</span>
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
            placeholder="tempo/azione"
            inputMode="decimal"
            className="h-7 w-24 text-[11px]"
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
  const flagged = rows.filter(row => row.method === 'close_itm_estimate').length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Premi temporali opzioni — {periodLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            Il premio è solo valore temporale. Roll ITM: spot implicito dalla gamba ricomprata (tutta intrinseco).
            Dopo un'assegnazione: spot = prezzo di vendita delle azioni. Senza riferimento: chiusura del sottostante,
            da verificare{flagged > 0 ? ` (${flagged} nel periodo)` : ''}. Valori per azione, nella divisa dell'opzione.
          </DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nessuna operazione con componente intrinseca nel periodo.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border/70">
            <table className="w-full min-w-[980px] border-collapse text-[11px]">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
                <tr>
                  <th className="px-2 py-2 font-medium">Data</th>
                  <th className="px-2 py-2 font-medium">Opzione</th>
                  <th className="px-2 py-2 font-medium">Operazione</th>
                  <th className="px-2 py-2 text-right font-medium">Premio</th>
                  <th className="px-2 py-2 font-medium">Metodo</th>
                  <th className="px-2 py-2 text-right font-medium">Spot rif.</th>
                  <th className="px-2 py-2 text-right font-medium">Intrinseco</th>
                  <th className="px-2 py-2 text-right font-medium">Tempo</th>
                  <th className="px-2 py-2 text-right font-medium">Tempo €</th>
                  <th className="px-2 py-2 font-medium">Correzione</th>
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
