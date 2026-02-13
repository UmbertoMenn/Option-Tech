

## Fix: aggiungere `underlyingPrices` alle dipendenze dei `useMemo`

### Causa del problema

Nella modifica precedente, le sezioni "Covered Call ITM" e "Naked Put ITM" sono state aggiornate per leggere da `underlyingPrices` (prezzi live), ma le dependency array dei rispettivi `useMemo` non sono state aggiornate. React non ricalcola mai quei valori quando i prezzi cambiano, quindi la card resta "congelata" sui valori iniziali.

### Fix

**File: `src/components/derivatives/DerivativesSummaryCard.tsx`**

1. **Linea 237** - Covered Call ITM memo:
   - Da: `}, [categories.coveredCalls]);`
   - A: `}, [categories.coveredCalls, underlyingPrices]);`

2. **Linea 326** - Naked Put ITM memo:
   - Da: `}, [categories.nakedPuts]);`
   - A: `}, [categories.nakedPuts, underlyingPrices]);`

### Risultato

Le sezioni Covered Call ITM e Naked Put ITM si ricalcoleranno ogni volta che i prezzi live cambiano, allineandosi perfettamente ai badge nelle righe di dettaglio.

