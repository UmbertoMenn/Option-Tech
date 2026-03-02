

## Soluzione: limitare l'altezza della tabella Posizioni con scroll interno

Il problema è che la tabella posizioni estende la pagina enormemente, rendendo la scrollbar del browser minuscola. La soluzione è aggiungere un'altezza massima al contenitore della tabella con scroll verticale interno, mantenendo l'header della tabella visibile (sticky).

### Modifiche

**File: `src/components/dashboard/PositionsTable.tsx`**
- Aggiungere `max-h-[600px] overflow-y-auto` al div contenitore della tabella (riga 102-103)
- Rendere l'header della tabella sticky con `sticky top-0 z-10 bg-card`
- Così la tabella scrolla internamente senza far crescere la pagina all'infinito

