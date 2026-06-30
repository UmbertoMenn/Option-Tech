## Obiettivo
Correggere il bucket **Equity (incl. derivati)** a t0 della card "Evoluzione patrimonio alle scadenze" affinché sia:

```
Equity_t0 = (azioni + ETF) + (GP_total − GP_cash) + Netting Totale derivati (signed)
```

dove "Netting Totale derivati" = la componente derivati del Netting Totale già calcolato in `useDerivativeNetting` (la stessa che la Dashboard mostra), cioè il delta `nettingTotal − summary.totalValue` (negativo quando i derivati pesano).

## Cosa cambia

### 1. `src/lib/portfolioProjection.ts`
- Estendere `buildProjectionInputs` con due nuovi parametri opzionali:
  - `gpEquityValue: number` (default 0) — quota GP azionaria (esclusa la liquidità GP).
  - `derivativesNettingT0: number | null` (default `null`) — netting derivati signed a t0. Se passato, sostituisce `derivMVT0` nel calcolo di `equityT0` e nel "livello" iniziale del bucket equity per la proiezione.
- Nuovo bucket interno `gpEquityFlat` (piatto, come `commodityFlat`): aggiunto al sleeve **Equity** sia a t0 sia nei punti futuri (nessuno shock azionario applicato — la GP resta piatta come oggi nello Stress Lab; se l'utente vorrà shockarla la rivedremo).
- Ricalcolo:
  - `equityT0 = equityFlat + gpEquityFlat + (derivativesNettingT0 ?? derivMVT0)`
  - `patrimonyT0 = baseValue + (derivativesNettingT0 ?? derivMVT0)` (resta consistente con la card "Netting Totale" della Dashboard).
- Nei punti futuri il sleeve equity continua a usare il pricing BS dei derivati (`derivVal + equityAdjAtExpiry`) — la correzione "netting vs MV" è solo sul livello iniziale. Il delta `derivativesNettingT0 − derivMVT0` viene aggiunto come **offset costante** al sleeve equity (così a t0 il grafico parte dal valore corretto e il P/L% futuro è coerente).

### 2. `src/components/dashboard/PatrimonyProjectionCard.tsx`
- Aggiungere due props opzionali: `gpEquityValue?: number`, `derivativesNettingT0?: number`.
- Inoltrarli a `buildProjectionInputs`.
- Aggiornare il tooltip "Equity (incl. derivati)" per spiegare la formula nuova.

### 3. `src/components/dashboard/DynamicPortfolioChart.tsx`
- Calcolare i due valori e passarli alla card:
  - `gpEquityValue = (portfolio?.gp_total_value ?? 0) − (portfolio?.gp_cash_value ?? 0)`
  - `derivativesNettingT0 = netting.nettingTotal − (summary?.totalValue ?? 0)`
- Nessuna altra modifica di rendering.

## Dettagli tecnici
- Nessuna modifica DB, nessun edge function, nessuna RLS.
- Test esistente `src/test/portfolioProjection.test.ts`: aggiornare le aspettative dove serve (e aggiungere un caso che verifica `equityT0 = equity + gp + nettingDerivT0` quando i nuovi parametri sono passati).
- Retro-compatibilità: se `derivativesNettingT0` non viene passato, il calcolo resta identico a oggi (`derivMVT0`).

## Fuori scope
- Logica della GP nella proiezione futura (resta piatta come oggi nello Stress Lab).
- Modifica del netting futuro alle scadenze (continua via BS).
