import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Info, Loader2, Upload } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { resolveCoveredAttributionPeriod } from '@/lib/attributionPeriod';
import { needsTimeValueReview } from '@/lib/optionPremiumSplit';
import { AttributionHelp } from './AttributionHelp';

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

const CLASS_HELP: Record<AttributionCategory, string> = {
  option_time: 'Parte del prezzo delle opzioni eccedente l’intrinseco. Il contributo include premi temporali incassati meno pagati e variazione del valore temporale delle posizioni aperte. T0/T1 sono negativi per opzioni vendute, positivi per acquistate: un premio incassato non è subito tutto guadagno.',
  option_intrinsic: 'Valore immediatamente esercitabile: call = max(spot − strike, 0); put = max(strike − spot, 0), limitato al premio osservato. Separato dal tempo. Include i trasferimenti dovuti ad assegnazioni/esercizi.',
  stock: 'Variazione del valore delle azioni, meno acquisti, più vendite e dividendi. Assegnazioni/esercizi sono valorizzati al prezzo di mercato, con l’intrinseco separato nelle opzioni.',
  etf: 'Variazione del valore degli ETF, meno acquisti, più vendite e proventi.',
  bond: 'Variazione del valore delle obbligazioni, meno acquisti, più vendite e cedole.',
  commodity: 'Variazione del valore degli strumenti su materie prime, corretta per acquisti, vendite e proventi.',
  gp: 'Variazione del valore della gestione patrimoniale al netto dei giroconti registrati. Le operazioni interne della gestione sono già comprese nel suo valore.',
  cash: 'Variazione della liquidità al netto dei flussi ricostruiti: versamenti/prelievi, compravendite, proventi, costi e giroconti. Movimenti non classificati possono restare in questa voce.',
  fees: 'Commissioni di negoziazione e cambio e spese rilevate nei movimenti: il contributo è il loro importo con segno invertito.',
  capital_gain_tax: 'Imposta capital gain addebitata o rimborsata nei movimenti cash. Il contributo è −addebiti + rimborsi, non una stima delle imposte latenti.',
  taxes: 'Ritenute e bolli rilevati nei movimenti; gli addebiti riducono il rendimento e i rimborsi lo aumentano.',
  unclassified: 'Strumenti o movimenti che i dati disponibili non consentono di assegnare a una classe precisa.',
  reconciliation_gap: 'Differenza fra il risultato complessivo del Netting e la somma delle componenti. Non è una fonte di rendimento identificata: evidenzia valori o movimenti da riconciliare.',
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = usePerformanceAttribution(portfolioId);

  const movementInputs = useMemo(
    () => data
      ? buildMovementAttributionInputs({ rows: data.movements, uploads: data.movementUploads, snapshots: data.snapshots, dynamicAliases: data.dynamicAliases })
      : null,
    [data],
  );

  const coveredPeriod = useMemo(() => {
    const historicalDates = new Set(historicalData.map(entry => entry.snapshot_date));
    return resolveCoveredAttributionPeriod(
      (data?.snapshots ?? []).map(s => s.snapshot_date).filter(date => historicalDates.has(date)),
      movementInputs?.titoliWindows ?? [], movementInputs?.cashWindows ?? [],
      selectedStart, selectedEnd,
    );
  }, [data, historicalData, movementInputs, selectedStart, selectedEnd]);

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
    const attributableDates = coveredPeriod.dates;

    if (attributableDates.length < 2) {
      return {
        result: null,
        attributableDates,
        period: null,
        reason: coveredPeriod.windows.length === 0
          ? 'Carica movimenti cash e titoli con un periodo comune: la scomposizione richiede la copertura di entrambi.'
          : 'Servono due snapshot completi con Netting nello stesso periodo coperto da cash e titoli. T0 può essere il giorno precedente l’inizio dei movimenti; non vengono usati snapshot successivi alla copertura.',
      };
    }

    // Estremi entro una finestra continua coperta da entrambi i ledger.
    const resolved = coveredPeriod.period;
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
  }, [data, deposits, historicalData, coveredPeriod, movementInputs]);

  const periodReview = useMemo(() => {
    if (!movementInputs || !calculation.period) return [];
    const { startDate, endDate } = calculation.period;
    return movementInputs.premiumReview.filter(row => row.date > startDate && row.date <= endDate);
  }, [movementInputs, calculation.period]);
  // Da segnalare solo le put ITM vendute come covered call sintetica su titoli non posseduti.
  const flaggedPremiums = periodReview.filter(row => needsTimeValueReview(row.method)).length;

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
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="flex max-h-[50%] shrink-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]">
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')} />
                {detailsOpen ? 'Nascondi dettagli' : 'Filtri e dettagli'}
              </Button>
            </CollapsibleTrigger>
            {result && <span className="tabular-nums text-muted-foreground">{formatDate(result.startDate)} – {formatDate(result.endDate)}</span>}
            {!detailsOpen && flaggedPremiums > 0 && (
              <button type="button" onClick={() => setReviewOpen(true)} aria-label={`${flaggedPremiums} put ITM vendute senza riferimento: apri Premi temporali`} className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />{flaggedPremiums}
              </button>
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
                      L'attribuzione parte dal {formatDate(result.startDate)}: le date precedenti non soddisfano tutti i requisiti di snapshot completo e copertura dei movimenti.
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
        <CollapsibleContent className="min-h-0 space-y-2 overflow-y-auto pt-2">
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
                {coveredPeriod.endDates.map(date => (
                  <SelectItem key={date} value={date} className="text-[11px]">
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

        </div>
      </div>

      <div className="text-[11px] leading-4 text-muted-foreground" data-testid="attribution-period-summary">
        <p>Movimenti caricati: {uploadedWindows || 'nessuno'}. La scomposizione usa solo periodi coperti da entrambi i file.</p>
        {result && <p>Valore iniziale al {formatDate(result.startDate)}; valore finale al {formatDate(result.endDate)}. Movimenti successivi a T0 e fino a T1 incluso. Il rendimento si ferma a T1, non alla data odierna.</p>}
        <p>Clicca sulle icone ⓘ e sugli importi sottolineati per leggere significato, formule e dettaglio dei movimenti.</p>
      </div>
      {flaggedPremiums > 0 && (
        <button type="button" onClick={() => setReviewOpen(true)} className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-left text-[11px] text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {flaggedPremiums} put ITM vendute come covered call sintetica su titoli non posseduti: premio temporale calcolato dalla chiusura del sottostante. Puoi modificarlo nel dettaglio Premi temporali.
        </button>
      )}

        </CollapsibleContent>
      </Collapsible>

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
                <th className="w-28 px-3 py-2 text-right font-medium">T0 · {formatDate(result.startDate)}<AttributionHelp label="T0">Valore della classe nello snapshot iniziale. Non è il prezzo di acquisto. I movimenti del giorno T0 sono già incorporati e non vengono ricontati.</AttributionHelp></th>
                <th className="w-28 px-3 py-2 text-right font-medium">T1 · {formatDate(result.endDate)}<AttributionHelp label="T1">Valore della classe nello snapshot finale, entro la copertura comune dei movimenti cash e titoli. Per le opzioni vendute il valore è negativo.</AttributionHelp></th>
                <th className="w-28 px-3 py-2 text-right font-medium">Movimenti netti<AttributionHelp label="Movimenti netti">Flussi della classe, non guadagni: acquisti e premi pagati positivi; vendite, premi incassati e proventi negativi. Sono sottratti dalla variazione T1 − T0. Esempio: T0 100, T1 130, acquisti 20 → contributo 10. Clicca sull’importo per le sottovoci. Nelle righe di costo: addebiti positivi, rimborsi negativi.</AttributionHelp></th>
                <th className="w-28 px-3 py-2 text-right font-medium">Contributo<AttributionHelp label="Contributo">Risultato in euro: T1 − T0 − movimenti netti. Per costi e imposte: −costi pagati. Comprende variazioni delle posizioni aperte, non solo guadagni realizzati.</AttributionHelp></th>
                <th className="w-20 px-3 py-2 text-right font-medium">% rend.<AttributionHelp label="Percentuale di rendimento">Contributo in euro / patrimonio medio del periodo × 100. Base comune: {formatEUR(result.averageBalance)}, calcolata dal patrimonio iniziale e dai versamenti/prelievi ponderati per i giorni. È il contributo al rendimento del portafoglio, non il rendimento della singola classe; non è annualizzato.</AttributionHelp></th>
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
                      <AttributionHelp label={item.label}>{CLASS_HELP[item.category]}</AttributionHelp>
                      {item.category === 'option_time' && flaggedPremiums > 0 && (
                        <button type="button" onClick={() => setReviewOpen(true)} aria-label={`${flaggedPremiums} put ITM vendute senza riferimento: apri Premi temporali`} className="ml-1 inline-flex align-middle text-warning"><AlertTriangle className="h-3.5 w-3.5" /></button>
                      )}
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
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatEUR(result.externalFlows)}<AttributionHelp label="Flussi esterni">Solo versamenti e prelievi registrati nel periodo: versamenti positivi, prelievi negativi. Non è la somma dei movimenti delle classi, perché compravendite e giroconti sono interni al portafoglio.</AttributionHelp></td>
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
