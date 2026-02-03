
# Piano: Fix Duplicazione ETF nella Sector Allocation e Esclusione Opzioni EUROFOREX

## Problema 1: Duplicazione ETF

### Analisi del Bug
Nel file `src/lib/sectorExposure.ts` (linee 272-343), la logica di elaborazione degli ETF presenta un grave bug di controllo flusso:

```
if (isETF && stock.isin && etfAllocations[stock.isin]) {
  if (totalSectorPercentage > 0) {
    // Decompone ETF per settore ✓
    for (...) { ... }
    
    // BUG: Manca "continue" - il codice continua e aggiunge a "Other"!
    sectorExposure.totalRisk += grossValueEUR;  // ← PRIMA DUPLICAZIONE
  }
  
  // BUG: Manca "else" - eseguito SEMPRE anche se già decomposto!
  sectorExposure.totalRisk += grossValueEUR;  // ← SECONDA DUPLICAZIONE
}
```

**Risultato**: Ogni ETF con dati settoriali viene contato **3 volte**:
1. Una volta correttamente decomposto per settore
2. Una volta in "Other" (linee 299-308)
3. Una seconda volta in "Other" (linee 311-320)

### Soluzione
Ristrutturare con `continue` e `else` appropriati:

| Caso | Azione | Controllo Flusso |
|------|--------|------------------|
| ETF con dati settoriali (`totalSectorPercentage > 0`) | Decompone per settore | `continue` dopo il ciclo |
| ETF senza dati settoriali | Assegna a "Other" | `continue` dopo assegnazione |
| Stock singolo (non ETF) | Assegna settore da mapping | Normale flusso |

---

## Problema 2: Esclusione Opzioni EUROFOREX EUROPEAN

### Contesto
Le opzioni su "EUROFOREX EUROPEAN" sono strumenti currency-related che non dovrebbero essere inclusi nell'analisi del rischio azionario/settoriale. 

Il sistema di aggiornamento prezzi (`update-prices-cron`) già marca questo ticker come `'SKIP'`, ma questa esclusione non è propagata al Risk Analyzer.

### Soluzione
Aggiungere un filtro per escludere i derivati con underlying contenente "EUROFOREX" nei seguenti punti:

1. **`src/lib/riskCalculator.ts`** - Funzione `analyzePortfolioRisk`:
   - Filtrare i derivati prima di passarli a `categorizeDerivatives()`

2. **`src/lib/sectorExposure.ts`** - Funzione `calculateSectorExposure`:
   - Filtrare i dati derivati (`nakedPutDetails`, `leapCallDetails`, `strategyDetails`) prima dell'elaborazione

---

## Modifiche Tecniche

### File 1: `src/lib/sectorExposure.ts`

**Linee 265-344** - Correzione logica ETF:

```typescript
// Process stocks (including ETFs)
for (const stock of analysis.stockDetails) {
  // NUOVO: Skip EUROFOREX instruments
  if (stock.underlying.toUpperCase().includes('EUROFOREX')) {
    continue;
  }
  
  const isETF = isETFByName(stock.underlying);
  const grossValueEUR = stock.stockValue / stock.exchangeRate;
  
  if (isETF && stock.isin && etfAllocations[stock.isin]) {
    const allocation = etfAllocations[stock.isin];
    const sectorData = allocation.sectorAllocations || {};
    const totalSectorPercentage = Object.values(sectorData).reduce((a, b) => a + b, 0);
    
    if (totalSectorPercentage > 0) {
      // ETF con dati settoriali - decompone per settore
      for (const [sector, percentage] of Object.entries(sectorData)) {
        if (percentage > 0) {
          const sectorExposure = getOrCreateSector(sector);
          const riskAmount = grossValueEUR * (percentage / 100);
          
          sectorExposure.totalRisk += riskAmount;
          sectorExposure.breakdown.stocks += riskAmount;
          sectorExposure.instruments.push({
            name: stock.underlying,
            riskEUR: riskAmount,
            isETF: true,
            isFromETFDecomposition: true,
            sourceETF: allocation.name || stock.underlying,
            percentage,
            category: 'stocks',
          });
        }
      }
      continue; // ← FIX: Esce dopo decomposizione
    } else {
      // ETF senza dati settoriali - assegna a "Other"
      const sectorExposure = getOrCreateSector('Other');
      sectorExposure.totalRisk += grossValueEUR;
      sectorExposure.breakdown.stocks += grossValueEUR;
      sectorExposure.instruments.push({
        name: stock.underlying,
        riskEUR: grossValueEUR,
        isETF: true,
        isFromETFDecomposition: false,
        category: 'stocks',
      });
      continue; // ← FIX: Esce dopo assegnazione a Other
    }
  } else if (isETF) {
    // ETF senza allocations entry - assegna a "Other"
    const sectorExposure = getOrCreateSector('Other');
    sectorExposure.totalRisk += grossValueEUR;
    sectorExposure.breakdown.stocks += grossValueEUR;
    sectorExposure.instruments.push({
      name: stock.underlying,
      riskEUR: grossValueEUR,
      isETF: true,
      isFromETFDecomposition: false,
      category: 'stocks',
    });
  } else {
    // Stock singolo - assegna settore
    let sector: string;
    if (stock.isin && sectorMappings[stock.isin]?.sector) {
      sector = normalizeSectorName(sectorMappings[stock.isin].sector);
    } else {
      sector = getStockSector(stock.underlying);
    }
    
    const sectorExposure = getOrCreateSector(sector);
    sectorExposure.totalRisk += grossValueEUR;
    sectorExposure.breakdown.stocks += grossValueEUR;
    sectorExposure.instruments.push({
      name: stock.underlying,
      riskEUR: grossValueEUR,
      isETF: false,
      isFromETFDecomposition: false,
      category: 'stocks',
    });
  }
}

// Process derivatives - NUOVO: filtro EUROFOREX
if (includeDerivatives) {
  // Filtra derivati EUROFOREX
  const isEuroforex = (name: string) => name.toUpperCase().includes('EUROFOREX');
  
  // Naked PUTs
  for (const np of analysis.nakedPutDetails) {
    if (isEuroforex(np.underlying)) continue; // ← NUOVO
    // ... resto del codice esistente ...
  }
  
  // Leap CALLs
  for (const lc of analysis.leapCallDetails) {
    if (isEuroforex(lc.underlying)) continue; // ← NUOVO
    // ... resto del codice esistente ...
  }
  
  // Strategies
  for (const strat of analysis.strategyDetails) {
    if (isEuroforex(strat.underlying)) continue; // ← NUOVO
    // ... resto del codice esistente ...
  }
}
```

