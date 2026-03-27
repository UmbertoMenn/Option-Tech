

## Redesign Wizard: raggruppamento per sottostante

### Concetto

Il wizard viene ripensato: invece di un pool piatto con sezioni "Azioni / Derivati / ETF", tutte le posizioni vengono raggruppate per sottostante. Ogni sottostante diventa una card dove l'utente può creare strategie liberamente, spostare posizioni, splittare azioni.

### Struttura UI nuova

```text
┌─ Dialog "Configurazione Strategie Derivati" ──────────────────┐
│  [Auto-classifica]  [Cerca sottostante...]                     │
│                                                                │
│  ┌─ BROADCOM ──────────────────────────────────────────────┐  │
│  │  Posizioni disponibili:                                  │  │
│  │   ☐ AZ. BROADCOM (100 azioni)                           │  │
│  │   ☐ AVGO V CALL 230 GIU/25                              │  │
│  │   ☐ AVGO A PUT 200 GIU/25                               │  │
│  │                                                          │  │
│  │  [+ Crea strategia da selezionate (2)]                   │  │
│  │                                                          │  │
│  │  Strategie configurate:                                  │  │
│  │  ┌ Covered Call ─────────────────────────────────┐       │  │
│  │  │  AVGO V CALL 230 GIU/25  ✕                    │       │  │
│  │  │  AZ. BROADCOM (100 azioni) ✕                   │       │  │
│  │  └────────────────────────────────────────────────┘       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─ MICRON ────────────────────────────────────────────────┐  │
│  │  ...                                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│                              [Annulla]  [Salva Configurazione] │
└────────────────────────────────────────────────────────────────┘
```

### Modifiche in `src/components/derivatives/StrategyConfigWizard.tsx`

**1. Raggruppamento per sottostante**
- Creare un `Map<string, Position[]>` che raggruppa tutte le posizioni (azioni + derivati + ETF) per sottostante normalizzato
- Per le azioni: usare `normalizeForMatching(description)` per matchare col sottostante dei derivati
- Per i derivati: usare `underlying`
- Stock splitting in slot da 100 rimane come ora

**2. UI per-sottostante**
- Ogni sottostante è una `Card` collapsibile con:
  - Lista posizioni disponibili (non ancora assegnate a strategie) con checkbox
  - Bottone "Crea strategia" che prende le selezionate e crea una `WizardStrategy` locale a quel sottostante
  - Lista strategie già create per quel sottostante, con possibilità di rimuovere posizioni, cambiare tipo, eliminare strategia
- Rimuovere le sezioni collapsibili "AZIONI", "DERIVATI", "ETF"

**3. Ricerca**
- Il campo ricerca filtra le card dei sottostanti (non le singole posizioni)

**4. Auto-classifica**
- Resta uguale (usa `categorizeDerivatives`), ma i risultati vengono distribuiti nelle card dei rispettivi sottostanti

**5. Punto 4 dell'utente: "nella pagina Derivati finisce SOLO quello che ho configurato"**
- Nella pagina `Derivatives.tsx`, quando `hasConfigurations === true`, la `categorizeDerivatives` viene già chiamata con `strategyConfigs` — le sezioni mostrano solo ciò che è configurato
- Verificare che questo funzioni correttamente: se una posizione NON è in nessuna configurazione, non deve apparire in nessuna sezione strategia

### File da modificare
1. **`src/components/derivatives/StrategyConfigWizard.tsx`** — redesign completo del pool e della UI
2. **`src/pages/Derivatives.tsx`** — verificare che con configurazioni attive, le sezioni mostrino SOLO posizioni configurate (potrebbe richiedere fix in `categorizeDerivatives`)

