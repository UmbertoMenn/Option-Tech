

## Fix: 3 problemi nel Wizard Configurazione Strategie

### 1. Pool con tendine (collapsible) e ordine Azioni → Derivati → ETF

Attualmente le sezioni del pool (Azioni/ETF/Derivati) sono sempre aperte e ordinate Azioni → ETF → Derivati. Cambiare a:
- **Ordine**: Azioni → Derivati → ETF
- **Collapsible**: ogni sezione è una tendina (Collapsible) aperta di default, cliccabile per chiudere/aprire

**File**: `src/components/derivatives/StrategyConfigWizard.tsx` — riga 333-360
- Aggiungere stato per sezioni aperte/chiuse
- Wrappare ogni sezione in `<Collapsible>` con header cliccabile
- Riordinare l'array: `stock` → `derivative` → `etf`

### 2. Derivati ALPHABET mancanti nel pool

Questo richiede un'indagine sui dati reali dell'utente MELD. Possibili cause:
- Le opzioni ALPHABET potrebbero avere `asset_type` diverso da `derivative`
- L'`underlying` potrebbe non corrispondere al nome atteso

**Azione**: aggiungere un log diagnostico temporaneo nel wizard per verificare cosa contiene `derivatives` e `allAvailable`. Verificherò anche il parsing Excel per ALPHABET/GOOGL.

### 3. Posizioni duplicate nelle Covered Call dopo il salvataggio (**BUG CRITICO**)

**Causa root trovata**: In `src/lib/derivativeStrategies.ts`, riga 381:
```typescript
const soldCalls = filteredDerivatives.filter(d => d.option_type === 'call' && d.quantity < 0);
```
Questo **NON filtra** le posizioni già usate in Step 0.5 (configurazioni salvate). Risultato: le CALL vendute classificate dal wizard come Covered Call vengono ri-classificate anche da Step 1, duplicandole.

**Fix**: Aggiungere il check `!usedDerivatives.has(d.id)`:
```typescript
const soldCalls = filteredDerivatives.filter(d => 
  d.option_type === 'call' && d.quantity < 0 && !usedDerivatives.has(d.id)
);
```

**File**: `src/lib/derivativeStrategies.ts` — riga 381

### File da modificare

1. **`src/components/derivatives/StrategyConfigWizard.tsx`** — Tendine collapsibili nel pool, ordine Azioni → Derivati → ETF
2. **`src/lib/derivativeStrategies.ts`** — riga 381: aggiungere filtro `usedDerivatives` a Step 1