### File 2: `src/lib/riskCalculator.ts`

**Funzione `analyzePortfolioRisk`** - Aggiungere filtro EUROFOREX ai derivati:

```typescript
export function analyzePortfolioRisk(
  positions: Position[],
  categories: DerivativeCategories
): RiskAnalysis {
  // NUOVO: Helper per escludere EUROFOREX
  const isEuroforex = (name: string) => 
    name?.toUpperCase().includes('EUROFOREX') || false;
  
  // ... codice esistente ...
  
  // Naked put risk - FILTRO
  const filteredNakedPuts = categories.nakedPuts.filter(
    np => !isEuroforex(np.option.underlying || np.option.description)
  );
  const nakedPutDetails = calculateNakedPutRisk(filteredNakedPuts);
  
  // Leap call risk - FILTRO
  const filteredLeapCalls = categories.leapCalls.filter(
    lc => !isEuroforex(lc.option.underlying || lc.option.description)
  );
  const leapCallDetails = calculateLeapCallRisk(filteredLeapCalls);
  
  // Strategy risk - FILTRO implicito (le strategies usano underlying dai derivati)
  // ...
}
```

### File 3: `src/lib/derivativeStrategies.ts`

**Funzione `categorizeDerivatives`** - Escludere EUROFOREX dall'inizio:

```typescript
export function categorizeDerivatives(
  derivatives: Position[],
  allPositions: Position[],
  overrides: DerivativeOverride[] = []
): DerivativeCategories {
  // NUOVO: Filtra derivati EUROFOREX prima di tutto
  const filteredDerivatives = derivatives.filter(d => {
    const name = (d.underlying || d.description || '').toUpperCase();
    return !name.includes('EUROFOREX');
  });
  
  // Usa filteredDerivatives invece di derivatives nel resto della funzione
  // ...
}
```

---

## Riepilogo Modifiche

| File | Tipo | Descrizione |
|------|------|-------------|
| `src/lib/sectorExposure.ts` | Bug fix + Feature | Fix duplicazione ETF con `continue`/`else`; filtro EUROFOREX |
| `src/lib/riskCalculator.ts` | Feature | Filtro EUROFOREX per nakedPuts e leapCalls |
| `src/lib/derivativeStrategies.ts` | Feature | Filtro EUROFOREX all'inizio di `categorizeDerivatives` |

---

## Impatto

| Prima | Dopo |
|-------|------|
| ETF con dati settoriali contati 3 volte | Contati 1 volta (solo decomposti per settore) |
| ETF senza dati settoriali contati 2 volte | Contati 1 volta in "Other" |
| Opzioni EUROFOREX incluse nel rischio | Completamente escluse dal Risk Analyzer |
| Totale settoriale gonfiato | Valori corretti e coerenti |

---

## Note Tecniche

- La correzione ETF è una ristrutturazione del controllo di flusso senza cambiare la logica di business
- L'esclusione EUROFOREX è coerente con il sistema esistente (`update-prices-cron` già marca questi strumenti come `'SKIP'`)
- Nessuna nuova dipendenza richiesta
