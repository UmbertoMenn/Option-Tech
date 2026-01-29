import { PortfolioSummary } from '@/types/portfolio';
import { formatCurrency, formatProfitLoss, formatPercentage } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3 } from 'lucide-react';

interface StatsCardsProps {
  summary: PortfolioSummary;
}

export function StatsCards({ summary }: StatsCardsProps) {
  const stats = [
    {
      label: 'Patrimonio Totale',
      value: formatCurrency(summary.totalValue),
      icon: Wallet,
      change: null,
    },
    {
      label: 'Investito',
      value: formatCurrency(summary.investedValue),
      icon: BarChart3,
      change: null,
    },
    {
      label: 'Liquidità',
      value: formatCurrency(summary.cashValue),
      icon: PiggyBank,
      change: null,
    },
    {
      label: 'Profitto/Perdita',
      value: formatProfitLoss(summary.totalProfitLoss),
      icon: summary.totalProfitLoss >= 0 ? TrendingUp : TrendingDown,
      change: formatPercentage(summary.totalProfitLossPct),
      isProfit: summary.totalProfitLoss >= 0,
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
                stat.isProfit !== undefined 
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
              stat.isProfit !== undefined
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