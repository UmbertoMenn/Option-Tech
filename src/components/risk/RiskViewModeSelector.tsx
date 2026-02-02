import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

const RISK_CALCULATION_TOOLTIP = 
  "Le azioni singole sono calcolate al netto delle protezioni (Long PUT). " +
  "Il rischio Strategie è calcolato come il max loss di ogni strategia. " +
  "Le Leap Call sono calcolate come il totale dei premi pagati.";

const VIEWS: RiskViewMode[] = ['equity', 'currency', 'sector'];

export function RiskViewModeSelector({ viewMode, onViewModeChange }: RiskViewModeSelectorProps) {
  const currentIndex = VIEWS.indexOf(viewMode);

  const cycleView = (direction: 'prev' | 'next') => {
    if (direction === 'next') {
      onViewModeChange(VIEWS[(currentIndex + 1) % VIEWS.length]);
    } else {
      onViewModeChange(VIEWS[(currentIndex - 1 + VIEWS.length) % VIEWS.length]);
    }
  };

  return (
    <div className="flex items-center justify-center gap-4 mb-6">
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
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium min-w-[140px] text-center">
            Vista: {VIEW_LABELS[viewMode]}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  className="p-0.5 rounded-full hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Info sul calcolo del rischio"
                >
                  <Info className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm">
                <p>{RISK_CALCULATION_TOOLTIP}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
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
