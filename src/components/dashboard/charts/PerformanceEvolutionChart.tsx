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

type TimeRange = '1Y' | '2Y' | '3Y' | 'MAX';

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
  returnPct: number;
  cumulativeDeposits: number;
  benchmarkReturn?: number;
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
        {hasBenchmarkData && (
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
        {showWarning && (
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
          {(['1Y', '2Y', '3Y', 'MAX'] as const).map((range) => (
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
              {range === 'MAX' ? 'MAX' : range.replace('Y', 'A')}
            </button>
          ))}
        </div>
        
        {/* Currency toggle */}
        {hasBenchmarkData && hasUsdData && (
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
  const [isHoveringBenchmark, setIsHoveringBenchmark] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currencyAdjusted, setCurrencyAdjusted] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('MAX');
  
  // Get equity exposure for BENCHMARK only: protections on, all derivatives off
  // This ensures a fair comparison with direct equity holdings (SPY/QQQ/AGG)
  const { equityExposurePct, equityExposureEUR, assetsTotalEUR, hasData: hasEquityData } = useEquityExposurePct({
    includeNakedPut: false,
    includeStrategies: false,
    includeLeapCall: false
  });
  
  // Get USD exposure for currency adjustment (derivatives excluded, bonds included)
  const { usdExposurePct, totalExposure: usdTotalExposure, isLoading: isUsdLoading } = useCurrencyExposure({ 
    includeProtections: false, 
    includeNakedPut: false, 
    includeStrategies: false, 
    includeLeapCall: false, 
    includeBonds: true 
  });
  const hasUsdData = !isUsdLoading && usdTotalExposure > 0;
  
  // Calculate the latest snapshot date from ALL historical data (not filtered)
  // This is used to determine if currentDate is really the newest
  const latestSnapshotDate = useMemo(() => {
    if (historicalData.length === 0) return null;
    return new Date(Math.max(...historicalData.map(d => new Date(d.snapshot_date).getTime())));
  }, [historicalData]);

  // Determine if we can append the current point (only if it's newer than the latest saved snapshot)
  const canAppendCurrent = useMemo(() => {
    if (!currentDate || currentValue <= 0) return false;
    if (!latestSnapshotDate) return true; // No historical data, so current is newest
    return new Date(currentDate) > latestSnapshotDate;
  }, [currentDate, currentValue, latestSnapshotDate]);

  // Filter historical data based on time range
  const filteredHistoricalData = useMemo(() => {
    if (timeRange === 'MAX') return historicalData;
    
    const now = new Date();
    const years = timeRange === '1Y' ? 1 : timeRange === '2Y' ? 2 : 3;
    const cutoffDate = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
    
    return historicalData.filter(entry => 
      new Date(entry.snapshot_date) >= cutoffDate
    );
  }, [historicalData, timeRange]);
  
  // For benchmark: only pass currentDate if it's actually the newest
  const effectiveCurrentDateForBenchmark = canAppendCurrent ? currentDate : null;
  
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
    const years = timeRange === '1Y' ? 1 : timeRange === '2Y' ? 2 : 3;
    const cutoffDate = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
    
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

    // Create a map of benchmark returns by date
    const benchmarkByDate: Record<string, number> = {};
    benchmarkReturns.forEach((br) => {
      benchmarkByDate[br.date] = br.scaledReturn;
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

      // Use average balance from entry if available, otherwise use initial value + half deposits
      const avgBalance = entry.average_balance > 0 
        ? entry.average_balance 
        : initialValue + cumulativeDeposits / 2;

      // Return % = P/L / average balance * 100
      const returnPct = avgBalance > 0 ? (pl / avgBalance) * 100 : 0;

      return {
        date: entry.snapshot_date,
        formattedDate: format(parseISO(entry.snapshot_date), "dd MMM ''yy", { locale: it }),
        value,
        returnPct,
        cumulativeDeposits,
        benchmarkReturn: benchmarkByDate[entry.snapshot_date],
      };
    });

    // Add current point ONLY if it's newer than the latest saved snapshot and not a duplicate
    if (canAppendCurrent && currentDate && !data.some(d => d.date === currentDate)) {
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
        formattedDate: format(parseISO(currentDate), "dd MMM ''yy", { locale: it }),
        value: currentValue,
        returnPct,
        cumulativeDeposits,
        benchmarkReturn: benchmarkByDate[currentDate],
      });
    }

    // Ensure chronological order as a safety measure
    data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return data;
  }, [filteredHistoricalData, viewMode, currentValue, currentDate, filteredDeposits, benchmarkReturns, timeRange, canAppendCurrent]);

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
      />
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="formattedDate"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              interval={0}
              type="category"
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
              formatter={(value: number, name: string) => {
                if (name === 'returnPct') return [`${value.toFixed(2)}%`, 'Rendimento'];
                if (name === 'benchmarkReturn') {
                  const label = currencyAdjusted ? 'Benchmark (Adj.)' : 'Benchmark';
                  return [`${value.toFixed(2)}%`, label];
                }
                return [value, name];
              }}
              labelFormatter={(label) => `Data: ${label}`}
            />
            <Line
              type="monotone"
              dataKey="returnPct"
              stroke="hsl(var(--profit))"
              strokeWidth={2}
              dot={{ r: 3, fill: 'hsl(var(--profit))' }}
              activeDot={{ r: 5 }}
              name="returnPct"
            />
            {hasBenchmarkData && (
              <Line
                type="monotone"
                dataKey="benchmarkReturn"
                stroke="hsl(30, 100%, 50%)"
                strokeWidth={benchmarkStrokeWidth}
                strokeOpacity={benchmarkOpacity}
                dot={{ r: 2, fill: 'hsl(30, 100%, 50%)', fillOpacity: benchmarkOpacity }}
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
