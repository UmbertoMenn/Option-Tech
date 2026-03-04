

## Diagnosi del problema

### Causa radice
La `strategy_cache` (usata dal cron `check-alerts` per determinare strike/scadenze) viene aggiornata **solo quando l'utente visita la pagina Derivati**. Se stamattina è stato caricato un nuovo Excel con la covered call NFLX a strike 100, ma nessuno ha aperto la pagina Derivati di quel portafoglio, la cache contiene ancora lo strike vecchio (98). Il cron ha letto strike 98 dalla cache, ha visto il prezzo NFLX sopra 98 → ha generato l'alert ITM.

### Soluzione
Aggiornare la `strategy_cache` automaticamente **dopo ogni upload Excel**, non solo alla visita della pagina Derivati. In questo modo il cron lavora sempre con dati aggiornati.

### Implementazione

**File: `src/components/dashboard/FileUploader.tsx`** (o dove avviene il salvataggio post-upload)
- Dopo il salvataggio delle posizioni nel DB, invocare `saveStrategyCache()` con le nuove posizioni derivate e i prezzi sottostanti disponibili.
- Questo richiede:
  1. Riclassificare i derivati con la stessa logica di `derivativeStrategies.ts`
  2. Chiamare `saveStrategyCache(portfolioId, categories, underlyingPrices)`

**Problema**: la classificazione completa dei derivati richiede `underlyingPrices` e `derivative_overrides`, che al momento del upload potrebbero non essere tutti disponibili. Tuttavia la cache verrebbe comunque aggiornata con gli strike corretti dal nuovo Excel, risolvendo il caso specifico.

**Approccio pratico (meno invasivo)**:
Aggiungere un refresh della strategy cache nel flusso post-upload. Dopo che le posizioni sono state salvate:
1. Ri-fetchare le posizioni derivate dal DB
2. Eseguire la categorizzazione
3. Chiamare `saveStrategyCache`

Questo garantisce che il cron `check-alerts` veda sempre gli strike aggiornati dall'ultimo Excel caricato, anche se nessuno apre la pagina Derivati.

### File da modificare
- `src/components/dashboard/FileUploader.tsx` — aggiungere chiamata a `saveStrategyCache` post-upload
- Potrebbe servire un refactor leggero per estrarre la logica di categorizzazione in una funzione riutilizzabile se non è già separata

Devo prima verificare il flusso di upload per capire dove inserire la chiamata.

