
## Obiettivo
Fare in modo che la linea “Benchmark” non possa più rimanere “piatta” per mesi quando in realtà i prezzi esistono, e che il sistema:
1) recuperi sempre i dati più aggiornati possibili,
2) segnali in modo chiaro eventuali buchi/obsolescenza dei dati (per ticker e per data),
3) permetta un refresh manuale (senza “sprecare crediti” a tentativi).

---

## Diagnosi (cosa sta succedendo davvero)
### 1) Da dove arrivano i dati benchmark
I prezzi vengono scaricati dal backend tramite la funzione `update-benchmark-prices` che interroga **Yahoo Finance** endpoint:
`https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1=...&period2=...&interval=1d&events=history`

Poi salva tutto nella tabella `benchmark_prices` (una riga per `ticker` + `price_date`).

### 2) Perché puoi vedere il rendimento “fisso” da dicembre 24 ad oggi
Il frontend, in `useBenchmarkData.ts`, fa una query:

```ts
supabase.from('benchmark_prices')
  .select(...)
  .gte('price_date', from)
  .lte('price_date', to)
  .order('price_date', { ascending: true })
```

Ma le API del database hanno un **limite di righe per risposta (tipicamente 1000)**.  
Se chiedi 3 anni * 5 tickers, superi facilmente 1000 righe, e ottieni solo una porzione iniziale della serie storica.

Effetto collaterale:
- per le date successive all’ultima `price_date` effettivamente ricevuta dal frontend, `getClosestPrice()` continua a restituire “l’ultimo prezzo disponibile” (vecchio),
- quindi i rendimenti diventano “congelati” da quel punto in poi, anche se nel database i dati più recenti esistono.

Questa è la causa più coerente con il comportamento “linea piatta per mesi”.

---

## Cosa implementerò (fix definitivo)

### A) Fix principale: paginazione per superare il limite 1000 righe
**File:** `src/hooks/useBenchmarkData.ts`

1) Sostituire la query singola con una funzione di fetch paginata:
- fetch a blocchi (es. 1000 righe per pagina) usando `.range(from, to)`
- accumulare fino a quando la pagina ritorna meno di `PAGE_SIZE`.

Risultato: avremo davvero tutte le righe nel range richiesto, quindi `getClosestPrice()` potrà trovare prezzi recenti e il benchmark non si “congela”.

2) Aggiungere una “sanity check” lato hook:
- calcolare `lastFetchedDateByTicker`
- se per un ticker `lastFetchedDate` è molto indietro rispetto a `dateRange.to` (es. > 7 giorni), segnalare “stale/missing”.

---

### B) Gap detection seria (non solo “missing tickers”)
**File:** `src/hooks/useBenchmarkData.ts`

Oggi `dataGaps` salva solo `{ date, missingTickers }` e “stale” è un boolean interno non riportato in modo informativo.

Modifica:
- cambiare struttura gap in qualcosa tipo:
  - `date`
  - `missingTickers: string[]`
  - `staleTickers: string[]`
  - `staleDetails?: Record<ticker, { lastDate: string; daysDiff: number }>`
- aggiornare `getClosestPrice()` per restituire anche `matchedDate` (non solo `price`), così possiamo dire chiaramente “per SPY sto usando il prezzo del 2025-12-24 per la data 2026-02-06”.

Questo rende l’avviso affidabile e “debbugabile” dall’utente.

---

### C) Avviso UI chiaro e non ignorabile quando ci sono lacune
**File:** `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

1) Se `dataGaps.length > 0`:
- mostrare l’icona `AlertTriangle` (già presente) ma rendere il tooltip più esplicito, ad esempio:
  - “Dati benchmark incompleti/obsoleti”
  - elenco ticker con `ultima data disponibile` (e quanti giorni di ritardo)
  - spiegazione: “in giorni di borsa chiusa uso la chiusura precedente; oltre X giorni è considerato stale”.

2) Aggiungere (facoltativo ma consigliato) una riga di testo piccola sotto la legenda quando ci sono gap:
- “Benchmark: dati non aggiornati per alcuni ticker (vedi tooltip)”
così non dipende solo dall’hover.

---

### D) (Opzionale) Pulsante “Aggiorna benchmark” controllato
**Per evitare altri giri a vuoto quando Yahoo ha avuto errori temporanei.**

**File:** `PerformanceEvolutionChart.tsx` (o componente padre dashboard)
- aggiungere un bottone visibile solo se:
  - ci sono gap stale significativi, oppure
  - l’ultima data disponibile è indietro oltre soglia.
- al click invoca la backend function `update-benchmark-prices` e poi invalida la query React Query `['benchmark-prices', ...]`.

Nota: questo non sostituisce l’aggiornamento automatico, ma ti dà un “recovery” immediato senza dover intervenire manualmente sul backend.

---

## Test (verifiche che farò prima di chiudere)
1) **Verifica dati reali nel database** (internamente):
- controllare `max(price_date)` per ticker e assicurarsi che arrivi a date recenti.

2) **Verifica frontend dopo paginazione**:
- loggare temporaneamente quante righe arrivano (`benchmarkPrices.length`) e la `max price_date` per ticker dopo fetch (solo in console) per confermare che non si ferma più a ~1000.

3) **Verifica grafico**:
- se oggi è nel range, il punto `currentDate` deve usare prezzi <= oggi e quindi il rendimento deve muoversi.

4) **Verifica warning**:
- simulare un ticker mancante (o restringere range) e vedere che l’avviso compaia con dettagli (ticker + ultima data).

---

## File che toccherò
- `src/hooks/useBenchmarkData.ts`
  - paginazione query
  - gap/stale detection dettagliata
- `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`
  - UI warning migliorato
  - (opzionale) pulsante refresh benchmark

---

## Risultato atteso
- Il benchmark non può più rimanere “congelato” per mesi se i dati esistono.
- Se davvero ci sono buchi (provider down, ticker senza dati, ecc.), lo vedi subito con un warning chiaro e dettagliato.
- Hai un modo rapido per forzare l’aggiornamento, senza altri tentativi alla cieca.
