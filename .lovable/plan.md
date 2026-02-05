

# Piano: Correzione Visualizzazione Ticker nel Dialog Avvisi

## Problema Identificato

Il sistema **ha già i ticker** - vengono restituiti dalla edge function `fetch-underlying-prices` nel campo `ticker` dell'oggetto `underlyingPrices`. Il problema è che la funzione `extractUniqueTickers` nel dialog non riesce a trovare corrispondenze tra:

1. Gli underlying estratti dalle categorie (es. `cc.option.underlying` = "AMAZON COM INC")
2. Le chiavi dell'oggetto `underlyingPrices` (es. "AMAZON COM" o diversa normalizzazione)

## Soluzione

Invece di cercare di fare il match tra underlying e `underlyingPrices`, **iteriamo direttamente su `underlyingPrices`** che contiene già tutti i ticker risolti. Poi confrontiamo con gli underlying delle strategie per identificare quelli non risolti.

---

## Modifica al File `AlertSettingsDialog.tsx`

### Problema nella funzione `extractUniqueTickers`:

```typescript
// ATTUALE - cerca match esatto che può fallire
const priceData = underlyingPrices[underlying];
if (priceData?.ticker) { ... }
```

### Nuova logica:

```typescript
function extractUniqueTickers(
  categories: DerivativeCategories,
  underlyingPrices: Record<string, UnderlyingPrice>
): { 
  resolved: Array<{ underlying: string; ticker: string }>;
  unresolved: string[];
} {
  // 1. Raccogli TUTTI gli underlying dalle categorie
  const allCategoryUnderlyings = new Set<string>();
  
  categories.ironCondors.forEach(ic => allCategoryUnderlyings.add(ic.underlying));
  categories.doubleDiagonals.forEach(dd => allCategoryUnderlyings.add(dd.underlying));
  categories.coveredCalls.forEach(cc => {
    const u = cc.option.underlying || cc.underlying?.description;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.nakedPuts.forEach(np => {
    const u = np.option.underlying;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.leapCalls.forEach(lc => {
    const u = lc.option.underlying;
    if (u) allCategoryUnderlyings.add(u);
  });
  categories.groupedOtherStrategies.forEach(g => allCategoryUnderlyings.add(g.underlying));
  
  // 2. Usa DIRETTAMENTE underlyingPrices per i ticker risolti
  //    (le chiavi sono gli underlying originali, il valore contiene .ticker)
  const resolvedTickersSet = new Set<string>();
  const resolved: Array<{ underlying: string; ticker: string }> = [];
  
  for (const [underlying, priceData] of Object.entries(underlyingPrices)) {
    if (priceData.ticker && !resolvedTickersSet.has(priceData.ticker)) {
      resolvedTickersSet.add(priceData.ticker);
      resolved.push({ underlying, ticker: priceData.ticker });
    }
  }
  
  // 3. Trova underlying non risolti
  //    (quelli presenti nelle categorie ma senza entry in underlyingPrices)
  const resolvedUnderlyings = new Set(Object.keys(underlyingPrices));
  const unresolved: string[] = [];
  
  for (const underlying of allCategoryUnderlyings) {
    if (!underlying) continue;
    
    // Cerca se esiste una chiave corrispondente (match esatto o parziale)
    let found = false;
    for (const priceKey of resolvedUnderlyings) {
      if (priceKey === underlying || 
          priceKey.includes(underlying) || 
          underlying.includes(priceKey)) {
        found = true;
        break;
      }
    }
    
    if (!found) {
      unresolved.push(underlying);
    }
  }
  
  return { 
    resolved: resolved.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    unresolved: [...new Set(unresolved)].sort()
  };
}
```

---

## Logica Chiave

La correzione si basa su un'osservazione fondamentale:

- **`underlyingPrices`** contiene già SOLO gli underlying per cui è stato trovato un prezzo E un ticker
- La chiave dell'oggetto è l'underlying originale (es. "AMAZON COM INC")
- Il valore contiene `{ price, currency, ticker }`

Quindi invece di:
1. Raccogliere underlying dalle categorie
2. Cercare match in underlyingPrices
3. Estrarre ticker

Facciamo:
1. Iterare direttamente su underlyingPrices (che ha già i ticker)
2. Raccogliere underlying dalle categorie per trovare quelli non risolti

---

## Risultato Atteso

Nel tab "Per Ticker" del dialog Gestione Avvisi:

- **Ticker disponibili**: AAPL, AMZN, APP, GOOGL, NVDA, MSFT, ... (tutti quelli presenti in `underlyingPrices`)
- **Ticker non risolti**: Solo quelli per cui la edge function non ha trovato un prezzo

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/derivatives/AlertSettingsDialog.tsx` | Riscrivere `extractUniqueTickers` per usare direttamente `underlyingPrices` |

