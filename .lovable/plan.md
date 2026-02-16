

## Fix: Errore salvataggio cooldown (e qualsiasi altra impostazione avvisi)

### Problema identificato

L'errore nei log del database e':
```
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

L'indice univoco sulla tabella `alert_configs` usa `COALESCE(ticker, '')`:
```sql
CREATE UNIQUE INDEX ... ON alert_configs (user_id, COALESCE(ticker, ''), alert_type)
```

Ma il codice JS fa upsert con:
```typescript
onConflict: 'user_id,ticker,alert_type'
```

PostgreSQL non riesce a far corrispondere `ON CONFLICT (user_id, ticker, alert_type)` con un indice che usa `COALESCE(ticker, '')`. Questo errore si verifica per **tutti gli utenti** (non solo admin), ogni volta che si salvano impostazioni con ticker NULL (cioe' le impostazioni globali, che sono la maggioranza).

### Soluzione

Sostituire l'indice COALESCE con un indice univoco standard che gestisce i NULL tramite `NULLS NOT DISTINCT` (disponibile in PostgreSQL 15+, usato da Supabase).

**1. Migrazione database:**

```sql
-- Rimuovere il vecchio indice con COALESCE
DROP INDEX IF EXISTS alert_configs_user_id_ticker_alert_type_key;

-- Creare il nuovo indice univoco che tratta NULL come uguale
CREATE UNIQUE INDEX alert_configs_user_ticker_type_uq
  ON alert_configs (user_id, ticker, alert_type)
  NULLS NOT DISTINCT;
```

Nessuna modifica al codice TypeScript — il `onConflict: 'user_id,ticker,alert_type'` funzionera' correttamente con il nuovo indice.

### File/risorse da modificare

| Risorsa | Modifica |
|---|---|
| Database (migrazione SQL) | Sostituire l'indice COALESCE con `NULLS NOT DISTINCT` |

### Risultato atteso

- Il salvataggio del cooldown (e di qualsiasi impostazione) funziona correttamente sia per l'utente proprietario che per l'admin in modalita' impersonificazione
- Le impostazioni globali (ticker NULL) vengono aggiornate correttamente tramite upsert senza errori

