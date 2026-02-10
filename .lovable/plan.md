

## Migrazione a Yahoo Finance v7/finance/options per bid/ask reali

### Problema attuale

L'endpoint `v8/finance/chart/{OCC_SYMBOL}` restituisce `bid=null, ask=null` per la maggior parte delle opzioni, facendo scattare il fallback su `regularMarketPrice` che non rappresenta il mid-price reale.

### Soluzione

Usare l'endpoint **`v7/finance/options/{TICKER}?date={UNIX_TIMESTAMP}`** che restituisce l'intera option chain per un ticker e una scadenza, con bid e ask reali per ogni contratto.

### Vantaggi

- **Bid/Ask reali** per ogni opzione nella chain
- **Meno chiamate API**: invece di 234 chiamate individuali (una per OCC symbol), si raggruppano per ticker+scadenza. Se ci sono 30 ticker con 2-3 scadenze ciascuno, servono circa 60-80 chiamate totali invece di 234
- **Stesso rate limiting** gia in uso (delay 200ms tra chiamate, 2s tra batch)

### Logica modificata

**File: `supabase/functions/update-option-prices-cron/index.ts`**

1. **Raggruppare** le posizioni per `ticker + mese di scadenza` (chiave: `TICKER_YYYY-MM`)
2. Per ogni gruppo, chiamare `https://query1.finance.yahoo.com/v7/finance/options/{TICKER}?date={UNIX_3RD_FRIDAY}` 
   - `date` e il timestamp Unix del 3o venerdi del mese
3. La risposta contiene `optionChain.result[0].options[0].calls[]` e `.puts[]`
4. Ogni elemento ha: `strike`, `bid`, `ask`, `lastPrice`, `contractSymbol`
5. Per ogni posizione nel gruppo, cercare il contratto con lo strike corrispondente
6. Calcolare `(bid + ask) / 2`, fallback su `lastPrice`
7. Aggiornare `positions.current_price` e `updated_at`

### Struttura risposta Yahoo v7

```text
optionChain.result[0]:
  underlyingSymbol: "AAPL"
  options[0]:
    expirationDate: 1771027200  (Unix timestamp)
    calls: [
      { strike: 40, bid: 8.5, ask: 9.2, lastPrice: 8.85, contractSymbol: "AAPL260320C00040000" },
      ...
    ]
    puts: [
      { strike: 40, bid: 1.2, ask: 1.5, lastPrice: 1.35, contractSymbol: "AAPL260320P00040000" },
      ...
    ]
```

### Dettagli tecnici

- La funzione `buildOCCSymbol` e `getThirdFriday` restano invariate (servono per il matching del contratto)
- Il batching cambia: invece di batch di 50 OCC symbols, batch di 20 chiamate ticker+expiry
- Delay 300ms tra chiamate, 2s tra batch (piu conservativo perche ogni chiamata restituisce piu dati)
- Se un ticker non ha dati per una scadenza, si logga e si salta

### Riepilogo

| Aspetto | Prima (v8/chart) | Dopo (v7/options) |
|---------|-------------------|-------------------|
| Endpoint | `/v8/finance/chart/{OCC}` | `/v7/finance/options/{TICKER}?date=` |
| Chiamate API | ~234 (1 per opzione) | ~60-80 (1 per ticker+scadenza) |
| Bid/Ask | Quasi sempre null | Reali dalla option chain |
| Prezzo | Fallback su regularMarketPrice | `(bid+ask)/2`, fallback su lastPrice |

Un solo file da modificare: `supabase/functions/update-option-prices-cron/index.ts`

