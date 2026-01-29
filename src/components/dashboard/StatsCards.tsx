import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { formatCurrency, formatProfitLoss, formatPercentage, formatDate } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, Landmark, Target } from 'lucide-react';

interface StatsCardsProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
}

export function StatsCards({ summary, portfolio }: StatsCardsProps) {
  const initialValue = portfolio?.initial_value || 0;
  const deposits = portfolio?.deposits || 0;
  const averageBalance = portfolio?.average_balance || 0;
  const initialDate = portfolio?.initial_date;
  const averageBalanceDate = portfolio?.average_balance_date;
  const initialPlusDeposits = initialValue + deposits;
  
  const hasInitialData = initialValue > 0;
  const hasAverageBalance = averageBalance > 0;
  
  // Rendimento = Patrimonio Totale - (Patrimonio Iniziale + Versamenti)
  const absolutePL = hasInitialData 
    ? summary.totalValue - initialPlusDeposits 
    : 0;
  
  // Rendimento % = [(Patrimonio Totale - (Patrimonio Iniziale + Versamenti)] / Giacenza Media
  const percentPL = hasAverageBalance 
    ? (absolutePL / averageBalance) * 100 
    : 0;

  const stats = [
    {
      label: 'Patrimonio Totale',
      value: formatCurrency(summary.totalValue),
      icon: Wallet,
      change: null,
      subtext: null,
    },
    {
      label: 'Patrimonio Iniziale + Versamenti',
      value: hasInitialData ? formatCurrency(initialPlusDeposits) : '—',
      icon: Target,
      change: null,
      dimmed: !hasInitialData,
      subtext: initialDate ? `al ${formatDate(initialDate)}` : null,
    },
    {
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
      label: 'Profitto/Perdita',
      value: hasInitialData ? formatProfitLoss(absolutePL) : '—',
      icon: absolutePL >= 0 ? TrendingUp : TrendingDown,
      change: hasAverageBalance ? formatPercentage(percentPL) : null,
      isProfit: absolutePL >= 0,
      dimmed: !hasInitialData,
      subtext: null,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className="stat-card animate-fade-in"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${
                stat.dimmed 
                  ? 'text-muted-foreground'
                  : stat.isProfit !== undefined 
                    ? stat.isProfit 
                      ? 'text-profit' 
                      : 'text-loss'
                    : ''
              }`}>
                {stat.value}
              </p>
              {stat.subtext && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stat.subtext}
                </p>
              )}
              {stat.change && (
                <p className={`text-xs font-mono mt-1 ${
                  stat.isProfit ? 'text-profit' : 'text-loss'
                }`}>
                  {stat.change}
                </p>
              )}
            </div>
            <div className={`p-2 rounded-lg ${
              stat.dimmed
                ? 'bg-muted/10 text-muted-foreground'
                : stat.isProfit !== undefined
                  ? stat.isProfit
                    ? 'bg-profit/10 text-profit'
                    : 'bg-loss/10 text-loss'
                  : 'bg-primary/10 text-primary'
            }`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}