

## Semplificare la regola di approccio nel Simulator

### Cosa cambia

La sezione "Se il prezzo si avvicina alla call venduta" passa da 3 opzioni radio a **nessuna scelta** — rimane solo la logica "roll up positivo", ma il parametro cambia da valore assoluto USD a **percentuale sul prezzo del sottostante**.

### Modifiche

**1. `src/lib/adjustmentRules.ts`**
- Rimuovere il campo `action` da `ApproachRule` (non serve più, c'è un solo comportamento)
- Rimuovere `minPremiumUsd` — sostituirlo con `minPremiumPct: number` (% del prezzo del sottostante)
- Rimuovere `newCallBarrierPct` (era per `do_nothing`)
- Aggiornare `getDefaultCoveredCallRules()` con `minPremiumPct: 0.5` (default 0.5%)

**2. `src/components/simulator/AdjustmentRuleEditor.tsx`**
- Rimuovere l'intero `RadioGroup` con le 3 opzioni
- Mostrare direttamente i parametri configurabili: distanza di attivazione, distanza min strike, e il nuovo campo "Premio minimo aggiuntivo" in percentuale
- Aggiornare le label per chiarire il comportamento unico

**3. `src/lib/backtestEngine.ts`**
- In `handleApproachRoll` (~riga 394-398): sostituire il check `netPremium >= approachRule.minPremiumUsd` con `netPremium >= S * (approachRule.minPremiumPct / 100)`
- Rimuovere il branch `do_nothing` (riga 377) e il branch `roll_up_always` (che non aveva vincolo di premio)
- La funzione `handleExpiryDoNothing` diventa dead code — rimuoverla
- Rimuovere il blocco `if (false)` a riga 200

