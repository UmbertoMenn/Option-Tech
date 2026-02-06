import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';

interface YearlyReturnChartProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  deposits: DepositEntry[];
}

interface YearlyDataPoint {
  year: string;
  returnPct: number;
}

function getValueForViewMode(entry: HistoricalDataEntry, viewMode: ViewMode): number {
  switch (viewMode) {
    case 'base':
      return entry.total_value;
    case 'netting_total':
      return entry.netting_total;
    case 'netting_ex_cc':
      return entry.netting_ex_cc;
    case 'netting_ex_cc_np':
      return entry.netting_ex_cc_np ?? entry.netting_ex_cc;
    default:
      return entry.total_value;
  }
}

export function YearlyReturnChart({
  historicalData,
  viewMode,
  deposits,
}: YearlyReturnChartProps) {
  const chartData = useMemo(() => {
    if (historicalData.length < 2) return [];

    // Sort by date ascending
    const sorted = [...historicalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    // Group by year
    const byYear: Record<string, HistoricalDataEntry[]> = {};
    sorted.forEach((entry) => {
      const year = entry.snapshot_date.substring(0, 4);
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(entry);
    });

    const sortedDeposits = [...deposits].sort(
      (a, b) => new Date(a.deposit_date).getTime() - new Date(b.deposit_date).getTime()
    );

    const years = Object.keys(byYear).sort();
    const data: YearlyDataPoint[] = [];

    years.forEach((year, index) => {
      const yearEntries = byYear[year];
      if (yearEntries.length === 0) return;

      // Get first entry of the year (or last entry of previous year)
      let startValue: number;
      let startDate: Date;

      if (index === 0) {
        // First year: use first entry as start
        startValue = getValueForViewMode(yearEntries[0], viewMode);
        startDate = new Date(yearEntries[0].snapshot_date);
      } else {
        // Use last entry of previous year as start
        const prevYear = years[index - 1];
        const prevYearEntries = byYear[prevYear];
        const lastPrevEntry = prevYearEntries[prevYearEntries.length - 1];
        startValue = getValueForViewMode(lastPrevEntry, viewMode);
        startDate = new Date(lastPrevEntry.snapshot_date);
      }

      // Get last entry of the year
      const lastEntry = yearEntries[yearEntries.length - 1];
      const endValue = getValueForViewMode(lastEntry, viewMode);
      const endDate = new Date(lastEntry.snapshot_date);

      // Sum deposits in the year
      const yearDeposits = sortedDeposits
        .filter((d) => {
          const depositDate = new Date(d.deposit_date);
          return depositDate > startDate && depositDate <= endDate;
        })
        .reduce((sum, d) => sum + d.amount, 0);

      // P/L for the year
      const pl = endValue - startValue - yearDeposits;

      // Average balance
      const avgBalance = startValue + yearDeposits / 2;

      // Return %
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      data.push({
        year,
        returnPct,
      });
    });

    return data;
  }, [historicalData, viewMode, deposits]);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Servono almeno 2 snapshot per calcolare i rendimenti annuali
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickFormatter={(value) => `${value.toFixed(0)}%`}
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
          formatter={(value: number) => [`${value.toFixed(2)}%`, 'Rendimento']}
          labelFormatter={(label) => `Anno ${label}`}
        />
        <Bar dataKey="returnPct" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.returnPct >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
