import { useEffect } from 'react';
import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { HistoricalDataEntry } from '@/types/historicalData';
import { formatCurrency, formatProfitLoss, formatPercentage, formatDate } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, Target, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewMode } from './ViewModeSelector';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface StatsCardsProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
  nettingTotal: number;
  nettingExCC: number;
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
}

const VIEW_LABELS: Record<ViewMode, { patrimonio: string; pl: string }> = {
  base: { patrimonio: 'Patrimonio Totale', pl: 'Profitto/Perdita' },
  netting_total: { patrimonio: 'Patrimonio (Netting Totale)', pl: 'P/L (Netting Totale)' },
  netting_ex_cc: { patrimonio: 'Patrimonio (Netting ex CC)', pl: 'P/L (Netting ex CC)' },
};

export function StatsCards({ 
  summary, 
  portfolio, 
  nettingTotal, 
  nettingExCC, 
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
}: StatsCardsProps) {
  const initialValue = portfolio?.initial_value || 0;
  const portfolioDeposits = portfolio?.deposits || 0;
  const portfolioAverageBalance = portfolio?.average_balance || 0;
  const initialDate = portfolio?.initial_date;
  const averageBalanceDate = portfolio?.average_balance_date;
  const initialPlusDeposits = initialValue + portfolioDeposits;
  
  const hasInitialData = initialValue > 0;
  const hasPortfolioAverageBalance = portfolioAverageBalance > 0;
  
  // Find selected historical entry
  const selectedHistoricalEntry = selectedHistoricalDate 
    ? historicalData.find(h => h.snapshot_date === selectedHistoricalDate) 
    : null;
  const hasHistoricalData = selectedHistoricalEntry !== null;
  
  // Auto-calculate average balance when historical data, deposits, or viewMode changes
  useEffect(() => {
    if (isManualAverageBalance) return;
    
    if (!selectedHistoricalEntry) {
      onAverageBalanceChange(0);
      return;
    }
    
    // Get historical value based on viewMode
    let historicalValue: number;
    switch (viewMode) {
      case 'netting_total':
        historicalValue = selectedHistoricalEntry.netting_total;
        break;
      case 'netting_ex_cc':
        historicalValue = selectedHistoricalEntry.netting_ex_cc;
        break;
      default:
        historicalValue = selectedHistoricalEntry.total_value;
    }
    
    // Calculate average balance
    const calculatedAverage = deposits > 0 
      ? historicalValue + (deposits / 2) 
      : historicalValue;
    
    onAverageBalanceChange(calculatedAverage);
  }, [selectedHistoricalEntry, deposits, viewMode, isManualAverageBalance, onAverageBalanceChange]);
  
  // Patrimonio value based on viewMode
  const getPatrimonioValue = () => {
    switch (viewMode) {
      case 'netting_total': return nettingTotal;
      case 'netting_ex_cc': return nettingExCC;
      default: return summary.totalValue;
    }
  };

  // P/L calculation based on historical data and viewMode
  const calculatePL = () => {
    if (!hasHistoricalData) {
      // Fallback to old calculation if no historical data selected
      if (!hasInitialData) return { absolute: 0, percent: 0 };
      const absolutePL = summary.totalValue - initialPlusDeposits;
      const percentPL = hasPortfolioAverageBalance ? (absolutePL / portfolioAverageBalance) * 100 : 0;
      return { absolute: absolutePL, percent: percentPL };
    }

    const historical = selectedHistoricalEntry!;
    let currentValue: number;
    let historicalValue: number;

    switch (viewMode) {
      case 'netting_total':
        currentValue = nettingTotal;
        historicalValue = historical.netting_total;
        break;
      case 'netting_ex_cc':
        currentValue = nettingExCC;
        historicalValue = historical.netting_ex_cc;
        break;
      default:
        currentValue = summary.totalValue;
        historicalValue = historical.total_value;
    }

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
  const canCalculatePL = hasInitialData || hasHistoricalData;

  const parseInputValue = (val: string): number => {
    return parseFloat(val.replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0;
  };

  const stats = [
    {
      key: 'patrimonio',
      label: VIEW_LABELS[viewMode].patrimonio,
      value: formatCurrency(patrimonioValue),
      icon: Wallet,
      change: null,
      subtext: null,
    },
    {
      key: 'iniziale',
      label: 'Patrimonio Iniziale',
      value: hasHistoricalData 
        ? formatCurrency(
            viewMode === 'netting_total' 
              ? selectedHistoricalEntry!.netting_total 
              : viewMode === 'netting_ex_cc' 
                ? selectedHistoricalEntry!.netting_ex_cc 
                : selectedHistoricalEntry!.total_value
          )
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
      subtext: null,
    },
    {
      key: 'pl',
      label: VIEW_LABELS[viewMode].pl,
      value: canCalculatePL ? formatProfitLoss(plAbsolute) : '—',
      icon: plAbsolute >= 0 ? TrendingUp : TrendingDown,
      change: canCalculatePL && (hasPortfolioAverageBalance || (hasHistoricalData && averageBalance > 0)) ? formatPercentage(plPercent) : null,
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
              {'subtext' in stat && stat.subtext && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stat.subtext}
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
              
              {'hasDateSelector' in stat && stat.hasDateSelector && (
                <div className="mt-2">
                  <Select
                    value={selectedHistoricalDate || 'none'}
                    onValueChange={(value) => onHistoricalDateChange(value === 'none' ? null : value)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <Calendar className="w-3 h-3 mr-1" />
                      <SelectValue placeholder="Data riferimento" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nessuna data</SelectItem>
                      {historicalData.map((entry) => (
                        <SelectItem key={entry.id} value={entry.snapshot_date}>
                          {formatDate(entry.snapshot_date)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
