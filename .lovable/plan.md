

## Fix: Commissioni fisse per operazioni su titoli (NN) e assegnazioni

### Problema
La riga `const commissions = totalLots * transactionCost` calcola le commissioni moltiplicando la quantità per 10 USD per **tutti** gli ordini, inclusi quelli su titoli (NN) e assegnazioni. Ma per le operazioni su titoli, la commissione è fissa a 10 USD/EUR per transazione, non per lotto.

### Soluzione
In `calculatePremiumMetrics` (`src/lib/orderFileParser.ts`, righe 900-902), separare il calcolo:
- **Ordini opzioni** (non `isStockTrade` e non `isAssignment`): `quantità × 10`
- **Ordini titoli/assegnazioni** (`isStockTrade` o `isAssignment`): `10` fisso per ordine

```
commissions = Σ(option orders: qty × 10) + Σ(stock/assignment orders: 10 ciascuno)
```

### File da modificare
- `src/lib/orderFileParser.ts` — righe 900-902: iterare su `filteredOrders` e sommare commissioni diverse per tipo

