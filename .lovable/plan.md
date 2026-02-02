
# Piano: Correggere Fetch ETF Allocations per Equity View

## Problema Identificato

Lo screenshot mostra che NVIDIA ha solo i badge Stock e PUT, ma **nessun badge ETF**, nonostante NVIDIA dovrebbe apparire nelle top holdings di ETF come iShares MSCI World (3.44%).

### Diagnosi

Il problema NON è nell'edge function (funziona correttamente - popola le top holdings via AI). Il problema è nel **timing del fetch**:

```typescript
// src/pages/RiskAnalyzer.tsx, linea 70
if (etfIsins.length > 0 && (viewMode === 'currency' || viewMode === 'sector') && !hasFetchedETFs) {
  setHasFetchedETFs(true);
  fetchMultipleAllocations(etfIsins);
}
```

Questo codice fetcha le allocazioni ETF **SOLO** quando l'utente passa alla vista "Currency" o "Sector", ma **MAI** per la vista "Equity" (che è quella di default e contiene "Holdings Consolidate").

Quando l'utente è sulla vista Equity:
- `allocations` = `{}` (vuoto)
- `calculateConsolidatedTopHoldings()` non trova nessuna top holding ETF
- Nessun badge ETF viene mostrato

## Soluzione

### Modifica 1: Fetch ETF allocations anche per equity view

**File**: `src/pages/RiskAnalyzer.tsx`

Modificare la condizione nel `useEffect` per includere anche `viewMode === 'equity'`:

```typescript
// Fetch ETF allocations for ALL views that need them
useEffect(() => {
  if (etfIsins.length > 0 && !hasFetchedETFs) {
    setHasFetchedETFs(true);
    fetchMultipleAllocations(etfIsins);
  }
}, [etfIsins, hasFetchedETFs, fetchMultipleAllocations]);
```

Oppure, più specificamente:

```typescript
// Fetch ETF allocations for equity, currency, and sector views
useEffect(() => {
  if (etfIsins.length > 0 && 
      (viewMode === 'equity' || viewMode === 'currency' || viewMode === 'sector') && 
      !hasFetchedETFs) {
    setHasFetchedETFs(true);
    fetchMultipleAllocations(etfIsins);
  }
}, [etfIsins, viewMode, hasFetchedETFs, fetchMultipleAllocations]);
```

Dato che `equity` è la vista di default, la seconda forma è equivalente alla prima in pratica, ma è più esplicita.

## File da Modificare

| File | Modifica |
|------|----------|
| `src/pages/RiskAnalyzer.tsx` | Aggiungere `viewMode === 'equity'` alla condizione del fetch ETF |

## Risultato Atteso

Dopo la modifica:

1. Quando l'utente apre Risk Analyzer (default view = equity), le allocazioni ETF vengono caricate immediatamente
2. NVIDIA mostrerà:
   - **Stock**: €140.331
   - **PUT**: €63.910
   - **ETF**: ~€XXX (calcolato da iShares MSCI World 3.44% di €YYY)
3. Il totale includerà correttamente l'esposizione via ETF
4. Il breakdown dialog mostrerà le fonti ETF (es. "iShares Core MSCI World UCITS ETF - 3.44%")

## Verifica

Dopo l'implementazione:
1. Aprire Risk Analyzer 
2. Vista default = Equity Exposure
3. Verificare che le Holdings Consolidate mostrino badge ETF per titoli presenti negli ETF
4. Cliccare su NVIDIA per verificare che nel breakdown appaiano le fonti ETF (es. iShares MSCI World)

## Note Tecniche

- Il fetch ETF usa batching (3 alla volta) con delay 500ms per evitare rate limiting
- I dati vengono cachati in memoria (`allocations` state) e nel database (`etf_allocations` table)
- La prima volta potrebbero volerci alcuni secondi per fetchare tutti gli ETF (il loader è già gestito con `isLoadingETFData`)
