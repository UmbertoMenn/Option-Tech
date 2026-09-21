import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DepositEntry } from '@/types/deposits';
import { HistoricalDataEntry } from '@/types/historicalData';
import { usePerformanceAttribution } from '@/hooks/usePerformanceAttribution';
import {
  AttributionCategory,
  AttributionItem,
  COST_CATEGORIES,
  PerformanceAttributionResult,
  calculatePerformanceAttribution,
} from '@/lib/performanceAttribution';
import {
  buildMovementAttributionInputs,
  buildMovementCoverage,
  mergeLegacyTrades,
  movementPeriodWarnings,
} from '@/lib/movementAttribution';
import { ingestMovementFiles } from '@/lib/movementLedgerIngest';
import { OptionPremiumReviewDialog } from './OptionPremiumReviewDialog';
import { Button } from '@/components/ui/button';
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
import { resolveAttributionPeriod } from '@/lib/attributionPeriod';

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
  fees: 'before:bg-rose-400',
  capital_gain_tax: 'before:bg-rose-400',
  taxes: 'before:bg-rose-400',
  unclassified: 'before:bg-slate-400',
  reconciliation_gap: 'before:bg-warning',
};

function signedFormulaValue(value: number): string {
  return value < 0 ? `(${formatEUR(value)})` : formatEUR(value);
}

