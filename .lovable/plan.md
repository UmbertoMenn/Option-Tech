

## Fix: Vista aggregata per-utente completamente vuota

### Causa

Catena di errori nell'accesso all'ID selezionato:

1. `PortfolioContext` espone solo `selectedPortfolio` (l'oggetto Portfolio completo), ma per ID aggregati come `AGGREGATED_USER:xxx` non esiste un portfolio reale nel database, quindi `selectedPortfolio` e' sempre `null`
2. `usePortfolio.ts` deriva l'ID dal portfolio: `selectedId = portfolio?.id` che diventa `undefined`
3. Con `selectedId` undefined, tutti i flag (`isUserAgg`, `isGlobalAggregated`) sono falsi, tutte le query sono disabilitate, e la dashboard resta vuota

### Soluzione

**File 1: `src/contexts/PortfolioContext.tsx`**

- Aggiungere `selectedPortfolioId: string | null` al tipo `PortfolioContextType`
- Esporre `selectedId` direttamente nel Provider value, cosi' gli hook possono accedere all'ID raw senza dipendere dall'oggetto portfolio

**File 2: `src/hooks/usePortfolio.ts`**

- Leggere `selectedPortfolioId` dal context invece di derivarlo da `selectedPortfolio?.id`
- Cambiare: `const selectedId = portfolio?.id;` in `const selectedId = selectedPortfolioId;`
- Aggiornare la condizione `enabled` di `positionsQuery` per usare il nuovo `selectedId`

**File 3: `src/hooks/useHistoricalData.ts`** (verifica)

- Questo hook riceve gia' `portfolioId` come parametro, quindi non ha il problema. Verificare che il chiamante (Dashboard) passi l'ID corretto.

**File 4: `src/components/dashboard/Dashboard.tsx`** (verifica)

- Verificare che la Dashboard passi `selectedPortfolioId` (e non `selectedPortfolio?.id`) a `useHistoricalData` e altri hook

### Dettaglio tecnico

```text
// PortfolioContext - aggiunta al tipo
interface PortfolioContextType {
  // ... existing fields
  selectedPortfolioId: string | null;  // NUOVO
}

// PortfolioContext - aggiunta al value
<PortfolioContext.Provider value={{
  // ... existing
  selectedPortfolioId: selectedId,  // espone l'ID raw
}}>

// usePortfolio.ts - fix
const { selectedPortfolio, isAggregatedView, selectedPortfolioId } = usePortfolioContext();
const selectedId = selectedPortfolioId;  // invece di portfolio?.id
```

### File da modificare

| File | Modifica |
|---|---|
| `PortfolioContext.tsx` | Aggiungere `selectedPortfolioId` al tipo e al Provider value |
| `usePortfolio.ts` | Usare `selectedPortfolioId` dal context invece di derivarlo |
| `Dashboard.tsx` | Verificare che passi l'ID corretto ai sotto-hook |

