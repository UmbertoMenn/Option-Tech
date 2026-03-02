

## Bug: confronto case-sensitive nella diagnostica

La diagnostica usa `Set.has()` con stringhe esatte, ma i nomi nelle `positions` sono in case misto (`Broadcom Inc`, `Eni`, `Ferrari`) mentre in `underlying_mappings` sono tutti maiuscoli (`BROADCOM INC`, `ENI`, `FERRARI`). Il tab Ticker non li mostra perché usa normalizzazione case-insensitive.

### Fix

**File: `src/components/admin/ResolutionDiagnostics.tsx`**

Nella sezione "Underlying senza mapping" (riga 54, 66), normalizzare entrambi i set prima del confronto:

```typescript
// Riga 54: normalizzare le chiavi del set mappings
const normalize = (s: string) => s.toUpperCase().replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim();
const mappedUnderlyings = new Set(mappings.map(m => normalize(m.underlying)));

// Riga 66: normalizzare anche gli underlying delle posizioni nel confronto
const noMapping = [...derivativeUnderlyings].filter(u => !mappedUnderlyings.has(normalize(u))).sort();
```

Questo allinea la logica della diagnostica con quella del tab Ticker, eliminando i falsi positivi.

