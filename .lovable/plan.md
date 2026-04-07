

## Piano: Split On-Demand per Opzioni E Azioni

### Stato: ✅ COMPLETATO

### Comportamento finale
- **Azioni**: raggruppate di default, splittabili on-demand in slot da 100 con ✂️
- **Opzioni**: raggruppate di default, splittabili on-demand in contratti singoli con ✂️
- **Riconciliazione**: non si apre più immediatamente dopo il salvataggio

### Modifiche effettuate

1. **`src/lib/strategyReconciliation.ts`**: Fix `matchSignatureMulti` — ora gestisce quantità aggregate (una posizione con qty=-3 matcha una signature con quantity_abs=3)
2. **`src/components/derivatives/StrategyConfigWizard.tsx`**: Rimosso auto-split azioni, unificato `splitPositionIds` per azioni e opzioni, ✂️ e Merge per entrambi
3. **`src/components/derivatives/StrategyReconciliationDialog.tsx`**: Stesso approccio unificato per la riconciliazione
4. **`src/pages/Derivatives.tsx`**: Aggiunto `justSavedRef` per bloccare auto-apertura riconciliazione dopo salvataggio
