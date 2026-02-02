import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewMode = 'base' | 'netting_total' | 'netting_ex_cc' | 'netting_ex_cc_np';

interface ViewModeSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  base: 'Base',
  netting_ex_cc: 'Netting ex. Covered Call',
  netting_ex_cc_np: 'Netting ex. Covered Call e Naked Put OTM',
  netting_total: 'Netting Totale',
};

const VIEWS: ViewMode[] = ['base', 'netting_ex_cc', 'netting_ex_cc_np', 'netting_total'];

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
    <div className="flex flex-col items-center gap-2 mb-4">
      <span className="text-sm font-medium">
        Vista: {VIEW_LABELS[viewMode]}
      </span>
      
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => cycleView('prev')}
          className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Vista precedente"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
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
        
        <button
          onClick={() => cycleView('next')}
          className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Vista successiva"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
