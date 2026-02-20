import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BacktestDayResult } from '@/lib/backtestEngine';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface GreeksChartProps {
  days: BacktestDayResult[];
}

const GREEKS = [
  { key: 'totalDelta', label: 'Delta', color: 'hsl(var(--primary))' },
  { key: 'totalGamma', label: 'Gamma', color: 'hsl(var(--chart-2))' },
  { key: 'totalTheta', label: 'Theta', color: 'hsl(var(--chart-3))' },
  { key: 'totalVega', label: 'Vega', color: 'hsl(var(--chart-4))' },
];

export function GreeksChart({ days }: GreeksChartProps) {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    totalDelta: true, totalGamma: true, totalTheta: true, totalVega: true,
  });

  const chartData = useMemo(() => {
    return days.map(d => ({
      date: d.date,
      totalDelta: Math.round(d.totalDelta * 100) / 100,
      totalGamma: Math.round(d.totalGamma * 100) / 100,
      totalTheta: Math.round(d.totalTheta * 100) / 100,
      totalVega: Math.round(d.totalVega * 100) / 100,
    }));
  }, [days]);

  if (days.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Greeks</CardTitle>
          <div className="flex gap-1">
            {GREEKS.map(g => (
              <Button
                key={g.key}
                variant={visible[g.key] ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setVisible(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
              >
                {g.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
            />
            <Legend />
            {GREEKS.filter(g => visible[g.key]).map(g => (
              <Line key={g.key} type="monotone" dataKey={g.key} stroke={g.color} strokeWidth={1.5} dot={false} name={g.label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
