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

const VIEWS: ViewMode[] = ['base', 'netting_ex_cc_np', 'netting_total'];

export function ViewModeSelector({ viewMode, onViewModeChange }: ViewModeSelectorProps) {
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
