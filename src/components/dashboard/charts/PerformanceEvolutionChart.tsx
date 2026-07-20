import { useMemo, useState } from 'react';
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

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';

interface PerformanceEvolutionChartProps {
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

function CustomLegend({
  timeRange,
  onTimeRangeChange,
}: {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <div className="flex items-center justify-between text-xs mb-2">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-profit rounded" />
          <span className="text-foreground">Portafoglio</span>
        </div>
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
  historicalData,
  viewMode,
  currentValue,
  currentDate,
  deposits,
}: PerformanceEvolutionChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');

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
  }, [filteredHistoricalData, viewMode, currentValue, currentDate, filteredDeposits, timeRange, hasLiveCurrent, latestSnapshotDate]);

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
