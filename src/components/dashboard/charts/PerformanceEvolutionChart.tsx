import { useMemo, useState } from 'react';
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
import { calculateTimeWeightedAverage } from '@/lib/timeWeightedAverage';
import { it } from 'date-fns/locale';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { ViewMode } from '@/components/dashboard/ViewModeSelector';
import { HelpCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useBenchmarkData, BenchmarkStaleSummary } from '@/hooks/useBenchmarkData';
import { useEquityExposurePct } from '@/hooks/useEquityExposurePct';
import { useCurrencyExposure } from '@/hooks/useCurrencyExposure';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | 'MAX' | 'YTD';

interface PerformanceEvolutionChartProps {
  historicalData: HistoricalDataEntry[];
  viewMode: ViewMode;
  currentValue: number;
  currentDate: string | null;
  deposits: DepositEntry[];
}

interface ChartDataPoint {
  date: string;
  timestamp: number;
  formattedDate: string;
  value: number;
  returnPct: number;
  cumulativeDeposits: number;
  benchmarkReturn?: number;
  // Benchmark breakdown details
  benchmarkEquityReturn?: number;
  benchmarkBondReturn?: number;
  benchmarkEquityPctUsed?: number;
  benchmarkEurusdVariation?: number;
  benchmarkUsdPctUsed?: number;
}

// Temporal bucket downsampling: distributes points uniformly over TIME, not index.
// This prevents dense clusters at the tail when aggregated data has uneven date density.
function downsampleData<T extends { timestamp: number }>(
  data: T[],
  maxPoints = 30,
  preserveTimestamp?: number // optional: always keep a point closest to this timestamp
): T[] {
  if (data.length <= maxPoints) return data;

  const first = data[0];
  const last = data[data.length - 1];
  const tMin = first.timestamp;
  const tMax = last.timestamp;

  if (tMax === tMin) return [first];

  // Number of interior buckets (excluding first and last which are always kept)
  const bucketCount = maxPoints - 2;
  const bucketSize = (tMax - tMin) / (bucketCount + 1); // +1 so buckets don't include edges

  // For each bucket, pick the point closest to the bucket center
  const result: T[] = [first];
  const used = new Set<number>([0, data.length - 1]);

  for (let b = 1; b <= bucketCount; b++) {
    const bucketCenter = tMin + b * bucketSize;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < data.length - 1; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs(data[i].timestamp - bucketCenter);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      result.push(data[bestIdx]);
    }
  }

  // Ensure the preserved timestamp point is included
  if (preserveTimestamp !== undefined) {
    let closestIdx = -1;
    let closestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(data[i].timestamp - preserveTimestamp);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    if (closestIdx >= 0 && !used.has(closestIdx)) {
      result.push(data[closestIdx]);
    }
  }

  result.push(last);
  // Sort by timestamp to maintain chronological order
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function computeTimeTicks(data: { timestamp: number }[], maxTicks = 6): number[] {
  if (data.length === 0) return [];
  if (data.length <= maxTicks) return data.map(d => d.timestamp);
  const min = data[0].timestamp;
  const max = data[data.length - 1].timestamp;
  const step = (max - min) / (maxTicks - 1);
  return Array.from({ length: maxTicks }, (_, i) => min + step * i);
}

function formatTickDate(timestamp: number): string {
  return format(new Date(timestamp), "MMM ''yy", { locale: it });
}

