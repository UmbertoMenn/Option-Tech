

## Allineare calcolatrice e P/L di Altre Strategie e Iron Condor al Double Diagonal

### Cosa cambia
1. Il tooltip della calcolatrice per Altre Strategie e Iron Condor cambiera' da "Calcola gain potenziale" a "Calcola flussi di cassa"
2. Il titolo e l'etichetta del valore nella finestra calcolatrice mostreranno "Flussi di cassa" anche per Iron Condor e Altre Strategie (non solo per Double Diagonal)
3. La colonna P/L delle Altre Strategie avra' un tooltip informativo e il prefisso "P/L:", identico al Double Diagonal

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx`**

1. **Riga 1198** -- Tooltip calcolatrice Iron Condor: cambiare "Calcola gain potenziale" in "Calcola flussi di cassa"

2. **Riga 1825** -- Tooltip calcolatrice Altre Strategie: cambiare "Calcola gain potenziale" in "Calcola flussi di cassa"

3. **Righe 1942-1947** -- Colonna P/L Altre Strategie: aggiungere Tooltip con testo "Profit/Loss: somma dei P/L delle N gambe + flussi di cassa calcolatrice" e aggiungere prefisso "P/L:" come nel Double Diagonal:
```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <div className={`flex items-center gap-1 cursor-help justify-end whitespace-nowrap ${combinedPL >= 0 ? 'text-green-500' : 'text-red-500'}`} onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-muted-foreground">P/L:</span>
      <span className="text-sm">{formatCurrency(combinedPL, legCurrency)}</span>
    </div>
  </TooltipTrigger>
  <TooltipContent>
    <p>Profit/Loss: somma dei P/L delle {options.length} gambe{hasSavedGP ? ' + flussi di cassa calcolatrice' : ''}</p>
  </TooltipContent>
</Tooltip>
```

**File: `src/components/derivatives/CallPremiumCalculatorDialog.tsx`**

4. **Riga 247** -- Titolo dialog: estendere la condizione per includere `iron_condor` e `other_strategy`:
```typescript
{(strategyType === 'double_diagonal' || strategyType === 'iron_condor' || strategyType === 'other_strategy') ? 'Calcola Flussi di cassa' : isMultiLeg ? 'Calcola Gain Potenziale' : 'Calcola Premi CALL'}
```

5. **Riga 297** -- Etichetta valore: stessa estensione della condizione:
```typescript
{(strategyType === 'double_diagonal' || strategyType === 'iron_condor' || strategyType === 'other_strategy') ? 'Flussi di cassa' : isMultiLeg ? 'Gain Potenziale' : 'Netto Unitario'}
```

### Nota sul calcolo P/L
Il calcolo P/L delle Altre Strategie e' gia' equivalente a quello del Double Diagonal: somma `net_per_share` salvato + valore di mercato delle posizioni aperte. Nessuna modifica alla logica di calcolo.
