

## Gestione assegnazione opzioni PUT nella calcolatrice premi

### Contesto
Quando una PUT venduta viene assegnata, l'utente compra titoli allo strike e li rivende a mercato. Questa perdita/guadagno deve essere tracciata nei flussi di cassa. Se ci sono più PUT aperte candidate, l'utente deve scegliere quale considerare.

### Modifiche

#### 1. `src/lib/orderFileParser.ts`

- **Non filtrare** le righe NN (stock trades): rimuovere il `continue` per `NN`, ma marcarle con `optionType: null` e un nuovo campo `isStockTrade: true` nell'interfaccia `ParsedOrder`
- Per i trade azionari il `orderValue` va calcolato come `quantity * avgPrice` (senza moltiplicare ×100)
- Nuova funzione esportata `detectOpenPuts(orders, ticker)`: tra gli ordini PUT eseguiti per quel ticker, calcola per ogni simbolo il saldo netto (sell qty - buy qty). Ritorna le PUT con saldo > 0 (aperte), con il relativo strike estratto dal simbolo
- Nuova funzione esportata `buildAssignmentOrder(stockSellOrder, putStrike)`: dato un ordine di vendita titoli e lo strike della PUT assegnata, crea un ordine sintetico con `isAssignment: true`, `optionType: null`, `orderValue = (avgPrice - putStrike) * quantity` (negativo se strike > avgPrice)

#### 2. `src/components/derivatives/CallPremiumCalculatorDialog.tsx`

- Dopo il parsing del file (`onDrop`), cercare tra gli ordini parsati le vendite di titoli (stock sells con `isStockTrade: true`)
- Per ogni vendita titoli, chiamare `detectOpenPuts` per trovare le PUT aperte per quel ticker
  - **Se 1 sola PUT aperta** → creare automaticamente l'ordine di assegnazione con `buildAssignmentOrder`
  - **Se più PUT aperte** → mostrare un dialog/select all'utente con le PUT candidate (simbolo, strike, scadenza) per scegliere quale assegnazione considerare. Aggiungere uno state `pendingAssignments` e un piccolo dialog di selezione
  - **Se 0 PUT aperte** → ignorare la vendita titoli
- Gli ordini di assegnazione vengono aggiunti alla lista `callOrders` (o un nuovo array dedicato) e inclusi nel calcolo dei flussi di cassa
- Nella tabella operazioni, le righe di assegnazione mostrano un badge arancione **"ASSEGNAZIONE"** e il valore calcolato

#### 3. Interfaccia `ParsedOrder` — nuovi campi opzionali

```typescript
isStockTrade?: boolean;    // true per righe NN (vendita/acquisto titoli)
isAssignment?: boolean;    // true per ordini sintetici di assegnazione
assignmentStrike?: number; // strike della PUT assegnata
```

### File da modificare
- `src/lib/orderFileParser.ts` — parsing NN, `detectOpenPuts`, `buildAssignmentOrder`
- `src/components/derivatives/CallPremiumCalculatorDialog.tsx` — logica assegnazione con dialog di selezione PUT, badge nella tabella