function formatTooltipDate(timestamp: number): string {
  return format(new Date(timestamp), "dd MMM ''yy", { locale: it });
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

// Format stale summary for tooltip
function formatStaleSummary(staleSummary: BenchmarkStaleSummary[]): string {
  if (staleSummary.length === 0) return '';
  
  const lines = staleSummary.map(s => {
    if (s.daysDiff === -1) {
      return `• ${s.ticker}: nessun dato disponibile`;
    }
    return `• ${s.ticker}: ultimo dato ${s.lastDate} (${s.daysDiff} giorni fa)`;
  });
  
  return '\n\n⚠️ Dati obsoleti:\n' + lines.join('\n');
}

// Custom legend component with benchmark tooltip, time range selector, and currency toggle
function CustomLegend({ 
  hasBenchmarkData, 
  isHoveringBenchmark,
  onBenchmarkHover,
  hasDataGaps,
  staleSummary,
  onRefresh,
  isRefreshing,
  equityExposurePct,
  equityExposureEUR,
  assetsTotalEUR,
  hasEquityData,
  currencyAdjusted,
  onCurrencyAdjustedChange,
  usdExposurePct,
  hasUsdData,
  timeRange,
  onTimeRangeChange,
  isAdmin,
}: { 
  hasBenchmarkData: boolean; 
  isHoveringBenchmark: boolean;
  onBenchmarkHover: (hovering: boolean) => void;
  hasDataGaps: boolean;
  staleSummary: BenchmarkStaleSummary[];
  onRefresh: () => void;
  isRefreshing: boolean;
  equityExposurePct: number;
  equityExposureEUR: number;
  assetsTotalEUR: number;
  hasEquityData: boolean;
  currencyAdjusted: boolean;
  onCurrencyAdjustedChange: (checked: boolean) => void;
  usdExposurePct: number;
  hasUsdData: boolean;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  isAdmin: boolean;
}) {
  const equityPctFormatted = (equityExposurePct * 100).toFixed(1);
  const bondPctFormatted = ((1 - equityExposurePct) * 100).toFixed(1);
  const usdPctFormatted = (usdExposurePct * 100).toFixed(1);
  
  const benchmarkDescription = hasEquityData
    ? `Paniere Equity/Bond ponderato per l'equity exposure storica del portafoglio.\n\n` +
      `Ponderazione dinamica: Il peso Equity/Bond varia nel tempo in base all'esposizione salvata in ogni snapshot.\n` +
      `L'exposure di ciascun punto determina la ponderazione per il periodo successivo.\n\n` +
      `⚠️ Nota metodologica: Per comparabilità, l'esposizione equity esclude Naked PUT, Leap CALL e Strategie.\n` +
      `Questi derivati rappresentano esposizione potenziale con profilo rischio/rendimento diverso dalla detenzione diretta di equity.\n\n` +
      `Equity exposure attuale: ${equityPctFormatted}%\n` +
      `Benchmark attuale: ${equityPctFormatted}% × Equity (SPY/QQQ) + ${bondPctFormatted}% × Bond (AGG)`
    : 'Paniere Equity/Bond ponderato per l\'equity exposure storica del portafoglio.\nEquity exposure non disponibile - usando fallback 60%.';

  const currencyTooltip = hasUsdData
    ? `Aggiusta il benchmark per l'effetto valutario EUR/USD.\n\n` +
      `Ponderazione dinamica: L'esposizione USD varia nel tempo in base al valore salvato in ogni snapshot.\n` +
      `L'exposure di ciascun punto determina la correzione per il periodo successivo.\n\n` +
      `USD exposure attuale: ${usdPctFormatted}%\n` +
      `Derivati esclusi, bond inclusi.`
    : 'Dati esposizione USD non disponibili.';

  const staleInfo = formatStaleSummary(staleSummary);
  const showWarning = hasDataGaps || staleSummary.length > 0;

  return (
    <div className="flex items-center justify-between text-xs mb-2">
      {/* Left side: Legend items */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-profit rounded" />
          <span className="text-foreground">Portafoglio</span>
        </div>
        {isAdmin && hasBenchmarkData && (
          <UITooltip delayDuration={0}>
            <TooltipTrigger 
              className="flex items-center gap-1.5 cursor-help"
              onMouseEnter={() => onBenchmarkHover(true)}
              onMouseLeave={() => onBenchmarkHover(false)}
            >
              <div 
                className="w-3 h-0.5 rounded" 
                style={{ backgroundColor: 'hsl(30, 100%, 50%)', opacity: isHoveringBenchmark ? 1 : 0.6 }} 
              />
              <span className="text-foreground">Benchmark</span>
              {showWarning ? (
                <AlertTriangle className="w-3 h-3 text-warning" />
              ) : (
                <HelpCircle className="w-3 h-3 text-muted-foreground" />
              )}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-md">
              <p className="text-xs whitespace-pre-line">{benchmarkDescription}{staleInfo}</p>
            </TooltipContent>
          </UITooltip>
        )}
        {isAdmin && showWarning && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-warning hover:text-warning"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Aggiornando...' : 'Aggiorna'}
          </Button>
        )}
      </div>
      
      {/* Right side: Time range selector + Currency toggle */}
      <div className="flex items-center gap-3">
        {/* Time range selector */}
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {(['1M', '3M', '6M', '1Y', '2Y', '3Y', 'MAX', 'YTD'] as const).map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange(range)}
              className={cn(
                "px-2 py-0.5 text-xs transition-colors",
                timeRange === range 
                  ? "bg-primary text-primary-foreground" 
                  : "hover:bg-muted text-foreground"
              )}
            >
              {range === 'MAX' || range === 'YTD' ? range : range.replace('Y', 'A')}
            </button>
          ))}
        </div>
        
        {/* Currency toggle */}
        {isAdmin && hasBenchmarkData && hasUsdData && (
          <UITooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <label 
                  htmlFor="currency-adjusted" 
                  className="text-xs text-foreground cursor-pointer flex items-center gap-1"
                >
                  Currency
                  <HelpCircle className="w-3 h-3 text-muted-foreground" />
                </label>
                <Switch
                  id="currency-adjusted"
                  checked={currencyAdjusted}
                  onCheckedChange={onCurrencyAdjustedChange}
                  className="h-4 w-7 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              <p className="text-xs whitespace-pre-line">{currencyTooltip}</p>
            </TooltipContent>
          </UITooltip>
        )}
      </div>
    </div>
  );
}

