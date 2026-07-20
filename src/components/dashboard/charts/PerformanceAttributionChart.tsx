import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { DepositEntry } from '@/types/deposits';
import { HistoricalDataEntry } from '@/types/historicalData';
import { usePerformanceAttribution } from '@/hooks/usePerformanceAttribution';
import {
  AttributionItem,
  PerformanceAttributionResult,
  calculatePerformanceAttribution,
} from '@/lib/performanceAttribution';
import { formatDate, formatEUR, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';

interface PerformanceAttributionChartProps {
  portfolioId: string | null;
  historicalData: HistoricalDataEntry[];
  deposits: DepositEntry[];
}

interface AttributionCalculation {
  result: PerformanceAttributionResult | null;
  reason: string | null;
}

const STATUS_LABELS: Record<AttributionItem['status'], string> = {
  calculated: 'Calcolato',
  partial: 'Parziale',
  unavailable: 'Non attribuibile',
  no_activity: 'Nessuna attività',
};

const STATUS_CLASSES: Record<AttributionItem['status'], string> = {
  calculated: 'border-profit/30 bg-profit/10 text-profit',
  partial: 'border-warning/30 bg-warning/10 text-warning',
  unavailable: 'border-loss/30 bg-loss/10 text-loss',
  no_activity: 'border-border bg-muted text-muted-foreground',
};

function dateMonthsBefore(date: string, months: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setMonth(value.getMonth() - months);
  return value.toISOString().slice(0, 10);
}

function cutoffForRange(range: TimeRange, endDate: string): string | null {
  if (range === 'MAX') return null;
  if (range === 'YTD') return `${endDate.slice(0, 4)}-01-01`;
  const months: Record<Exclude<TimeRange, 'MAX' | 'YTD'>, number> = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '2Y': 24,
    '3Y': 36,
  };
  return dateMonthsBefore(endDate, months[range]);
}

function startSnapshotForRange(
  snapshots: Array<{ snapshot_date: string }>,
  cutoff: string | null,
) {
  if (!cutoff) return snapshots[0] ?? null;
  // Il periodo parte dal miglior T0 disponibile alla o prima della data
  // richiesta. Usare il primo snapshot successivo troncherebbe il rendimento.
  return snapshots.filter(snapshot => snapshot.snapshot_date <= cutoff).at(-1)
    ?? snapshots[0]
    ?? null;
}

function signedFormulaValue(value: number): string {
  return value < 0 ? `(${formatEUR(value)})` : formatEUR(value);
}

function rowFormula(item: AttributionItem, result: PerformanceAttributionResult): string {
  if (item.category === 'reconciliation_gap') {
    const classified = result.totalPL - item.amount;
    return `${formatEUR(result.totalPL)} − ${signedFormulaValue(classified)}`;
  }
  return `${formatEUR(item.endValue)} − ${formatEUR(item.startValue)} − ${signedFormulaValue(item.netFlows)}`;
}

