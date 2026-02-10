

## Modifica prezzo nelle URL OptionStrat: usare PMC invece del prezzo attuale

### Cosa cambia

Nel file `src/lib/optionStratUrl.ts`, nella funzione `formatLeg`, il prezzo dopo `@` deve essere il **PMC (avg_cost)** invece del prezzo corrente.

### Dettaglio tecnico

**File**: `src/lib/optionStratUrl.ts`, riga ~43

Codice attuale:
```typescript
const price = formatStrike(option.current_price || option.avg_cost);
```

Nuovo codice:
```typescript
const price = formatStrike(option.avg_cost || option.current_price);
```

Invertendo la priorità, il sistema usa `avg_cost` (PMC) come valore primario, con fallback su `current_price` solo se il PMC non è disponibile.

Una sola riga da modificare.

