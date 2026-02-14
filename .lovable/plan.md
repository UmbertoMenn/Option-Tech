

## Aggiungere la sezione "Per Strategia" nella Gestione Avvisi

### Obiettivo

Aggiungere un nuovo tab "Per Strategia" nel dialog Gestione Avvisi che elenchi tutte le strategie attualmente presenti nella pagina Strategie Derivati, con un toggle per attivare/disattivare gli avvisi per ciascuna. Le strategie non piu presenti dopo un ricaricamento Excel spariscono automaticamente dalla lista.

### Approccio

Utilizzare la tabella `strategy_cache` come unica fonte di verita per le strategie esistenti (gia popolata dal frontend). Creare una nuova tabella `strategy_alert_toggles` per persistere lo stato on/off per strategy_key. Le strategie senza record nella tabella toggle sono considerate abilitate per default.

### 1. Nuova tabella database: `strategy_alert_toggles`

```sql
CREATE TABLE public.strategy_alert_toggles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indice unico per evitare duplicati
CREATE UNIQUE INDEX idx_strategy_alert_toggles_user_key 
  ON strategy_alert_toggles(user_id, strategy_key);

-- RLS
ALTER TABLE strategy_alert_toggles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own toggles"
  ON strategy_alert_toggles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 2. Nuovo hook: `src/hooks/useStrategyAlertToggles.ts`

- `useStrategyAlertToggles()`: fetch dei toggle per l'utente effettivo
- `useUpsertStrategyAlertToggle()`: upsert singolo (strategy_key, enabled)
- `useBatchUpsertStrategyAlertToggles()`: upsert multiplo per toggle massivi
- Segue lo stesso pattern di `useAlertConfigs.ts` con `useEffectiveUserId` per compatibilita admin

### 3. Nuovo tab "Per Strategia" in `AlertSettingsDialog.tsx`

**Layout del tab:**
- Intestazione con descrizione: "Attiva o disattiva gli avvisi per singola strategia"
- Toggle massivo "Attiva/Disattiva tutte" in alto
- Lista delle strategie raggruppate per tipo (Covered Call, Naked Put, Iron Condor, Double Diagonal, LEAP Call, Altre Strategie)
- Ogni riga mostra: tipo strategia, ticker, strike(s), e un toggle Switch

**Dati**: le strategie vengono derivate direttamente dalla prop `categories` (DerivativeCategories) gia passata al dialog, garantendo che la lista sia identica a quella nella pagina dettaglio. Ogni strategia viene mappata alla sua `strategy_key` usando la stessa logica di `strategyCache.ts`.

**Comportamento:**
- Strategie senza un record in `strategy_alert_toggles` sono abilitate di default
- Quando l'utente disabilita una strategia, viene creato un record con `enabled: false`
- Quando si ricarica un Excel e una strategia non esiste piu, semplicemente non appare nella lista (i record orfani nel DB sono innocui e ignorati)

### 4. Aggiornamento Edge Function `check-alerts`

Nella funzione `check-alerts/index.ts`, dopo aver caricato le strategie dalla `strategy_cache`:
- Fetch dei toggle da `strategy_alert_toggles` per l'utente
- Filtrare le strategie la cui `strategy_key` ha un toggle `enabled = false`
- Le strategie senza record toggle rimangono attive (default)

### 5. Aggiornamento TabsList

Il numero di colonne nella griglia dei tab passa da 5/6 a 6/7 per includere il nuovo tab "Per Strategia".

### Riepilogo delle modifiche

| File | Modifica |
|---|---|
| Migrazione SQL | Nuova tabella `strategy_alert_toggles` con RLS |
| `src/hooks/useStrategyAlertToggles.ts` | Nuovo file - hook CRUD per i toggle |
| `src/components/derivatives/AlertSettingsDialog.tsx` | Nuovo tab "Per Strategia" + aggiornamento griglia tab |
| `supabase/functions/check-alerts/index.ts` | Fetch toggle e filtro strategie disabilitate |

