import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PortfolioSummary, Portfolio, ASSET_TYPE_LABELS, ASSET_TYPE_COLORS } from '@/types/portfolio';
import { formatCurrency, formatPercentage } from '@/lib/formatters';

interface PortfolioDonutChartProps {
  summary: PortfolioSummary;
  portfolio: Portfolio | null;
}

export function PortfolioDonutChart({ summary, portfolio }: PortfolioDonutChartProps) {
  const data = [...summary.byAssetType]
    .sort((a, b) => b.value - a.value)
    .map(item => ({
      name: ASSET_TYPE_LABELS[item.type],
      value: item.value,
      percentage: item.percentage,
      color: ASSET_TYPE_COLORS[item.type],
    }));

  // Calculate the same P/L percentage as StatsCards
  const initialValue = portfolio?.initial_value || 0;
  const deposits = portfolio?.deposits || 0;
  const averageBalance = portfolio?.average_balance || 0;
  const initialPlusDeposits = initialValue + deposits;
  
  const hasInitialData = initialValue > 0;
  const hasAverageBalance = averageBalance > 0;
  
  const absolutePL = hasInitialData 
    ? summary.totalValue - initialPlusDeposits 
    : summary.totalProfitLoss;
  
  const percentPL = hasAverageBalance 
    ? (absolutePL / averageBalance) * 100 
    : summary.totalProfitLossPct;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm">{data.name}</p>
          <p className="text-muted-foreground text-sm">{formatCurrency(data.value)}</p>
          <p className="text-muted-foreground text-sm">{data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={80}
            outerRadius={120}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-sm text-muted-foreground">Patrimonio Totale</p>
        <p className="text-2xl font-bold font-mono">{formatCurrency(summary.totalValue)}</p>
      </div>
    </div>
  );
}