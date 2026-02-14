

## Fix: TypeError "Cannot read properties of undefined (reading 'netting_total')"

### Causa

In `StatsCards.tsx`, la variabile `selectedHistoricalEntry` viene calcolata con `historicalData.find(...)`, che restituisce `undefined` quando non trova corrispondenza. Il controllo alla riga 122 usa `!== null`, ma `undefined !== null` e' `true`, quindi `hasHistoricalData` risulta erroneamente vero. Il codice accede poi a `selectedHistoricalEntry!.netting_total` su un valore `undefined`, causando il crash.

Questo accade quando si esce dalla vista aggregata: `selectedHistoricalDate` contiene ancora una data dei dati aggregati che non esiste nello storico del singolo portafoglio.

### Fix

**File: `src/components/dashboard/StatsCards.tsx`**

Riga 122 - cambiare il controllo da strict null a truthiness check:

- Da: `const hasHistoricalData = selectedHistoricalEntry !== null;`
- A: `const hasHistoricalData = !!selectedHistoricalEntry;`

Questo gestisce correttamente sia `null` che `undefined`, prevenendo l'accesso a proprieta' su valori non definiti.

