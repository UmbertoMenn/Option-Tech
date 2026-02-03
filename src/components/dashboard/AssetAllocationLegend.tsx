import { PortfolioSummary, ASSET_TYPE_LABELS, ASSET_TYPE_COLORS } from '@/types/portfolio';
import { formatCurrency } from '@/lib/formatters';

interface AssetAllocationLegendProps {
  summary: PortfolioSummary;
}

export function AssetAllocationLegend({ summary }: AssetAllocationLegendProps) {
  return (
    <div className="space-y-2">
      {[...summary.byAssetType].sort((a, b) => b.value - a.value).map((item) => (
        <div
          key={item.type}
          className="flex items-center justify-between p-3 rounded-lg bg-background-secondary/50 hover:bg-background-tertiary transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: ASSET_TYPE_COLORS[item.type] }}
            />
            <span className="text-sm font-medium">{ASSET_TYPE_LABELS[item.type]}</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-mono">{formatCurrency(item.value)}</p>
            <span className="text-xs text-muted-foreground">
              {item.percentage.toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}