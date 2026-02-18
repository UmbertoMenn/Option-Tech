

## Cambiare orario briefing da 10:00 a 11:00

### Modifica

**File: `supabase/functions/daily-briefing/index.ts`**

Nella funzione `isItalian10AM()` (che verra rinominata concettualmente):
- Cambiare il controllo `italianHour === 10` in `italianHour === 11` (riga 46)

Questo sposta l'invio del briefing dalle 10:00 alle 11:00 ora italiana.

Se esiste un cron job che invoca questa funzione, potrebbe essere necessario verificare che la finestra oraria del cron copra anche le 11:00 italiane (09:00-10:00 UTC in inverno, 08:00-09:00 UTC in estate). Se il cron attuale e ristretto alle 08:00 UTC, potrebbe non triggerare la funzione alle 09:00 UTC invernali.

