import { cn } from '@/lib/utils';

export type ViewMode = 'base' | 'netting_total' | 'netting_ex_cc_np';

interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  base: 'Base',
  netting_ex_cc_np: 'Netting ex. Covered Call e Naked Put OTM',
  netting_total: 'Netting Totale',
};

const VIEWS: ViewMode[] = ['netting_total', 'netting_ex_cc_np', 'base'];

export function ViewModeSelector({ viewMode, onViewModeChange }: ViewModeSelectorProps) {
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
