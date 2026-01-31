import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { HistoricalDataEntry } from '@/types/historicalData';
import { formatCurrency, formatProfitLoss, formatPercentage, formatDate } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, Landmark, Target, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewMode } from './ViewModeSelector';
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
}: StatsCardsProps) {
  const initialValue = portfolio?.initial_value || 0;
  const deposits = portfolio?.deposits || 0;
  const averageBalance = portfolio?.average_balance || 0;
  const initialDate = portfolio?.initial_date;
  const averageBalanceDate = portfolio?.average_balance_date;
  const initialPlusDeposits = initialValue + deposits;
  
  const hasInitialData = initialValue > 0;
  const hasAverageBalance = averageBalance > 0;
  
  // Find selected historical entry
  const selectedHistoricalEntry = selectedHistoricalDate 
    ? historicalData.find(h => h.snapshot_date === selectedHistoricalDate) 
    : null;
  const hasHistoricalData = selectedHistoricalEntry !== null;
  
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
      const percentPL = hasAverageBalance ? (absolutePL / averageBalance) * 100 : 0;
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

    // P/L = Current Value - Historical Value
    const absolutePL = currentValue - historicalValue;
    
    // Use historical average balance for percentage calculation
    const avgBalance = historical.average_balance || historicalValue;
    const percentPL = avgBalance > 0 ? (absolutePL / avgBalance) * 100 : 0;
    
    return { absolute: absolutePL, percent: percentPL };
  };

  const patrimonioValue = getPatrimonioValue();
  const plData = calculatePL();
  const plAbsolute = plData.absolute;
  const plPercent = plData.percent;
  const canCalculatePL = hasInitialData || hasHistoricalData;

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
      label: 'Patrimonio Iniziale + Versamenti',
      value: hasInitialData ? formatCurrency(initialPlusDeposits) : '—',
      icon: Target,
      change: null,
      dimmed: !hasInitialData,
      subtext: initialDate ? `al ${formatDate(initialDate)}` : null,
    },
    {
      key: 'giacenza',
      label: 'Giacenza Media',
      value: hasAverageBalance ? formatCurrency(averageBalance) : '—',
      icon: Landmark,
      change: null,
      dimmed: !hasAverageBalance,
      subtext: initialDate && averageBalanceDate 
        ? `dal ${formatDate(initialDate)} al ${formatDate(averageBalanceDate)}` 
        : null,
    },
    {
      key: 'pl',
      label: VIEW_LABELS[viewMode].pl,
      value: canCalculatePL ? formatProfitLoss(plAbsolute) : '—',
      icon: plAbsolute >= 0 ? TrendingUp : TrendingDown,
      change: canCalculatePL && (hasAverageBalance || hasHistoricalData) ? formatPercentage(plPercent) : null,
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
                stat.dimmed 
                  ? 'text-muted-foreground'
                  : stat.isProfit !== undefined 
                    ? stat.isProfit 
                      ? 'text-profit' 
                      : 'text-loss'
                    : ''
              )}>
                {stat.value}
              </p>
              {stat.subtext && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stat.subtext}
                </p>
              )}
              {stat.change && (
                <p className={cn(
                  "text-xs font-mono mt-1",
                  stat.isProfit ? 'text-profit' : 'text-loss'
                )}>
                  {stat.change}
                </p>
              )}
              {stat.hasDateSelector && historicalData.length > 0 && (
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
              stat.dimmed
                ? 'bg-muted/10 text-muted-foreground'
                : stat.isProfit !== undefined
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
