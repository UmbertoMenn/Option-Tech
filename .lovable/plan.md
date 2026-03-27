

## Fix auto-classificazione: usare `categorizeDerivatives` direttamente

### Problema

L'`autoClassify` nel wizard reimplementa (male) la logica di classificazione, producendo risultati diversi da `categorizeDerivatives` in `derivativeStrategies.ts`. L'utente vuole che il wizard usi ESATTAMENTE la stessa logica originale.

### Soluzione

Sostituire la funzione `autoClassify` nel wizard per chiamare direttamente `categorizeDerivatives()` e poi convertire il risultato `DerivativeCategories` in array di `WizardStrategy[]`.

### File: `src/components/derivatives/StrategyConfigWizard.tsx`

**Rimuovere**: le funzioni `detectStrategyType`, `isFourLeg`, e l'attuale `autoClassify` (righe ~91-213).

**Nuova `autoClassify`**:
1. Importare `categorizeDerivatives` da `derivativeStrategies.ts`
2. Chiamarla con `(derivatives, allPositions, [], [])` — zero overrides e zero configs, esattamente come faceva il sistema prima della configurazione manuale
3. Iterare su ogni categoria del risultato (`coveredCalls`, `deRiskingCoveredCalls`, `ironCondors`, `doubleDiagonals`, `nakedPuts`, `leapCalls`, `otherStrategies`, `longPuts`) e convertirle in `WizardStrategy[]`:
   - Covered Call → raggruppa per underlying, tipo `covered_call`, posizioni = `[cc.option, cc.underlying]`
   - De-Risking CC → tipo `derisking_covered_call`, posizioni = `[cc.coveredCall.option, cc.coveredCall.underlying, cc.protectionPut]` + eventuale `syntheticPut`
   - Iron Condor → tipo `iron_condor`, posizioni = 4 gambe
   - Double Diagonal → tipo `double_diagonal`, posizioni = 4 gambe
   - Naked Put → tipo `naked_put`, posizioni = `[option]`
   - Leap Call → tipo `leap_call`, posizioni = `[option]`
   - Long Puts / Protezioni → tipo `other`, posizioni = `[option]`
   - Other → tipo `other`, posizioni raggruppate per underlying
4. Raggruppare posizioni dello stesso underlying e tipo in una singola `WizardStrategy` (per evitare duplicati)
5. Aggiungere al pool le posizioni non consumate (se ce ne sono)

Questo garantisce che MICRON e qualsiasi altra posizione venga classificata esattamente come nel sistema pre-wizard.

