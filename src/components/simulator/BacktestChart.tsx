import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BacktestDayResult, AdjustmentLog } from '@/lib/backtestEngine';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush
} from 'recharts';

interface BacktestChartProps {
  days: BacktestDayResult[];
  adjustmentLog: AdjustmentLog[];
}

interface ChartDataPoint {
  date: string;
  price: number;
  adjustmentDesc: string | null;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  // Prioritise the payload entry that has an adjustmentDesc
  const withAdj = payload.find((p: any) => p?.payload?.adjustmentDesc);
  const data = (withAdj?.payload ?? payload[0]?.payload) as ChartDataPoint;
  if (!data) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs max-w-xs">
      <p className="font-mono text-muted-foreground mb-1">{data.date}</p>
      <div className="flex justify-between gap-4">
        <span>Prezzo:</span>
        <span style={{ fontFamily: 'monospace' }}>${data.price.toFixed(2)}</span>
      </div>
      {data.adjustmentDesc && (
        <div className="mt-2 pt-2 border-t border-primary/30">
          <p className="font-semibold text-primary mb-1">⚡ Operazione</p>
          <p className="text-foreground whitespace-pre-line">{data.adjustmentDesc}</p>
        </div>
      )}
    </div>
  );
}

function CustomScatterDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  // Only render dot on days with an operation
  if (!payload?.adjustmentDesc) return null;
  return (
    <g>
      {/* Large near-invisible hit-area for easy hover */}
      <circle cx={cx} cy={cy} r={22} fill="rgba(249,115,22,0.001)" pointerEvents="all" stroke="none" />
      {/* Visible orange dot */}
      <circle cx={cx} cy={cy} r={7} fill="#f97316" stroke="hsl(var(--background))" strokeWidth={2} />
    </g>
  );
}

export function BacktestChart({ days, adjustmentLog }: BacktestChartProps) {
  const chartData = useMemo(() => {
    const descMap = new Map<string, string[]>();
    for (const adj of adjustmentLog) {
      const arr = descMap.get(adj.date) || [];
      arr.push(adj.description);
      descMap.set(adj.date, arr);
    }

    return days.map(d => ({
      date: d.date,
      price: d.underlyingPrice,
      adjustmentDesc: descMap.get(d.date)?.join('\n') ?? null,
    }));
  }, [days, adjustmentLog]);

  if (days.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Prezzo & Operazioni</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Esegui il backtest per vedere i risultati</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prezzo & Operazioni</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis className="text-xs" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone" dataKey="price"
              stroke="hsl(var(--primary))" strokeWidth={2}
              dot={false} activeDot={false} name="Prezzo"
            />
            <Scatter
              dataKey="price"
              shape={<CustomScatterDot />}
              name="Operazioni"
            />
            <Brush dataKey="date" height={20} stroke="hsl(var(--primary))" />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
