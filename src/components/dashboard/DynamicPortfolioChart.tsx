import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PortfolioDonutChart } from '@/components/dashboard/PortfolioDonutChart';
import { AssetAllocationLegend } from '@/components/dashboard/AssetAllocationLegend';
import { PortfolioSummary, Portfolio, Position } from '@/types/portfolio';
import { NettingResult } from '@/hooks/useDerivativeNetting';
import { ViewMode } from './ViewModeSelector';
import { Upload } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { formatCurrency } from '@/lib/formatters';

interface DynamicPortfolioChartProps {
  summary: PortfolioSummary | null;
  portfolio: Portfolio | null;
  positions: Position[];
  netting: NettingResult;
  viewMode: ViewMode;
}

interface NettingChartProps {
  baseValue: number;
  nettedValue: number;
  label: string;
}

function NettingChart({ baseValue, nettedValue, label }: NettingChartProps) {
  const data = [
    { name: 'Valore Asset Portafoglio', value: baseValue, fill: 'hsl(var(--muted-foreground))' },
    { name: label, value: nettedValue, fill: 'hsl(217, 91%, 60%)' },
  ];

  const formatValue = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M $`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K $`;
    return `${value.toFixed(0)} $`;
  };

  return (
    <div className="flex flex-col items-center py-4">
      <div className="w-full h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 80, top: 10, bottom: 10 }}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis 
              type="category" 
              dataKey="name" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              width={140}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <LabelList 
                dataKey="value" 
                position="right" 
                formatter={formatValue}
                style={{ fill: 'hsl(var(--foreground))', fontSize: 12, fontWeight: 500 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-center">
        <p className="text-2xl font-bold text-blue-500">
          {formatCurrency(nettedValue)}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

const CHART_TITLES: Record<ViewMode, string> = {
  base: 'Composizione Portafoglio (Derivati esclusi)',
  netting_total: 'Valore Portafoglio (Netting Totale Derivati)',
  netting_ex_cc: 'Valore Portafoglio (Netting ex. Covered Call)',
};

export function DynamicPortfolioChart({ summary, portfolio, positions, netting, viewMode }: DynamicPortfolioChartProps) {
  const renderChart = () => {
    if (viewMode === 'base') {
      if (summary && positions.length > 0) {
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PortfolioDonutChart summary={summary} portfolio={portfolio} />
            <AssetAllocationLegend summary={summary} />
          </div>
        );
      }
      return (
        <div className="text-center py-12 text-muted-foreground">
          <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nessuna posizione presente</p>
          <p className="text-sm">Carica un file Excel per iniziare</p>
        </div>
      );
    }

    if (viewMode === 'netting_total') {
      return (
        <NettingChart
          baseValue={summary?.totalValue ?? 0}
          nettedValue={netting.nettingTotal}
          label="Netting Totale"
        />
      );
    }

    // netting_ex_cc
    return (
      <NettingChart
        baseValue={summary?.totalValue ?? 0}
        nettedValue={netting.nettingExCoveredCall}
        label="Netting ex. CC & Protezioni"
      />
    );
  };

  return (
    <Card className="lg:col-span-2 border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-center">{CHART_TITLES[viewMode]}</CardTitle>
      </CardHeader>
      <CardContent>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
