import { useMemo } from 'react';
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
import { it } from 'date-fns/locale';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { formatCurrency } from '@/lib/formatters';

interface PerformanceEvolutionChartProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  currentValue: number;
  currentDate: string | null;
  deposits: DepositEntry[];
}

interface ChartDataPoint {
  date: string;
  formattedDate: string;
  value: number;
  pl: number;
  returnPct: number;
  cumulativeDeposits: number;
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

export function PerformanceEvolutionChart({
  historicalData,
  viewMode,
  currentValue,
  currentDate,
  deposits,
}: PerformanceEvolutionChartProps) {
  const chartData = useMemo(() => {
    if (historicalData.length === 0) return [];

    // Sort by date ascending
    const sorted = [...historicalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    const initialEntry = sorted[0];
    const initialValue = getValueForViewMode(initialEntry, viewMode);
    const initialDate = new Date(initialEntry.snapshot_date);

    // Calculate cumulative deposits for each snapshot
    const sortedDeposits = [...deposits].sort(
      (a, b) => new Date(a.deposit_date).getTime() - new Date(b.deposit_date).getTime()
    );

    const data: ChartDataPoint[] = sorted.map((entry) => {
      const snapshotDate = new Date(entry.snapshot_date);
      const value = getValueForViewMode(entry, viewMode);

      // Sum deposits between initial date and this snapshot date
      const cumulativeDeposits = sortedDeposits
        .filter((d) => {
          const depositDate = new Date(d.deposit_date);
          return depositDate > initialDate && depositDate <= snapshotDate;
        })
        .reduce((sum, d) => sum + d.amount, 0);

      // P/L = current value - initial value - deposits in period
      const pl = value - initialValue - cumulativeDeposits;

      // Use average balance from entry if available, otherwise use initial value + half deposits
      const avgBalance = entry.average_balance > 0 
        ? entry.average_balance 
        : initialValue + cumulativeDeposits / 2;

      // Return % = P/L / average balance * 100
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      return {
        date: entry.snapshot_date,
        formattedDate: format(parseISO(entry.snapshot_date), 'MMM yy', { locale: it }),
        value,
        pl,
        returnPct,
        cumulativeDeposits,
      };
    });

    // Add current point if different from last snapshot
    if (currentDate && currentValue > 0) {
      const lastEntry = data[data.length - 1];
      if (!lastEntry || lastEntry.date !== currentDate) {
        const currentDateObj = new Date(currentDate);
        const cumulativeDeposits = sortedDeposits
          .filter((d) => {
            const depositDate = new Date(d.deposit_date);
            return depositDate > initialDate && depositDate <= currentDateObj;
          })
          .reduce((sum, d) => sum + d.amount, 0);

        const pl = currentValue - initialValue - cumulativeDeposits;
        const avgBalance = initialValue + cumulativeDeposits / 2;
        const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

        data.push({
          date: currentDate,
          formattedDate: format(parseISO(currentDate), 'MMM yy', { locale: it }),
          value: currentValue,
          pl,
          returnPct,
          cumulativeDeposits,
        });
      }
    }

    return data;
  }, [historicalData, viewMode, currentValue, currentDate, deposits]);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Nessun dato storico disponibile
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis
          dataKey="formattedDate"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickFormatter={(value) => `${value.toFixed(1)}%`}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickFormatter={(value) => formatCurrency(value)}
        />
        <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value: number, name: string) => {
            if (name === 'returnPct') return [`${value.toFixed(2)}%`, 'Rendimento'];
            if (name === 'pl') return [formatCurrency(value), 'P/L'];
            return [value, name];
          }}
          labelFormatter={(label) => `Data: ${label}`}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="returnPct"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{ r: 3, fill: 'hsl(var(--primary))' }}
          activeDot={{ r: 5 }}
          name="returnPct"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="pl"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ r: 3, fill: 'hsl(var(--chart-2))' }}
          activeDot={{ r: 5 }}
          name="pl"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
