import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { calculateTimeWeightedAverage } from '@/lib/timeWeightedAverage';
import { it } from 'date-fns/locale';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { cn } from '@/lib/utils';
import { fetchFullSnapshotDates } from '@/lib/fullSnapshot';
import { AverageExposureResult, computeAverageEquityExposure, GAP_DAYS } from '@/lib/equityExposureAverage';
import { formatDate } from '@/lib/formatters';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';

interface PerformanceEvolutionChartProps {
  /** Portafoglio singolo: la media usa solo le date con Visualizzazione Storica. Null = vista aggregata. */
  portfolioId?: string | null;
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  currentValue: number;
  currentDate: string | null;
  deposits: DepositEntry[];
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  formattedDate: string;
  value: number;
  returnPct: number;
  cumulativeDeposits: number;
  /** Esposizione azionaria (0-1) se la data ha i dati della Visualizzazione Storica. */
  equityPct?: number;
}

// Temporal bucket downsampling: distributes points uniformly over TIME, not index.
function downsampleData<T extends { timestamp: number }>(
  data: T[],
  maxPoints = 30,
  preserveTimestamp?: number
): T[] {
  if (data.length <= maxPoints) return data;

  const first = data[0];
  const last = data[data.length - 1];
  const tMin = first.timestamp;
  const tMax = last.timestamp;

  if (tMax === tMin) return [first];

  const bucketCount = maxPoints - 2;
  const bucketSize = (tMax - tMin) / (bucketCount + 1);

  const result: T[] = [first];
  const used = new Set<number>([0, data.length - 1]);

  for (let b = 1; b <= bucketCount; b++) {
    const bucketCenter = tMin + b * bucketSize;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < data.length - 1; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs(data[i].timestamp - bucketCenter);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      result.push(data[bestIdx]);
    }
  }

  if (preserveTimestamp !== undefined) {
    let closestIdx = -1;
    let closestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(data[i].timestamp - preserveTimestamp);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    if (closestIdx >= 0 && !used.has(closestIdx)) {
      result.push(data[closestIdx]);
    }
  }

  result.push(last);
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function computeTimeTicks(data: { timestamp: number }[], maxTicks = 6): number[] {
  if (data.length === 0) return [];
  if (data.length <= maxTicks) return data.map(d => d.timestamp);
  const min = data[0].timestamp;
  const max = data[data.length - 1].timestamp;
  const step = (max - min) / (maxTicks - 1);
  return Array.from({ length: maxTicks }, (_, i) => min + step * i);
}

function formatTickDate(timestamp: number): string {
  return format(new Date(timestamp), "MMM ''yy", { locale: it });
}

function formatTooltipDate(timestamp: number): string {
  return format(new Date(timestamp), "dd MMM ''yy", { locale: it });
}

function getValueForViewMode(entry: HistoricalDataEntry, viewMode: ViewMode): number {
  switch (viewMode) {
    case 'netting_intrinsic_a':
      return entry.netting_ex_cc_np ?? entry.netting_ex_cc;
    case 'netting_intrinsic_b':
      return entry.netting_intrinsic_b ?? entry.netting_ex_cc_np ?? entry.netting_ex_cc;
    case 'netting_total':
    default:
      return entry.netting_total;
  }
}