export function PerformanceAttributionChart({
  portfolioId,
  historicalData,
  deposits,
}: PerformanceAttributionChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');
  const { data, isLoading, error } = usePerformanceAttribution(portfolioId);
  const earliestHistoricalDate = useMemo(
    () => historicalData.reduce<string | null>(
      (earliest, entry) => !earliest || entry.snapshot_date < earliest ? entry.snapshot_date : earliest,
      null,
    ),
    [historicalData],
  );

  const calculation = useMemo<AttributionCalculation>(() => {
    if (!data) return { result: null, reason: 'I dati necessari non sono ancora disponibili.' };
    if (data.snapshots.length === 0) {
      return {
        result: null,
        reason: 'Calcolo non possibile: non è disponibile alcuno snapshot completo delle posizioni.',
      };
    }
    if (data.snapshots.length === 1) {
      return {
        result: null,
        reason: `Calcolo non possibile: è disponibile un solo snapshot completo (${formatDate(data.snapshots[0].snapshot_date)}). Servono sia T0 sia T1.`,
      };
    }

    const snapshots = [...data.snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const endSnapshot = snapshots[snapshots.length - 1];
    const cutoff = cutoffForRange(timeRange, endSnapshot.snapshot_date);
    const startSnapshot = startSnapshotForRange(snapshots, cutoff);
    if (!startSnapshot || startSnapshot.snapshot_date === endSnapshot.snapshot_date) {
      return {
        result: null,
        reason: 'Calcolo non possibile nel periodo selezionato: manca uno snapshot T0 distinto dallo snapshot T1.',
      };
    }

    const historicalByDate = new Map(historicalData.map(entry => [entry.snapshot_date, entry]));
    const startHistorical = historicalByDate.get(startSnapshot.snapshot_date);
    const endHistorical = historicalByDate.get(endSnapshot.snapshot_date);
    const missingDates = [
      !startHistorical ? `T0 ${formatDate(startSnapshot.snapshot_date)}` : null,
      !endHistorical ? `T1 ${formatDate(endSnapshot.snapshot_date)}` : null,
    ].filter((value): value is string => !!value);
    if (!startHistorical || !endHistorical) {
      return {
        result: null,
        reason: `Calcolo non possibile: manca il Netting storico per ${missingDates.join(' e ')}.`,
      };
    }

    return {
      result: calculatePerformanceAttribution({
        startSnapshot,
        endSnapshot,
        startHistorical,
        endHistorical,
        allHistoricalData: historicalData,
        deposits,
        trades: data.trades,
        internalTransfers: data.internalTransfers,
      }),
      reason: null,
    };
  }, [data, deposits, historicalData, timeRange]);

  const result = calculation.result;

  if (!portfolioId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Disponibile sul singolo portafoglio</div>;
  }
  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Calcolo attribuzione…</div>;
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-loss">
        Impossibile caricare la scomposizione: il recupero di snapshot o movimenti non è riuscito.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(['1M', '3M', '6M', '1Y', '2Y', '3Y', 'MAX', 'YTD'] as const).map(range => (
            <button
              key={range}
              type="button"
              onClick={() => setTimeRange(range)}
              className={cn(
                'rounded px-2 py-1 text-[10px] font-medium transition-colors',
                timeRange === range ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {range === 'MAX' || range === 'YTD' ? range : range.replace('Y', 'A')}
            </button>
          ))}
        </div>
        {result && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Totale</span>
            <span className={cn('font-semibold tabular-nums', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
              {formatEUR(result.totalPL)} · {result.totalPercent == null ? 'percentuale n.d.' : formatPercentage(result.totalPercent)}
            </span>
            <TooltipProvider delayDuration={150}>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Informazioni sulla scomposizione">
                    {result.warnings.length > 0
                      ? <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                      : <Info className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-96 text-xs">
                  <p>
                    Periodo {formatDate(result.startDate)} – {formatDate(result.endDate)}. Ogni contributo è T1 − T0 − movimenti netti; l’eventuale differenza resta visibile nel residuo.
                  </p>
                  <p className="mt-1">
                    Base delle percentuali: patrimonio medio {formatEUR(result.averageBalance)}. Prezzi opzioni verificati: {result.coverage.optionMarks - result.coverage.optionMarksWithoutSpot}/{result.coverage.optionMarks}.
                  </p>
                  {earliestHistoricalDate && earliestHistoricalDate < result.startDate && (
                    <p className="mt-1 text-warning">
                      L’attribuzione parte dal {formatDate(result.startDate)}: gli snapshot precedenti non contengono il dettaglio completo delle posizioni.
                    </p>
                  )}
                  {result.warnings.map(warning => <p key={warning} className="mt-1 text-warning">{warning}</p>)}
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {!result ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {calculation.reason}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/70">
          <table className="w-full min-w-[1180px] border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-left text-muted-foreground">
                <th className="w-44 px-3 py-2 font-medium">Classe</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T0 · {formatDate(result.startDate)}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T1 · {formatDate(result.endDate)}</th>
                <th className="w-32 px-3 py-2 text-right font-medium">Movimenti netti</th>
                <th className="w-64 px-3 py-2 font-medium">Calcolo</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Contributo</th>
                <th className="w-20 px-3 py-2 text-right font-medium">% rend.</th>
                <th className="min-w-80 px-3 py-2 font-medium">Stato / motivo</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map(item => {
                const isGap = item.category === 'reconciliation_gap';
                return (
                  <tr key={item.category} className={cn('border-b border-border/60 align-top hover:bg-muted/30', isGap && 'bg-warning/5')}>
                    <td className="px-3 py-2 font-medium text-foreground">{item.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{isGap ? '—' : formatEUR(item.startValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{isGap ? '—' : formatEUR(item.endValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{isGap ? '—' : formatEUR(item.netFlows)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{rowFormula(item, result)}</td>
                    <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', item.amount >= 0 ? 'text-profit' : 'text-loss')}>
                      {formatEUR(item.amount)}
                    </td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', item.amount >= 0 ? 'text-profit' : 'text-loss')}>
                      {item.percent == null ? '—' : formatPercentage(item.percent)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', STATUS_CLASSES[item.status])}>
                          {STATUS_LABELS[item.status]}
                        </span>
                        <span className="leading-4 text-muted-foreground">{item.reason}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-muted shadow-[0_-1px_0_hsl(var(--border))]">
              <tr className="font-semibold text-foreground">
                <td className="px-3 py-2">Netting totale</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatEUR(result.startTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatEUR(result.endTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatEUR(result.externalFlows)}</td>
                <td className="px-3 py-2 font-mono font-normal tabular-nums text-muted-foreground">
                  {formatEUR(result.endTotal)} − {formatEUR(result.startTotal)} − {signedFormulaValue(result.externalFlows)}
                </td>
                <td className={cn('px-3 py-2 text-right tabular-nums', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
                  {formatEUR(result.totalPL)}
                </td>
                <td className={cn('px-3 py-2 text-right tabular-nums', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
                  {result.totalPercent == null ? '—' : formatPercentage(result.totalPercent)}
                </td>
                <td className="px-3 py-2 font-normal text-muted-foreground">
                  {result.totalPercent == null
                    ? 'Percentuale non disponibile: il patrimonio medio del periodo non è positivo.'
                    : `Percentuale calcolata sul patrimonio medio di ${formatEUR(result.averageBalance)}.`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
