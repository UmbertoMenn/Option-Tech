

## Aggiornamento: assegnazioni nell'URL OptionStrat con quantità dinamica

### Problema
Il piano precedente hardcodava `x100` per le assegnazioni. In realtà la quantità venduta viene dal file Excel (campo `quantity` dell'ordine di assegnazione sintetico), e può essere diversa da 100.

### Soluzione
In `buildOptionStratUrlFromOrders` (`src/lib/optionStratUrl.ts`), nel loop `while (remaining.length > 0)`, prima di `parseSymbolTypeAndStrike`:

```typescript
if (opening.isAssignment && opening.assignmentStrike) {
  const qty = opening.quantity; // dal file Excel (es. 100, 200, 50...)
  const buyPrice = formatStrike(opening.assignmentStrike);
  const sellPrice = formatStrike(opening.avgPrice);
  legs.push(`${ticker}x${qty}@${buyPrice}@${sellPrice}`);
  continue;
}
```

- `quantity` è già disponibile nel `ParsedOrder` sintetico (copiato da `stockSellOrder.quantity` in `buildAssignmentOrder`)
- Formato: `TICKERx{qty}@{strike}@{sellPrice}` (es. `TSLAx100@440@410`, `TSLAx200@440@410`)

### File da modificare
- `src/lib/optionStratUrl.ts` — aggiungere check `isAssignment` nel loop di `buildOptionStratUrlFromOrders`, ~riga 320

