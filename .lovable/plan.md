

## Fix: Archived filtering non funziona — chiavi incompatibili

### Causa radice

Le `archivedKeys` sono stringhe come `"RAVE RESTAURANT GROUP RAVE"`, `"AQUESTIVE THERAPEUTICS AQST"`.
Le chiavi nella balance map sono **ticker risolti** come `"RAVE"`, `"AQST"`.

Il codice attuale confronta `normalizeForMatching("RAVE")` con `normalizeForMatching("RAVE RESTAURANT GROUP RAVE")` — non matchano mai, quindi il filtro non esclude nulla.

### Fix

**File: `src/lib/monitoringEngine.ts`** — funzione `computeAvailableCalls`

Invece di normalizzare le archivedKeys e confrontarle con `normalizeForMatching(key)`, bisogna **risolvere le archivedKeys attraverso `resolveKey`** (la stessa funzione usata per stock e derivati), così entrambi i lati usano lo stesso tipo di chiave (il ticker).

```typescript
// Prima (non funziona):
const archivedSet = new Set(archivedKeys.map(k => normalizeForMatching(k)));
// confronto: normalizeForMatching("RAVE") vs normalizeForMatching("RAVE RESTAURANT GROUP RAVE")

// Dopo (corretto):
const archivedSet = new Set(archivedKeys.map(k => resolveKey(k, underlyingPrices)));
// confronto: "RAVE" vs "RAVE" ✓
```

In più, aggiungere un fallback con `normalizeForMatching` per i casi in cui `resolveKey` non trova il ticker (archived key non presente in underlyingPrices):

```typescript
const archivedResolved = new Set<string>();
for (const k of archivedKeys) {
  archivedResolved.add(resolveKey(k, underlyingPrices));  // ticker se risolvibile
  archivedResolved.add(normalizeForMatching(k));           // fallback normalizzato
}

// Nel loop: skip se key O normKey O normTicker è nel set
```

### File da modificare

1. **`src/lib/monitoringEngine.ts`** — Riscrivere la costruzione di `archivedSet` in `computeAvailableCalls` per risolvere le chiavi tramite `resolveKey`

### Risultato atteso

I ticker archiviati (RAVE, AQST, INDI, HIVE, MARA, QS, SMR, AAPL, ARVN, TLRY, CAPR) scompaiono dalle "Call da rivendere" per maurog.

