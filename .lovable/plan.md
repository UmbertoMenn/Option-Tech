
# Piano: Fix Tooltip Benchmark, Colori Legenda e Linea fino ad Oggi

## Problemi Identificati

1. **Tooltip non leggibile**: Il `TooltipContent` usa gli stili di default che potrebbero non avere sufficiente contrasto
2. **Descrizione benchmark incompleta**: Il tooltip deve spiegare chiaramente quali indici vengono usati e le regole di scaling
3. **Colore legenda**: "Portafoglio" e "Benchmark" usano `text-muted-foreground` (grigio), devono essere bianchi
4. **Linea benchmark interrotta**: Il hook `useBenchmarkData` calcola i rendimenti solo per le date degli snapshot storici, non include il punto "oggi" 

---

## Modifiche

### File: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

**1. Aggiornare la descrizione del benchmark** con spiegazione completa degli indici e delle regole:

```tsx
const benchmarkDescription = viewMode === 'base' 
  ? 'Media ponderata di MSCI World (URTH), S&P 500 (SPY), MSCI ACWI (ACWI), Stoxx 600 (EXSA.DE). Benchmark scalato al 60% equity per la vista base.'
  : 'Benchmark dinamico basato sull\'esposizione azionaria:\n• Esposizione ≥90% → 100% equity (media URTH, SPY, ACWI, EXSA.DE)\n• Esposizione 40-60% → 50% SPY + 50% AGG (bond)\n• Valori intermedi → blend proporzionale';
```

**2. Cambiare colore legenda da grigio a bianco**:

```tsx
// Sostituire text-muted-foreground con text-foreground
<span className="text-foreground">Portafoglio</span>
...
<span className="text-foreground">Benchmark</span>
```

**3. Migliorare visibilità tooltip** con classi esplicite:

```tsx
<TooltipContent side="top" className="max-w-sm bg-popover text-popover-foreground border-border">
  <p className="text-xs whitespace-pre-line">{benchmarkDescription}</p>
</TooltipContent>
```

---

### File: `src/hooks/useBenchmarkData.ts`

**4. Aggiungere supporto per la data corrente** (oltre agli snapshot storici):

Il hook deve accettare un parametro opzionale `currentDate` e calcolare il rendimento benchmark anche per quella data.

Modifiche alla firma:
```tsx
export function useBenchmarkData(
  historicalData: HistoricalDataEntry[],
  viewMode: ViewMode,
  currentDate?: string | null  // Nuovo parametro
)
```

Modifiche al `dateRange`:
```tsx
const dateRange = useMemo(() => {
  if (historicalData.length === 0) return null;
  
  const dates = historicalData.map(h => new Date(h.snapshot_date));
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  let maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
  
  // Estendi fino alla data corrente se fornita
  if (currentDate) {
    const current = new Date(currentDate);
    if (current > maxDate) {
      maxDate = current;
    }
  }
  
  minDate.setDate(minDate.getDate() - 7);
  
  return {
    from: minDate.toISOString().split('T')[0],
    to: maxDate.toISOString().split('T')[0],
  };
}, [historicalData, currentDate]);
```

Aggiungere calcolo per data corrente nel `benchmarkReturns`:
```tsx
// Dopo il forEach degli snapshot storici, aggiungere il punto "oggi"
if (currentDate && !returns.find(r => r.date === currentDate)) {
  // Calcolo identico a quello degli snapshot
  let equityReturns: number[] = [];
  EQUITY_BENCHMARKS.forEach(ticker => {
    const basePrice = basePrices[ticker];
    const currentPrice = getClosestPrice(ticker, currentDate);
    if (basePrice && currentPrice) {
      equityReturns.push(((currentPrice - basePrice) / basePrice) * 100);
    }
  });
  const avgEquityReturn = equityReturns.length > 0 
    ? equityReturns.reduce((a, b) => a + b, 0) / equityReturns.length 
    : 0;

  // Per la data corrente, usa l'ultimo entry storico per l'esposizione
  const lastEntry = sortedHistory[sortedHistory.length - 1];
  const equityExposure = getEquityExposure(lastEntry, viewMode);
  const { equityWeight, useBalanced } = selectBenchmarkWeight(equityExposure);
  
  // Calcola balanced return
  const spyBase = basePrices[BALANCED_EQUITY_TICKER];
  const spyCurrent = getClosestPrice(BALANCED_EQUITY_TICKER, currentDate);
  const aggBase = basePrices[BOND_TICKER];
  const aggCurrent = getClosestPrice(BOND_TICKER, currentDate);
  
  let balancedReturn = 0;
  if (spyBase && spyCurrent && aggBase && aggCurrent) {
    const spyReturn = ((spyCurrent - spyBase) / spyBase) * 100;
    const aggReturn = ((aggCurrent - aggBase) / aggBase) * 100;
    balancedReturn = 0.5 * spyReturn + 0.5 * aggReturn;
  }

  let scaledReturn: number;
  if (useBalanced) {
    scaledReturn = balancedReturn;
  } else if (equityWeight === 1) {
    scaledReturn = avgEquityReturn;
  } else {
    scaledReturn = equityWeight * avgEquityReturn + (1 - equityWeight) * balancedReturn;
  }

  returns.push({
    date: currentDate,
    equityReturn: avgEquityReturn,
    balancedReturn,
    scaledReturn,
  });
}
```

---

### File: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

**5. Passare `currentDate` al hook**:

```tsx
const { benchmarkReturns, hasBenchmarkData } = useBenchmarkData(
  historicalData, 
  viewMode,
  currentDate  // Nuovo parametro
);
```

---

## Riepilogo Modifiche

| File | Modifica |
|------|----------|
| `PerformanceEvolutionChart.tsx` | Descrizione benchmark dettagliata con indici e regole |
| `PerformanceEvolutionChart.tsx` | Colore legenda da `text-muted-foreground` a `text-foreground` (bianco) |
| `PerformanceEvolutionChart.tsx` | TooltipContent con classi esplicite per contrasto |
| `PerformanceEvolutionChart.tsx` | Passaggio `currentDate` al hook |
| `useBenchmarkData.ts` | Accettare `currentDate` come parametro |
| `useBenchmarkData.ts` | Estendere `dateRange` fino a `currentDate` |
| `useBenchmarkData.ts` | Calcolare rendimento benchmark per data corrente |

---

## Risultato Atteso

1. Tooltip benchmark leggibile con sfondo scuro e testo bianco
2. Descrizione completa: "Media ponderata di MSCI World (URTH), S&P 500 (SPY)..."
3. "Portafoglio" e "Benchmark" in bianco nella legenda
4. Linea benchmark che arriva fino alla data odierna (come la linea portafoglio)
