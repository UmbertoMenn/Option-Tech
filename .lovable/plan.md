

## Briefing pre-apertura giornaliero alle 12:00

### Cosa fa

Ogni giorno lavorativo alle 12:00 ora italiana, una nuova Edge Function genera un riepilogo completo delle posizioni in derivati da monitorare per ogni utente con notifiche attive, basandosi sui prezzi di chiusura del giorno prima. Il briefing viene inviato via Telegram (e opzionalmente email) usando gli stessi canali gia configurati.

### Contenuto del briefing

Il messaggio replica la logica della card "Posizioni da monitorare" del frontend, includendo:

1. **Call vendute non coperte (Naked Call)** -- ticker e contratti scoperti
2. **Covered Call ITM** -- ticker, strike e contratti
3. **Naked Put ITM** -- ticker, strike e contratti
4. **Iron Condor OOR** -- ticker fuori range
5. **Double Diagonal OOR** -- ticker fuori range
6. **Altre Strategie OOR/OOB** -- ticker e nome strategia
7. **Leap Call in Gain** -- ticker con gain significativo
8. **Call da rivendere** -- ticker con azioni disponibili

Ogni sezione viene mostrata solo se contiene elementi. Se non c'e nulla da segnalare, il briefing non viene inviato.

### Esempio messaggio Telegram

```text
📋 Briefing Pre-Apertura
📅 12 feb 2026

🔴 Covered Call ITM
  AAPL strike 220 (2 contratti)

🔴 Iron Condor OOR
  NVDA

🟡 Altre Strategie OOR/OOB
  MSFT - Put Spread (OOR)

🟢 Leap Call in Gain
  AMZN strike 180 (1 contratto)

📈 Call da rivendere
  META (200 azioni disponibili)
```

### Dettaglio tecnico

**1. Nuova Edge Function `daily-briefing/index.ts`**

- Legge tutti gli utenti con notifiche abilitate (`notify_telegram = true` o `notify_email = true`)
- Per ogni utente, recupera i portfolio e la `strategy_cache`
- Recupera i prezzi sottostanti da `underlying_prices`
- Applica la stessa logica di `DerivativesSummaryCard` (ITM, OOR, OOB, Naked Call, Leap gain, Call da rivendere) lato server
- Per le Call da rivendere: recupera anche le posizioni stock per calcolare le azioni disponibili
- Compone il messaggio in formato Markdown (Telegram) e HTML (email)
- Invia direttamente usando le API Telegram e Resend (stesse librerie di `send-notification`)
- Se un utente non ha nulla da monitorare, salta l'invio
- Invia anche agli admin se hanno le notifiche admin attive

**2. `supabase/config.toml`** -- aggiungere:

```toml
[functions.daily-briefing]
verify_jwt = false
```

**3. Cron job** -- nuovo job schedulato alle 11:00 UTC (= 12:00 CET inverno, 13:00 CEST estate)

Poiche l'ora italiana cambia con il DST (CET/CEST), la funzione usera lo stesso approccio "smart guard" di `check-alerts`: il cron copre entrambi gli orari possibili (10:00 e 11:00 UTC) e la funzione calcola dinamicamente se sono le 12:00 ora italiana.

Schedule: `0 10,11 * * 1-5` (gira alle 10:00 e 11:00 UTC, lun-ven)

All'interno della funzione, un guard verifica:
- In inverno (CET, UTC+1): 11:00 UTC = 12:00 CET -- esegue
- In estate (CEST, UTC+2): 10:00 UTC = 12:00 CEST -- esegue
- L'altra esecuzione viene scartata con early return

**4. Logica di calcolo (server-side)**

La funzione replica i calcoli di `DerivativesSummaryCard`:
- **Naked Call**: bilancio azioni possedute vs call vendute nette
- **CC ITM**: `underlying_price > sold_call_strike` dalla strategy_cache
- **NP ITM**: `underlying_price < sold_put_strike` dalla strategy_cache
- **IC/DD OOR**: sottostante fuori dal range degli strike venduti
- **Altre OOR/OOB**: strategie con `is_range_strategy` e check breakeven
- **Leap Gain**: confronto `current_price` vs `avg_cost` dalle posizioni
- **Call da rivendere**: azioni con contratti disponibili non coperti

### Cosa cambia
- Nuova Edge Function `daily-briefing/index.ts`
- Nuovo cron job (schedule `0 10,11 * * 1-5`)
- Aggiornamento `supabase/config.toml`

### Cosa NON cambia
- Nessuna modifica al frontend
- Nessuna modifica a `check-alerts` o `send-notification`
- Nessuna nuova tabella nel database
- I canali di notifica usano le stesse preferenze utente esistenti

