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
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

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

// Custom legend component with benchmark tooltip
function CustomLegend({ 
  hasBenchmarkData, 
  viewMode,
  isHoveringBenchmark,
  onBenchmarkHover,
  hasDataGaps,
  staleSummary,
  onRefresh,
  isRefreshing,
}: { 
  hasBenchmarkData: boolean; 
  viewMode: ViewMode;
  isHoveringBenchmark: boolean;
  onBenchmarkHover: (hovering: boolean) => void;
  hasDataGaps: boolean;
  staleSummary: BenchmarkStaleSummary[];
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const benchmarkDescription = viewMode === 'base' 
    ? 'Media ponderata di MSCI World (URTH), S&P 500 (SPY), MSCI ACWI (ACWI), Stoxx 600 (EXSA.DE). Benchmark scalato al 60% equity per la vista base.'
    : 'Benchmark dinamico basato sull\'esposizione equity:\n• Esposizione equity ≥90% → 100% equity (media URTH, SPY, ACWI, EXSA.DE)\n• Esposizione equity 40-60% → 50% SPY + 50% AGG (bond)\n• Valori intermedi → blend proporzionale';

  const staleInfo = formatStaleSummary(staleSummary);
  const showWarning = hasDataGaps || staleSummary.length > 0;

  return (
    <div className="flex items-center justify-center gap-4 text-xs mb-2">
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
  
  // Fetch benchmark data
  const { benchmarkReturns, hasBenchmarkData, dataGaps, staleSummary, refreshBenchmark } = useBenchmarkData(historicalData, viewMode, currentDate);
  
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
        formattedDate: format(parseISO(entry.snapshot_date), 'MMM yy', { locale: it }),
        value,
        returnPct,
        cumulativeDeposits,
        benchmarkReturn: benchmarkByDate[entry.snapshot_date],
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
          returnPct,
          cumulativeDeposits,
          benchmarkReturn: benchmarkByDate[currentDate],
        });
      }
    }

    return data;
  }, [historicalData, viewMode, currentValue, currentDate, deposits, benchmarkReturns]);

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
        viewMode={viewMode}
        isHoveringBenchmark={isHoveringBenchmark}
        onBenchmarkHover={setIsHoveringBenchmark}
        hasDataGaps={dataGaps && dataGaps.length > 0}
        staleSummary={staleSummary}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="formattedDate"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
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
              formatter={(value: number, name: string) => {
                if (name === 'returnPct') return [`${value.toFixed(2)}%`, 'Rendimento'];
                if (name === 'benchmarkReturn') return [`${value.toFixed(2)}%`, 'Benchmark'];
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
