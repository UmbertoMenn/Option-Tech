

# Piano: Correggere la Logica P/L per Non Usare Dati Legacy

## Problema Identificato

Il P/L mostra ancora un valore (+1.342.598,45 €) nonostante sia selezionato "Nessuna data" perché:

1. **Database**: Il "Portfolio Principale" (ID: `2babec7d-...`) contiene ancora dati legacy:
   - `initial_value`: 670,000 €
   - `average_balance`: 595,000 €
   - `deposits`: 0

2. **Codice**: In `StatsCards.tsx`, linee 197-203, quando non ci sono dati storici selezionati, il codice fa un fallback e usa i campi legacy:

```typescript
if (!hasHistoricalData) {
  if (!hasInitialData) return { absolute: 0, percent: 0 };
  // USA DATI LEGACY:
  const absolutePL = summary.totalValue - initialPlusDeposits;
  const percentPL = (absolutePL / portfolioAverageBalance) * 100;
  return { absolute: absolutePL, percent: percentPL };
}
```

## Soluzione

### Parte 1: Pulire i Dati dal Database

Eseguire UPDATE sul portfolio corretto:

```sql
UPDATE portfolios 
SET 
  initial_value = NULL,
  initial_date = NULL,
  deposits = NULL,
  average_balance = NULL,
  average_balance_date = NULL
WHERE id = '2babec7d-a801-4329-94ec-cee3489d86ab';
```

### Parte 2: Correggere la Logica nel Codice

Modificare `StatsCards.tsx` per NON usare mai i dati legacy. Se non ci sono dati storici selezionati, il P/L deve essere `—`:

**Linee 197-204 - Prima:**
```typescript
const calculatePL = () => {
  if (!hasHistoricalData) {
    // Fallback to old calculation if no historical data selected
    if (!hasInitialData) return { absolute: 0, percent: 0 };
    const absolutePL = summary.totalValue - initialPlusDeposits;
    const percentPL = hasPortfolioAverageBalance ? (absolutePL / portfolioAverageBalance) * 100 : 0;
    return { absolute: absolutePL, percent: percentPL };
  }
  // ... resto del codice
```

**Linee 197-204 - Dopo:**
```typescript
const calculatePL = () => {
  // Se non ci sono dati storici selezionati, non calcolare P/L
  if (!hasHistoricalData) {
    return { absolute: 0, percent: 0 };
  }
  // ... resto del codice per calcolo con dati storici
```

Rimuovere anche:
- Le variabili legacy non più necessarie (`initialValue`, `portfolioDeposits`, `portfolioAverageBalance`, `initialPlusDeposits`, `hasInitialData`, `hasPortfolioAverageBalance`)
- La logica di fallback alla linea 242 (`canCalculatePL`)

### Parte 3: Aggiornare la Variabile `canCalculatePL`

**Linea 242 - Prima:**
```typescript
const canCalculatePL = hasInitialData || hasHistoricalData;
```

**Dopo:**
```typescript
const canCalculatePL = hasHistoricalData;
```

## Risultato Atteso

| Situazione | P/L Mostrato |
|------------|--------------|
| Nessuna data storica selezionata | `—` |
| Data storica selezionata | Valore calcolato correttamente |

## File da Modificare

| File | Azione |
|------|--------|
| `src/components/dashboard/StatsCards.tsx` | Rimuovere fallback a dati legacy |
| Database (via SQL) | Pulire i campi legacy dal portfolio attuale |

