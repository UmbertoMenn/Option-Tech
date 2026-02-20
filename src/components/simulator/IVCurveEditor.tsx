import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RotateCcw, Minus } from 'lucide-react';
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export interface IVPoint {
  date: string;
  iv: number; // as decimal, e.g. 0.30 = 30%
}

interface IVCurveEditorProps {
  priceData: { date: string; close: number }[];
  ivPoints: IVPoint[];
  riskFreeRate: number;
  onIVPointsChange: (points: IVPoint[]) => void;
  onRiskFreeRateChange: (rate: number) => void;
}

const IV_COLOR = '#f97316'; // orange

/**
 * Generate one IV point per month boundary in the price data range.
 * Includes start date, first of each month, and end date.
 */
export function generateMonthlyPoints(priceData: { date: string }[]): IVPoint[] {
  if (priceData.length === 0) return [];

  const startDate = priceData[0].date;
  const endDate = priceData[priceData.length - 1].date;

  const points: IVPoint[] = [{ date: startDate, iv: 0.3 }];

  // Walk months from start
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  let current = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    if (dateStr !== startDate && dateStr !== endDate) {
      points.push({ date: dateStr, iv: 0.3 });
    }
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  if (endDate !== startDate) {
    points.push({ date: endDate, iv: 0.3 });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Interpolate IV at a given date from sorted IV points.
 */
function interpolateIVAtDate(points: IVPoint[], date: string): number {
  if (points.length === 0) return 0.3;
  if (points.length === 1) return points[0].iv;
  if (date <= points[0].date) return points[0].iv;
  if (date >= points[points.length - 1].date) return points[points.length - 1].iv;

  for (let i = 0; i < points.length - 1; i++) {
    if (date >= points[i].date && date <= points[i + 1].date) {
      const t1 = new Date(points[i].date).getTime();
      const t2 = new Date(points[i + 1].date).getTime();
      const t = new Date(date).getTime();
      if (t2 === t1) return points[i].iv;
      const w = (t - t1) / (t2 - t1);
      return points[i].iv + w * (points[i + 1].iv - points[i].iv);
    }
  }
  return points[points.length - 1].iv;
}

export function IVCurveEditor({
  priceData,
  ivPoints,
  riskFreeRate,
  onIVPointsChange,
  onRiskFreeRateChange,
}: IVCurveEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Sample price data for chart display (max ~120 points)
  const sampledDates = useMemo(() => {
    const step = Math.max(1, Math.floor(priceData.length / 120));
    return priceData.filter((_, i) => i % step === 0 || i === priceData.length - 1);
  }, [priceData]);

  // Build chart data with interpolated IV curve
  const chartData = useMemo(() => {
    const sorted = [...ivPoints].sort((a, b) => a.date.localeCompare(b.date));
    return sampledDates.map(p => ({
      date: p.date,
      close: p.close,
      iv: interpolateIVAtDate(sorted, p.date) * 100,
    }));
  }, [sampledDates, ivPoints]);

  // Scatter data: only the IV control points
  const scatterData = useMemo(() => {
    return ivPoints.map((p, i) => ({
      date: p.date,
      ivPoint: p.iv * 100,
      idx: i,
    }));
  }, [ivPoints]);

  const handleScatterClick = useCallback((data: any) => {
    if (data && data.idx !== undefined) {
      setSelectedIdx(data.idx);
    }
  }, []);

  const handleFlatIV = useCallback(() => {
    const val = selectedIdx !== null ? ivPoints[selectedIdx].iv : 0.3;
    onIVPointsChange(ivPoints.map(p => ({ ...p, iv: val })));
  }, [ivPoints, selectedIdx, onIVPointsChange]);

  const handleReset = useCallback(() => {
    const newPoints = generateMonthlyPoints(priceData);
    onIVPointsChange(newPoints);
    setSelectedIdx(null);
  }, [priceData, onIVPointsChange]);

  const handleIVInput = useCallback((val: string) => {
    if (selectedIdx === null) return;
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return;
    const newPoints = [...ivPoints];
    newPoints[selectedIdx] = { ...newPoints[selectedIdx], iv: num / 100 };
    onIVPointsChange(newPoints);
  }, [selectedIdx, ivPoints, onIVPointsChange]);

  // Handle mouse drag on chart for IV point vertical adjustment
  const handleMouseDown = useCallback((e: any) => {
    if (e && e.activePayload) {
      const payload = e.activePayload.find((p: any) => p.dataKey === 'ivPoint' && p.value !== undefined);
      if (payload) {
        const date = e.activeLabel;
        const idx = ivPoints.findIndex(p => p.date === date);
        if (idx >= 0) {
          setDraggingIdx(idx);
          setSelectedIdx(idx);
        }
      }
    }
  }, [ivPoints]);

  const handleMouseMove = useCallback((e: any) => {
    if (draggingIdx === null || !e) return;
    const chartWrapper = chartRef.current;
    if (!chartWrapper) return;

    if (e.chartY !== undefined) {
      const chartArea = chartWrapper.querySelector('.recharts-cartesian-grid');
      if (!chartArea) return;
      const rect = chartArea.getBoundingClientRect();
      const relY = (e.chartY - 5) / (rect.height);
      const maxIV = 150;
      const iv = Math.max(1, Math.min(maxIV, maxIV * (1 - relY))) / 100;

      const newPoints = [...ivPoints];
      newPoints[draggingIdx] = { ...newPoints[draggingIdx], iv };
      onIVPointsChange(newPoints);
    }
  }, [draggingIdx, ivPoints, onIVPointsChange]);

  const handleMouseUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  useEffect(() => {
    if (draggingIdx !== null) {
      const up = () => setDraggingIdx(null);
      window.addEventListener('mouseup', up);
      return () => window.removeEventListener('mouseup', up);
    }
  }, [draggingIdx]);

  const formatDate = (d: string) => {
    if (!d) return '';
    return d.slice(5); // MM-DD
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Curva Volatilità Implicita</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">IV punto selezionato (%)</Label>
            <Input
              type="number"
              step="1"
              min="1"
              max="300"
              className="w-20 h-8 text-xs"
              value={selectedIdx !== null ? Math.round(ivPoints[selectedIdx].iv * 100) : ''}
              onChange={e => handleIVInput(e.target.value)}
              disabled={selectedIdx === null}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Risk-Free Rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="20"
              className="w-20 h-8 text-xs"
              value={Math.round(riskFreeRate * 1000) / 10}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onRiskFreeRateChange(v / 100);
              }}
            />
          </div>

          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleFlatIV}>
            <Minus className="w-3 h-3 mr-1" />IV Piatta
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleReset}>
            <RotateCcw className="w-3 h-3 mr-1" />Reset
          </Button>
        </div>

        {/* Chart */}
        <div ref={chartRef} className="select-none" style={{ cursor: draggingIdx !== null ? 'ns-resize' : 'default' }}>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              onMouseDown={handleMouseDown}
              onMouseMove={draggingIdx !== null ? handleMouseMove : undefined}
              onMouseUp={handleMouseUp}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={formatDate} interval="preserveStartEnd" />
              <YAxis yAxisId="iv" tick={{ fontSize: 9 }} unit="%" domain={[0, 150]} />
              <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 9 }} domain={['dataMin', 'dataMax']} />

              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                formatter={(v: number, name: string) => {
                  if (name === 'close') return [`$${v.toFixed(2)}`, 'Prezzo'];
                  if (name === 'iv') return [`${v.toFixed(1)}%`, 'IV'];
                  return [`${v.toFixed(1)}%`, 'Punto IV'];
                }}
              />

              {/* Price area */}
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="close"
                fill="hsl(var(--primary) / 0.1)"
                stroke="hsl(var(--primary) / 0.3)"
                strokeWidth={1}
              />

              {/* IV interpolated line */}
              <Line
                yAxisId="iv"
                type="monotone"
                dataKey="iv"
                stroke={IV_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={false}
              />

              {/* IV control points */}
              <Scatter
                yAxisId="iv"
                dataKey="ivPoint"
                data={scatterData}
                fill={IV_COLOR}
                onClick={handleScatterClick}
                cursor="grab"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <p className="text-xs text-muted-foreground">
          {ivPoints.length} punti IV (mensili) • Trascina verticalmente per modificare • Risk-free: {(riskFreeRate * 100).toFixed(1)}%
        </p>
      </CardContent>
    </Card>
  );
}
