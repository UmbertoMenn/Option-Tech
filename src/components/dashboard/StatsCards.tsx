import { PortfolioSummary, Portfolio } from '@/types/portfolio';
import { formatCurrency, formatProfitLoss, formatPercentage } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, PiggyBank, Target } from 'lucide-react';

interface StatsCardsProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
}

export function StatsCards({ summary, portfolio }: StatsCardsProps) {
  // Calcola P/L rispetto al patrimonio iniziale
  const initialValue = portfolio?.initial_value;
  const hasInitialValue = initialValue && initialValue > 0;
  
  const absolutePL = hasInitialValue 
    ? summary.totalValue - initialValue 
    : summary.totalProfitLoss;
  
  const percentPL = hasInitialValue 
    ? ((summary.totalValue - initialValue) / initialValue) * 100 
    : summary.totalProfitLossPct;

  const stats = [
    {
      label: 'Patrimonio Totale',
      value: formatCurrency(summary.totalValue),
      icon: Wallet,
      change: null,
    },
    {
      label: 'Patrimonio Iniziale',
      value: hasInitialValue ? formatCurrency(initialValue) : '—',
      icon: Target,
      change: null,
      dimmed: !hasInitialValue,
    },
    {
      label: 'Liquidità',
      value: formatCurrency(summary.cashValue),
      icon: PiggyBank,
      change: null,
    },
    {
      label: 'Profitto/Perdita',
      value: hasInitialValue ? formatProfitLoss(absolutePL) : '—',
      icon: absolutePL >= 0 ? TrendingUp : TrendingDown,
      change: hasInitialValue ? formatPercentage(percentPL) : null,
      isProfit: absolutePL >= 0,
      dimmed: !hasInitialValue,
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