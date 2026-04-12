

## Fix: matching normalizzato universale in monitoringEngine

### Causa

`resolveTickerFromPrices` fa un lookup **esatto** `underlyingPrices[text]`. Per maurog (broker Fineco), gli stock hanno prefisso `AZ.` nella description ma `underlyingPrices` è indicizzato sui nomi underlying dei derivati (senza `AZ.`). Il lookup fallisce, stock e derivati finiscono su chiavi diverse, tutti i conteggi saltano.

Per silvias funziona solo perché il suo broker non aggiunge prefissi — il codice non è robusto, ha funzionato per coincidenza.

### Fix

**File: `src/lib/monitoringEngine.ts`**

Riscrivere `resolveTickerFromPrices` per fare matching normalizzato quando il lookup esatto fallisce:

1. Lookup esatto (come oggi) — O(1)
2. Se fallisce: normalizzare il testo con `normalizeForMatching` e `getCanonicalKey`, poi cercare tra tutte le chiavi di `underlyingPrices`
3. Cache interna per evitare iterazioni ripetute

```typescript
function resolveTickerFromPrices(text, underlyingPrices) {
  // 1. Exact
  if (underlyingPrices[text]?.ticker) return underlyingPrices[text].ticker;
  
  // 2. Normalized fallback
  const norm = normalizeForMatching(text);
  const canon = getCanonicalKey(text);
  for (const [key, data] of Object.entries(underlyingPrices)) {
    if (!data.ticker) continue;
    if (canon && getCanonicalKey(key) === canon) return data.ticker;
    if (normalizeForMatching(key) === norm) return data.ticker;
  }
  return null;
}
```

Questo fix è universale: funziona per qualsiasi prefisso broker (`AZ.`, o altri futuri) perché `normalizeForMatching` li rimuove.

### File da modificare

1. `src/lib/monitoringEngine.ts` — riscrivere `resolveTickerFromPrices` con matching normalizzato e cache

