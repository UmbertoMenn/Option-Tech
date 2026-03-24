

## Fix: detect put spread / diagonal put spread come "altre strategie"

### Problema
Quando ci sono una put venduta e una put comprata con strike più basso, la combinazione è un **bull put spread** (stessa scadenza) o un **diagonal put spread** (scadenze diverse). Attualmente `detectStrategyType` classifica erroneamente queste combinazioni — ad esempio come `derisking_covered_call` (riga 101) quando ci sono anche call vendute, perché il check `boughtPuts.length > 0` scatta senza verificare la relazione tra gli strike delle put.

### Fix

**File**: `src/components/derivatives/StrategyConfigWizard.tsx` — funzione `detectStrategyType` (righe 82-109)

Aggiungere un check **prima** della logica covered call (riga 100): se ci sono put vendute E put comprate con strike inferiore allo strike della put venduta, e non ci sono call, → `other`.

Inoltre, nel ramo `derisking_covered_call` (riga 101), verificare che la put comprata abbia strike **superiore o uguale** allo strike della put venduta (protezione vera). Se lo strike della put comprata è **inferiore**, non è una protezione ma uno spread → non classificare come derisking.

Logica aggiornata:

```typescript
// Check for put spread (bought put strike < sold put strike) → 'other'
if (soldPuts.length > 0 && boughtPuts.length > 0) {
  const maxSoldPutStrike = Math.max(...soldPuts.map(p => p.strike_price || 0));
  const minBoughtPutStrike = Math.min(...boughtPuts.map(p => p.strike_price || 0));
  
  // If bought put is below sold put → it's a spread, not protection
  if (minBoughtPutStrike < maxSoldPutStrike) {
    // If no calls involved, it's a pure put spread
    if (soldCalls.length === 0 && boughtCalls.length === 0) return 'other';
    // If calls are present but puts form a spread, don't treat bought put as protection
    // Fall through without triggering derisking_covered_call
  }
}

// In the covered call section, only classify as derisking if bought put is protective (strike >= sold put)
if (soldCalls.length > 0 && (hasStock || soldPuts.some(p => Math.abs(p.strike_price || 0) > 0))) {
  const isProtectivePut = boughtPuts.length > 0 && boughtPuts.every(bp => {
    const relevantSoldPut = soldPuts.find(sp => true); // nearest sold put
    return !relevantSoldPut || (bp.strike_price || 0) >= (relevantSoldPut.strike_price || 0);
  });
  if (isProtectivePut) return 'derisking_covered_call';
  if (hasStock) return 'covered_call';
}
```

### File da modificare
- `src/components/derivatives/StrategyConfigWizard.tsx` — funzione `detectStrategyType`, righe 93-108

