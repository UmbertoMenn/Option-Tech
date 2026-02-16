

## Fix: Matching Covered Call ITM per ID posizione

### Problema

In `getBreakdownForViewMode`, il ricalcolo del valore intrinseco delle Covered Call ITM (e Naked Put ITM) usa `.find()` con matching per stringa ticker. Quando esistono piu' covered call sullo stesso sottostante (es. due CALL GOOGL a strike diversi), il `.find()` restituisce sempre la prima, causando il calcolo errato o la perdita della seconda.

### Soluzione

Aggiungere il campo `positionId` a `NettingBreakdownDetail` e usarlo per il matching diretto in `getBreakdownForViewMode`.

### Dettaglio tecnico

**File: `src/hooks/useDerivativeNetting.ts`**

1. **Aggiungere `positionId` all'interfaccia `NettingBreakdownDetail`** (riga 9):
   ```typescript
   export interface NettingBreakdownDetail {
     positionId: string;  // <-- nuovo campo
     ticker: string;
     description: string;
     value: number;
     strike?: number;
     expiry?: string;
   }
   ```

2. **Popolare `positionId` nella creazione del detail** (riga ~88):
   ```typescript
   const detail: NettingBreakdownDetail = {
     positionId: derivative.id,  // <-- aggiunto
     ticker,
     description: derivative.description,
     value: 0,
     strike: derivative.strike_price ?? undefined,
     expiry: derivative.expiry_date ?? undefined,
   };
   ```

3. **Fix matching CC ITM in `getBreakdownForViewMode`** (righe 249-252): sostituire il matching per ticker con matching per position ID tramite `coveredCallMap` (che e' gia' indicizzata per `option.id`):
   ```typescript
   const ccEntry = coveredCallMap.get(det.positionId);
   ```

4. **Fix matching NP ITM in `getBreakdownForViewMode`** (righe 292-295): stesso approccio:
   ```typescript
   const npEntry = nakedPutMap.get(det.positionId);
   ```

5. **Aggiungere `positionId` nell'aggregazione "other by ticker"** (riga ~177): l'aggregazione per ticker puo' preservare un positionId arbitrario dato che il campo serve solo per il matching CC/NP:
   ```typescript
   otherByTicker.set(key, { ...d, strike: undefined, expiry: undefined });
   // positionId viene portato avanti dal primo detail del gruppo
   ```

Queste modifiche garantiscono un matching univoco per ogni posizione derivata, eliminando il problema delle covered call multiple sullo stesso sottostante.

