

## Riprogettazione del Dialog di Riconciliazione

### Problema
Il dialog attuale mostra una lista piatta di gambe con badge colorati (❌/✅/🆕) e checkbox. Non si capisce come riconfigurare le strategie. L'utente vuole la stessa esperienza del wizard di configurazione strategie.

### Soluzione
Riscrivere `StrategyReconciliationDialog` per replicare la UI del wizard (`StrategyConfigWizard`) all'interno del dialog, mostrando per ogni sottostante con cambiamenti:
- Un **banner di riepilogo cambiamenti** in cima (es. "2 gambe rimosse, 1 nuova")
- Le **posizioni disponibili** come chip selezionabili (stessa UI del wizard: checkbox + label colorati per tipo)
- Le **strategie già configurate** come card con bordo tratteggiato (stessa UI del wizard: select tipo, checkbox sintetica, badge posizioni con X per rimuovere, bottone elimina)
- Il bottone **"Crea strategia"** quando si selezionano posizioni disponibili
- Le gambe rimosse evidenziate in rosso con un badge "Rimossa" nella sezione riepilogo, ma NON incluse nel pool disponibile

### Struttura per sottostante (stessa del wizard)
```text
┌─ APPLE INC ──────────────────────────────────────┐
│ ⚠ 1 gamba rimossa, 1 nuova opzione              │
│                                                   │
│ Posizioni disponibili (2)        [Crea strategia] │
│ [☑ V CALL 250 SET/25] [☐ 100 azioni slot 1]     │
│                                                   │
│ ┌ Covered Call ▼  ☐ Sintetica          🗑 ──────┐│
│ │ V CALL 240 GIU/25 ×  │  100 azioni ×          ││
│ └────────────────────────────────────────────────┘│
│                                                   │
│ Rimosse: V CALL 230 MAR/25                       │
└──────────────────────────────────────────────────┘
```

### Modifiche tecniche

**`src/components/derivatives/StrategyReconciliationDialog.tsx`** — Riscrittura completa:
- Nuovo state interno: `strategies: WizardStrategy[]` per sottostante (inizializzato dalle gambe "present" delle config esistenti)
- Le gambe "new" vanno nel pool delle posizioni disponibili
- Le gambe "missing" mostrate in una sezione separata con badge "Rimossa"
- Stesse funzioni del wizard: `toggleSelected`, `createStrategyFromSelected`, `removeFromStrategy`, `deleteStrategy`, `updateStrategyType`, `toggleSynthetic`, `detectStrategyType`
- Riuso delle stesse funzioni helper: `positionLabel`, `positionBadgeClass`, `formatExpiryMMY`
- Il save costruisce `UpsertConfigParams[]` con le signatures dalle strategie configurate, preservando le config invariate

**`src/lib/strategyReconciliation.ts`** — Aggiungere alle `LegStatus` la `position` anche per le gambe "present" (già presente), e restituire le posizioni attuali per underlying per popolare il pool disponibile

**`src/pages/Derivatives.tsx`** — Passare anche `positions` (le posizioni correnti) al dialog di riconciliazione per popolare il pool disponibile

### File da modificare
1. `src/components/derivatives/StrategyReconciliationDialog.tsx` — riscrittura UI
2. `src/lib/strategyReconciliation.ts` — arricchire output con posizioni per il pool
3. `src/pages/Derivatives.tsx` — passare posizioni al dialog

