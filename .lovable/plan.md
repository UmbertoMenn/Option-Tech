
# Piano: Correggere il Calcolo del Rischio con Protezioni Parziali

## Problema Identificato

Il calcolo del rischio per AMD mostra un valore errato perché:

1. **La PUT 115 DEC/27 non viene usata come protezione** - Il codice raggruppa tutte le opzioni su AMD in "Altre Strategie" anziché riconoscere la PUT comprata come protezione
2. **La formula usa un solo strike** - Il codice attuale usa solo lo strike più alto per tutte le azioni protette, senza considerare correttamente la protezione parziale

### Dati AMD dal Database

| Tipo | Strike | Quantità | Scadenza |
|------|--------|----------|----------|
| Stock | - | 700 azioni @ $236.73 | - |
| PUT | 115 | +5 (comprata) | DEC/27 |
| PUT | 240 | -2 (venduta) | FEB/26 |
| PUT | 250 | -1 (venduta) | FEB/26 |
| CALL | 230 | -2 (venduta) | FEB/26 |
| CALL | 250 | -5 (venduta) | DEC/27 |

### Calcolo Corretto (Formula Utente)

```
Rischio = (Azioni_non_protette × Prezzo) + (Azioni_protette × (Prezzo - Strike))

Per AMD con 5 PUT 115 (protezione per 500 azioni su 700):
- Non protette: (700 - 500) × $236.73 = $47,346
- Protette: 500 × ($236.73 - $115) = $60,865
- Totale: $107,211 USD / 1.1869 = €90,360 EUR
```

---

## Causa Radice

### 1. Classificazione Derivati

In `derivativeStrategies.ts`, quando un sottostante ha **più opzioni**, tutte vengono raggruppate in "Altre Strategie". La PUT 115 comprata non viene estratta separatamente come protezione anche se il sottostante esiste.

### 2. Formula Rischio (Problema Secondario)

Anche se la formula algebrica è equivalente a quella corretta, il codice attuale:
- Prende un solo strike (il più alto)
- Non considera PUT multiple a strike diversi
- Non bilancia correttamente protezione vs azioni

---

## Soluzione Proposta

### Approccio 1: Estrarre le Long PUT dal calcolo strategie (CONSIGLIATO)

Modificare `riskCalculator.ts` per cercare protezioni **direttamente dalle posizioni del portafoglio**, non solo dalla categoria `longPuts`:

```typescript
function findProtectivePuts(
  stock: Position,
  allPositions: Position[],
  existingLongPuts: LongPutPosition[]
): { puts: Position[], totalContracts: number } {
  // 1. Cerca nelle longPuts classificate
  const fromCategory = existingLongPuts.filter(lp => matchesUnderlying(lp.option, stock));
  
  // 2. Cerca PUT comprate non classificate nelle posizioni
  const allDerivatives = allPositions.filter(p => 
    p.asset_type === 'derivative' && 
    p.option_type === 'put' && 
    p.quantity > 0 // PUT comprata
  );
  const fromPositions = allDerivatives.filter(put => matchesUnderlying(put, stock));
  
  // Unisci evitando duplicati
  const seenIds = new Set(fromCategory.map(lp => lp.option.id));
  const additional = fromPositions.filter(p => !seenIds.has(p.id));
  
  const totalFromCategory = fromCategory.reduce((sum, lp) => sum + lp.contracts, 0);
  const totalFromPositions = additional.reduce((sum, p) => sum + (p.quantity || 0), 0);
  
  return {
    puts: [...fromCategory.map(lp => lp.option), ...additional],
    totalContracts: totalFromCategory + totalFromPositions
  };
}
```

### Approccio 2: Formula Rischio Corretta per Protezione Parziale

Correggere la formula in `calculateStockRisk` per gestire correttamente le protezioni parziali con strike diversi:

