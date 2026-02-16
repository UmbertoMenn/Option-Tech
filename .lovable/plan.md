

## Semplificare il filtro LEAP: escludere tutte le CALL solo comprate

### Logica attuale

Il filtro LEAP esclude le CALL solo comprate (senza corrispondente vendita) **solo se** lo strike supera il 130% del prezzo del sottostante. Le CALL comprate con strike vicino al prezzo vengono mantenute nel calcolo dei premi.

### Nuova logica

Qualsiasi CALL che ha **solo operazioni di acquisto** (nessuna vendita per lo stesso simbolo) viene esclusa dal calcolo, indipendentemente dallo strike o dal prezzo del sottostante. Il parametro `underlyingPrice` non sara' piu' necessario per il filtro.

### Modifiche

**1. `src/lib/orderFileParser.ts`** -- Funzione `filterAndCalculateCallPremiums`

Semplificare lo Step 3: invece di controllare strike vs prezzo, escludere tutte le CALL buy-only:

```text
const filteredOrders = baseFiltered.filter(order => {
  // Se il simbolo ha almeno una vendita → tieni tutto (Covered Call o rolling)
  if (symbolsWithSells.has(order.symbol)) {
    return true;
  }
  // Solo acquisti per questo simbolo → escludere (LEAP o Long Call)
  return false;
});
```

Rimuovere la costante `LEAP_THRESHOLD` e il controllo su `extractStrikeFromSymbol`. Il parametro `underlyingPrice` puo' restare nella firma per retrocompatibilita' ma non verra' piu' usato nel filtro.

**2. `src/test/orderFileParserHtmlXls.test.ts`** -- Aggiornare i test

| Test | Modifica |
|---|---|
| "should exclude buy-only CALL with high strike (LEAP)" | Rinominare in "should exclude buy-only CALL" e rimuovere il riferimento allo strike |
| "should keep CALL with sell operation" | Nessuna modifica, rimane valido |
| "should keep buy if same symbol has a sell (rolling)" | Nessuna modifica, rimane valido |
| "should keep buy-only CALL with near-money strike" | **Invertire aspettativa**: ora `filteredOrders` deve avere length 0 (viene esclusa) |
| "should filter multiple LEAPs while keeping valid CCs" | Nessuna modifica logica, gia' corretto |
| "should not filter when underlyingPrice is not provided" | **Invertire aspettativa**: ora length 0 (viene esclusa anche senza prezzo) |
| "should handle edge case at exactly 130% threshold" | **Invertire aspettativa**: ora length 0 |
| "should correctly calculate metrics after LEAP filtering" | Nessuna modifica, gia' corretto |

### Risultato atteso

Tutte le CALL con sole operazioni di acquisto vengono escluse dal calcolo dei premi Covered Call, semplificando la logica e rendendo il filtro indipendente dal prezzo del sottostante.

