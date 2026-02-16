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
import { formatEUR, formatPercentage } from '@/lib/formatters';

interface YearlyReturnChartProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  deposits: DepositEntry[];
}

interface YearlyDataPoint {
  year: string;
  returnPct: number;
  startValue: number;
  endValue: number;
  deposits: number;
  pl: number;
  avgBalance: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: YearlyDataPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;
  const isProfit = data.returnPct >= 0;

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold text-foreground mb-2">Anno {data.year}</p>

      <div className="space-y-1 text-muted-foreground">
        <div className="flex justify-between gap-4">
          <span>Valore iniziale:</span>
          <span className="text-foreground font-medium">{formatEUR(data.startValue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Valore finale:</span>
          <span className="text-foreground font-medium">{formatEUR(data.endValue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Versamenti:</span>
          <span className="text-foreground font-medium">{formatEUR(data.deposits)}</span>
        </div>
      </div>

      <div className="border-t border-border my-2" />

      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>P/L:</span>
          <span className={`font-medium ${isProfit ? 'text-profit' : 'text-loss'}`}>
            {formatEUR(data.pl)}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>Giacenza media:</span>
          <span className="text-foreground font-medium">{formatEUR(data.avgBalance)}</span>
        </div>
      </div>

      <div className="border-t border-border my-2" />

      <div className="flex justify-between gap-4">
        <span className="font-semibold text-foreground">Rendimento:</span>
        <span className={`font-bold ${isProfit ? 'text-profit' : 'text-loss'}`}>
          {formatPercentage(data.returnPct)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
        P/L ÷ (Valore iniziale + Versamenti/2)
      </p>
    </div>
  );
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
        startValue,
        endValue,
        deposits: yearDeposits,
        pl,
        avgBalance,
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
        <Tooltip content={<CustomTooltip />} />
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
