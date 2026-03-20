

## Redesign: Classificazione interattiva strategie derivati

### Panoramica

Sostituire il sistema di classificazione automatica con un wizard interattivo persistente. L'utente configura manualmente come classificare le posizioni derivati al primo accesso. La configurazione viene salvata e riapplicata ai successivi upload Excel. Se ci sono nuove posizioni, il wizard si riapre solo per quelle.

### Nuove categorie

1. **Covered Call** — CALL vendute coperte da titoli in portafoglio
2. **De-Risking Covered Call** (nuova) — Covered Call + PUT comprata sullo stesso sottostante (sostituisce "Protezione")
3. **Covered Call Sintetica** — Covered Call dove il titolo è "sintetico": PUT venduta deep ITM (delta ≈ -1) + CALL venduta + eventuale PUT comprata di protezione. Badge **S** con tooltip "Synthetic position / short PUT delta -1"
4. **Iron Condor** — invariato
5. **Double Diagonal** — invariato
6. **Naked Put** — invariato
7. **LEAP Call** — invariato
8. **Altre Strategie** — Diagonal Put Spread, Bull Put Spread, ecc.

### Nuova tabella: `strategy_configurations`

```sql
CREATE TABLE strategy_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  underlying text NOT NULL,
  strategy_type text NOT NULL,
  position_signatures jsonb NOT NULL DEFAULT '[]',
  is_synthetic boolean NOT NULL DEFAULT false,
  linked_stock_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(portfolio_id, underlying, strategy_type)
);
```

- `underlying`: nome normalizzato del sottostante (es. "LULULEMON ATHLETICA")
- `strategy_type`: `covered_call`, `derisking_covered_call`, `iron_condor`, `double_diagonal`, `naked_put`, `leap_call`, `other_<nome>`
- `position_signatures`: array di firme `{option_type, strike, expiry, quantity_sign}` per tracciare le leg
- `is_synthetic`: badge "S" per CC sintetiche

RLS: stesse policy dei `derivative_overrides` (portfolio ownership + admin).

### Wizard interattivo (nuova pagina/dialog)

**Quando si apre**:
- Primo accesso alla pagina Derivati con un portafoglio che non ha `strategy_configurations`
- Dopo upload Excel se ci sono posizioni nuove (firme non presenti in nessuna configurazione)

**Contenuto del wizard — una card per sottostante**:
1. Mostra tutte le opzioni del sottostante (tipo, strike, scadenza, quantità)
2. Dropdown/radio per scegliere la classificazione:
   - Se ci sono CALL vendute + stock → propone "Covered Call" o "De-Risking CC" (se ci sono anche PUT comprate)
   - Se ci sono 4 leg PUT+CALL → propone "Iron Condor" / "Double Diagonal"
   - Se ci sono PUT vendute senza stock → propone "Naked Put"
   - Se ci sono CALL comprate → propone "LEAP Call"
   - Altrimenti → "Altra Strategia" con campo nome libero
3. Checkbox "Sintetica" (disponibile solo per CC) → attiva badge "S"
4. Per CC/De-Risking: selettore dello stock collegato

**Azione "Salva configurazione"**: salva tutte le scelte in `strategy_configurations`.

### Logica al caricamento Excel

1. Upload Excel → posizioni rigenerate con nuovi UUID
2. Per ogni sottostante con derivati, confronta le firme correnti con quelle salvate in `strategy_configurations`
3. **Nessuna nuova firma** → applica configurazione salvata (nessun wizard)
4. **Nuove firme** → apri wizard solo per i sottostanti con posizioni nuove
5. L'utente può sempre riaprire il wizard manualmente (bottone "Riconfigura strategie")

### Cambio al motore di categorizzazione

`categorizeDerivatives` in `src/lib/derivativeStrategies.ts`:
- Accetta un nuovo parametro opzionale `strategyConfigs: StrategyConfiguration[]`
- Se presente, applica le configurazioni salvate come Step 0 (prima di qualsiasi logica automatica)
- La logica automatica resta come fallback per posizioni senza configurazione

### Impatto sulla categoria "Protezione"

La categoria `longPuts` / "Protezione" viene eliminata come categoria standalone. Le PUT comprate vengono classificate come:
- Parte di "De-Risking Covered Call" se sullo stesso sottostante di una CC
- Parte di Iron Condor / Double Diagonal se in strategia multi-leg
- Parte di "Altre Strategie" altrimenti

### File da creare/modificare

1. **Migration SQL** — Tabella `strategy_configurations` con RLS
2. **`src/hooks/useStrategyConfigurations.ts`** — Nuovo hook CRUD
3. **`src/components/derivatives/StrategyConfigWizard.tsx`** — Nuovo componente wizard
4. **`src/lib/derivativeStrategies.ts`** — Aggiungere Step 0 per configurazioni salvate, aggiungere interfaccia `DeRiskingCoveredCall`, rimuovere `longPuts` da `DerivativeCategories`, aggiungere `deRiskingCoveredCalls` e flag `isSynthetic` alle CC
5. **`src/pages/Derivatives.tsx`** — Integrare wizard, nuova sezione De-Risking CC con badge "S", rimuovere sezione Protezione
6. **`src/types/derivativeOverrides.ts`** — Aggiornare tipi per nuove categorie
7. **`src/lib/uploadSnapshot.ts`** — Dopo upload, confrontare firme e aprire wizard se necessario
8. **`src/lib/refreshStrategyCache.ts`** — Fetch configurazioni al posto degli overrides
9. **`src/components/derivatives/MoveOptionMenu.tsx`** — Aggiornare categorie disponibili (rimuovere "protection", aggiungere "derisking_covered_call")

### Flusso utente

```text
Upload Excel
    ↓
Vai a Strategie Derivati
    ↓
[Prima volta?] → Wizard con TUTTE le posizioni → Salva config
[Config esiste?] → Nuove posizioni? → Wizard solo per le nuove
                                    → Nessuna nuova? → Mostra tutto classificato
    ↓
Pagina Derivati con categorie configurate
    ↓
Override manuale sempre possibile (aggiorna config salvata)
```

