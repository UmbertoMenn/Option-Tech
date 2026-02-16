

## Aggiungere P/L percentuale alle Naked Put

### Cosa cambia
Accanto al prezzo dell'opzione nella riga Naked Put verra' mostrata la variazione percentuale rispetto al PMC, come gia' fatto per Long Put e Covered Call.

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx`**

1. **Aggiungere il calcolo** nella funzione `NakedPutRow` (dopo riga 2208):
```typescript
const currentPrice = option.current_price || 0;
const avgCost = option.avg_cost || 0;
const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
```

2. **Allargare la colonna del prezzo** nel grid template (riga 2217): cambiare l'ultima colonna da `7rem` a `8rem`.

3. **Aggiungere la percentuale nel Col 10 (Prezzo)** dopo l'indicatore stale price (riga 2310), con colori invertiti per opzioni vendute (verde se il prezzo scende, rosso se sale):
```typescript
{priceChangePct !== null && (
  <span className={`text-xs font-medium ${priceChangePct <= 0 ? 'text-green-500' : 'text-red-500'}`}>
    {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
  </span>
)}
```

### Nota sui colori
Le Naked Put sono opzioni **vendute**, quindi la logica dei colori e' invertita rispetto alle Long Put: verde se il prezzo scende (guadagno per il venditore), rosso se sale (perdita). Coerente con le Covered Call.

