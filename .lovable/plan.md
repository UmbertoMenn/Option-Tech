
# Piano: Aggiungere Tooltip Esplicativi ai Titoli del Carousel Risk Analyzer

## Obiettivo

Aggiungere un'icona informativa (i) accanto al titolo di ogni vista nel carousel del Risk Analyzer, con un tooltip che spieghi come viene calcolato il rischio per quella categoria.

## Testi dei Tooltip

| Vista | Testo Tooltip |
|-------|---------------|
| Equity Exposure | Le azioni singole sono calcolate al netto delle protezioni (Long PUT). Il rischio Strategie e calcolato come il max loss di ogni strategia. Le Leap Call sono calcolate come il totale dei premi pagati. |
| Currency Exposure | (stesso testo) |
| Sector Allocation | (stesso testo) |

---

## Implementazione

### File da Modificare

`src/components/risk/RiskViewModeSelector.tsx`

### Modifiche

1. **Import del componente Tooltip** - Aggiungere gli import necessari da `@/components/ui/tooltip` e l'icona `Info` da lucide-react

2. **Aggiungere il tooltip** - Posizionare l'icona (i) accanto al testo "Vista: [Nome Vista]" con il tooltip esplicativo

### Codice Risultante

```typescript
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type RiskViewMode = 'equity' | 'currency' | 'sector';

// ... existing code ...

const RISK_CALCULATION_TOOLTIP = 
  "Le azioni singole sono calcolate al netto delle protezioni (Long PUT). " +
  "Il rischio Strategie e calcolato come il max loss di ogni strategia. " +
  "Le Leap Call sono calcolate come il totale dei premi pagati.";

export function RiskViewModeSelector({ viewMode, onViewModeChange }: RiskViewModeSelectorProps) {
  // ... existing code ...

  return (
    <div className="flex items-center justify-center gap-4 mb-6">
      {/* ... chevron left button ... */}
      
      <div className="flex items-center gap-3">
        {/* ... dots ... */}
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
      
      {/* ... chevron right button ... */}
    </div>
  );
}
```

---

## Risultato Visivo

```
    [<]  ●○○  Vista: Equity Exposure (i)  [>]
```

L'icona (i) apparira subito dopo il nome della vista. Al passaggio del mouse, mostrera il tooltip con la spiegazione del calcolo del rischio.

---

## Note Tecniche

- Il tooltip utilizza i componenti shadcn/ui gia presenti nel progetto (`@/components/ui/tooltip`)
- L'icona `Info` proviene da lucide-react (gia installato)
- Il testo del tooltip e identico per tutte e tre le viste (Equity, Currency, Sector)
- `max-w-xs` sul TooltipContent garantisce che il testo vada a capo correttamente
