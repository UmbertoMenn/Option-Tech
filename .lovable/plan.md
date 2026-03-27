

## Fix wizard: ricerca nel pool + auto-classificazione corretta

### Problema 1: Pool azioni troppo confusionale

Con lo splitting in slot da 100, il pool AZIONI diventa enorme e innavigabile. 

**Soluzione**: Aggiungere un campo di ricerca (Input) sopra le sezioni del pool. Filtra in tempo reale tutte le posizioni (azioni, derivati, ETF) per nome/descrizione. Sotto-raggruppare le azioni per nome (es. "APPLE" → 2 slot) così sono visivamente raggruppati.

### Problema 2: Auto-classificazione mette bought calls nelle covered call

**Root cause**: `autoClassify` raggruppa TUTTE le posizioni dello stesso underlying in un unico gruppo. Se ci sono sia sold calls (covered call) che bought calls (leap) sullo stesso titolo, finiscono tutti insieme. Poi `detectStrategyType` vede sold calls + bought calls + stock e li classifica come iron condor/double diagonal (4-leg check a riga 102) oppure li lascia come covered call includendo erroneamente le bought calls.

**Fix in `autoClassify`**: Dopo il raggruppamento per underlying, se il gruppo contiene sia sold calls che bought calls MA non ha la struttura 4-leg (iron condor / double diagonal), separare le bought calls in una strategia `leap_call` dedicata. Analogamente, separare bought puts standalone come protezioni.

### File da modificare

**`src/components/derivatives/StrategyConfigWizard.tsx`**:

1. **Aggiungere stato `searchQuery`** e un `<Input>` con placeholder "Cerca posizione..." sopra le sezioni collapsibili del pool
2. **Filtrare** `pool` per `searchQuery` (match su `description`, `ticker`, `underlying`)
3. **Sotto-raggruppare azioni** nella sezione AZIONI per nome titolo, mostrando "APPLE (2 slot)" come sotto-header
4. **Fix `autoClassify`**: dopo il raggruppamento iniziale per underlying, per ogni gruppo:
   - Se è un vero 4-leg (iron condor / double diagonal) → mantienilo unito
   - Altrimenti, separa bought calls (→ `leap_call`) e isola sold calls + stock (→ `covered_call`)
   - Separa bought puts standalone senza sold calls (→ `other` / protezione)

