import { cn } from '@/lib/utils';

export type RiskViewMode = 'equity' | 'currency' | 'sector';

interface RiskViewModeSelectorProps {
  viewMode: RiskViewMode;
  onViewModeChange: (mode: RiskViewMode) => void;
}

const VIEW_LABELS: Record<RiskViewMode, string> = {
  equity: 'Equity Exposure',
  currency: 'Currency Exposure',
  sector: 'Sector Allocation',
};

const VIEWS: RiskViewMode[] = ['equity', 'currency', 'sector'];

export function RiskViewModeSelector({ viewMode, onViewModeChange }: RiskViewModeSelectorProps) {
  return (
    <div className="flex flex-wrap justify-center gap-3 mb-4">
      {VIEWS.map((v) => {
        const active = viewMode === v;
        return (
          <button
            key={v}
            onClick={() => onViewModeChange(v)}
            className={cn(
              'px-4 py-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted/50 text-foreground'
            )}
            aria-pressed={active}
          >
            {VIEW_LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}
