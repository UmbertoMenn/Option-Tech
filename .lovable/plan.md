## 1) Admin: header non raggruppato

Il pannello admin (`src/components/admin/AdminPanel.tsx`, righe 222–346) ha un header custom con barra di pulsanti separati (Dashboard, Strategie Derivati, Risk Analyzer, Esci) invece del dropdown unico "Menù" usato nelle altre pagine tramite `AppHeaderMenu`.

**Fix**: sostituire l'header custom dell'admin con il componente standard `AppHeaderMenu` (con `includePortfolioSelector={false}`), mantenendo:
- il logo `IronCondorIcon` + titolo "Option Tech" a sinistra
- il bottone "Aggiungi Utente" come azione primaria a destra, prima del menù
- il menù raggruppato che esporrà le stesse voci delle altre pagine (Dashboard, Strategie Derivati, Risk Analyzer, Risk/Margin Simulator, Option Analyzer, Admin, tema, Esci)

Rimuove sia il blocco mobile "Indice" che la barra desktop, eliminando la duplicazione di logica già presente in `AppHeaderMenu`.

## 2) Admin: landing di default sull'ultimo cliente aggiornato

Oggi, in `PortfolioContext` (righe 49–158), all'apertura dell'app l'admin viene posizionato sul proprio portafoglio personale (`localStorage`/primo della propria lista). Vuoi invece che, all'apertura, l'admin entri in vista admin sul portafoglio **più recentemente aggiornato tra tutti i clienti** (escludendo i propri).

**Fix in `src/contexts/PortfolioContext.tsx`**:

1. Aggiungere una query admin-only che recupera tutti i portafogli (di tutti gli utenti) ordinati per `last_updated DESC, created_at DESC LIMIT 1`, escludendo `user_id = admin.id`. Abilitata solo se `isAdmin` (letto da `useAuth`). Le policy RLS admin esistenti già consentono questa lettura (vedi `useAdminPortfolios`).
2. Nell'effetto di auto-selezione iniziale, se:
   - l'utente è admin,
   - `sessionStorage` non contiene già una `ADMIN_VIEW_PORTFOLIO_KEY` (cioè non c'è una vista admin attiva da preservare tra remount/refresh),
   - e `hasInitialized === false` (solo al primo bootstrap della sessione),
   
   allora chiamare `setAdminViewPortfolio(latest.id, latest.user_id)` invece del fallback al portafoglio personale. Marcare `hasInitialized = true`.
3. Se la query non trova nessun portafoglio cliente (caso limite), si torna al comportamento attuale (portafoglio personale).
4. Il comportamento di `exitAdminMode` rimane invariato (torna al portafoglio personale), così come la persistenza della vista admin in `sessionStorage` introdotta nei fix precedenti — quindi navigando tra le pagine la vista corrente non viene sovrascritta.

### Note tecniche

- Nessuna modifica di schema DB necessaria: la colonna `last_updated` su `portfolios` è già utilizzata per l'ordinamento nella query personale (riga 74).
- La logica "primo bootstrap" usa il flag esistente `hasInitialized` per evitare di rimbalzare l'admin sul cliente più recente ogni volta che cambia manualmente portafoglio o esce dalla vista admin nella stessa sessione.
- `AppHeaderMenu` è già usato in tutte le altre pagine principali, quindi il refactor dell'admin garantisce parità visiva e funzionale immediata.

### File toccati

- `src/components/admin/AdminPanel.tsx` — sostituzione blocco header custom con `AppHeaderMenu`.
- `src/contexts/PortfolioContext.tsx` — nuova query admin "latest client portfolio" + logica di landing iniziale.