```typescript
// Trova protezioni per questo stock
const { puts, totalContracts } = findProtectivePuts(stock, allPositions, longPuts);

// Calcola azioni protette (max = azioni totali)
const protectedShares = Math.min(totalContracts * 100, stock.quantity || 0);
const unprotectedShares = (stock.quantity || 0) - protectedShares;

// Se ci sono PUT multiple, usa lo strike medio ponderato
let effectiveStrike = 0;
if (puts.length > 0) {
  const totalWeight = puts.reduce((sum, p) => sum + Math.abs(p.quantity || 0), 0);
  effectiveStrike = puts.reduce((sum, p) => 
    sum + (p.strike_price || 0) * Math.abs(p.quantity || 0), 0
  ) / totalWeight;
}

// Formula corretta:
// Rischio = (Azioni_non_protette × Prezzo) + (Azioni_protette × max(0, Prezzo - Strike))
const price = stock.current_price || 0;
const unprotectedRisk = unprotectedShares * price;
const protectedRisk = protectedShares * Math.max(0, price - effectiveStrike);
const riskOriginal = unprotectedRisk + protectedRisk;
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/lib/riskCalculator.ts` | Aggiungere `findProtectivePuts`, modificare `calculateStockRisk` per passare `allPositions` e usare formula corretta |
| `src/hooks/useRiskAnalysis.ts` | Passare `positions` a `analyzePortfolioRisk` per permettere lookup diretto delle PUT |

---

## Dettagli Implementazione

### 1. Modificare `analyzePortfolioRisk` per passare posizioni complete

```typescript
export function analyzePortfolioRisk(
  positions: Position[],
  categories: DerivativeCategories
): RiskAnalysis {
  // ...
  const stockDetails = calculateStockRisk(stocks, categories.longPuts, positions);
  // ...
}
```

### 2. Modificare firma `calculateStockRisk`

```typescript
export function calculateStockRisk(
  stocks: Position[],
  longPuts: LongPutPosition[],
  allPositions: Position[]  // NUOVO parametro
): StockRiskDetail[]
```

### 3. Implementare logica protezione corretta

```typescript
for (const stock of stocks) {
  // ... existing code ...
  
  // Trova TUTTE le PUT comprate su questo stock (non solo quelle classificate)
  const allDerivatives = allPositions.filter(p => p.asset_type === 'derivative');
  const boughtPuts = allDerivatives.filter(p => 
    p.option_type === 'put' && 
    p.quantity > 0 && 
    matchesUnderlying(p, stock)
  );
  
  // Calcola contratti protezione totali
  const protectionContracts = boughtPuts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const protectedShares = Math.min(protectionContracts * 100, stockQuantity);
  const unprotectedShares = stockQuantity - protectedShares;
  
  // Calcola strike medio ponderato
  let avgStrike = 0;
  if (protectionContracts > 0) {
    avgStrike = boughtPuts.reduce((sum, p) => 
      sum + (p.strike_price || 0) * (p.quantity || 0), 0
    ) / protectionContracts;
  }
  
  // Formula corretta
  const unprotectedRisk = unprotectedShares * stockPrice;
  const protectedRisk = protectedShares * Math.max(0, stockPrice - avgStrike);
  const riskOriginal = unprotectedRisk + protectedRisk;
  
  result.push({
    // ...
    protectionStrike: avgStrike > 0 ? avgStrike : null,
    protectionContracts,
    protectedValue: protectedShares * avgStrike, // Per retrocompatibilità UI
    riskOriginal,
    // ...
  });
}
```

---

## Risultato Atteso per AMD

| Metrica | Prima (Errato) | Dopo (Corretto) |
|---------|----------------|-----------------|
| Stock Value | $165,711 | $165,711 |
| Protezioni trovate | 0 | 5 contratti |
| Azioni protette | 0 | 500 |
| Azioni non protette | 700 | 200 |
| **Rischio USD** | $165,711 | **$108,211** |
| **Rischio EUR** | €139,578 | **€91,183** |

La riduzione del rischio sarà di circa €48,400 per AMD.

---

## Note Tecniche

1. **Lookup diretto**: Cercando le PUT direttamente nelle posizioni evitiamo il problema della classificazione in "Altre Strategie"
2. **Strike medio ponderato**: Se ci sono PUT a strike diversi, usiamo la media ponderata per i contratti
3. **Retrocompatibilità**: I campi `protectedValue` e `protectionStrike` rimangono per l'UI esistente
4. **Nessun cambio in derivativeStrategies**: La classificazione rimane invariata, solo il calcolo rischio viene corretto
