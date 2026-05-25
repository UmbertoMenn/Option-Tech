Piano di intervento:

1. Rendere lo spot risolvibile anche per ticker
- Aggiorno `useRiskAnalysis` per usare `useUnderlyingPrices` sui sottostanti/ticker dei derivati, come già fa la Dashboard.
- Passo un `spotResolver` esplicito a `analyzePortfolioRisk`.
- Ordine di risoluzione:
  1. stock/ETF presenti in portafoglio: `snapshot_price` poi `current_price`;
  2. prezzo live/cache da `underlying_prices`, cercando per nome sottostante e per ticker canonico;
  3. se non trovato, resta `null`.

2. Migliorare il resolver nel calcolo rischio
- Estendo `SpotResolver` per ricevere anche ticker/strike/descrizioni utili.
- In `calculateSyntheticCcDrccRisk`, per le CALL sintetiche passo al resolver il ticker della long CALL, il ticker della short CALL e il nome sottostante.
- Mantengo invariata la formula di rischio: cambia solo il modo in cui si recupera lo spot.

3. Tooltip con diagnosi esplicita
- Nel `syntheticBreakdown` aggiungo metadati tipo `spotSource` e `spotStatus`.
- Nel tooltip di dettaglio mostro chiaramente:
  - spot trovato e fonte: portafoglio oppure ticker/prezzo cache;
  - confronto reale `spot > strike_short` o `spot ≤ strike_short`;
  - prezzo scelto (`PMC` o `mkt`) e moltiplicazione finale.

4. Bollino rosso se lo spot non è risolto
- Nella riga delle sintetiche CALL, se `spot === null`, mostro un badge rosso accanto alla strategia, ad esempio `Spot non risolto`.
- Il tooltip in quel caso spiega che è stato usato il fallback `mkt` perché lo spot non è stato trovato né nel portafoglio né per ticker.

File coinvolti:
- `src/hooks/useRiskAnalysis.ts`
- `src/lib/riskCalculator.ts`
- `src/components/risk/EquityExposureView.tsx`

Nessun cambio a database, RLS, backend o formule di rischio.