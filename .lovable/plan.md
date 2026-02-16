

## Fix: Ogni ordine Excel diventa una gamba separata nel link OptionStrat

### Problema

La funzione `buildOptionStratUrlFromOrders` raggruppa gli ordini per simbolo e prende solo un'operazione di apertura e una di chiusura per gruppo. Questo e' sbagliato perche':

1. Lo stesso simbolo puo' apparire molte volte con operazioni diverse (es. `CLSG6C350` appare 4 volte: sell, buy, sell, buy)
2. Il raggruppamento perde le operazioni intermedie
3. L'apertura/chiusura viene determinata dalla posizione nell'array, non dall'operazione effettiva

Il risultato: tutte le gambe appaiono come comprate perche' l'ultimo ordine nell'array (usato come "opening") puo' essere un buy.

### Soluzione

Eliminare il raggruppamento per simbolo. Ogni ordine nel `orders_json` diventa una gamba separata nel link OptionStrat.

### Modifica

**File: `src/lib/optionStratUrl.ts`** -- funzione `buildOptionStratUrlFromOrders`

Logica corretta:

```
Per ogni ordine in orders:
  1. Estrarre tipo (C/P) e strike dal simbolo
  2. Estrarre scadenza da expiryDate (campo Excel "Data Scadenza")
  3. Se operation === 'sell' -> prefisso '-', quantita' negativa (-N)
  4. Se operation === 'buy' -> nessun prefisso, quantita' positiva (N)
  5. Formattare: {prefix}.{TICKER}{YYMMDD}{C/P}{STRIKE}x{+/-qty}@{price}
```

Esempio con dati reali dal database:

```text
Ordine: CLSH6C350, sell, qty=1, price=18.6, expiryDate=20/03/2026
Gamba: -.CLS260320C350x-1@18.6

Ordine: CLSG6C330, buy, qty=1, price=11.8, expiryDate=20/02/2026
Gamba: .CLS260220C330x1@11.8
```

### Dettaglio tecnico

Sostituire il corpo della funzione `buildOptionStratUrlFromOrders` (righe 298-334):

```typescript
export function buildOptionStratUrlFromOrders(
  orders: ParsedOrder[],
  ticker: string,
  strategyName: string | null
): string {
  const legs: string[] = [];

  for (const order of orders) {
    const parsed = parseSymbolTypeAndStrike(order.symbol);
    if (!parsed) continue;

    const expiry = expiryDateToYYMMDD(order.expiryDate);
    const isSold = order.operation === 'sell';
    const prefix = isSold ? '-' : '';
    const qty = isSold ? -order.quantity : order.quantity;
    const price = formatStrike(order.avgPrice);

    legs.push(
      `${prefix}.${ticker}${expiry}${parsed.type}${formatStrike(parsed.strike)}x${qty}@${price}`
    );
  }

  const slug = (strategyName && STRATEGY_SLUG_MAP[strategyName]) || 'custom';
  return `https://optionstrat.com/build/${slug}/${ticker}/${legs.join(',')}`;
}
```

Nessuna modifica necessaria agli altri file. La correzione e' interamente in `buildOptionStratUrlFromOrders`.

