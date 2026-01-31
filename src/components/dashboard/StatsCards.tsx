import { useState } from 'react';
import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { HistoricalDataEntry } from '@/types/historicalData';
import { formatCurrency, formatProfitLoss, formatPercentage, formatDate } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, Landmark, Target, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardsProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
  nettingTotal: number;
  nettingExCC: number;
  earliestHistoricalData: HistoricalDataEntry | null;
}

type PatrimonioView = 'base' | 'netting_total' | 'netting_ex_cc';
type PLView = 'base' | 'netting_total' | 'netting_ex_cc';

export function StatsCards({ summary, portfolio, nettingTotal, nettingExCC, earliestHistoricalData }: StatsCardsProps) {
  const [patrimonioView, setPatrimonioView] = useState<PatrimonioView>('base');
  const [plView, setPlView] = useState<PLView>('base');

  const initialValue = portfolio?.initial_value || 0;
  const deposits = portfolio?.deposits || 0;
  const averageBalance = portfolio?.average_balance || 0;
  const initialDate = portfolio?.initial_date;
  const averageBalanceDate = portfolio?.average_balance_date;
  const initialPlusDeposits = initialValue + deposits;
  
  const hasInitialData = initialValue > 0;
  const hasAverageBalance = averageBalance > 0;
  const hasHistoricalData = earliestHistoricalData !== null;
  
  // Patrimonio values based on view
  const getPatrimonioValue = () => {
    switch (patrimonioView) {
      case 'netting_total': return nettingTotal;
      case 'netting_ex_cc': return nettingExCC;
      default: return summary.totalValue;
    }
  };

  const getPatrimonioLabel = () => {
    switch (patrimonioView) {
      case 'netting_total': return 'Patrimonio (Netting Totale)';
      case 'netting_ex_cc': return 'Patrimonio (Netting ex CC)';
      default: return 'Patrimonio Totale';
    }
  };

  // P/L calculation based on historical data and view
  const calculatePL = (view: PLView) => {
    if (!hasHistoricalData) {
      // Fallback to old calculation
      if (!hasInitialData) return { absolute: 0, percent: 0 };
      const absolutePL = summary.totalValue - initialPlusDeposits;
      const percentPL = hasAverageBalance ? (absolutePL / averageBalance) * 100 : 0;
      return { absolute: absolutePL, percent: percentPL };
    }

    const historical = earliestHistoricalData!;
    let currentValue: number;
    let historicalValue: number;

    switch (view) {
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

    const absolutePL = currentValue - historicalValue - historical.deposits;
    const avgBalance = historical.average_balance || historicalValue;
    const percentPL = avgBalance > 0 ? (absolutePL / avgBalance) * 100 : 0;
    
    return { absolute: absolutePL, percent: percentPL };
  };

  const getPLLabel = () => {
    switch (plView) {
      case 'netting_total': return 'P/L (Netting Totale)';
      case 'netting_ex_cc': return 'P/L (Netting ex CC)';
      default: return 'Profitto/Perdita';
    }
  };

  const patrimonioValue = getPatrimonioValue();
  const plData = calculatePL(plView);
  const plAbsolute = plData.absolute;
  const plPercent = plData.percent;

  const cyclePatrimonio = (direction: 'prev' | 'next') => {
    const views: PatrimonioView[] = ['base', 'netting_total', 'netting_ex_cc'];
    const currentIndex = views.indexOf(patrimonioView);
    if (direction === 'next') {
      setPatrimonioView(views[(currentIndex + 1) % views.length]);
    } else {
      setPatrimonioView(views[(currentIndex - 1 + views.length) % views.length]);
    }
  };

  const cyclePL = (direction: 'prev' | 'next') => {
    const views: PLView[] = ['base', 'netting_total', 'netting_ex_cc'];
    const currentIndex = views.indexOf(plView);
    if (direction === 'next') {
      setPlView(views[(currentIndex + 1) % views.length]);
    } else {
      setPlView(views[(currentIndex - 1 + views.length) % views.length]);
    }
  };

  const CarouselDots = ({ current, total }: { current: number; total: number }) => (
    <div className="flex gap-1 justify-center mt-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 h-1.5 rounded-full transition-colors",
            i === current ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
      ))}
    </div>
  );

  const stats = [
    {
      key: 'patrimonio',
      label: getPatrimonioLabel(),
      value: formatCurrency(patrimonioValue),
      icon: Wallet,
      change: null,
      subtext: null,
      hasCarousel: true,
      carouselIndex: ['base', 'netting_total', 'netting_ex_cc'].indexOf(patrimonioView),
      onPrev: () => cyclePatrimonio('prev'),
      onNext: () => cyclePatrimonio('next'),
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
      label: getPLLabel(),
      value: hasInitialData || hasHistoricalData ? formatProfitLoss(plAbsolute) : '—',
      icon: plAbsolute >= 0 ? TrendingUp : TrendingDown,
      change: (hasAverageBalance || hasHistoricalData) ? formatPercentage(plPercent) : null,
      isProfit: plAbsolute >= 0,
      dimmed: !hasInitialData && !hasHistoricalData,
      subtext: null,
      hasCarousel: true,
      carouselIndex: ['base', 'netting_total', 'netting_ex_cc'].indexOf(plView),
      onPrev: () => cyclePL('prev'),
      onNext: () => cyclePL('next'),
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
              {stat.hasCarousel && (
                <CarouselDots current={stat.carouselIndex || 0} total={3} />
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
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
              {stat.hasCarousel && (
                <div className="flex gap-1">
                  <button
                    onClick={stat.onPrev}
                    className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={stat.onNext}
                    className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
