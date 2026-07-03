## Problema

Al login (utente normale) si osservano due sintomi in sequenza:
1. Un valore di "Netting Totale" iniziale sbagliato (residuo di stato precedente / cache).
2. Poi la Dashboard mostra "nessun portafoglio caricato" con tutto a zero, finché non si seleziona manualmente il portafoglio dal menu.

Causa: race condition tra il ripristino della sessione Supabase, il caricamento della lista portafogli in `PortfolioContext` e il primo render della Dashboard. `selectedId` parte da `localStorage` (potenzialmente stale/vuoto al primo login), le query `positions`/`portfolio` girano con `portfolio?.id` non ancora valorizzato → ritornano vuoto → Dashboard renderizza lo stato "zero" prima che l'auto-selezione del primo portafoglio scatti.

## Fix

1. **`src/contexts/AuthContext.tsx`** — esporre un flag `authReady` che diventa `true` solo dopo che `supabase.auth.getSession()` ha completato il ripristino iniziale (pattern `useAuthReady`). Evita che i consumer partano prima del ripristino sessione.

2. **`src/contexts/PortfolioContext.tsx`**
   - Non leggere `localStorage` per `selectedId` finché `authReady && !!user`; inizializzare a `null` e valorizzarlo dentro l'effetto di auto-selezione.
   - Pulire `SELECTED_PORTFOLIO_KEY` e le chiavi admin quando `user?.id` cambia rispetto al valore precedente (evita "spillover" da sessione precedente sullo stesso browser).
   - Esporre `isReady` = `authReady && !portfoliosQuery.isLoading && (portfolios.length === 0 || !!selectedPortfolio)` così i consumer sanno se possono fidarsi dello stato.
   - Mantenere l'ordinamento attuale (`last_updated desc, created_at desc`) come definizione di "portafoglio principale" per utenti normali.

3. **`src/components/dashboard/Dashboard.tsx`** — se `!isReady` (o `isLoading` del portafoglio) mostrare il `PageLoader`/skeleton invece dello stato "tutto a zero / nessun dato". Questo elimina sia il flash del netting sbagliato sia la schermata vuota.

4. **`src/hooks/usePortfolio.ts`** — abilitare la query `positions` solo quando `portfolio?.id` è valorizzato E `authReady` è vero (già parzialmente così, ma la aggancio esplicita a `authReady` per sicurezza). Nessuna modifica di logica sui calcoli.

Nessuna modifica su admin landing, storico, aggregati o sul database.

## Verifica

- Login utente con 1 solo portafoglio → si apre direttamente su quel portafoglio, nessuna schermata "zero" intermedia.
- Login utente con più portafogli → si apre sul più recente (`last_updated desc`), coerente con il selettore.
- Refresh a pagina caricata → nessuna regressione (selectedId persiste in localStorage dopo l'auto-selezione).
- Admin: landing sull'ultimo cliente aggiornato invariata.
