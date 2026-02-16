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
  formattedDate: string;
  value: number;
  isCurrent?: boolean;
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
      formattedDate: format(parseISO(entry.snapshot_date), "dd MMM ''yy", { locale: it }),
      value: getValueForViewMode(entry, viewMode),
    }));

    // Add current point ONLY if it's newer than the latest saved snapshot and not a duplicate
    if (canAppendCurrent && currentDate && !data.some(d => d.date === currentDate)) {
      data.push({
        date: currentDate,
        formattedDate: format(parseISO(currentDate), "dd MMM ''yy", { locale: it }),
        value: currentValue,
        isCurrent: true,
      });
    }

    // Ensure chronological order as a safety measure
    data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return data;
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
          dataKey="formattedDate"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          interval={0}
          type="category"
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
          labelFormatter={(label) => `Data: ${label}`}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#portfolioGradient)"
          dot={(props) => {
            const { cx, cy, payload } = props;
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
            return <circle cx={cx} cy={cy} r={3} fill="hsl(var(--primary))" />;
          }}
          activeDot={{ r: 5, fill: 'hsl(var(--primary))' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
