# Fix etichetta CC/DR-CC sintetiche

## Problema
Le CC e DR-CC sintetiche mostrano sempre "Sintetico (PUT venduta deep ITM)" anche quando la configurazione manuale contiene una CALL acquistata deep ITM al posto della PUT venduta.

## Modifica (solo UI)

### `src/lib/derivativeStrategies.ts`
Aggiungere campo opzionale `syntheticCall?: Position` a `CoveredCallPosition` e `DeRiskingCoveredCallPosition`.

Nei rami `case 'covered_call'` e `case 'derisking_covered_call'` con `config.is_synthetic`:
- se in `matchedVirtual` esiste una **bought call** (`option_type === 'call' && quantity > 0`) → popolarla in `syntheticCall` (e non in `syntheticPut`)
- altrimenti comportamento attuale (cerca sold put → `syntheticPut`)

Nessun cambio di logica: il sintetico è già definito dalla config manuale, leggiamo solo cosa contiene.

### `src/pages/Derivatives.tsx`
Alle 4 occorrenze (linee 1338, 1368, 1636, 1685):
- se `syntheticCall` presente → mostrare "Sintetico (CALL acquistata deep ITM)" e nel box di dettaglio mostrare strike/scadenza/PMC/prezzo della call
- altrimenti testo attuale per la put

### `src/components/derivatives/StrategyConfigWizard.tsx`
Nel collector aggiungere `if (cc.syntheticCall) entry.positions.push(cc.syntheticCall)` accanto al `syntheticPut` esistente, così la posizione viene preservata al reload.

## Non si tocca
DB, edge functions, risk calculator, wizard di creazione, monitoring.
