import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BacktestDayResult, AdjustmentLog } from '@/lib/backtestEngine';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Brush, Legend
} from 'recharts';

interface BacktestChartProps {
  days: BacktestDayResult[];
  adjustmentLog: AdjustmentLog[];
}

export function BacktestChart({ days, adjustmentLog }: BacktestChartProps) {
  const chartData = useMemo(() => {
    return days.map(d => ({
      date: d.date,
      pl: Math.round(d.totalPL * 100) / 100,
      plPct: Math.round(d.plPct * 100) / 100,
      price: d.underlyingPrice,
      hasAdjustment: d.adjustments.length > 0,
    }));
  }, [days]);

  const adjustmentDates = new Set(adjustmentLog.map(a => a.date));

  if (days.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Evoluzione P/L</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Esegui il backtest per vedere i risultati</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evoluzione P/L</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="plGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                <stop offset="50%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                <stop offset="50%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis yAxisId="pl" className="text-xs" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="price" orientation="right" className="text-xs" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
              formatter={(v: number, name: string) => {
                if (name === 'P/L') return [`$${v.toFixed(2)}`, name];
                if (name === 'P/L %') return [`${v.toFixed(2)}%`, name];
                return [`$${v.toFixed(2)}`, name];
              }}
            />
            <Legend />
            <ReferenceLine yAxisId="pl" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />

            {/* Adjustment markers */}
            {Array.from(adjustmentDates).map(date => (
              <ReferenceLine key={date} x={date} yAxisId="pl" stroke="hsl(var(--primary))" strokeDasharray="5 5" strokeWidth={1} />
            ))}

            <Area yAxisId="pl" type="monotone" dataKey="pl" fill="url(#plGradient)" stroke="hsl(var(--chart-2))" strokeWidth={2} name="P/L" />
            <Line yAxisId="price" type="monotone" dataKey="price" stroke="hsl(var(--muted-foreground))" strokeWidth={1} dot={false} name="Prezzo" />
            <Brush dataKey="date" height={20} stroke="hsl(var(--primary))" />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
