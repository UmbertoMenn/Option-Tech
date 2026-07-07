import { useEffect, useState, useMemo } from 'react';
import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { HistoricalDataEntry } from '@/types/historicalData';
import { DepositEntry } from '@/types/deposits';
import { formatCurrency, formatProfitLoss, formatPercentage, formatDate } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, Target, Calendar, Pencil, Check, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewMode } from './ViewModeSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { differenceInDays, parseISO, format } from 'date-fns';
import { it } from 'date-fns/locale';
import { DateSelectorDual } from './DateSelectorDual';

interface StatsCardsProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
  nettingTotal: number;
  nettingIntrinsicA: number;
  nettingIntrinsicB: number;
  viewMode: ViewMode;
  historicalData: HistoricalDataEntry[];
  selectedHistoricalDate: string | null;
  onHistoricalDateChange: (date: string | null) => void;
  deposits: number;
  averageBalance: number;
  isManualAverageBalance: boolean;
  onDepositsChange: (value: number) => void;
  onAverageBalanceChange: (value: number) => void;
  onManualAverageBalanceToggle: (isManual: boolean) => void;
  allDeposits: DepositEntry[];
}

/**
 * Calculate time-weighted average balance
 * Each balance level is weighted by the number of days it was held
 */
import { calculateTimeWeightedAverage } from '@/lib/timeWeightedAverage';

const VIEW_LABELS: Record<ViewMode, { patrimonio: string; pl: string }> = {
  netting_total: { patrimonio: 'Patrimonio (Netting Totale)', pl: 'P/L (Netting Totale)' },
  netting_intrinsic_a: { patrimonio: 'Patrimonio (Netting Intrinseco A)', pl: 'P/L (Netting Intrinseco A)' },
  netting_intrinsic_b: { patrimonio: 'Patrimonio (Netting Intrinseco B)', pl: 'P/L (Netting Intrinseco B)' },
};

