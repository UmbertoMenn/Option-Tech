

## Fix: Naked Put intrinsic più negativo del valore di mercato

### Causa
In `getBreakdownForViewMode`, per il view `netting_ex_cc_np`, il valore intrinseco delle naked put ITM viene calcolato usando il prezzo sottostante corrente (`underlyingPrices` o `snapshot_price` del sottostante), mentre il valore di mercato nel `netting_total` usa il `snapshot_price` dell'opzione. Se il prezzo dell'opzione è stale (non aggiornato), il valore intrinseco calcolato può superare il valore di mercato, il che è economicamente impossibile.

### Soluzione
Aggiungere un cap: il valore intrinseco per ogni posizione naked put non può mai essere più negativo del suo valore di mercato. Lo stesso principio va applicato anche a covered call e de-risking CC.

### Modifica a `src/hooks/useDerivativeNetting.ts`

**In `getBreakdownForViewMode`**, sezione naked put (righe ~500-538):
- Dopo aver calcolato `tickerIntrinsic`, confrontarlo con il valore di mercato del ticker (`det.value`)
- Se `tickerIntrinsic < det.value` (più negativo), usare `det.value` come cap

```typescript
// Cap: intrinsic cannot exceed market value in absolute terms
if (tickerIntrinsic < det.value) {
  tickerIntrinsic = det.value;
}
```

**Stessa logica per covered_call e derisking_cc** (righe ~440-497):
- Cap `tickerIntrinsic` a `det.value` per evitare lo stesso problema con prezzi stale delle covered call

**In `computeSinglePortfolioNetting`**, sezione naked_put (righe ~256-273):
- Applicare lo stesso cap anche al calcolo di `nettingExCCAndNP`: se `-intrinsicValue` è più negativo di `nettingValue`, usare `nettingValue`

```typescript
const cappedIntrinsic = Math.max(-intrinsicValue, nettingValue);
nettingExCCAndNP += cappedIntrinsic;
```

### File da modificare
- `src/hooks/useDerivativeNetting.ts` — aggiungere cap intrinseco ≤ mercato in 3 punti

