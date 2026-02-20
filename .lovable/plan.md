

## Card Movimenti Cronologici

### Obiettivo
Aggiungere una card in `BacktestResults` che mostra tutte le operazioni singole (acquisti/vendite) in ordine cronologico, estratte dall'`adjustmentLog` e dall'apertura iniziale della strategia.

### Logica

Ogni `AdjustmentLog` contiene `legsRemoved` (posizioni chiuse) e `legsAdded` (posizioni aperte). Si costruisce un array di "movimenti" piatto:

1. **Apertura iniziale**: dalle `legs` iniziali del backtest (es. "BUY 100 STOCK @ $X", "SELL 1 CALL K @ $Y")
2. **Chiusure**: da ogni `adj.legsRemoved` -> "BUY 1 CALL K (chiusura) @ $X"
3. **Aperture**: da ogni `adj.legsAdded` -> "SELL 1 CALL K @ $X"

Ogni riga mostra: data, tipo (BUY/SELL), strumento (STOCK/CALL), strike, scadenza, quantita, prezzo, costo totale.

### Modifiche

**File**: `src/components/simulator/BacktestResults.tsx`

- Aggiungere una nuova Card "Movimenti" dopo le stat cards e prima del log aggiustamenti
- Costruire l'array dei movimenti a partire da `result.adjustmentLog` (che contiene `legsAdded` e `legsRemoved`)
- Includere anche le leg iniziali come primo movimento (data = prima barra)
- Tabella con colonne: Data, Operazione (BUY/SELL badge colorato), Strumento, Strike, Scadenza, Qty, Prezzo, Totale
- Ordinamento cronologico per data
- Badge verde per SELL (incasso premio), rosso per BUY (costo)
- ScrollArea per gestire molte righe

### Dettaglio tecnico

Interfaccia interna al componente:
```text
TradeMovement {
  date: string
  action: 'BUY' | 'SELL'
  instrument: string      // "STOCK" | "CALL K120 exp 2024-03-15"
  type: 'stock' | 'call' | 'put'
  strike: number
  expiry: string
  quantity: number
  price: number
  total: number           // price * quantity * multiplier
}
```

Costruzione array:
1. Per ogni leg iniziale: action = quantity > 0 ? 'BUY' : 'SELL', date = leg.entryDate
2. Per ogni adjustment:
   - legsRemoved -> action inversa (se era SELL, ora BUY per chiudere)
   - legsAdded -> action diretta dal segno della quantity
3. Sort per data

| File | Modifica |
|------|----------|
| `src/components/simulator/BacktestResults.tsx` | Aggiungere card "Movimenti" con tabella cronologica delle operazioni |

