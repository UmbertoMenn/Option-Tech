
Obiettivo: correggere l’estrazione ticker nel Simulator, così file come `BATS_AAPL,60.csv` restituiscono `AAPL` (non `BATS`).

1) Root cause (attuale)
- In `src/components/simulator/TickerSelector.tsx` il parser cerca una singola colonna con pattern `['ticker', 'symbol', 'simbolo']`: se trova prima `ticker`, può prendere un valore exchange (es. `BATS`).
- Il fallback filename prende sempre il primo token alfabetico (`^([A-Z]{1,6})`), quindi su `BATS_AAPL,60.csv` ritorna `BATS`.

2) Modifiche da fare (stesso file)
- Separare la ricerca colonne:
  - `symbolIdx = findColumn(headers, ['symbol', 'simbolo'])`
  - `tickerIdx = findColumn(headers, ['ticker'])`
- Priorità estrazione riga:
  - prima `symbolIdx`
  - poi `tickerIdx`
- Aggiungere normalizzazione/candidate picker ticker:
  - uppercase, trim, rimozione quote
  - split su separatori (`_ , : ; - spazio /`)
  - ignorare token exchange noti (`BATS`, `NYSE`, `NASDAQ`, `ARCA`, `IEX`, `CBOE`, ecc.)
  - scegliere il primo token “ticker-like” valido (es. `AAPL`, `SAP.DE`), ignorando token numerici (`60`)
- Rifare `extractTickerFromFilename` con la stessa logica:
  - caso `EXCHANGE_TICKER,...` → prendere il token successivo all’exchange (`AAPL`)
  - fallback: primo token valido non-exchange

3) Comportamento finale atteso
- `BATS_AAPL,60.csv` → `AAPL`
- CSV con colonna `ticker=BATS` e `symbol=AAPL` → `AAPL`
- CSV con solo `ticker=MSFT` → `MSFT`
- Se non rilevabile automaticamente, resta possibile inserimento manuale nel campo Ticker (comportamento già presente).

4) Validazione rapida dopo implementazione
- Test manuale upload con:
  - `BATS_AAPL,60.csv`
  - file con colonne `ticker` + `symbol`
  - file con solo `ticker`
- Verifica toast e input “Ticker (auto-estratto)” coerenti col simbolo reale.
