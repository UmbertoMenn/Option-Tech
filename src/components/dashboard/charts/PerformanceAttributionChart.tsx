import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { DepositEntry } from '@/types/deposits';
import { HistoricalDataEntry } from '@/types/historicalData';
import { usePerformanceAttribution } from '@/hooks/usePerformanceAttribution';
import { AttributionItem, calculatePerformanceAttribution } from '@/lib/performanceAttribution';
import { formatDate, formatEUR, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';

interface PerformanceAttributionChartProps {
  portfolioId: string | null;
  historicalData: HistoricalDataEntry[];
  deposits: DepositEntry[];
}

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

function AttributionTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: AttributionItem }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{item.label}</p>
      <p className={item.amount >= 0 ? 'text-profit' : 'text-loss'}>
        {formatEUR(item.amount)} · {formatPercentage(item.percent)}
      </p>
      <p className="mt-1 max-w-56 text-muted-foreground">
        {item.category === 'reconciliation_gap'
          ? 'Differenza da analizzare: non viene attribuita artificialmente a una classe di attivo.'
          : 'Variazione di valore al netto di acquisti, vendite e trasferimenti interni.'}
      </p>
    </div>
  );
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

  const result = useMemo(() => {
    if (!data || data.snapshots.length < 2) return null;
    const snapshots = [...data.snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const endSnapshot = snapshots[snapshots.length - 1];
    const cutoff = cutoffForRange(timeRange, endSnapshot.snapshot_date);
    const startSnapshot = startSnapshotForRange(snapshots, cutoff);
    if (!startSnapshot || startSnapshot.snapshot_date === endSnapshot.snapshot_date) return null;
    const historicalByDate = new Map(historicalData.map(entry => [entry.snapshot_date, entry]));
    const startHistorical = historicalByDate.get(startSnapshot.snapshot_date);
    const endHistorical = historicalByDate.get(endSnapshot.snapshot_date);
    if (!startHistorical || !endHistorical) return null;

    return calculatePerformanceAttribution({
      startSnapshot,
      endSnapshot,
      startHistorical,
      endHistorical,
      allHistoricalData: historicalData,
      deposits,
      trades: data.trades,
      internalTransfers: data.internalTransfers,
    });
  }, [data, deposits, historicalData, timeRange]);

  if (!portfolioId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Disponibile sul singolo portafoglio</div>;
  }
  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Calcolo attribuzione…</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-loss">Impossibile caricare la scomposizione</div>;
  }

  return (
    <div className="flex h-full flex-col">
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
            <span className={cn('font-semibold', result.totalPL >= 0 ? 'text-profit' : 'text-loss')}>
              {formatEUR(result.totalPL)} · {formatPercentage(result.totalPercent)}
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
                <TooltipContent className="max-w-80 text-xs">
                  <p>
                    Periodo {formatDate(result.startDate)} – {formatDate(result.endDate)}. La somma dei contributi riconcilia il P/L del Netting Totale.
                  </p>
                  <p className="mt-1">
                    Prezzi opzioni verificati: {result.coverage.optionMarks - result.coverage.optionMarksWithoutSpot}/{result.coverage.optionMarks}.
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
        <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          Servono almeno due snapshot completi nel periodo selezionato
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={result.items} layout="vertical" margin={{ top: 0, right: 24, left: 18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={value => `${Number(value).toFixed(1)}%`}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={118}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
              <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.35)' }} content={<AttributionTooltip />} />
              <Bar dataKey="percent" radius={[3, 3, 3, 3]} maxBarSize={18}>
                {result.items.map(item => (
                  <Cell key={item.category} fill={item.amount >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
