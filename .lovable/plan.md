Correggo l’implementazione mettendo la (i) dove serve davvero: nei pannelli di dettaglio categorie del Risk Analyzer, accanto ai valori EUR.

## Modifiche da fare

### `src/components/risk/SectorAllocationView.tsx`
- Aggiungere una piccola icona `Info` cliccabile/hoverabile accanto al valore EUR:
  - nella riga intestazione categoria, es. `Dettaglio Strategie`, `Dettaglio Naked Put`, `Dettaglio Leap Call`, `Stocks & ETF`;
  - in ogni riga strumento sotto la categoria, accanto al valore EUR della singola posizione.
- Il tooltip mostrerà una spiegazione coerente con la categoria:
  - `Naked Put`: rischio assegnazione calcolato su strike × contratti × 100, convertito in EUR;
  - `Leap Call`: valore di mercato della call, convertito in EUR;
  - `Strategie`: max loss calcolato sul payoff a scadenza, con nota per rischio illimitato se disponibile nei dati;
  - `Stocks & ETF`: valore esposizione posizione / quota ETF.

### `src/components/risk/CurrencyExposureView.tsx`
- Applicare la stessa logica anche al dettaglio per valuta, perché è un altro dettaglio del Risk Analyzer con categorie e valori EUR.
- Aggiungere la (i) accanto al valore EUR totale categoria e al valore EUR di ogni riga strumento.

## Nota
Non tocco la logica di calcolo del rischio, database o funzioni backend: è solo una correzione di UI/tooltip nella posizione richiesta.