import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { HistoricalDataEntry } from '@/types/historicalData';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { formatCurrency } from '@/lib/formatters';

/**
 * Format large numbers for Y-axis labels (e.g., 2.1M, 814k)
 */
function formatAxisValue(value: number): string {
  const absValue = Math.abs(value);
  
  if (absValue >= 1_000_000) {
    const formatted = (value / 1_000_000).toFixed(1);
    // Remove trailing .0
    return formatted.endsWith('.0') 
      ? `${Math.round(value / 1_000_000)}M` 
      : `${formatted}M`;
  }
  
  if (absValue >= 1_000) {
    const formatted = (value / 1_000).toFixed(0);
    return `${formatted}k`;
  }
  
  return value.toFixed(0);
}

interface PortfolioEvolutionChartProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  currentValue: number;
  currentDate: string | null;
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  formattedDate: string;
  value: number;
  isCurrent?: boolean;
}

function downsampleData<T extends { timestamp: number }>(
  data: T[],
  maxPoints = 30,
  preserveIndices?: Set<number>
): T[] {
  if (data.length <= maxPoints) return data;
  const result: T[] = [data[0]];
  const step = (data.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)]);
  }
  result.push(data[data.length - 1]);
  // Ensure preserved indices are included
  if (preserveIndices) {
    for (const idx of preserveIndices) {
      if (!result.includes(data[idx])) {
        result.push(data[idx]);
      }
    }
    result.sort((a, b) => a.timestamp - b.timestamp);
  }
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
    case 'base':
      return entry.total_value;
    case 'netting_total':
      return entry.netting_total;
    case 'netting_ex_cc_np':
      return entry.netting_ex_cc_np ?? entry.netting_ex_cc;
    default:
      return entry.total_value;
  }
}

export function PortfolioEvolutionChart({
  historicalData,
  viewMode,
  currentValue,
  currentDate,
}: PortfolioEvolutionChartProps) {
  // Calculate the latest snapshot date from ALL historical data
  // This is used to determine if currentDate is really the newest
  const latestSnapshotDate = useMemo(() => {
    if (historicalData.length === 0) return null;
    return new Date(Math.max(...historicalData.map(d => new Date(d.snapshot_date).getTime())));
  }, [historicalData]);

  // Determine if we can append the current point (only if it's newer than the latest saved snapshot)
  const canAppendCurrent = useMemo(() => {
    if (!currentDate || currentValue <= 0) return false;
    if (!latestSnapshotDate) return true; // No historical data, so current is newest
    return new Date(currentDate) > latestSnapshotDate;
  }, [currentDate, currentValue, latestSnapshotDate]);

  const chartData = useMemo(() => {
    if (historicalData.length === 0) return [];

    // Sort by date ascending
    const sorted = [...historicalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    const data: ChartDataPoint[] = sorted.map((entry) => ({
      date: entry.snapshot_date,
      timestamp: new Date(entry.snapshot_date).getTime(),
      formattedDate: format(parseISO(entry.snapshot_date), "dd MMM ''yy", { locale: it }),
      value: getValueForViewMode(entry, viewMode),
    }));

    // Add current point ONLY if it's newer than the latest saved snapshot and not a duplicate
    if (canAppendCurrent && currentDate && !data.some(d => d.date === currentDate)) {
      data.push({
        date: currentDate,
        timestamp: new Date(currentDate).getTime(),
        formattedDate: format(parseISO(currentDate), "dd MMM ''yy", { locale: it }),
        value: currentValue,
        isCurrent: true,
      });
    }

    // Ensure chronological order as a safety measure
    data.sort((a, b) => a.timestamp - b.timestamp);

    // Downsample for smoother curve
    const currentIdx = data.findIndex(d => d.isCurrent);
    const preserve = currentIdx >= 0 ? new Set([currentIdx]) : undefined;
    return downsampleData(data, 30, preserve);
  }, [historicalData, viewMode, currentValue, currentDate, canAppendCurrent]);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Nessun dato storico disponibile
      </div>
    );
  }

  // Calculate domain with some padding
  const minValue = Math.min(...chartData.map((d) => d.value));
  const maxValue = Math.max(...chartData.map((d) => d.value));
  const padding = (maxValue - minValue) * 0.1 || maxValue * 0.1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          domain={[minValue - padding, maxValue + padding]}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickFormatter={formatAxisValue}
          width={50}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value: number) => [formatCurrency(value), 'Patrimonio']}
          labelFormatter={(ts: number) => `Data: ${formatTooltipDate(ts)}`}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#portfolioGradient)"
          dot={(props) => {
            const { cx, cy, payload, index } = props;
            if (payload?.isCurrent) {
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                />
              );
            }
            // Show dots only on first and last points
            if (index === 0 || index === chartData.length - 1) {
              return <circle cx={cx} cy={cy} r={3} fill="hsl(var(--primary))" />;
            }
            return <circle cx={cx} cy={cy} r={0} />;
          }}
          activeDot={{ r: 5, fill: 'hsl(var(--primary))' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
