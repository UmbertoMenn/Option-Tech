
Obiettivo: far sì che l’auto-classificazione del Wizard rispecchi davvero il comportamento pre-configurazione, senza “riusare” le stesse 100 azioni in più strategie.

1) Correzione mapper in `src/components/derivatives/StrategyConfigWizard.tsx` (funzione `autoClassify`)
- Mantengo `categorizeDerivatives(derivatives, allPositions, [], [])` come unica fonte di classificazione.
- Cambio la conversione `DerivativeCategories -> WizardStrategy[]` così:
  - `coveredCalls`: include CALL venduta + azione (ed eventuale `syntheticPut` se sintetica).
  - `deRiskingCoveredCalls`: include CALL venduta + PUT protezione + azione (ed eventuale `syntheticPut`).
  - `ironCondors`: solo 4 gambe opzioni (niente azione).
  - `doubleDiagonals`: solo 4 gambe opzioni (niente azione).
  - `nakedPuts`: solo opzione.
  - `leapCalls`: solo opzione.
  - `longPuts`: solo opzione (niente azione).
  - `groupedOtherStrategies`: solo gambe opzioni (niente azione).
- Questo elimina il caso Broadcom in cui la stessa azione appare sia in Covered Call sia in Altre Strategie.

2) Guardrail anti-duplicati nel Wizard
- Durante la costruzione delle strategie auto, introduco un set `consumedPositionIds` per evitare che la stessa posizione (stesso `id`) venga inserita in più strategie.
- Priorità di consumo: Covered Call / De-Risking prima, poi le altre categorie.
- Se una posizione è già usata, non viene riaggiunta in strategie successive.

3) Allineamento con la logica “prima del Wizard”
- Rimuovo dal mapper qualunque “arricchimento” non presente nella classificazione originale (es. stock aggiunto artificialmente a IC/DD/Other/LongPut).
- L’auto-classificazione del Wizard diventa una proiezione fedele del risultato di `categorizeDerivatives`, non una reinterpretazione.

4) Verifiche funzionali da fare dopo implementazione
- Caso Broadcom: `CALL venduta + 100 azioni` in Covered Call, e la `PUT comprata` senza duplicare le stesse 100 azioni in Altre Strategie.
- Caso Micron: resta aggregata come prima (niente splitting artificiale in più strategie).
- Regressione rapida su IC/DD: nessuna azione mostrata come gamba.
