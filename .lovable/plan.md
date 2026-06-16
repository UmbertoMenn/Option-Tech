## Diagnosi: perché molti Beta mancano per SilviaS

Causa root: il consumer in `useStressLab.ts` interroga `ticker_fundamentals` usando direttamente `p.underlying` grezzo (es. `"APPLE COMPUTER, INC."`, `"GOOGLE INC. (A)"`), mentre `ticker_fundamentals` è chiavato sui ticker puliti (AAPL, GOOGL, JPM) che il cron `update-beta-cron` popola correttamente leggendo da `underlying_prices`.

Conseguenze attuali:
- 51/66 ticker di SilviaS appaiono "senza beta" anche se il beta esiste (su AAPL, GOOGL, JPM, ecc.).
- Il fallback on-demand chiama `fetch-ticker-fundamentals` con la stringa grezza, Yahoo/GuruFocus restituiscono nulla, e viene **upsertata una riga inquinata** in `ticker_fundamentals` con ticker = "APPLE COMPUTER, INC." e beta NULL.

## Cosa fare

### 1. Riuso degli strumenti di risoluzione già esistenti
Nel codice esiste già tutto il necessario, da riusare senza reinventare:
- `src/lib/tickerIdentity.ts` → `resolveUnderlyingIdentity()` (alias map + linkedStock + exchange suffix), `normalizeTickerCandidate`, `isLikelyUnderlyingTicker`.
- `src/hooks/useUnderlyingMappings.ts` → `normalizeUnderlying` + tabella `underlying_mappings`.
- `src/hooks/useUnderlyingPrices.ts` → pattern già usato per risolvere `underlying → ticker` via `underlying_mappings` con fallback su normalizzazione.

**Fix consumer (`useStressLab.ts`)**: nel calcolo di `allTickers`, per ogni derivato passare l'`underlying` attraverso lo stesso pattern di `useUnderlyingPrices` (carico `underlying_mappings`, lookup diretto + normalizzato, fallback a `resolveUnderlyingIdentity({ underlyingName, description })`). Solo i ticker risolti e validi (`isLikelyUnderlyingTicker`) finiscono nella query a `ticker_fundamentals` e nel fallback on-demand.

### 2. Hardening `fetch-ticker-fundamentals`
- Validazione input: se il ticker contiene spazi/virgole/parentesi o non passa `isLikelyUnderlyingTicker`, restituisce 400 senza scrivere su DB.
- Niente più righe inquinate.

### 3. Beta = media Yahoo + GuruFocus
Sia in `fetch-ticker-fundamentals` (on-demand) sia in `update-beta-cron` (batch):

```text
beta = (yahooBeta + guruBeta) / 2   se entrambi presenti
     = yahooBeta o guruBeta         se uno solo
     = null                          altrimenti
beta_source = "Yahoo+GuruFocus" | "Yahoo Finance" | "GuruFocus"
```

Il throttling adattivo già presente in `update-beta-cron` resta valido (una chiamata GuruFocus in più per ticker).

### 4. Cron mensile a partire da oggi
Riprogrammare il job pg_cron `update-beta-weekly` come **mensile**, giorno 16 alle 03:00 UTC (oggi è il 16/06/2026):

```sql
SELECT cron.unschedule('update-beta-weekly');
SELECT cron.schedule('update-beta-monthly', '0 3 16 * *', $$ ...net.http_post(update-beta-cron)... $$);
```

### 5. Pulizia dati inquinati (una-tantum)
```sql
DELETE FROM ticker_fundamentals
WHERE ticker !~ '^[A-Z0-9.\-^=]+$';   -- rimuove "APPLE COMPUTER, INC." ecc.
```

### 6. Fetch manuale dalla pagina admin
Nuovo componente `src/components/admin/BetaRefreshPanel.tsx` montato in `AdminPanel`:
- Query aggregata cross-utente: per ogni derivato + stock, risolve l'`underlying`/`ticker` con la stessa pipeline del punto 1, e raggruppa lo stato in `ticker_fundamentals` (beta presente / NULL / mai fetchato).
- Tabella con: ticker risolto, nome canonico, # posizioni totali, ultimo aggiornamento beta, source.
- Pulsante **"Refetch"** per riga → `fetch-ticker-fundamentals` sul singolo ticker, toast con esito (beta + source).
- Pulsante **"Refetch tutti i mancanti"** → invoca `update-beta-cron` (batch unico).
- Auto-refresh della lista al termine.

## File interessati

- `src/hooks/useStressLab.ts` — risoluzione underlying→ticker prima della query betas (riuso pipeline esistente).
- `supabase/functions/fetch-ticker-fundamentals/index.ts` — validazione input + media Yahoo/GuruFocus.
- `supabase/functions/update-beta-cron/index.ts` — media Yahoo/GuruFocus.
- `src/components/admin/AdminPanel.tsx` (+ nuovo `BetaRefreshPanel.tsx`) — UI fetch manuale.
- Migration: pulizia righe inquinate + unschedule weekly + schedule monthly.

Nessuna modifica a dashboard/derivatives (snapshot/live prices invariati).
