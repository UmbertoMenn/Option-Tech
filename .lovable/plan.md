
Obiettivo: rendere la curva di “Evoluzione Rendimento” davvero leggibile in vista aggregata, eliminando l’effetto erratico nella parte finale.

Piano di implementazione (1 file):
File: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

1) Sostituire il downsampling attuale (a indice) con downsampling a bucket temporali
- Problema attuale: `downsampleData` seleziona punti per indice (`Math.round(i * step)`), quindi se i dati sono densi a fine periodo (tipico dell’aggregato), la coda del grafico resta troppo “nervosa”.
- Fix: creare bucket uniformi sul tempo (timestamp), non sul numero di record, e prendere 1 punto rappresentativo per bucket.
- Preservare sempre:
  - primo punto
  - ultimo punto
  - eventuale punto corrente (`currentDate`) se presente

2) Ridurre in modo più aggressivo il numero massimo di punti renderizzati
- Aggiornare la logica `maxPoints` nel `useMemo` di `chartData` con soglie più basse di quelle attuali.
- Proposta:
  - `1M`: 10
  - `3M`: 12
  - `6M`: 14
  - `1Y`: 18
  - `2Y`: 22
  - `3Y` / `MAX` / `YTD`: 24
- Risultato: meno ancore di tooltip/cursore e linee molto più pulite.

3) Rifinire interazione cursore/dot
- Lasciare i dot visibili solo su primo/ultimo (già presente), ma rendere l’`activeDot` più discreto o condizionato.
- Effetto: il cursore non dà più la sensazione di “agganciarsi” a troppi micro-movimenti.

4) Non toccare la logica YTD già corretta
- `YTD` resta visibile come etichetta `YTD` (non convertita).
- Filtro data da 1 gennaio invariato.

Verifica end-to-end (obbligatoria)
- Aprire dashboard su “Il mio aggregato”.
- Testare range: `6M`, `1Y`, `YTD`, `MAX`.
- Verificare:
  - coda curva visivamente più stabile
  - meno stop del tooltip con il mouse
  - nessuna regressione su benchmark/admin
  - etichetta `YTD` corretta.

Dettagli tecnici
- Punto chiave: il bug visivo non è nel filtro temporale, ma nel campionamento “per indice”.
- In serie aggregate, la distribuzione date non è uniforme: il campionamento temporale uniforme risolve proprio la coda erratica che stai vedendo.
