

## Fix estrazione ticker dal CSV

### Problema

`findColumn(headers, ['ticker', 'symbol', 'simbolo'])` trova la prima colonna che matcha — se il CSV ha una colonna "ticker" contenente il nome dell'exchange (es. "BATS") e una colonna "symbol" con il ticker reale (es. "AAPL"), il codice prende "BATS".

### Soluzione

In `src/components/simulator/TickerSelector.tsx`, nella funzione `parseCsvContent`:

1. Cercare separatamente la colonna "symbol" e la colonna "ticker"/"exchange"
2. Prioritizzare la colonna "symbol" per l'estrazione del ticker
3. Aggiungere una lista di exchange noti (BATS, NYSE, NASDAQ, ARCA, AMEX, IEX, CBOE) come fallback: se il valore estratto è un exchange noto, passare alla colonna successiva o al filename

Logica aggiornata:
- `symbolIdx = findColumn(headers, ['symbol', 'simbolo'])`
- `tickerIdx = findColumn(headers, ['ticker'])`
- Usare `symbolIdx` se disponibile, altrimenti `tickerIdx`
- Se il valore trovato è in `KNOWN_EXCHANGES`, ignorarlo e usare il fallback dal filename

