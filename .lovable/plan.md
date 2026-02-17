

## Modifica logica P/L per "Altre Strategie" senza operazioni in calcolatrice

### Cosa cambia

Quando **non** ci sono operazioni salvate nella calcolatrice, il P/L viene calcolato come:

**P/L = Valore ai PMC + Valore al prezzo di mercato**

- Valore ai PMC = somma di (avg_cost x quantita x 100) per ogni gamba
- Valore al prezzo di mercato = somma di (current_price x quantita x 100) per ogni gamba
- La somma dei due da il P/L (il PMC e' positivo se venduta, il prezzo mercato e' negativo se da ricomprare)

Il P/L senza operazioni storiche viene mostrato in **giallo oro** (invece di verde/rosso) con un tooltip che indica "P/L calcolato senza operazioni storiche caricate".

Quando ci sono operazioni nella calcolatrice, la logica resta invariata (flussi di cassa + valore mercato, colori verde/rosso).

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx`** -- funzione `GroupedOtherStrategyRow` (intorno a riga 1771-1776 e 1942-1953)

1. **Calcolo P/L senza calcolatrice** (riga ~1776): quando `!hasSavedGP`, calcolare il P/L come somma del valore ai PMC e del valore di mercato:
   ```
   const avgCostValue = options.reduce((sum, o) => {
     const acv = (o.option.avg_cost || 0) * o.option.quantity * 100;
     return sum + acv;
   }, 0);
   const combinedPL = hasSavedGP
     ? savedPremium.net_per_share + marketValuePositions
     : avgCostValue + marketValuePositions;
   ```

2. **Colore giallo oro** (riga ~1945): condizionare la classe CSS:
   - Se `hasSavedGP`: verde/rosso come attuale (`text-green-500` / `text-red-500`)
   - Se `!hasSavedGP`: giallo oro (`text-yellow-500`)

3. **Tooltip differenziato** (riga ~1951): aggiornare il testo del tooltip per indicare la fonte del calcolo:
   - Con calcolatrice: testo attuale (flussi di cassa + valore mercato)
   - Senza calcolatrice: "P/L calcolato senza operazioni storiche caricate"

