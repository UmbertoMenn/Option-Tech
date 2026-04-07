

## Piano: Split On-Demand per Opzioni (mantenendo auto-split azioni)

### Comportamento finale
- **Azioni**: auto-split in slot da 100 (invariato)
- **Opzioni**: appaiono raggruppate con quantità originale (es. "-3 CALL AAPL 250 ×3"). Un'icona ✂️ accanto permette di splittarle in slot da 1 contratto. Un pulsante "Riunisci" permette di ri-aggregarle se non assegnate.

### Modifiche

**File: `src/components/derivatives/StrategyConfigWizard.tsx`**

1. **Rimuovere auto-splitting opzioni** (righe 393-405): le opzioni entrano nel pool con quantità originale, senza creare `__opt_slot_N`
2. **Aggiungere stato `splitOptionIds`** (`Set<string>`): traccia quali posizioni option l'utente ha scelto di splittare manualmente
3. **Derivare posizioni effettive** in un `useMemo` tra `allAvailable` e il rendering: se un'opzione è in `splitOptionIds`, genera gli slot virtuali `__opt_slot_N`; altrimenti la lascia intera
4. **Icona ✂️ (Scissors)**: accanto a ogni opzione con `|qty| > 1` non assegnata, al click aggiunge l'ID a `splitOptionIds`
5. **Pulsante "Riunisci"**: visibile quando ci sono slot `__opt_slot_N` non assegnati della stessa posizione base → rimuove l'ID da `splitOptionIds`
6. **`positionLabel()`**: per opzioni non splittate, mostra `×N`; per slot splittati, mostra `[1]`, `[2]`, ecc.
7. **`buildSignatures()`**: per opzioni non splittate assegnate intere, `quantity_abs = |quantity|`; per slot virtuali, `quantity_abs = 1` (logica già presente, funziona)
8. **`restoreFromConfigs()`**: se una config salvata ha `quantity_abs < |quantity originale|` dell'opzione, auto-aggiunge l'ID a `splitOptionIds` per ricreare gli slot necessari al ripristino

**File: `src/components/derivatives/StrategyReconciliationDialog.tsx`**
- Stesso approccio: rimuovere auto-splitting opzioni, aggiungere `splitOptionIds` + ✂️ + riunisci

### Nessuna modifica a:
- `useStrategyConfigurations.ts` — `quantity_abs` già supportato
- `strategyReconciliation.ts` — matching con `quantity_abs` già funzionante

