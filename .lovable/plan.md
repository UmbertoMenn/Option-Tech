

## Cron job automatico per snapshot storico alle 23:59

### Problema
Attualmente lo snapshot storico viene creato manualmente dall'utente nella sezione "Dati Storici". Se l'utente dimentica di salvare, la serie storica ha dei buchi.

### Soluzione
Un sistema a due fasi:
1. Il **frontend** salva i valori calcolati (patrimonio, netting, equity/usd exposure) in una nuova tabella di "staging" ogni volta che il dashboard carica dati aggiornati
2. Un **cron job** alle 23:59 controlla se serve uno snapshot e lo crea automaticamente

### Perche serve lo staging dal frontend
I valori di netting, equity exposure e USD exposure sono calcolati dal frontend con logica complessa (derivati, override, cambi valuta). Non e possibile ricalcolarli lato server senza duplicare centinaia di righe di codice. Il frontend salva quindi un "pacchetto pronto" che il cron puo semplicemente copiare in `historical_data`.

### Dettaglio tecnico

**1. Nuova tabella `portfolio_latest_values`**

Colonne:
- `portfolio_id` (uuid, PK, FK verso portfolios)
- `total_value` (numeric)
- `netting_total` (numeric)
- `netting_ex_cc_np` (numeric)
- `equity_exposure_pct` (numeric)
- `usd_exposure_pct` (numeric)
- `updated_at` (timestamptz)

RLS: l'utente puo leggere/scrivere i propri (via portfolios.user_id), service_role puo leggere tutti.

**2. File: `src/components/dashboard/Dashboard.tsx`**

Aggiungere un `useEffect` che, quando i dati del dashboard sono pronti (summary, netting, equityExposurePct, usdExposurePct sono disponibili e il portfolio ha un `snapshot_date`), effettua un upsert su `portfolio_latest_values` con i valori correnti:

```text
useEffect:
  SE summary E netting E portfolio.snapshot_date disponibili:
    upsert portfolio_latest_values(
      portfolio_id,
      total_value: summary.totalValue,
      netting_total: netting.nettingTotal,
      netting_ex_cc_np: netting.nettingExCCAndNP,
      equity_exposure_pct,
      usd_exposure_pct,
      updated_at: now()
    )
```

**3. Nuova Edge Function: `supabase/functions/auto-snapshot/index.ts`**

Logica:
1. Per ogni portfolio:
   - Legge `portfolios.snapshot_date` (data dell'Excel caricato)
   - Se `snapshot_date` e null, salta
   - Cerca l'ultimo record in `historical_data` per quel portfolio (MAX snapshot_date)
   - Se l'ultimo snapshot corrisponde gia a `snapshot_date`, salta (nessun bisogno)
   - Se non c'e nessuno snapshot O l'ultimo e antecedente a `snapshot_date`:
     - Legge `portfolio_latest_values` per ottenere i valori calcolati
     - Se `portfolio_latest_values` non esiste o e troppo vecchio (>48h), salta con warning
     - Crea un nuovo record in `historical_data` con `snapshot_date = portfolios.snapshot_date` e i valori da `portfolio_latest_values`

2. Log del risultato (quanti snapshot creati, quanti saltati)

**4. Cron job**

Schedule: `59 23 * * *` (ogni giorno alle 23:59 UTC)

```sql
select cron.schedule(
  'auto-snapshot-daily',
  '59 23 * * *',
  $$
  select net.http_post(
    url:='https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/auto-snapshot',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer ANON_KEY"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

**5. Configurazione: `supabase/config.toml`**

```toml
[functions.auto-snapshot]
verify_jwt = false
```

### Flusso completo

```text
Utente carica Excel
  -> FileUploader salva snapshot_date nel portfolio
  -> Dashboard calcola netting, equity, usd exposure
  -> useEffect salva valori in portfolio_latest_values

Cron alle 23:59
  -> auto-snapshot legge tutti i portfolio
  -> Per ogni portfolio con snapshot_date:
    -> Confronta con ultimo historical_data
    -> SE snapshot_date > ultimo historical_data:
      -> Legge portfolio_latest_values
      -> Crea record in historical_data
    -> SE snapshot_date == ultimo historical_data:
      -> Salta (gia fatto)
```

### Edge case gestiti
- L'utente non apre mai il dashboard dopo l'upload: `portfolio_latest_values` non viene aggiornato, il cron salta con un warning nel log
- Upload multipli nello stesso giorno: vince l'ultimo valore salvato in `portfolio_latest_values`
- Portfolio senza Excel: `snapshot_date` e null, il cron salta
- Cron eseguito ma nessun cambiamento: nessuno snapshot creato, operazione idempotente

