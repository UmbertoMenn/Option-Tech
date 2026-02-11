

## Aggiunta icona informativa (i) con tooltip sulla sorgente dati

### Cosa cambia
Viene aggiunta un'icona informativa (i) posizionata nell'angolo in alto a sinistra della sezione principale della dashboard (sotto l'header, a sinistra del selettore vista), come indicato dal rettangolo rosso nello screenshot.

Al passaggio del mouse (o tap su mobile), un tooltip spiega:
- **Dashboard e Risk Analyzer**: dati aggiornati ai prezzi del file Excel caricato (snapshot statico)
- **Strategie Derivati**: prezzi opzioni aggiornati con ritardo di 15 minuti, prezzi sottostanti aggiornati ogni 5 minuti

### Dettaglio tecnico

**File: `src/components/dashboard/Dashboard.tsx`**

1. Aggiungere l'import di `Info` da `lucide-react` e dei componenti `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` da `@/components/ui/tooltip`
2. Nella sezione `<main>`, subito prima del `ViewModeSelector`, inserire un contenitore flex con:
   - L'icona `Info` avvolta in un Tooltip Radix sulla sinistra
   - Il `ViewModeSelector` centrato (come ora)
3. Il tooltip contiene il testo informativo in italiano

### Testo del tooltip
```
Dashboard e Risk Analyzer: dati aggiornati ai prezzi
del file Excel caricato.
Strategie Derivati: prezzi opzioni delayed 15 min,
prezzi sottostanti aggiornati ogni 5 min.
```

### Layout
L'icona viene posizionata con `absolute left-0` rispetto a un wrapper `relative` che contiene anche il ViewModeSelector centrato, in modo da non spostare il selettore vista dalla sua posizione attuale.
