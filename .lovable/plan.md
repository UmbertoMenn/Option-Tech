

## Cambio logica Rolling Dinamico

### Cosa cambia

**Attuale**: se i premi annualizzati superano la soglia, rolla sulla prima scadenza disponibile con distanza minima strike, **anche in perdita** (nessun controllo sul premio netto della nuova operazione).

**Nuovo**: se i premi annualizzati superano la soglia, cerca la **scadenza più vicina** con distanza minima strike tale per cui, dopo acquisto della vecchia e vendita della nuova, i premi annualizzati **restano ≥ soglia**.

### Logica implementativa

In `executeDynamicRolling` (`src/lib/backtestEngine.ts`):

1. Calcolo premi annualizzati correnti (invariato)
2. Se sotto soglia → `return null` (invariato)
3. **Nuovo ciclo**: per ogni scadenza disponibile (dalla più vicina):
   - Calcolo strike minimo con distanza %
   - Calcolo prezzo nuova call e costo riacquisto vecchia
   - **Simulo** l'effetto sul calcolo annualizzato: creo un log "ipotetico" aggiungendo l'operazione di roll (vendita nuova - riacquisto vecchia) e ricalcolo `calcAnnualizedPremiumPct`
   - Se il risultato ≥ soglia → eseguo il roll su quella scadenza/strike
4. Se nessuna scadenza soddisfa → `return null`

### File modificati

- `src/lib/backtestEngine.ts` — funzione `executeDynamicRolling`
- `src/lib/adjustmentRules.ts` — aggiornamento commento descrittivo (nessun campo nuovo necessario, i parametri `dynamicAnnualizedPremiumPct` e `dynamicMinDistancePct` restano gli stessi)
- `src/components/simulator/AdjustmentRuleEditor.tsx` — aggiornamento testo descrittivo del Rolling Dinamico per riflettere la nuova logica