const pctLabel = (value: number | null) =>
  value == null ? '—' : `${(value * 100).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Esposizione azionaria media del periodo, con copertura dei dati storici. */
function AverageExposureBadge({ result, aggregated }: { result: AverageExposureResult; aggregated: boolean }) {
  const incomplete = !!result.missingBefore || !!result.missingAfter || result.gaps.length > 0;
  if (result.average == null) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        Esp. azionaria media: nessun dato storico nel periodo
      </span>
    );
  }
  return (
    <TooltipProvider delayDuration={100}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn('inline-flex items-center gap-1 rounded px-1 tabular-nums', incomplete ? 'text-warning' : 'text-muted-foreground')}
            aria-label="Dettaglio esposizione azionaria media"
          >
            {incomplete ? <AlertTriangle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
            <span>Esp. azionaria media</span>
            <span className="font-semibold text-foreground">{pctLabel(result.average)}</span>
            {result.missingBefore && <span>dal {formatDate(result.missingBefore)}</span>}
            {result.missingAfter && <span>al {formatDate(result.missingAfter)}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 text-xs">
          <p className="font-medium">
            Esposizione azionaria media {pctLabel(result.average)}
            <span className="font-normal text-muted-foreground"> (min {pctLabel(result.min)} · max {pctLabel(result.max)})</span>
          </p>
          <p className="mt-1">
            Calcolata dal {formatDate(result.from as string)} al {formatDate(result.to as string)} su {result.points} snapshot.
          </p>
          {result.missingBefore && (
            <p className="mt-1 text-warning">
              Dati storici mancanti prima del {formatDate(result.missingBefore)}: il periodo selezionato parte dal {formatDate(result.requestedStart)}, la media copre solo i giorni successivi.
            </p>
          )}
          {result.missingAfter && (
            <p className="mt-1 text-warning">
              Nessuno snapshot storico dopo il {formatDate(result.missingAfter)}: la media si ferma a quella data.
            </p>
          )}
          {result.gaps.map(gap => (
            <p key={gap.from} className="mt-1 text-warning">
              Nessuno snapshot tra il {formatDate(gap.from)} e il {formatDate(gap.to)} (oltre {GAP_DAYS} giorni): tratto interpolato.
            </p>
          ))}
          <p className="mt-1 text-muted-foreground">
            {aggregated
              ? 'Vista aggregata: esposizione salvata negli storici di ciascun portafoglio, ponderata per valore.'
              : 'Dagli snapshot della Visualizzazione Storica: esposizione come nel Risk Analyzer (azioni, ETF, commodity, put nude, LEAP, strategie, covered call sintetiche e azioni GP) sul netting totale.'}
            {' '}Media ponderata per il tempo, con interpolazione lineare tra uno snapshot e il successivo.
          </p>
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

function CustomLegend({
  timeRange,
  onTimeRangeChange,
  extra,
}: {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-xs mb-2">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-profit rounded" />
          <span className="text-foreground">Portafoglio</span>
        </div>
        {extra}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {(['1M', '3M', '6M', '1Y', '2Y', '3Y', 'MAX', 'YTD'] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={cn(
                "px-2 py-0.5 text-xs transition-colors",
                timeRange === range
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-foreground"
              )}
            >
              {range === 'MAX' || range === 'YTD' ? range : range.replace('Y', 'A')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PerformanceEvolutionChart({
  portfolioId = null,
  historicalData,
  viewMode,
  currentValue,
  currentDate,
  deposits,
}: PerformanceEvolutionChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');

  // Date con Visualizzazione Storica (snapshot completo) del portafoglio singolo.
  const { data: fullSnapshotDates } = useQuery({
    queryKey: ['full-snapshot-dates', portfolioId],
    queryFn: () => fetchFullSnapshotDates(portfolioId as string),
    enabled: !!portfolioId,
    staleTime: 5 * 60 * 1000,
  });
  const coveredDates = useMemo(
    () => (portfolioId ? new Set((fullSnapshotDates ?? []).map(date => date.slice(0, 10))) : null),
    [portfolioId, fullSnapshotDates],
  );

  const latestSnapshotDate = useMemo(() => {
    if (historicalData.length === 0) return null;
    return new Date(Math.max(...historicalData.map(d => new Date(d.snapshot_date).getTime())));
  }, [historicalData]);

  const hasLiveCurrent = !!currentDate && currentValue > 0;

  const filteredHistoricalData = useMemo(() => {
    if (timeRange === 'MAX') return historicalData;

    const now = new Date();
    let cutoffDate: Date;
    switch (timeRange) {
      case '1M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case '3M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1Y': cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case '2Y': cutoffDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break;
      case '3Y': cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()); break;
      case 'YTD': cutoffDate = new Date(now.getFullYear(), 0, 1); break;
      default: cutoffDate = new Date(0); break;
    }

    return historicalData.filter(entry =>
      new Date(entry.snapshot_date) >= cutoffDate
    );
  }, [historicalData, timeRange]);

  const filteredDeposits = useMemo(() => {
    if (timeRange === 'MAX') return deposits;

    const now = new Date();
    let cutoffDate: Date;
    switch (timeRange) {
      case '1M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case '3M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1Y': cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case '2Y': cutoffDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break;
      case '3Y': cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()); break;
      case 'YTD': cutoffDate = new Date(now.getFullYear(), 0, 1); break;
      default: cutoffDate = new Date(0); break;
    }

    return deposits.filter(d => new Date(d.deposit_date) >= cutoffDate);
  }, [deposits, timeRange]);

  const exposureAverage = useMemo(() => {
    if (historicalData.length === 0) return null;
    if (portfolioId && !fullSnapshotDates) return null; // in caricamento
    const sortedDates = historicalData.map(entry => entry.snapshot_date.slice(0, 10)).sort();
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let start: string;
    if (timeRange === 'MAX') {
      start = sortedDates[0];
    } else {
      let cutoff: Date;
      switch (timeRange) {
        case '1M': cutoff = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()); break;
        case '3M': cutoff = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()); break;
        case '6M': cutoff = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()); break;
        case '1Y': cutoff = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()); break;
        case '2Y': cutoff = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate()); break;
        case '3Y': cutoff = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate()); break;
        case 'YTD': cutoff = new Date(today.getFullYear(), 0, 1); break;
        default: cutoff = new Date(0); break;
      }
      start = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    }
    // Fine periodo = data del valore corrente del grafico (ultimo upload), come la linea del rendimento.
    const lastHistorical = sortedDates[sortedDates.length - 1];
    const current = currentDate?.slice(0, 10) ?? null;
    const end = current && current > lastHistorical ? current : (lastHistorical ?? todayIso);
    const points = historicalData
      .filter(entry => entry.equity_exposure_pct != null && (!coveredDates || coveredDates.has(entry.snapshot_date.slice(0, 10))))
      .map(entry => ({ date: entry.snapshot_date.slice(0, 10), pct: Number(entry.equity_exposure_pct) }));
    return computeAverageEquityExposure(points, start, end);
  }, [historicalData, portfolioId, fullSnapshotDates, coveredDates, timeRange, currentDate]);

  const chartData = useMemo(() => {
    if (filteredHistoricalData.length === 0) return [];

    const sorted = [...filteredHistoricalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    const initialEntry = sorted[0];
    const initialValue = getValueForViewMode(initialEntry, viewMode);
    const initialDate = new Date(initialEntry.snapshot_date);

    const sortedDeposits = [...filteredDeposits].sort(
      (a, b) => new Date(a.deposit_date).getTime() - new Date(b.deposit_date).getTime()
    );

    const data: ChartDataPoint[] = sorted.map((entry) => {
      const snapshotDate = new Date(entry.snapshot_date);
      const value = getValueForViewMode(entry, viewMode);

      const cumulativeDeposits = sortedDeposits
        .filter((d) => {
          const depositDate = new Date(d.deposit_date);
          return depositDate > initialDate && depositDate <= snapshotDate;
        })
        .reduce((sum, d) => sum + d.amount, 0);

      const pl = value - initialValue - cumulativeDeposits;

      const avgBalance = calculateTimeWeightedAverage(
        initialDate, snapshotDate, initialValue, sortedDeposits
      ).average;

      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      return {
        date: entry.snapshot_date,
        timestamp: snapshotDate.getTime(),
        formattedDate: format(parseISO(entry.snapshot_date), "dd MMM ''yy", { locale: it }),
        value,
        returnPct,
        cumulativeDeposits,
        equityPct: entry.equity_exposure_pct != null && (!coveredDates || coveredDates.has(entry.snapshot_date.slice(0, 10)))
          ? Number(entry.equity_exposure_pct)
          : undefined,
      };
    });

    if (hasLiveCurrent && currentDate) {
      const currentDateObj = new Date(currentDate);
      const cumulativeDeposits = sortedDeposits
        .filter((d) => {
          const depositDate = new Date(d.deposit_date);
          return depositDate > initialDate && depositDate <= currentDateObj;
        })
        .reduce((sum, d) => sum + d.amount, 0);

      const pl = currentValue - initialValue - cumulativeDeposits;
      const avgBalance = calculateTimeWeightedAverage(
        initialDate, currentDateObj, initialValue, sortedDeposits
      ).average;
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      const existingIdx = data.findIndex(d => d.date === currentDate);
      if (existingIdx >= 0) {
        data[existingIdx] = {
          ...data[existingIdx],
          value: currentValue,
          returnPct,
          cumulativeDeposits,
        };
      } else {
        const isNewest = !latestSnapshotDate || new Date(currentDate) >= latestSnapshotDate;
        if (isNewest) {
          data.push({
            date: currentDate,
            timestamp: currentDateObj.getTime(),
            formattedDate: format(parseISO(currentDate), "dd MMM ''yy", { locale: it }),
            value: currentValue,
            returnPct,
            cumulativeDeposits,
          });
        }
      }
    }

    data.sort((a, b) => a.timestamp - b.timestamp);

    const maxPoints = (timeRange === '1M') ? 10
      : (timeRange === '3M') ? 12
      : (timeRange === '6M') ? 14
      : (timeRange === '1Y') ? 18
      : (timeRange === '2Y') ? 22
      : 24;
    const preserveTs = currentDate ? new Date(currentDate).getTime() : undefined;
    return downsampleData(data, maxPoints, preserveTs);
  }, [filteredHistoricalData, viewMode, currentValue, currentDate, filteredDeposits, timeRange, hasLiveCurrent, latestSnapshotDate, coveredDates]);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Nessun dato storico disponibile
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <CustomLegend
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        extra={exposureAverage ? <AverageExposureBadge result={exposureAverage} aggregated={!portfolioId} /> : null}
      />
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={computeTimeTicks(chartData)}
              tickFormatter={formatTickDate}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickFormatter={(value) => `${value.toFixed(1)}%`}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{
                color: 'hsl(var(--foreground))',
                fontWeight: 500,
              }}
              itemStyle={{
                color: 'hsl(var(--foreground))',
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;

                const dataPoint = payload[0]?.payload as ChartDataPoint | undefined;
                if (!dataPoint) return null;

                return (
                  <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                    <p className="text-foreground font-medium text-sm mb-2">Data: {formatTooltipDate(label as number)}</p>

                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-profit" />
                      <span className="text-foreground text-xs">
                        Rendimento: <span className="font-medium">{dataPoint.returnPct.toFixed(2)}%</span>
                      </span>
                    </div>
                    {dataPoint.equityPct != null && (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        <span className="text-foreground text-xs">
                          Esposizione azionaria: <span className="font-medium">{pctLabel(dataPoint.equityPct)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="returnPct"
              stroke="hsl(var(--profit))"
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, index } = props;
                if (index === 0 || index === chartData.length - 1) {
                  return <circle cx={cx} cy={cy} r={3} fill="hsl(var(--profit))" />;
                }
                return <circle cx={cx} cy={cy} r={0} />;
              }}
              activeDot={{ r: 4, strokeWidth: 0 }}
              name="returnPct"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