function ContributionCell({ item, result }: { item: AttributionItem; result: PerformanceAttributionResult }) {
  const isGap = item.category === 'reconciliation_gap';
  const isCost = COST_CATEGORIES.includes(item.category);
  const tone = item.amount >= 0 ? 'text-profit' : 'text-loss';
  const formula = isGap
    ? `${formatEUR(result.totalPL)} − ${signedFormulaValue(result.totalPL - item.amount)}`
    : isCost
      ? `− ${signedFormulaValue(item.netFlows)}`
      : `${formatEUR(item.endValue)} − ${formatEUR(item.startValue)} − ${signedFormulaValue(item.netFlows)}`;
  const caption = isGap
    ? 'P/L Netting − componenti classificate'
    : isCost ? '− costi pagati nel periodo' : 'T1 − T0 − movimenti netti';
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
          {!isGap && !isCost && (
            <p className="mt-1 text-muted-foreground">
              Movimenti netti del periodo: {formatEUR(item.netFlows)}
            </p>
          )}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

/** Movimenti netti della classe (+ investimenti, − disinvestimenti/proventi) con dettaglio. */
function FlowsCell({ item }: { item: AttributionItem }) {
  if (item.category === 'reconciliation_gap') return <span className="text-muted-foreground">—</span>;
  const isCost = COST_CATEGORIES.includes(item.category);
  if (Math.abs(item.netFlows) < 0.005 && item.breakdown.length === 0) {
    return <span className="tabular-nums text-muted-foreground">{formatEUR(0)}</span>;
  }
  return (
    <TooltipProvider delayDuration={100}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-help tabular-nums text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
          >
            {formatEUR(item.netFlows)}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 text-xs">
          <p className="text-muted-foreground">
            {isCost ? 'Costi pagati nel periodo' : 'Movimenti netti: + investimenti, − disinvestimenti e proventi'}
          </p>
          {item.breakdown.length === 0 ? (
            <p className="mt-1">Nessun dettaglio disponibile.</p>
          ) : (
            <table className="mt-1 w-full tabular-nums">
              <tbody>
                {item.breakdown.map(line => (
                  <tr key={line.label}>
                    <td className="pr-3">{line.label}</td>
                    <td className="text-right font-mono">{formatEUR(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = usePerformanceAttribution(portfolioId);

  const movementInputs = useMemo(
    () => data
      ? buildMovementAttributionInputs({ rows: data.movements, uploads: data.movementUploads, snapshots: data.snapshots })
      : null,
    [data],
  );

  const handleMovementFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter(file => /\.csv$/i.test(file.name));
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!portfolioId || files.length === 0) return;
    setIsUploading(true);
    try {
      const res = await ingestMovementFiles(portfolioId, files);
      for (const name of res.rejectedFiles) {
        toast.error('File non riconosciuto', { description: `${name}: servono FlussoMovContiCash e/o FlussoMovContiTit.` });
      }
      if (res.files.length > 0) {
        const description = res.files.map(file => {
          const label = file.source === 'cash' ? 'Cash' : 'Titoli';
          const period = file.periodStart && file.periodEnd
            ? ` ${formatDate(file.periodStart)}–${formatDate(file.periodEnd)}`
            : '';
          const excluded = file.excludedByAccountRule > 0 ? `, ${file.excludedByAccountRule} fuori perimetro` : '';
          return `${label}${period}: ${file.rows} righe (${file.newRows} nuove${excluded})`;
        }).join(' • ');
        toast.success('Movimenti caricati', { description });
      }
      for (const warning of res.warnings) toast.warning('Movimenti', { description: warning });
      await queryClient.invalidateQueries({ queryKey: ['performance-attribution', portfolioId] });
    } catch (uploadError) {
      toast.error('Caricamento movimenti non riuscito', {
        description: uploadError instanceof Error ? uploadError.message : 'errore sconosciuto',
      });
    } finally {
      setIsUploading(false);
    }
  };

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

    // Sia T0 sia T1 sono selezionabili; in assenza di selezione si ripiega
    // su prima/ultima data attribuibile (funzione pura, testata).
    const resolved = resolveAttributionPeriod(attributableDates, selectedStart, selectedEnd);
    if (!resolved) {
      return { result: null, attributableDates, period: null, reason: 'Periodo non valido: la data T0 deve precedere la data T1.' };
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

    const movements = movementInputs ?? buildMovementAttributionInputs({ rows: [], uploads: [], snapshots: [] });
    const computed = calculatePerformanceAttribution({
      startSnapshot,
      endSnapshot,
      startHistorical,
      endHistorical,
      allHistoricalData: historicalData,
      deposits,
      // Dove i movimenti titoli coprono il periodo sostituiscono il ledger storico.
      trades: mergeLegacyTrades(movements.trades, data.trades, movements.titoliWindows),
      internalTransfers: data.internalTransfers,
      cashEvents: movements.cashEvents,
      positionEvents: movements.positionEvents,
      movementCoverage: buildMovementCoverage(movements, startDate, endDate),
    });
    const movementWarnings = movementPeriodWarnings(movements, startDate, endDate, computed.externalFlows);

    return {
      attributableDates,
      period: { startDate, endDate },
      reason: null,
      result: { ...computed, warnings: [...computed.warnings, ...movementWarnings] },
    };
  }, [data, deposits, historicalData, selectedStart, selectedEnd, movementInputs]);

  const periodReview = useMemo(() => {
    if (!movementInputs || !calculation.period) return [];
    const { startDate, endDate } = calculation.period;
    return movementInputs.premiumReview.filter(row => row.date > startDate && row.date <= endDate);
  }, [movementInputs, calculation.period]);
  const flaggedPremiums = periodReview.filter(row => row.method === 'close_itm_estimate').length;

  const uploadedWindows = useMemo(() => {
    if (!movementInputs) return '';
    const fmt = (windows: { start: string; end: string }[]) =>
      windows.map(window => `${formatDate(window.start)}–${formatDate(window.end)}`).join(', ');
    const parts: string[] = [];
    if (movementInputs.titoliWindows.length > 0) parts.push(`titoli ${fmt(movementInputs.titoliWindows)}`);
    if (movementInputs.cashWindows.length > 0) parts.push(`cash ${fmt(movementInputs.cashWindows)}`);
    return parts.join('; ');
  }, [movementInputs]);

  const result = calculation.result;
  const { attributableDates } = calculation;

  const visibleItems = useMemo(() => {
    if (!result) return [];
    if (!hideInactive) return result.items;
    return result.items.filter(item =>
      item.category === 'reconciliation_gap' || item.status !== 'no_activity',
    );
  }, [result, hideInactive]);

  // Selezionare un estremo "congela" l'altro al valore attualmente risolto,
  // così non salta a prima/ultima data mentre si sta scegliendo il periodo.
  const pickStart = (value: string) => {
    setSelectedStart(value);
    setSelectedEnd(prev => prev ?? calculation.period?.endDate ?? attributableDates.at(-1) ?? null);
  };
  const pickEnd = (value: string) => {
    setSelectedEnd(value);
    setSelectedStart(prev => prev ?? calculation.period?.startDate ?? null);
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
      {/* Riga unica – selettori T0/T1 + toggle classi inattive + totale periodo */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {attributableDates.length >= 2 ? (
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
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <Switch checked={hideInactive} onCheckedChange={setHideInactive} className="scale-75" />
              Nascondi classi inattive
            </label>
          </div>
        ) : <div />}
        <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={event => handleMovementFiles(event.target.files)}
        />
        {periodReview.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1.5 text-[11px]', flaggedPremiums > 0 && 'border-warning/50 text-warning')}
            onClick={() => setReviewOpen(true)}
          >
            {flaggedPremiums > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
            Premi temporali{flaggedPremiums > 0 ? ` · ${flaggedPremiums} da verificare` : ''}
          </Button>
        )}
        <TooltipProvider delayDuration={150}>
          <UiTooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-[11px]"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Movimenti
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 text-xs">
              <p>Carica FlussoMovContiCash e FlussoMovContiTit (anche insieme): ricostruiscono investimenti/disinvestimenti per classe, commissioni, ritenute, bolli e imposta capital gain.</p>
              <p className="mt-1 text-muted-foreground">{uploadedWindows ? `Caricati: ${uploadedWindows}.` : 'Nessun file movimenti caricato.'}</p>
            </TooltipContent>
          </UiTooltip>
        </TooltipProvider>
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
                  {uploadedWindows && <p className="mt-1">Movimenti caricati: {uploadedWindows}.</p>}
                  {result.warnings.map(warning => <p key={warning} className="mt-1 text-warning">{warning}</p>)}
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
        )}
        </div>
      </div>

      {!result ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {calculation.reason}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/70">
          <table className="w-full min-w-[760px] border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Classe</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T0 · {formatDate(result.startDate)}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">T1 · {formatDate(result.endDate)}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Movimenti netti</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Contributo</th>
                <th className="w-20 px-3 py-2 text-right font-medium">% rend.</th>
                <th className="min-w-72 px-3 py-2 font-medium">Stato / motivo</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(item => {
                const isGap = item.category === 'reconciliation_gap';
                const noValues = isGap || COST_CATEGORIES.includes(item.category);
                return (
                  <tr key={item.category} className={cn('border-b border-border/60 align-top hover:bg-muted/30', isGap && 'bg-warning/5')}>
                    <td className={cn(
                      'relative px-3 py-2 pl-4 font-medium text-foreground',
                      'before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full',
                      GROUP_ACCENT[item.category],
                    )}>
                      {item.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{noValues ? '—' : formatEUR(item.startValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{noValues ? '—' : formatEUR(item.endValue)}</td>
                    <td className="px-3 py-2 text-right">
                      <FlowsCell item={item} />
                    </td>
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
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatEUR(result.externalFlows)}</td>
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
      {portfolioId && calculation.period && (
        <OptionPremiumReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          portfolioId={portfolioId}
          rows={periodReview}
          periodLabel={`${formatDate(calculation.period.startDate)} – ${formatDate(calculation.period.endDate)}`}
        />
      )}
    </div>
  );
}
