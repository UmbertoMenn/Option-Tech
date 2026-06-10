
# Option Analyzer

Nuova pagina che porta nell'app il cruscotto opzioni dell'artifact, integrato con i provider dati esistenti (Finnhub/Yahoo) e con due cron job per Beta ed Equity Risk Premium.

## 1. Routing e menù

- Nuovo file `src/pages/OptionAnalyzer.tsx` (porting dell'artifact, allineato al design system).
- `src/App.tsx`: aggiungere route `/option-analyzer` con lazy import + ErrorBoundary.
- `src/components/layout/AppHeaderMenu.tsx`: nuova voce "Option Analyzer" subito sotto "Risk Simulator" (icona `LineChart` o simile da lucide).

## 2. Porting del componente

Il codice dell'artifact viene riscritto rispettando le convenzioni del progetto:

- TypeScript con tipi sugli stati e sulle funzioni matematiche.
- Niente colori hard-coded (`#131722`, `#2962FF`, …): si usano i token semantici di `index.css` / Tailwind (`bg-card`, `text-foreground`, `border-border`, `text-primary`, varianti `success`/`destructive`/`warning`). Le poche tonalità extra (verde EV, ambra) passano da variabili CSS già esistenti.
- Componenti shadcn esistenti (`Card`, `Input`, `Button`, `Select`, `Tabs`, `Tooltip`, `Switch`) sostituiscono i `Field`/`Metric`/`InfoIcon` inline dove sensato. La logica di disegno SVG (distribuzione, edge vs strike, edge vs μ, P&L) resta invariata.
- Header coerente con le altre pagine (`AppHeaderMenu` + titolo).
- La chiamata diretta a `api.anthropic.com` dell'artifact viene rimossa (insicura lato browser): vedi punto 3.

Tutta la matematica (Black-Scholes, IV bisection, drift CAPM, μ*, probabilità, p-touch, grafici SVG) viene portata 1:1.

## 3. Fetch dati ticker (prezzo, Beta, ERP, RV, risk-free)

Nuova edge function `supabase/functions/fetch-ticker-fundamentals/index.ts`:

- Input: `{ ticker }`.
- Output: `{ name, currency, price, beta, betaSource, rv, riskFree, erp, asof }`.
- Sorgenti (gratis, già usate in app o pubbliche):
  - **Prezzo / nome / valuta**: Finnhub `/quote` + `/stock/profile2` (chiave `FINNHUB_API_KEY` già presente), fallback Yahoo `v7/finance/quote`.
  - **Beta (1y)**: Yahoo `quoteSummary?modules=defaultKeyStatistics,summaryDetail` → campo `beta`. Fallback secondario: scraping leggero di GuruFocus (`https://www.gurufocus.com/term/beta/<ticker>`) con regex, perché è quello richiesto dall'artifact. `betaSource` riporta la fonte effettiva.
  - **RV (volatilità storica 1y annualizzata)**: calcolata da Yahoo `v8/finance/chart?range=1y&interval=1d` (stdev dei log-return × √252).
  - **Risk-free**: rendimento del decennale in base alla valuta del titolo. Yahoo: `^TNX` (USD), `^TYX` se serve, IT10Y/DE10Y per EUR. Mappa hard-coded valuta → ticker rendimento.
  - **ERP**: lettura della tabella ERP corrente di Damodaran (`https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html`) con parsing HTML. Cache in DB così non scarichiamo a ogni richiesta.

Chiamata dal frontend via `supabase.functions.invoke('fetch-ticker-fundamentals', { body: { ticker }})`. Tutti i campi restano modificabili come nell'artifact, e il bottone "Carica dati" riempie i form.

## 4. Caching su DB

Nuove tabelle (migration) per persistere Beta e ERP e servirli istantaneamente:

- `ticker_fundamentals(ticker pk, name, currency, beta, beta_source, rv, risk_free, updated_at)` — aggiornata dal cron mensile Beta + dal cron giornaliero (RV/risk-free).
- `equity_risk_premiums(country/currency pk, erp_pct, source, updated_at)` — aggiornata dal cron giornaliero ERP.

GRANT a `authenticated` (SELECT) e a `service_role` (ALL), RLS abilitata con policy SELECT pubblica per gli utenti autenticati.

L'edge function legge prima dalla cache; se manca o è stantia rispetto alle finestre del cron, fa il refresh on-demand.

## 5. Cron jobs

Due nuove edge functions Lovable-managed:

- `supabase/functions/update-erp-cron/index.ts` — 1×/giorno, aggiorna `equity_risk_premiums` da Damodaran.
- `supabase/functions/update-beta-cron/index.ts` — 1×/mese, scorre i ticker presenti in `ticker_fundamentals` (+ quelli noti dai portafogli) e aggiorna Beta + RV + risk-free.

Schedulazione tramite `pg_cron` + `pg_net` (insert separato come da policy), con gli URL completi e l'apikey anon.

## 6. Verifica

- Build pulita.
- Smoke test: aprire `/option-analyzer`, inserire `AAPL`, controllare che Beta arrivi (Yahoo o GuruFocus), ERP USA ≈ 4.5–5.5%, RV plausibile, e che i grafici si aggiornino.

## File toccati

- new `src/pages/OptionAnalyzer.tsx`
- edit `src/App.tsx`, `src/components/layout/AppHeaderMenu.tsx`
- new edge functions: `fetch-ticker-fundamentals`, `update-erp-cron`, `update-beta-cron`
- migration: tabelle `ticker_fundamentals`, `equity_risk_premiums` + GRANT + RLS
- insert SQL (non-migration) per i due cron `pg_cron`
