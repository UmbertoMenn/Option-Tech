

## Fix: Quantita' mancante nel link OptionStrat da posizioni

### Problema

`formatLeg()` usa `quantity` solo per determinare il prefisso `-` (vendita), ma ignora completamente il valore assoluto della quantita'. Quando ci sono 2 contratti venduti (qty = -2), genera `-.KLAC...P1660@78.5` invece del corretto `.KLAC...P1660x-2@78.5`.

### Formato corretto OptionStrat

- 1 contratto comprato: `.TICKER...C100@5` (nessun suffisso)
- 1 contratto venduto: `-.TICKER...C100@5` (prefisso `-`, nessun suffisso)
- 2+ contratti comprati: `.TICKER...C100x2@5` (suffisso `x2`, nessun prefisso)
- 2+ contratti venduti: `.TICKER...C100x-2@5` (suffisso `x-2`, nessun prefisso)

Il prefisso `-` si usa solo per qty = -1. Per qty multipli, il segno va dentro il suffisso `xN`.

### Soluzione

**File: `src/lib/optionStratUrl.ts`** -- funzione `formatLeg`

Modificare per includere la quantita' quando `|qty| > 1`:

```typescript
function formatLeg(ticker: string, option: Position): string {
  const qty = option.quantity;
  const absQty = Math.abs(qty);
  const type = option.option_type === 'call' ? 'C' : 'P';
  const expiry = formatExpiry(option.expiry_date);
  const strike = formatStrike(option.strike_price);
  const price = formatStrike(option.avg_cost || option.current_price);

  if (absQty === 1) {
    const prefix = qty < 0 ? '-' : '';
    return `${prefix}.${ticker}${expiry}${type}${strike}@${price}`;
  }
  // qty > 1: use xN (positive) or x-N (negative), no prefix
  const qtySuffix = `x${qty}`;
  return `.${ticker}${expiry}${type}${strike}${qtySuffix}@${price}`;
}
```

### Risultato atteso

KLA Corp con 2 put vendute a strike 1660:
- Prima: `-.KLAC260220P1660@78.5`
- Dopo: `.KLAC260220P1660x-2@78.5`

### Nessuna modifica ad altri file

La funzione `formatLeg` e' usata da `buildOptionStratUrl`, `buildCoveredCallUrl`, e tutte le funzioni di costruzione URL da posizioni. Il fix si applica automaticamente ovunque.

