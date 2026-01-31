import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewMode = 'base' | 'netting_total' | 'netting_ex_cc';

interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  base: 'Base',
  netting_total: 'Netting Totale',
  netting_ex_cc: 'Netting ex CC',
};

const VIEWS: ViewMode[] = ['base', 'netting_total', 'netting_ex_cc'];

export function ViewModeSelector({ viewMode, onViewModeChange }: ViewModeSelectorProps) {
  const currentIndex = VIEWS.indexOf(viewMode);

  const cycleView = (direction: 'prev' | 'next') => {
    if (direction === 'next') {
      onViewModeChange(VIEWS[(currentIndex + 1) % VIEWS.length]);
    } else {
      onViewModeChange(VIEWS[(currentIndex - 1 + VIEWS.length) % VIEWS.length]);
    }
  };

  return (
    <div className="flex items-center justify-center gap-4 mb-4">
      <button
        onClick={() => cycleView('prev')}
        className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Vista precedente"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => onViewModeChange(v)}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                viewMode === v ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
              aria-label={`Vista ${VIEW_LABELS[v]}`}
            />
          ))}
        </div>
        <span className="text-sm font-medium min-w-[120px] text-center">
          Vista: {VIEW_LABELS[viewMode]}
        </span>
      </div>
      
      <button
        onClick={() => cycleView('next')}
        className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Vista successiva"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
