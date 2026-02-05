
# Piano: Sistema di Avvisi Intelligenti per Derivati

## Panoramica

Sistema completo per monitorare le posizioni sui derivati e generare avvisi basati su condizioni configurabili per utente. Gli avvisi funzionano lato server (cron job ogni 15 minuti) con logica di **direction-aware threshold crossing**.

## Logica Avvisi di Distanza

### Direzione del Crossing

| Strumento | Trigger | Descrizione |
|-----------|---------|-------------|
| Call venduta (CC, lato call IC/DD) | Prezzo SALE sopra soglia | Si avvicina allo strike dal basso |
| Put venduta (NP, lato put IC/DD) | Prezzo SCENDE sotto soglia | Si avvicina allo strike dall'alto |

### Ciclo di Vita Avviso

```text
1. Prezzo in zona sicura (es. distanza 10% dallo strike, soglia 5%)
   → Stato: SAFE
   
2. Prezzo si avvicina (distanza scende al 4%)
   → Crossing detected! → GENERA AVVISO
   → Stato: ALERTED
   
3. Prezzo resta in zona rischio (3%, 2%, etc.)
   → Nessun nuovo avviso (già in stato ALERTED)
   
4. Prezzo torna in zona sicura (distanza 6%)
   → Stato: SAFE (reset)
   
5. Prezzo ri-entra in zona rischio (distanza 4%)
   → Se passato cooldown: GENERA AVVISO
   → Stato: ALERTED
```

## Architettura

```text
+------------------+     +-------------------+     +------------------+
|   Frontend       |     |   Edge Function   |     |   Database       |
|                  |     |   (Cron 15 min)   |     |                  |
| - Dialog config  |<--->| - check-alerts    |<--->| - alert_configs  |
| - Card avvisi    |     |   (direction      |     | - alerts         |
| - Badge non letti|     |    aware logic)   |     | - alert_states   |
+------------------+     +-------------------+     +------------------+
```

## Tipi di Avvisi

### 1. Avvisi di Distanza (configurabili per ticker)

| Strategia | Direzione | Descrizione |
|-----------|-----------|-------------|
| Iron Condor - lato Call | Prezzo SALE | Distanza % dal sold call strike |
| Iron Condor - lato Put | Prezzo SCENDE | Distanza % dal sold put strike |
| Double Diagonal - lato Call | Prezzo SALE | Distanza % dal sold call strike |
| Double Diagonal - lato Put | Prezzo SCENDE | Distanza % dal sold put strike |
| Alternative DD - lato Call | Prezzo SALE | Distanza % dal sold call strike |
| Alternative DD - lato Put | Prezzo SCENDE | Distanza % dal sold put strike |
| Covered Call | Prezzo SALE | Distanza % dallo strike venduto |
| Naked Put | Prezzo SCENDE | Distanza % dallo strike venduto |

### 2. Avvisi di Azione (soglie fisse, no direzione)

| Condizione | Trigger |
|------------|---------|
| Naked Put ITM | strike > prezzo sottostante |
| Covered Call ITM | strike < prezzo sottostante |
| DD/IC OOR | prezzo fuori dal range degli strike venduti |
| Strategie OOB | P/L negativo (strategia in perdita) |
| Leap Gain +20% | current_price > avg_cost * 1.20 |
| Leap Gain +30% | current_price > avg_cost * 1.30 |
| Leap Gain +40% | current_price > avg_cost * 1.40 |
| Leap Gain +50% | current_price > avg_cost * 1.50 |

## Struttura Database

### Tabella `alert_configs`
Configurazione soglie per utente/ticker

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK -> auth.users |
| ticker | text | NULL = default globale |
| alert_type | enum | tipo avviso |
| threshold_pct | numeric(5,2) | soglia % (es. 5.00 = 5%) |
| cooldown_minutes | integer | minuti tra avvisi (default 240 = 4h) |
| enabled | boolean | attivo/disattivo |
| created_at | timestamptz | - |
| updated_at | timestamptz | - |

