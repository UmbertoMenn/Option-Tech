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
    <div className="mb-4 border border-border rounded-xl bg-card p-1">
      <div className="flex flex-wrap justify-center gap-1">
        {VIEWS.map((v) => {
          const active = viewMode === v;
          return (
            <button
              key={v}
              onClick={() => onViewModeChange(v)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                active
                  ? 'bg-blue-400/10 text-blue-400'
                  : 'hover:bg-muted/50 text-foreground'
              )}
              aria-pressed={active}
            >
              {VIEW_LABELS[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
