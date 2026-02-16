

## Cambiare il briefing giornaliero alle 10:00 italiane

### Modifiche necessarie

**1. Edge Function `supabase/functions/daily-briefing/index.ts`**

- Rinominare la funzione guard da `isItalianNoon` a `isItalian10AM`
- Cambiare il controllo da `italianHour === 12` a `italianHour === 10`
- Aggiornare i commenti e il messaggio di log
- Aggiornare il testo nell'email da "Generato automaticamente alle 12:00" a "Generato automaticamente alle 10:00"

**2. Cron job nel database**

Il cron attuale e' `0 10,11 * * 1-5` (10:00 e 11:00 UTC per coprire CET/CEST quando l'ora italiana era 12).

Per le 10:00 italiane:
- CET (inverno): 10:00 IT = 09:00 UTC
- CEST (estate): 10:00 IT = 08:00 UTC

Nuovo schedule: `0 8,9 * * 1-5` (08:00 e 09:00 UTC, la guard nella Edge Function filtra l'esecuzione corretta)

Aggiornamento via SQL:
```text
SELECT cron.alter_job(11, schedule := '0 8,9 * * 1-5');
```

### Dettaglio tecnico

| File/Risorsa | Modifica |
|---|---|
| `supabase/functions/daily-briefing/index.ts` | Guard: `italianHour === 10`, label email aggiornata |
| Cron job (ID 11) | Schedule da `0 10,11 * * 1-5` a `0 8,9 * * 1-5` |

### Risultato atteso

Il briefing arriva ogni giorno lavorativo alle 10:00 ora italiana, sia in orario CET che CEST.

