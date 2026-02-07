
# Piano: Correzione del calcolo Equity Exposure per il Benchmark

## Problema Identificato

Il benchmark nel grafico delle performance usa una percentuale di esposizione equity del 35.2%, ma questo valore è calcolato usando solo `totalStockRisk` (Stocks + ETF netti delle protezioni).

Nel Risk Analyzer invece viene mostrata la percentuale corretta che include **tutte** le categorie di rischio:
- ETF Azionari
- Azioni (Stocks) 
- Commodities
- Naked PUT
- Leap CALL
- Strategie (Max Loss)

## Soluzione

Modificare l'hook `useEquityExposurePct` per:

1. **Usare `grandTotal`** invece di `totalStockRisk` - questo allinea il calcolo a quello visualizzato nel Risk Analyzer
2. **Applicare un cap al 100%** - se l'esposizione supera il 100% del valore assets, il benchmark usa 100% equity

## Modifiche Tecniche

### File: `src/hooks/useEquityExposurePct.ts`

Cambiamenti:
- Rinominare il campo `equityExposureEUR` in modo semanticamente più corretto (opzionale) oppure mantenerlo per compatibilità
- Usare `analysis.grandTotal` invece di `analysis.totalStockRisk`
- La formula diventa: `equityExposurePct = grandTotal / totalValue`
- Aggiornare i commenti per riflettere la nuova logica
- Il clamp `Math.max(0, Math.min(1, ...))` già presente gestisce il cap al 100%

```typescript
// PRIMA:
const equityExposureEUR = analysis.totalStockRisk;

// DOPO:
const equityExposureEUR = analysis.grandTotal;
```

## Impatto

- Il benchmark sarà ponderato correttamente usando la stessa percentuale visualizzata nel Risk Analyzer
- Se l'esposizione totale supera il 100% del valore assets, il benchmark userà 100% equity e 0% bond
- Nessun impatto su altre parti del codice poiché i campi restituiti rimangono gli stessi

## Validazione

Dopo la modifica:
- Nel grafico Performance Evolution, la percentuale mostrata nel tooltip del benchmark dovrebbe corrispondere a quella visualizzata nel Risk Analyzer sotto "Esposizione in Equity e Commodities"
