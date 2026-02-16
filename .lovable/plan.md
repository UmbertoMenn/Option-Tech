
## Aggiungere P/L percentuale alle Protezioni (Long Put)

### Cosa cambia
Accanto al prezzo dell'opzione nella riga Long Put verra' mostrata la variazione percentuale rispetto al PMC, come gia' avviene per le Covered Call.

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx`**

1. **Aggiungere il calcolo** nella funzione `LongPutRow` (dopo riga 955):
```typescript
const currentPrice = option.current_price || 0;
const avgCost = option.avg_cost || 0;
const priceChangePct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
```

2. **Allargare la colonna del prezzo** nel grid template (riga 964): cambiare l'ultima colonna da `7rem` a `8rem` per fare spazio alla percentuale.

3. **Aggiungere la percentuale nel Col 10 (Prezzo)** dopo l'indicatore stale price (riga 1072), con colori normali per opzioni comprate (verde se il prezzo sale, rosso se scende):
```typescript
{priceChangePct !== null && (
  <span className={`text-xs font-medium ${priceChangePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
    {priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(1)}%
  </span>
)}
```

### Nota sui colori
Le Long Put sono opzioni **comprate**, quindi la logica dei colori e' quella standard: verde se il prezzo sale (guadagno), rosso se scende (perdita). Questo e' opposto alle Covered Call/Naked Put che sono vendute.