### Tabella `alert_states`
Traccia lo stato corrente di ogni posizione per rilevare il crossing

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK -> auth.users |
| portfolio_id | uuid | FK -> portfolios |
| position_key | text | identificativo univoco posizione |
| alert_type | enum | tipo avviso |
| current_state | enum | 'safe' o 'alerted' |
| last_alerted_at | timestamptz | quando ultimo avviso generato |
| updated_at | timestamptz | - |

### Tabella `alerts`
Avvisi generati dal sistema

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK -> auth.users |
| portfolio_id | uuid | FK -> portfolios |
| alert_type | enum | tipo avviso |
| ticker | text | simbolo sottostante |
| strategy_type | text | CC, NP, IC, DD, LEAP, etc |
| direction | text | 'up' o 'down' (per distanza) |
| current_value | numeric | distanza % attuale o gain % |
| threshold_value | numeric | soglia superata |
| strike_price | numeric | strike di riferimento |
| underlying_price | numeric | prezzo sottostante |
| message | text | messaggio formattato italiano |
| severity | enum | info, warning, critical |
| created_at | timestamptz | quando generato |
| read_at | timestamptz | NULL = non letto |

## Componenti Frontend

### 1. Bottone "Gestione Avvisi"
Posizione: header della card "Avvisi recenti (24h)"
- Icona ingranaggio (Settings)
- Apre AlertSettingsDialog

### 2. AlertSettingsDialog
Dialog modale con tabs:

**Tab 1: Soglie Distanza Globali**
- Slider per ogni tipo (IC, DD, CC, NP)
- Default: 5%
- Range: 1% - 20%

**Tab 2: Override per Ticker**
- Tabella con ticker + soglia custom
- Bottone "Aggiungi ticker"
- Es: APPLOVIN 10%, AAPL 3%

**Tab 3: Avvisi Azione**
- Toggle on/off per: ITM NP, ITM CC, OOR, OOB
- Soglie Leap: toggle per +20%, +30%, +40%, +50%

**Tab 4: Cooldown**
- Slider per cooldown globale (1h - 24h)
- Default: 4 ore

### 3. Card "Avvisi recenti (24h)" Aggiornata
- Badge rosso con conteggio non letti
- Lista avvisi con:
  - Icona severity (info/warning/critical)
  - Ticker + tipo strategia
  - Messaggio (es. "APPLOVIN si avvicina allo strike $280 (distanza 4.2%)")
  - Timestamp relativo
- Click per marcare come letto
- Pulsante "Segna tutti come letti"

## Edge Function: check-alerts

### Pseudocodice

```text
FOR each user with alert_configs:
  FOR each portfolio:
    positions = fetch positions + underlying prices
    categories = categorize derivatives (IC, DD, CC, NP, LEAP, etc)
    
    // --- AVVISI DISTANZA ---
    FOR each strategy with sold options:
      ticker = get underlying ticker
      config = get config (ticker-specific OR global default)
      
      IF config.enabled:
        distance_pct = calculate distance to strike
        direction = 'up' for calls, 'down' for puts
        
        // Check direction-aware crossing
        IF direction == 'up' AND price moving UP toward strike:
          is_in_danger = distance_pct < config.threshold_pct
        ELSE IF direction == 'down' AND price moving DOWN toward strike:
          is_in_danger = distance_pct < config.threshold_pct
        
        state = get_or_create alert_state(user, portfolio, position_key, alert_type)
        
        IF is_in_danger AND state.current_state == 'safe':
          // Crossing from safe to danger!
          IF cooldown_passed(state.last_alerted_at, config.cooldown):
            create_alert(...)
            update_state(current_state='alerted', last_alerted_at=now())
        
        ELSE IF NOT is_in_danger AND state.current_state == 'alerted':
          // Returned to safe zone - reset state
          update_state(current_state='safe')
    
    // --- AVVISI AZIONE ---
    // Similar logic for ITM, OOR, OOB, LEAP gains
    // (questi non hanno direzione, solo stato on/off)
```

### Calcolo Distanza Percentuale

