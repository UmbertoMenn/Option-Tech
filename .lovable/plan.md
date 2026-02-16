

## Sostituire GP e ML con P/L nella riga Iron Condor

### Cosa cambia
La riga Iron Condor mostrera' il P/L totale (come il Double Diagonal) al posto del Gain Potenziale e Max Loss. Il badge giallo "IC" verra' rimosso.

### Impatto sul Risk Analyzer
Nessuno. Il calcolo del rischio delle strategie avviene in `src/lib/riskCalculator.ts` tramite `calculateIronCondorMaxLoss` e `calculateStrategyRisk`, che operano sulla struttura dati `DerivativeCategories` e sono completamente indipendenti dalla UI della pagina Derivati. Questa modifica e' puramente visuale.

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx` -- funzione `IronCondorRow`**

1. **Sostituire il calcolo di GP e ML** (righe 1138-1151) con il calcolo P/L identico al Double Diagonal:
```typescript
// P/L = saved GP + market value of open positions
const marketValuePositions = 
  ((boughtPut.current_price || 0) * Math.abs(boughtPut.quantity) * 100) +
  ((boughtCall.current_price || 0) * Math.abs(boughtCall.quantity) * 100) -
  ((soldPut.current_price || 0) * Math.abs(soldPut.quantity) * 100) -
  ((soldCall.current_price || 0) * Math.abs(soldCall.quantity) * 100);
const totalPL = (hasSavedGP ? savedPremium.net_per_share : 0) + marketValuePositions;
const isPositivePL = totalPL >= 0;
```

2. **Rimuovere il badge IC** (righe 1176-1179): eliminare la colonna del badge giallo "IC" dal grid e dal template.

3. **Aggiornare il grid template** (riga 1164): rimuovere la colonna `2rem` del badge IC e sostituire le ultime due colonne (GP `6rem` + ML `6.5rem`) con una sola colonna P/L (`7rem`), allineandosi al layout del Double Diagonal:
```
grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_3rem_3rem_5rem_6rem_7rem_4.5rem_7rem]
```

4. **Sostituire Col GP e Col ML** (righe 1297-1321) con un singolo Col P/L identico al Double Diagonal:
```typescript
{/* Col: P/L */}
<Tooltip>
  <TooltipTrigger asChild>
    <div className={`... ${isPositivePL ? 'text-green-500' : 'text-red-500'}`}>
      <span className="text-xs text-muted-foreground">P/L:</span>
      <span className="text-sm">{formatCurrency(totalPL, legCurrency)}</span>
    </div>
  </TooltipTrigger>
  <TooltipContent>
    <p>Profit/Loss: somma dei P/L delle 4 gambe
      {hasSavedGP ? ' + flussi di cassa calcolatrice' : ''}</p>
  </TooltipContent>
</Tooltip>
```

5. **Aggiornare il Summary nel CollapsibleContent** (righe 1388-1393): cambiare da "Gain Potenziale" a "Profit/Loss" con il valore `totalPL`.

6. **Rimuovere variabili inutilizzate**: `gainPotenzialeFromPMC`, `gainPotenziale`, `isPositiveGP`, `maxLoss`, `putSpreadWidth`, `callSpreadWidth`, `maxSpreadWidth`.