export function StatsCards({ 
  summary, 
  portfolio, 
  nettingTotal, 
  nettingIntrinsicA,
  nettingIntrinsicB,
  viewMode,
  historicalData,
  selectedHistoricalDate,
  onHistoricalDateChange,
  deposits,
  averageBalance,
  isManualAverageBalance,
  onDepositsChange,
  onAverageBalanceChange,
  onManualAverageBalanceToggle,
  allDeposits,
}: StatsCardsProps) {
  const { isAggregatedView } = usePortfolioContext();
  const [isEditingGiacenza, setIsEditingGiacenza] = useState(false);
  const [giacenzaInputValue, setGiacenzaInputValue] = useState('');
  // Legacy fields removed - only use historical_data for P/L calculations
  
  // Find selected historical entry
  const selectedHistoricalEntry = selectedHistoricalDate 
    ? historicalData.find(h => h.snapshot_date === selectedHistoricalDate) 
    : null;
  const hasHistoricalData = !!selectedHistoricalEntry;

  // Get the snapshot date from portfolio (extracted from Excel)
  const snapshotDate = portfolio?.snapshot_date;
  
  // Debug logging
  console.log('[StatsCards] Portfolio snapshot_date:', snapshotDate);
  console.log('[StatsCards] Selected historical entry:', selectedHistoricalEntry?.snapshot_date);
  console.log('[StatsCards] All deposits count:', allDeposits?.length);
  
  // Valore storico coerente con la vista corrente
  const historicalValueFor = (entry: typeof selectedHistoricalEntry): number => {
    if (!entry) return 0;
    switch (viewMode) {
      case 'netting_intrinsic_a':
        return entry.netting_ex_cc_np ?? entry.netting_ex_cc;
      case 'netting_intrinsic_b':
        return entry.netting_intrinsic_b ?? entry.netting_ex_cc_np ?? entry.netting_ex_cc;
      case 'netting_total':
      default:
        return entry.netting_total;
    }
  };

  // Calculate time-weighted average and deposits in period
  const timeWeightedData = useMemo(() => {
    if (!selectedHistoricalEntry || !snapshotDate) {
      console.log('[StatsCards] Cannot calculate: missing', !selectedHistoricalEntry ? 'historicalEntry' : 'snapshotDate');
      return { average: 0, totalDeposits: 0 };
    }

    const startDate = parseISO(selectedHistoricalEntry.snapshot_date);
    // Il valore "attuale" del portafoglio è quello LIVE (di oggi), non quello dell'ultimo
    // snapshot salvato. Di conseguenza il periodo entro cui scorporare i movimenti
    // (versamenti/prelievi) deve arrivare fino a OGGI, non fermarsi alla data dello
    // snapshot: un prelievo registrato dopo l'ultimo snapshot deve comunque contare,
    // altrimenti il rendimento non si aggiorna quando si aggiunge un movimento recente.
    const snapshotEnd = parseISO(snapshotDate);
    const today = new Date();
    const endDate = today > snapshotEnd ? today : snapshotEnd;

    console.log('[StatsCards] Calculating time-weighted average:', {
      startDate: selectedHistoricalEntry.snapshot_date,
      endDate: snapshotDate,
      depositsCount: allDeposits?.length
    });

    // Get historical value based on viewMode
    const historicalValue = historicalValueFor(selectedHistoricalEntry);

    const result = calculateTimeWeightedAverage(startDate, endDate, historicalValue, allDeposits);
    console.log('[StatsCards] Time-weighted result:', result);
    return result;
  }, [selectedHistoricalEntry, snapshotDate, viewMode, allDeposits]);
  
  // Auto-calculate average balance when historical data changes (time-weighted)
  useEffect(() => {
    if (isManualAverageBalance) return;
    
    if (!selectedHistoricalEntry || !snapshotDate) {
      onAverageBalanceChange(0);
      onDepositsChange(0);
      return;
    }
    
    onAverageBalanceChange(timeWeightedData.average);
    onDepositsChange(timeWeightedData.totalDeposits);
  }, [selectedHistoricalEntry, snapshotDate, timeWeightedData, isManualAverageBalance, onAverageBalanceChange, onDepositsChange]);
  
  // Patrimonio value based on viewMode
  const getPatrimonioValue = () => {
    switch (viewMode) {
      case 'netting_intrinsic_a': return nettingIntrinsicA;
      case 'netting_intrinsic_b': return nettingIntrinsicB;
      case 'netting_total':
      default: return nettingTotal;
    }
  };

  // P/L calculation based on historical data only
  const calculatePL = () => {
    // No historical data selected = no P/L calculation
    if (!hasHistoricalData) {
      return { absolute: 0, percent: 0 };
    }

    const historical = selectedHistoricalEntry!;
    const currentValue = getPatrimonioValue();
    const historicalValue = historicalValueFor(historical);

    // P/L = Current Value - Historical Value - Deposits
    const absolutePL = currentValue - historicalValue - deposits;
    
    // Rendimento % = P/L / Giacenza Media
    const percentPL = averageBalance > 0 ? (absolutePL / averageBalance) * 100 : 0;
    
    return { absolute: absolutePL, percent: percentPL };
  };

  const patrimonioValue = getPatrimonioValue();
  const plData = calculatePL();
  const plAbsolute = plData.absolute;
  const plPercent = plData.percent;
  const canCalculatePL = hasHistoricalData;

  const parseInputValue = (val: string): number => {
    // Support Italian number formats
    const cleaned = val.toString().replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
    if (!cleaned) return 0;
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/\./g, '');
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
  };

  const startEditGiacenza = () => {
    setGiacenzaInputValue(averageBalance > 0 ? averageBalance.toFixed(2) : '');
    setIsEditingGiacenza(true);
  };

  const saveGiacenza = () => {
    const newValue = parseInputValue(giacenzaInputValue);
    onManualAverageBalanceToggle(true);
    onAverageBalanceChange(newValue);
    setIsEditingGiacenza(false);
  };

  const cancelEditGiacenza = () => {
    setIsEditingGiacenza(false);
  };

  const stats = [
    {
      key: 'patrimonio',
      label: VIEW_LABELS[viewMode].patrimonio,
      value: formatCurrency(patrimonioValue),
      icon: Wallet,
      change: null,
      subtext: snapshotDate ? `al ${formatDate(snapshotDate)}` : null,
      // Liquidità vincolata (conti "A9...", garanzia operatività in derivati):
      // concorre alla liquidità totale, mostrata solo se > 1 €.
      extraSubtext: (summary.restrictedCashValue ?? 0) > 1
        ? `Liquidità vincolata: ${formatCurrency(summary.restrictedCashValue!)}`
        : null,
    },
    {
      key: 'iniziale',
      label: 'Patrimonio Iniziale',
      value: hasHistoricalData 
        ? formatCurrency(historicalValueFor(selectedHistoricalEntry!))
        : '—',
      icon: Target,
      change: null,
      dimmed: !hasHistoricalData,
      subtext: hasHistoricalData ? `al ${formatDate(selectedHistoricalEntry!.snapshot_date)}` : null,
    },
    {
      key: 'giacenza-media',
      label: 'Giacenza Media',
      value: averageBalance > 0 ? formatCurrency(averageBalance) : '—',
      icon: Wallet,
      change: null,
      dimmed: averageBalance === 0,
      subtext: isManualAverageBalance 
        ? 'modificato manualmente' 
        : deposits !== 0 
          ? deposits > 0 
            ? `Versamenti netti: ${formatCurrency(deposits)}`
            : `Prelievi netti: ${formatCurrency(Math.abs(deposits))}`
          : null,
      isEditable: !isAggregatedView, // Disabilita editing in vista aggregata
    },
    {
      key: 'pl',
      label: VIEW_LABELS[viewMode].pl,
      value: canCalculatePL ? formatProfitLoss(plAbsolute) : '—',
      icon: plAbsolute >= 0 ? TrendingUp : TrendingDown,
      change: canCalculatePL && averageBalance > 0 ? formatPercentage(plPercent) : null,
      isProfit: plAbsolute >= 0,
      dimmed: !canCalculatePL,
      subtext: null,
      hasDateSelector: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <div
          key={stat.key}
          className="stat-card animate-fade-in relative"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground truncate">{stat.label}</p>
              
              {'isEditable' in stat && stat.isEditable && isEditingGiacenza ? (
                <div className="mt-1 space-y-2">
                  <Input
                    type="text"
                    placeholder="0"
                    value={giacenzaInputValue}
                    onChange={(e) => setGiacenzaInputValue(e.target.value)}
                    className="h-8 text-sm font-mono"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveGiacenza();
                      if (e.key === 'Escape') cancelEditGiacenza();
                    }}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={saveGiacenza}>
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={cancelEditGiacenza}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <p className={cn(
                      "text-xl font-bold font-mono mt-1",
                      'dimmed' in stat && stat.dimmed 
                        ? 'text-muted-foreground'
                        : 'isProfit' in stat && stat.isProfit !== undefined 
                          ? stat.isProfit 
                            ? 'text-profit' 
                            : 'text-loss'
                          : ''
                    )}>
                      {'value' in stat ? stat.value : '—'}
                    </p>
                    {'isEditable' in stat && stat.isEditable && (
                      <div className="flex items-center gap-0.5">
                        {isManualAverageBalance && (
                          <button
                            onClick={() => {
                              onManualAverageBalanceToggle(false);
                              // Force recalculation by triggering the effect
                              onAverageBalanceChange(timeWeightedData.average);
                              onDepositsChange(timeWeightedData.totalDeposits);
                            }}
                            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                            title="Ricalcola automaticamente"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={startEditGiacenza}
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                          title="Modifica giacenza media"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {'subtext' in stat && stat.subtext && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {stat.subtext}
                    </p>
                  )}
                  {'extraSubtext' in stat && stat.extraSubtext && (
                    <p className="text-xs text-amber-500 mt-0.5" title="Liquidità a garanzia dell'operatività in derivati (inclusa nella liquidità totale)">
                      {stat.extraSubtext}
                    </p>
                  )}
                  {'change' in stat && stat.change && (
                    <p className={cn(
                      "text-xs font-mono mt-1",
                      'isProfit' in stat && stat.isProfit ? 'text-profit' : 'text-loss'
                    )}>
                      {stat.change}
                    </p>
                  )}
                </>
              )}
              
              {'hasDateSelector' in stat && stat.hasDateSelector && (
                <DateSelectorDual
                  historicalData={historicalData}
                  selectedDate={selectedHistoricalDate}
                  onDateChange={onHistoricalDateChange}
                />
              )}
            </div>
            <div className={cn(
              "p-2 rounded-lg",
              'dimmed' in stat && stat.dimmed
                ? 'bg-muted/10 text-muted-foreground'
                : 'isProfit' in stat && stat.isProfit !== undefined
                  ? stat.isProfit
                    ? 'bg-profit/10 text-profit'
                    : 'bg-loss/10 text-loss'
                  : 'bg-primary/10 text-primary'
            )}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
