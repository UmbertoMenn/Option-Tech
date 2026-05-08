L’errore è chiaro: in `src/lib/sectorExposure.ts` ci sono tre `require('./tickerIdentity')` usati dentro funzioni eseguite nel browser. Vite/React in modalità ESM non espone `require`, quindi il Risk Analyzer crasha appena calcola la vista Equity.

Piano di correzione:

1. Aggiornare `src/lib/sectorExposure.ts`
   - Sostituire i `require('./tickerIdentity')` con import ESM statici:
     - `resolveUnderlyingIdentity`
     - `normalizeText`
   - Mantenere invariata la logica di aggregazione e matching: cambia solo il modo in cui le funzioni vengono importate.

2. Verificare che non restino `require(` nel codice runtime
   - Lasciare eventuali test invariati, ma rimuovere i `require` dai file usati dall’app.

3. Validare il risultato
   - Controllare che la pagina `/risk-analyzer` non mostri più l’ErrorBoundary con `require is not defined`.
   - Se emergesse un nuovo errore, l’ErrorBoundary ora lo renderà visibile e si potrà intervenire sul punto preciso.