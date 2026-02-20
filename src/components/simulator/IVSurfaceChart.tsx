import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IVSurface, IVPoint } from '@/lib/ivSurface';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface IVSurfaceChartProps {
  ivSurface: IVSurface;
  strategyStrikes?: number[];
}

export function IVSurfaceChart({ ivSurface, strategyStrikes }: IVSurfaceChartProps) {
  const [selectedExpiries, setSelectedExpiries] = useState<Set<string>>(new Set(ivSurface.expiries.slice(0, 3)));

  const toggleExpiry = (exp: string) => {
    setSelectedExpiries(prev => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp); else next.add(exp);
      return next;
    });
  };

  const chartData = useMemo(() => {
    const allStrikes = [...new Set(ivSurface.points.filter(p => selectedExpiries.has(p.expiry)).map(p => p.strike))].sort((a, b) => a - b);

    return allStrikes.map(strike => {
      const row: Record<string, number> = { strike };
      for (const exp of selectedExpiries) {
        const pt = ivSurface.points.find(p => p.expiry === exp && p.strike === strike);
        if (pt) row[exp] = Math.round(pt.iv * 10000) / 100; // as percentage
      }
      return row;
    });
  }, [ivSurface, selectedExpiries]);

  const colors = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  if (ivSurface.points.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Superficie IV</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Nessun dato IV disponibile</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Volatilità Implicita (Smile/Skew)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {ivSurface.expiries.map((exp, i) => (
            <Button
              key={exp}
              variant={selectedExpiries.has(exp) ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-6 px-2"
              onClick={() => toggleExpiry(exp)}
            >
              {exp}
            </Button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="strike" className="text-xs" tick={{ fontSize: 10 }} />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} unit="%" />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
              labelFormatter={v => `Strike: $${v}`}
              formatter={(v: number) => [`${v.toFixed(1)}%`, '']}
            />
            <Legend />
            {Array.from(selectedExpiries).map((exp, i) => (
              <Line key={exp} type="monotone" dataKey={exp} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} name={exp} />
            ))}
            {/* Strategy strike markers would go here as ReferenceLine */}
          </LineChart>
        </ResponsiveContainer>

        <p className="text-xs text-muted-foreground">
          {ivSurface.points.length} punti IV • Risk-free rate: {(ivSurface.riskFreeRate * 100).toFixed(2)}%
        </p>
      </CardContent>
    </Card>
  );
}
