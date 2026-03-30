

## Fix: Costo di riacquisto per Netting Totale, mantenere intrinseco per Netting ex CC e NP

### Problema
Slide 2 e 3 del Netting Totale usano valore intrinseco per ITM. L'utente vuole che nel **Netting Totale** si usi sempre il **costo di riacquisto** (prezzo mercato Excel), ma che il calcolo intrinseco resti disponibile per il **Netting ex CC e NP**.

### Modifiche a `src/hooks/useDerivativeNetting.ts`

**1. Aggiungere parametro `viewMode` a `computeOptionTypeBreakdown`**

La funzione riceverà un parametro `mode: 'netting_total' | 'netting_ex_cc_np'`:
- `netting_total` → TUTTE le vendute usano buyback cost: `-(|qty| × 100 × marketPrice) / exchangeRate`
- `netting_ex_cc_np` → ITM vendute usano valore intrinseco (logica attuale), OTM vendute usano market price

**2. Modificare i blocchi ITM (righe 104-108 e 116-120)**

Aggiungere condizione sul mode:
```typescript
if (mode === 'netting_total') {
  // Buyback cost for all sold options
  const mv = -(contracts * 100 * marketPrice) / exchangeRate;
  bucket.total += mv;
  bucket.details.push({ ticker, value: mv });
} else {
  // Intrinsic value for ITM (netting_ex_cc_np)
  const intrinsic = -(contracts * 100 * Math.abs(strike - underlyingPrice)) / exchangeRate;
  bucket.total += intrinsic;
  bucket.details.push({ ticker, value: intrinsic });
}
```

**3. Calcolare due versioni di optionTypeBreakdown nel risultato**

In `computeSinglePortfolioNetting`, chiamare `computeOptionTypeBreakdown` due volte (o una volta con entrambi i mode) e restituire:
- `optionTypeBreakdown` → per netting_total (buyback cost)
- `optionTypeBreakdownIntrinsic` → per netting_ex_cc_np (valore intrinseco)

Oppure, più semplice: calcolare solo con buyback cost e mantenere la logica intrinseca separata nel breakdown esistente (che già la usa per `getBreakdownForViewMode`).

**Approccio scelto (più pulito):** aggiungere `optionTypeBreakdownIntrinsic` come secondo campo nel `NettingResult`.

**4. Stesso allineamento per `computeStrategyBreakdown` (Slide 3)**

La funzione `calcNettingValue` già usa market price → è già corretta per Netting Totale. Nessuna modifica necessaria.

**5. Aggiornare `NettingResult` interface**

```typescript
export interface NettingResult {
  // ... existing fields
  optionTypeBreakdown: OptionTypeBreakdown;        // buyback cost (netting totale)
  optionTypeBreakdownIntrinsic: OptionTypeBreakdown; // intrinsic (netting ex cc np)
  strategyBreakdown: NettingBreakdownItem[];
}
```

**6. `DynamicPortfolioChart.tsx`** — Slide 2 usa `netting.optionTypeBreakdown` quando viewMode è `netting_total`, e `netting.optionTypeBreakdownIntrinsic` quando viewMode è `netting_ex_cc_np`.

### File da modificare
1. `src/hooks/useDerivativeNetting.ts` — due versioni del breakdown per tipo opzione
2. `src/components/dashboard/DynamicPortfolioChart.tsx` — selezione del breakdown corretto in base al viewMode

