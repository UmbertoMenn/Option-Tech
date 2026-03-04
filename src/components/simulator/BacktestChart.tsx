import { useMemo, useState, useCallback, useRef } from 'react';
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

interface HoveredOperation {
  data: ChartDataPoint;
  x: number;
  y: number;
}

/* ---------- Standard axis tooltip (price only, no operation details) ---------- */
function AxisTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload as ChartDataPoint;
  if (!data) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs max-w-xs">
      <p className="font-mono text-muted-foreground mb-1">{data.date}</p>
      <div className="flex justify-between gap-4">
        <span>Prezzo:</span>
        <span style={{ fontFamily: 'monospace' }}>${data.price.toFixed(2)}</span>
      </div>
    </div>
  );
}

/* ---------- Custom operation tooltip (HTML overlay, pointer-events:none) ---------- */
function OperationTooltip({ op }: { op: HoveredOperation }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: op.x + 14,
        top: op.y - 10,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
      className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs max-w-xs"
    >
      <p className="font-mono text-muted-foreground mb-1">{op.data.date}</p>
      <div className="flex justify-between gap-4">
        <span>Prezzo:</span>
        <span style={{ fontFamily: 'monospace' }}>${op.data.price.toFixed(2)}</span>
      </div>
      <div className="mt-2 pt-2 border-t border-primary/30">
        <p className="font-semibold text-primary mb-1">⚡ Operazione</p>
        <p className="text-foreground whitespace-pre-line">{op.data.adjustmentDesc}</p>
      </div>
    </div>
  );
}

export function BacktestChart({ days, adjustmentLog }: BacktestChartProps) {
  const [hoveredOp, setHoveredOp] = useState<HoveredOperation | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);

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

  const handleDotEnter = useCallback((data: ChartDataPoint, e: React.MouseEvent) => {
    setHoveredOp({ data, x: e.clientX, y: e.clientY });
  }, []);

  const handleDotMove = useCallback((data: ChartDataPoint, e: React.MouseEvent) => {
    setHoveredOp({ data, x: e.clientX, y: e.clientY });
  }, []);

  const handleDotLeave = useCallback(() => {
    setHoveredOp(null);
  }, []);

  /* Scatter dot renderer — needs access to hover handlers */
  const renderScatterDot = useCallback((props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    if (!payload?.adjustmentDesc) return null;
    return (
      <g
        onMouseEnter={(e) => handleDotEnter(payload, e as any)}
        onMouseMove={(e) => handleDotMove(payload, e as any)}
        onMouseLeave={handleDotLeave}
      >
        {/* Large near-invisible hit-area for easy hover */}
        <circle cx={cx} cy={cy} r={24} fill="rgba(249,115,22,0.001)" pointerEvents="all" stroke="none" />
        {/* Visible orange dot */}
        <circle cx={cx} cy={cy} r={7} fill="#f97316" stroke="hsl(var(--background))" strokeWidth={2} pointerEvents="none" />
      </g>
    );
  }, [handleDotEnter, handleDotMove, handleDotLeave]);

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
        <div ref={chartWrapperRef} className="relative">
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis className="text-xs" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              {/* Show axis tooltip only when NOT hovering an operation dot */}
              {!hoveredOp && <Tooltip content={<AxisTooltip />} />}
              <Line
                type="monotone" dataKey="price"
                stroke="hsl(var(--primary))" strokeWidth={2}
                dot={false} activeDot={false} name="Prezzo"
              />
              <Scatter
                dataKey="price"
                shape={renderScatterDot}
                name="Operazioni"
              />
              <Brush dataKey="date" height={20} stroke="hsl(var(--primary))" />
            </ComposedChart>
          </ResponsiveContainer>
          {/* Custom operation tooltip overlay */}
          {hoveredOp && <OperationTooltip op={hoveredOp} />}
        </div>
      </CardContent>
    </Card>
  );
}
