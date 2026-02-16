

## Fix: Espansione quantita' per FIFO matching corretto

### Problema

Scenario reale: Buy 1x C440, Buy 1x C440, Sell 2x C440. Il FIFO attuale accoppia il primo Buy con l'intero Sell (qty=2), lasciando il secondo Buy come "aperto" anche se la posizione netta e' zero.

### Soluzione: espandere in unita' singole

Prima del FIFO matching, ogni ordine con qty > 1 viene "esploso" in N ordini con qty = 1 allo stesso prezzo. Cosi' il matching 1:1 funziona sempre correttamente.

### Esempio

Input:
```
Buy 1x C440 @ 12
Buy 1x C440 @ 8
Sell 2x C440 @ 15
```

Dopo espansione:
```
Buy 1x C440 @ 12
Buy 1x C440 @ 8
Sell 1x C440 @ 15
Sell 1x C440 @ 15
```

FIFO matching:
- Buy@12 -> Sell@15 -> `.C440@12@15`
- Buy@8 -> Sell@15 -> `.C440@8@15`

Nessuna posizione orfana.

### Dettaglio tecnico

**File: `src/lib/optionStratUrl.ts`** -- funzione `buildOptionStratUrlFromOrders`

Aggiungere un passaggio di espansione dopo il raggruppamento per simbolo e prima del FIFO matching:

```typescript
for (const [, group] of groups) {
  // Expand qty > 1 into individual unit orders
  const expanded: ParsedOrder[] = [];
  for (const order of group) {
    for (let i = 0; i < order.quantity; i++) {
      expanded.push({ ...order, quantity: 1 });
    }
  }

  // FIFO matching on expanded (all qty=1)
  const remaining = [...expanded];
  // ... resto del codice invariato
}
```

Con questa espansione, il suffisso `qtyPart` non servira' mai dentro il loop FIFO (ogni ordine ha qty=1). Pero' posizioni aperte consecutive con lo stesso prezzo e direzione possono essere riaggregate alla fine per produrre il suffisso `xN` corretto nel link.

### Riaggregazione finale (opzionale ma corretta)

Dopo il FIFO matching, le gambe consecutive identiche (stesso prefisso, stesso simbolo, stesso prezzo, non chiuse) vengono unite in una sola con `xN`:

```
.C440@8
.C440@8
-> .C440x2@8
```

Questo mantiene il link pulito e rispetta la regola "quantita' solo se > 1".

### Nessuna modifica ad altri file

Tutto in `buildOptionStratUrlFromOrders` dentro `src/lib/optionStratUrl.ts`.