export function PerformanceEvolutionChart({
  historicalData,
  viewMode,
  currentValue,
  currentDate,
  deposits,
}: PerformanceEvolutionChartProps) {
  const { isAdmin } = useAuth();
  const [isHoveringBenchmark, setIsHoveringBenchmark] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currencyAdjusted, setCurrencyAdjusted] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');
  
  // Get equity exposure for BENCHMARK only (admin-only, skip for non-admin)
  const { equityExposurePct, equityExposureEUR, assetsTotalEUR, hasData: hasEquityData } = useEquityExposurePct({
    includeNakedPut: false,
    includeStrategies: false,
    includeLeapCall: false
  });
  
  // Get USD exposure for currency adjustment (admin-only optimization: data still fetched but benchmark won't render)
  const { usdExposurePct, totalExposure: usdTotalExposure, isLoading: isUsdLoading } = useCurrencyExposure({ 
    includeProtections: false, 
    includeNakedPut: false, 
    includeStrategies: false, 
    includeLeapCall: false, 
    includeBonds: true 
  });
  const hasUsdData = !isUsdLoading && usdTotalExposure > 0;
  
  // Latest saved snapshot date — used only to decide whether to append vs override
  const latestSnapshotDate = useMemo(() => {
    if (historicalData.length === 0) return null;
    return new Date(Math.max(...historicalData.map(d => new Date(d.snapshot_date).getTime())));
  }, [historicalData]);

  // The current live point should ALWAYS be reflected on the chart when available.
  // Snapshot saved for the same date may be stale (e.g. saved before GP upload or
  // before underlying prices refresh): the live value is the source of truth for "today".
  const hasLiveCurrent = !!currentDate && currentValue > 0;

  // Filter historical data based on time range
  const filteredHistoricalData = useMemo(() => {
    if (timeRange === 'MAX') return historicalData;
    
    const now = new Date();
    let cutoffDate: Date;
    switch (timeRange) {
      case '1M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case '3M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1Y': cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case '2Y': cutoffDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break;
      case '3Y': cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()); break;
      case 'YTD': cutoffDate = new Date(now.getFullYear(), 0, 1); break;
      default: cutoffDate = new Date(0); break;
    }
    
    return historicalData.filter(entry => 
      new Date(entry.snapshot_date) >= cutoffDate
    );
  }, [historicalData, timeRange]);
  
  // For benchmark: pass currentDate when we have a live point to anchor it
  const effectiveCurrentDateForBenchmark = hasLiveCurrent ? currentDate : null;
  
  // Fetch benchmark data with real equity exposure and currency adjustment
  const { benchmarkReturns, hasBenchmarkData, dataGaps, staleSummary, refreshBenchmark } = useBenchmarkData(
    filteredHistoricalData, 
    viewMode, 
    effectiveCurrentDateForBenchmark,
    hasEquityData ? equityExposurePct : null,
    hasUsdData ? usdExposurePct : null,
    currencyAdjusted
  );
  
  // Log warning if there are data gaps
  if (dataGaps && dataGaps.length > 0) {
    console.warn('[Benchmark] Data gaps detected:', dataGaps);
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshBenchmark();
      toast.success('Dati benchmark aggiornati');
    } catch (error) {
      console.error('[Benchmark] Refresh error:', error);
      toast.error('Errore nell\'aggiornamento del benchmark');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter deposits based on time range
  const filteredDeposits = useMemo(() => {
    if (timeRange === 'MAX') return deposits;
    
    const now = new Date();
    let cutoffDate: Date;
    switch (timeRange) {
      case '1M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case '3M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6M': cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case '1Y': cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case '2Y': cutoffDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break;
      case '3Y': cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()); break;
      case 'YTD': cutoffDate = new Date(now.getFullYear(), 0, 1); break;
      default: cutoffDate = new Date(0); break;
    }
    
    return deposits.filter(d => new Date(d.deposit_date) >= cutoffDate);
  }, [deposits, timeRange]);

  const chartData = useMemo(() => {
    if (filteredHistoricalData.length === 0) return [];

    // Sort by date ascending
    const sorted = [...filteredHistoricalData].sort(
      (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );

    const initialEntry = sorted[0];
    const initialValue = getValueForViewMode(initialEntry, viewMode);
    const initialDate = new Date(initialEntry.snapshot_date);

    // Calculate cumulative deposits for each snapshot
    const sortedDeposits = [...filteredDeposits].sort(
      (a, b) => new Date(a.deposit_date).getTime() - new Date(b.deposit_date).getTime()
    );

    // Create a map of benchmark returns by date with full details
    const benchmarkByDate: Record<string, {
      scaledReturn: number;
      equityReturn: number;
      bondReturn: number;
      equityPctUsed?: number;
      eurusdVariation?: number;
      usdPctUsed?: number;
    }> = {};
    benchmarkReturns.forEach((br) => {
      benchmarkByDate[br.date] = {
        scaledReturn: br.scaledReturn,
        equityReturn: br.equityReturn,
        bondReturn: br.bondReturn,
        equityPctUsed: br.equityPctUsed,
        eurusdVariation: br.eurusdVariation,
        usdPctUsed: br.usdPctUsed,
      };
    });

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

      // Time-weighted average balance from initial date to this snapshot
      const avgBalance = calculateTimeWeightedAverage(
        initialDate, snapshotDate, initialValue, sortedDeposits
      ).average;

      // Return % = P/L / average balance * 100
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      const bm = benchmarkByDate[entry.snapshot_date];
      return {
        date: entry.snapshot_date,
        timestamp: snapshotDate.getTime(),
        formattedDate: format(parseISO(entry.snapshot_date), "dd MMM ''yy", { locale: it }),
        value,
        returnPct,
        cumulativeDeposits,
        benchmarkReturn: bm?.scaledReturn,
        benchmarkEquityReturn: bm?.equityReturn,
        benchmarkBondReturn: bm?.bondReturn,
        benchmarkEquityPctUsed: bm?.equityPctUsed,
        benchmarkEurusdVariation: bm?.eurusdVariation,
        benchmarkUsdPctUsed: bm?.usdPctUsed,
      };
    });

    // Reflect the current live point on the chart whenever available:
    // - if a snapshot already exists for the same date, OVERRIDE its value/return
    //   with the live one (snapshot may be stale, e.g. saved before GP/prices update)
    // - otherwise append a new point if it's the most recent date
    if (hasLiveCurrent && currentDate) {
      const currentDateObj = new Date(currentDate);
      const cumulativeDeposits = sortedDeposits
        .filter((d) => {
          const depositDate = new Date(d.deposit_date);
          return depositDate > initialDate && depositDate <= currentDateObj;
        })
        .reduce((sum, d) => sum + d.amount, 0);

      const pl = currentValue - initialValue - cumulativeDeposits;
      const avgBalance = calculateTimeWeightedAverage(
        initialDate, currentDateObj, initialValue, sortedDeposits
      ).average;
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      const bmCurrent = benchmarkByDate[currentDate];
      const liveBenchmark = {
        benchmarkReturn: bmCurrent?.scaledReturn,
        benchmarkEquityReturn: bmCurrent?.equityReturn,
        benchmarkBondReturn: bmCurrent?.bondReturn,
        benchmarkEquityPctUsed: bmCurrent?.equityPctUsed,
        benchmarkEurusdVariation: bmCurrent?.eurusdVariation,
        benchmarkUsdPctUsed: bmCurrent?.usdPctUsed,
      };

      const existingIdx = data.findIndex(d => d.date === currentDate);
      if (existingIdx >= 0) {
        data[existingIdx] = {
          ...data[existingIdx],
          value: currentValue,
          returnPct,
          cumulativeDeposits,
          ...liveBenchmark,
        };
      } else {
        const isNewest = !latestSnapshotDate || new Date(currentDate) >= latestSnapshotDate;
        if (isNewest) {
          data.push({
            date: currentDate,
            timestamp: currentDateObj.getTime(),
            formattedDate: format(parseISO(currentDate), "dd MMM ''yy", { locale: it }),
            value: currentValue,
            returnPct,
            cumulativeDeposits,
            ...liveBenchmark,
          });
        }
      }
    }

    // Ensure chronological order as a safety measure
    data.sort((a, b) => a.timestamp - b.timestamp);

    // Downsample with temporal buckets — aggressive reduction for smoother curves
    const maxPoints = (timeRange === '1M') ? 10
      : (timeRange === '3M') ? 12
      : (timeRange === '6M') ? 14
      : (timeRange === '1Y') ? 18
      : (timeRange === '2Y') ? 22
      : 24; // 3Y, MAX, YTD
    const preserveTs = currentDate ? new Date(currentDate).getTime() : undefined;
    return downsampleData(data, maxPoints, preserveTs);
  }, [filteredHistoricalData, viewMode, currentValue, currentDate, filteredDeposits, benchmarkReturns, timeRange, hasLiveCurrent, latestSnapshotDate]);

  if (chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Nessun dato storico disponibile
      </div>
    );
  }

  // Dynamic benchmark opacity based on hover state
  const benchmarkOpacity = isHoveringBenchmark ? 1 : 0.6;
  const benchmarkStrokeWidth = isHoveringBenchmark ? 2.5 : 1.5;

  return (
    <div className="h-full flex flex-col">
      <CustomLegend 
        hasBenchmarkData={hasBenchmarkData} 
        isHoveringBenchmark={isHoveringBenchmark}
        onBenchmarkHover={setIsHoveringBenchmark}
        hasDataGaps={dataGaps && dataGaps.length > 0}
        staleSummary={staleSummary}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        equityExposurePct={equityExposurePct}
        equityExposureEUR={equityExposureEUR}
        assetsTotalEUR={assetsTotalEUR}
        hasEquityData={hasEquityData}
        currencyAdjusted={currencyAdjusted}
        onCurrencyAdjustedChange={setCurrencyAdjusted}
        usdExposurePct={usdExposurePct}
        hasUsdData={hasUsdData}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        isAdmin={isAdmin}
      />
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={computeTimeTicks(chartData)}
              tickFormatter={formatTickDate}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickFormatter={(value) => `${value.toFixed(1)}%`}
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
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                
                const dataPoint = payload[0]?.payload as ChartDataPoint | undefined;
                if (!dataPoint) return null;

                const hasBenchmark = dataPoint.benchmarkReturn !== undefined;
                const equityPct = dataPoint.benchmarkEquityPctUsed ?? 0;
                const bondPct = 1 - equityPct;
                
                // Calculate scaled USD return (before currency adjustment)
                const scaledUsdReturn = equityPct * (dataPoint.benchmarkEquityReturn ?? 0) 
                  + bondPct * (dataPoint.benchmarkBondReturn ?? 0);

                return (
                  <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                    <p className="text-foreground font-medium text-sm mb-2">Data: {formatTooltipDate(label as number)}</p>
                    
                    {/* Portfolio return */}
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-profit" />
                      <span className="text-foreground text-xs">
                        Rendimento: <span className="font-medium">{dataPoint.returnPct.toFixed(2)}%</span>
                      </span>
                    </div>
                    
                    {/* Benchmark with breakdown (admin only) */}
                    {isAdmin && hasBenchmark && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(30, 100%, 50%)' }} />
                          <span className="text-foreground text-xs">
                            {currencyAdjusted ? 'Benchmark (Adj.)' : 'Benchmark'}: 
                            <span className="font-medium ml-1">{dataPoint.benchmarkReturn?.toFixed(2)}%</span>
                          </span>
                        </div>
                        
                        {/* Benchmark breakdown details */}
                        <div className="ml-4 mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                          <div className="flex justify-between gap-4">
                            <span>├─ Equity (USD):</span>
                            <span className="font-mono">{dataPoint.benchmarkEquityReturn?.toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span>├─ Bond (USD):</span>
                            <span className="font-mono">{dataPoint.benchmarkBondReturn?.toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span>├─ Peso Equity:</span>
                            <span className="font-mono">{(equityPct * 100).toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span>├─ Rend. Bnchmrk USD:</span>
                            <span className="font-mono">{scaledUsdReturn.toFixed(2)}%</span>
                          </div>
                          {currencyAdjusted && dataPoint.benchmarkUsdPctUsed !== undefined && (
                            <div className="flex justify-between gap-4">
                              <span>├─ Exp. USD:</span>
                              <span className="font-mono">{(dataPoint.benchmarkUsdPctUsed * 100).toFixed(1)}%</span>
                            </div>
                          )}
                          {currencyAdjusted && dataPoint.benchmarkEurusdVariation !== undefined && (
                            <div className="flex justify-between gap-4">
                              <span>├─ Var. EUR/USD:</span>
                              <span className="font-mono">{dataPoint.benchmarkEurusdVariation.toFixed(2)}%</span>
                            </div>
                          )}
                          <div className="flex justify-between gap-4 font-medium text-foreground">
                            <span>└─ Rend. EUR:</span>
                            <span className="font-mono">{dataPoint.benchmarkReturn?.toFixed(2)}%</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="returnPct"
              stroke="hsl(var(--profit))"
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, index } = props;
                if (index === 0 || index === chartData.length - 1) {
                  return <circle cx={cx} cy={cy} r={3} fill="hsl(var(--profit))" />;
                }
                return <circle cx={cx} cy={cy} r={0} />;
              }}
              activeDot={{ r: 4, strokeWidth: 0 }}
              name="returnPct"
            />
            {isAdmin && hasBenchmarkData && (
              <Line
                type="monotone"
                dataKey="benchmarkReturn"
                stroke="hsl(30, 100%, 50%)"
                strokeWidth={benchmarkStrokeWidth}
                strokeOpacity={benchmarkOpacity}
                dot={false}
                activeDot={{ r: 4, fill: 'hsl(30, 100%, 50%)' }}
                name="benchmarkReturn"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
