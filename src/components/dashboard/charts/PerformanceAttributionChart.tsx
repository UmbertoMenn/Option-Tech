import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { DepositEntry } from '@/types/deposits';
import { HistoricalDataEntry } from '@/types/historicalData';
import { usePerformanceAttribution } from '@/hooks/usePerformanceAttribution';
import {
  AttributionCategory,
  AttributionItem,
  PerformanceAttributionResult,
  calculatePerformanceAttribution,
} from '@/lib/performanceAttribution';
import { formatDate, formatEUR, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AttributionTimeRange, resolveAttributionPeriod } from '@/lib/attributionPeriod';

type TimeRange = AttributionTimeRange;
type RangeSelection = TimeRange | 'CUSTOM';

interface PerformanceAttributionChartProps {
  portfolioId: string | null;
  historicalData: HistoricalDataEntry[];
  deposits: DepositEntry[];
}

interface ResolvedPeriod {
  startDate: string;
  endDate: string;
}

interface AttributionCalculation {
  result: PerformanceAttributionResult | null;
  reason: string | null;
  attributableDates: string[];
  period: ResolvedPeriod | null;
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

// Accento verticale per gruppo logico: opzioni, mercati direzionali, gestita, tecnici.
const GROUP_ACCENT: Record<AttributionCategory, string> = {
  option_time: 'before:bg-sky-400',
  option_intrinsic: 'before:bg-sky-400',
  stock: 'before:bg-emerald-400',
  etf: 'before:bg-emerald-400',
  commodity: 'before:bg-amber-400',
  bond: 'before:bg-indigo-400',
  gp: 'before:bg-violet-400',
  cash: 'before:bg-slate-400',
  unclassified: 'before:bg-slate-400',
  reconciliation_gap: 'before:bg-warning',
};

function signedFormulaValue(value: number): string {
  return value < 0 ? `(${formatEUR(value)})` : formatEUR(value);
}

function ContributionCell({ item, result }: { item: AttributionItem; result: PerformanceAttributionResult }) {
  const isGap = item.category === 'reconciliation_gap';
  const tone = item.amount >= 0 ? 'text-profit' : 'text-loss';
  const formula = isGap
    ? `${formatEUR(result.totalPL)} − ${signedFormulaValue(result.totalPL - item.amount)}`
    : `${formatEUR(item.endValue)} − ${formatEUR(item.startValue)} − ${signedFormulaValue(item.netFlows)}`;
  const caption = isGap ? 'P/L Netting − componenti classificate' : 'T1 − T0 − movimenti netti';
  return (
    <TooltipProvider delayDuration={100}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('cursor-help font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-2', tone)}
          >
            {formatEUR(item.amount)}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <p className="text-muted-foreground">{caption}</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {formula} = <span className={cn('font-semibold', tone)}>{formatEUR(item.amount)}</span>
          </p>
          {!isGap && (
            <p className="mt-1 text-muted-foreground">
              Movimenti netti del periodo: {formatEUR(item.netFlows)}
            </p>
          )}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

export function PerformanceAttributionChart({
  portfolioId,
  historicalData,
  deposits,
}: PerformanceAttributionChartProps) {
  const [range, setRange] = useState<RangeSelection>('1Y');
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(true);
  const { data, isLoading, error } = usePerformanceAttribution(portfolioId);

  const earliestHistoricalDate = useMemo(
    () => historicalData.reduce<string | null>(
      (earliest, entry) => !earliest || entry.snapshot_date < earliest ? entry.snapshot_date : earliest,
      null,
    ),
    [historicalData],
  );

  const calculation = useMemo<AttributionCalculation>(() => {
    if (!data) return { result: null, reason: 'I dati necessari non sono ancora disponibili.', attributableDates: [], period: null };

    // Un T0/T1 è selezionabile solo se ha SIA lo snapshot completo delle
    // posizioni SIA il Netting storico: altrimenti l'attribuzione non quadra.
    const historicalDates = new Set(historicalData.map(entry => entry.snapshot_date));
    const attributableDates = [...new Set(data.snapshots.map(s => s.snapshot_date))]
      .filter(date => historicalDates.has(date))
      .sort((a, b) => a.localeCompare(b));

    if (attributableDates.length < 2) {
      const only = attributableDates[0];
      return {
        result: null,
        attributableDates,
        period: null,
        reason: only
          ? `Calcolo non possibile: è disponibile una sola data completa (${formatDate(only)}). Servono sia T0 sia T1.`
          : 'Calcolo non possibile: non è disponibile alcuno snapshot completo con Netting storico.',
      };
    }

    // Risoluzione del periodo (funzione pura, testata): override manuale
    // T0/T1 espliciti oppure preset relativo.
    const resolved = resolveAttributionPeriod({ attributableDates, range, customStart, customEnd });
    if (!resolved) {
      return {
        result: null,
        attributableDates,
        period: null,
        reason: 'Periodo non valido: la data T0 deve precedere la data T1.',
      };
    }
    const { startDate, endDate } = resolved;

    const snapByDate = new Map(data.snapshots.map(s => [s.snapshot_date, s]));
    const histByDate = new Map(historicalData.map(entry => [entry.snapshot_date, entry]));
    const startSnapshot = snapByDate.get(startDate);
    const endSnapshot = snapByDate.get(endDate);
    const startHistorical = histByDate.get(startDate);
    const endHistorical = histByDate.get(endDate);
    if (!startSnapshot || !endSnapshot || !startHistorical || !endHistorical) {
      return {
        result: null,
        attributableDates,
        period: null,
        reason: 'Calcolo non possibile: dati mancanti per il periodo selezionato.',
      };
    }

    return {
      attributableDates,
      period: { startDate, endDate },
      reason: null,
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
    };
  }, [data, deposits, historicalData, range, customStart, customEnd]);

  const result = calculation.result;
  const { attributableDates } = calculation;

  const visibleItems = useMemo(() => {
    if (!result) return [];
    if (!hideInactive) return result.items;
    return result.items.filter(item =>
      item.category === 'reconciliation_gap' || item.status !== 'no_activity',
    );
  }, [result, hideInactive]);

  const selectPreset = (preset: TimeRange) => {
    setRange(preset);
    setCustomStart(null);
    setCustomEnd(null);
  };

  const pickStart = (value: string) => {
    setRange('CUSTOM');
    setCustomStart(value);
    setCustomEnd(prev => prev ?? calculation.period?.endDate ?? attributableDates.at(-1) ?? null);
  };

  const pickEnd = (value: string) => {
    setRange('CUSTOM');
    setCustomEnd(value);
    setCustomStart(prev => prev ?? calculation.period?.startDate ?? null);
  };

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

  const activeStart = calculation.period?.startDate ?? null;
  const activeEnd = calculation.period?.endDate ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Riga 1 – preset rapidi + totale periodo */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(['1M', '3M', '6M', '1Y', '2Y', '3Y', 'YTD', 'MAX'] as const).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              className={cn(
                'rounded px-2 py-1 text-[10px] font-medium transition-colors',
                range === preset ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {preset === 'MAX' || preset === 'YTD' ? preset : preset.replace('Y', 'A')}
            </button>
          ))}
          {range === 'CUSTOM' && (
            <span className="rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">Personalizzato</span>
          )}
        </div>
        {result && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Totale</span>
            <span className={cn('font-semibold tabular-nums', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
              {formatEUR(result.totalPL)} · {result.totalPercent == null ? 'perc. n.d.' : formatPercentage(result.totalPercent)}
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
                    Periodo {formatDate(result.startDate)} – {formatDate(result.endDate)}. Ogni contributo è T1 − T0 − movimenti netti; l'eventuale differenza resta visibile nel residuo.
                  </p>
                  <p className="mt-1">
                    Base delle percentuali: patrimonio medio {formatEUR(result.averageBalance)}. Prezzi opzioni verificati: {result.coverage.optionMarks - result.coverage.optionMarksWithoutSpot}/{result.coverage.optionMarks}.
                  </p>
                  {earliestHistoricalDate && earliestHistoricalDate < result.startDate && (
                    <p className="mt-1 text-warning">
                      L'attribuzione parte dal {formatDate(result.startDate)}: gli snapshot precedenti non contengono il dettaglio completo delle posizioni.
                    </p>
                  )}
                  {result.warnings.map(warning => <p key={warning} className="mt-1 text-warning">{warning}</p>)}
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {/* Riga 2 – selettori espliciti T0 / T1 + toggle classi inattive */}
      {attributableDates.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Da (T0)</span>
          <Select value={activeStart ?? undefined} onValueChange={pickStart}>
            <SelectTrigger className="h-7 w-32 text-[11px]">
              <SelectValue placeholder="T0" />
            </SelectTrigger>
            <SelectContent>
              {attributableDates.slice(0, -1).map(date => (
                <SelectItem key={date} value={date} disabled={activeEnd != null && date >= activeEnd} className="text-[11px]">
                  {formatDate(date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">A (T1)</span>
          <Select value={activeEnd ?? undefined} onValueChange={pickEnd}>
            <SelectTrigger className="h-7 w-32 text-[11px]">
              <SelectValue placeholder="T1" />
            </SelectTrigger>
            <SelectContent>
              {attributableDates.slice(1).map(date => (
                <SelectItem key={date} value={date} disabled={activeStart != null && date <= activeStart} className="text-[11px]">
                  {formatDate(date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <Switch checked={hideInactive} onCheckedChange={setHideInactive} className="scale-75" />
            Nascondi classi inattive
          </label>
        </div>
      )}

      {!result ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {calculation.reason}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/70">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Classe</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T0 · {formatDate(result.startDate)}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T1 · {formatDate(result.endDate)}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Contributo</th>
                <th className="w-20 px-3 py-2 text-right font-medium">% rend.</th>
                <th className="min-w-72 px-3 py-2 font-medium">Stato / motivo</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(item => {
                const isGap = item.category === 'reconciliation_gap';
                return (
                  <tr key={item.category} className={cn('border-b border-border/60 align-top hover:bg-muted/30', isGap && 'bg-warning/5')}>
                    <td className={cn(
                      'relative px-3 py-2 pl-4 font-medium text-foreground',
                      'before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full',
                      GROUP_ACCENT[item.category],
                    )}>
                      {item.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{isGap ? '—' : formatEUR(item.startValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{isGap ? '—' : formatEUR(item.endValue)}</td>
                    <td className="px-3 py-2 text-right">
                      <ContributionCell item={item} result={result} />
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
                <td className="px-3 py-2 text-right">
                  <TooltipProvider delayDuration={100}>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className={cn('cursor-help font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-2', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
                          {formatEUR(result.totalPL)}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <p className="text-muted-foreground">T1 − T0 − versamenti/prelievi</p>
                        <p className="mt-0.5 font-mono tabular-nums">
                          {formatEUR(result.endTotal)} − {formatEUR(result.startTotal)} − {signedFormulaValue(result.externalFlows)}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {result.totalPercent == null
                            ? 'Percentuale non disponibile: patrimonio medio non positivo.'
                            : `Percentuale sul patrimonio medio di ${formatEUR(result.averageBalance)}.`}
                        </p>
                      </TooltipContent>
                    </UiTooltip>
                  </TooltipProvider>
                </td>
                <td className={cn('px-3 py-2 text-right tabular-nums', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
                  {result.totalPercent == null ? '—' : formatPercentage(result.totalPercent)}
                </td>
                <td className="px-3 py-2 font-normal text-muted-foreground">
                  {result.externalFlows !== 0
                    ? `Include ${formatEUR(result.externalFlows)} di versamenti/prelievi esterni nel periodo.`
                    : 'Nessun flusso esterno nel periodo.'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