```text
Per CALL venduta:
  distance_pct = (strike - underlying_price) / underlying_price * 100
  // Positivo = OTM (sicuro), Negativo = ITM (pericolo)
  // Avviso se distance_pct < threshold (si avvicina)

Per PUT venduta:
  distance_pct = (underlying_price - strike) / underlying_price * 100
  // Positivo = OTM (sicuro), Negativo = ITM (pericolo)
  // Avviso se distance_pct < threshold (si avvicina)
```

## File da Creare

| File | Descrizione |
|------|-------------|
| `src/types/alerts.ts` | Tipi TypeScript per alerts |
| `src/hooks/useAlerts.ts` | Hook per fetch/update avvisi |
| `src/hooks/useAlertConfigs.ts` | Hook per configurazioni |
| `src/components/derivatives/AlertSettingsDialog.tsx` | Dialog gestione configurazione |
| `supabase/functions/check-alerts/index.ts` | Edge function cron |

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/derivatives/DerivativesSummaryCard.tsx` | Aggiunta bottone + lista avvisi reali dalla tabella alerts |
| `supabase/config.toml` | Aggiunta configurazione edge function check-alerts |

## Migrazioni Database

### 1. Creazione Enum Types

```sql
CREATE TYPE public.alert_type AS ENUM (
  'distance_iron_condor_call',
  'distance_iron_condor_put',
  'distance_double_diagonal_call',
  'distance_double_diagonal_put',
  'distance_covered_call',
  'distance_naked_put',
  'action_naked_put_itm',
  'action_covered_call_itm',
  'action_dd_ic_oor',
  'action_strategy_oob',
  'action_leap_gain_20',
  'action_leap_gain_30',
  'action_leap_gain_40',
  'action_leap_gain_50'
);

CREATE TYPE public.alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE public.alert_state_status AS ENUM ('safe', 'alerted');
```

### 2. Tabella alert_configs

```sql
CREATE TABLE public.alert_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticker TEXT,
  alert_type public.alert_type NOT NULL,
  threshold_pct NUMERIC(5,2) DEFAULT 5.00,
  cooldown_minutes INTEGER DEFAULT 240,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ticker, alert_type)
);

ALTER TABLE public.alert_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert configs"
  ON public.alert_configs FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### 3. Tabella alert_states

```sql
CREATE TABLE public.alert_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  position_key TEXT NOT NULL,
  alert_type public.alert_type NOT NULL,
  current_state public.alert_state_status DEFAULT 'safe',
  last_alerted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, portfolio_id, position_key, alert_type)
);

ALTER TABLE public.alert_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert states"
  ON public.alert_states FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### 4. Tabella alerts

```sql
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  alert_type public.alert_type NOT NULL,
  ticker TEXT NOT NULL,
  strategy_type TEXT,
  direction TEXT,
  current_value NUMERIC,
  threshold_value NUMERIC,
  strike_price NUMERIC,
  underlying_price NUMERIC,
  message TEXT NOT NULL,
  severity public.alert_severity DEFAULT 'warning',
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts"
  ON public.alerts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own alerts"
  ON public.alerts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_alerts_user_created ON public.alerts(user_id, created_at DESC);
CREATE INDEX idx_alerts_unread ON public.alerts(user_id) WHERE read_at IS NULL;
```

## Setup Cron Job

Dopo deployment della edge function:

```sql
SELECT cron.schedule(
  'check-derivative-alerts',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/check-alerts',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body:='{}'::jsonb
  );
  $$
);
```

## Sequenza Implementazione

1. **Database**: Migrazioni per enum types + 3 tabelle + RLS policies
2. **Types**: Definizioni TypeScript in `src/types/alerts.ts`
3. **Hooks**: `useAlerts.ts` e `useAlertConfigs.ts`
4. **UI Dialog**: `AlertSettingsDialog.tsx` con tabs configurazione
5. **UI Card**: Aggiornamento `DerivativesSummaryCard.tsx`
6. **Edge Function**: `check-alerts/index.ts` con logica direction-aware
7. **Cron**: Setup job schedulato ogni 15 minuti
