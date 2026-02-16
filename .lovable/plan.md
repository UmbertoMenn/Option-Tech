

## Allungare istogramma verticalmente e rimuovere descrizione

### Modifiche

**File: `src/components/dashboard/DynamicPortfolioChart.tsx`**

1. **Aumentare altezza istogramma**: nel componente `NettingBreakdownChart`, cambiare l'altezza del contenitore da `220px` a `320px` (riga 112) per sfruttare lo spazio verticale disponibile nella card.

2. **Rimuovere la descrizione testuale**: eliminare il paragrafo con la descrizione sotto il carousel (righe 353-355), che risulta fuorviante. Il blocco `descriptions` e il relativo `<p>` verranno rimossi.

3. **Rimuovere l'oggetto `descriptions`**: eliminare la costante `descriptions` (righe 248-252) che non sara' piu' utilizzata.

