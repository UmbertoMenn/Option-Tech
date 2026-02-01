
# Piano: Implementare Yahoo Finance per Prezzi Opzioni

## Conferma: Yahoo Finance Offre Dati Opzioni

**Sì, Yahoo Finance offre dati sulle opzioni USA con un ritardo di circa 15 minuti**, completamente gratuito e senza necessità di API key.

### Dati Disponibili
- `lastPrice` - ultimo prezzo scambiato
- `bid` / `ask` - denaro/lettera
- `change` / `percentChange` - variazione giornaliera
- `volume` - volume giornaliero
- `openInterest` - open interest
- `impliedVolatility` - volatilità implicita

---

## Endpoint API

```
GET https://query1.finance.yahoo.com/v7/finance/options/{TICKER}?date={EXPIRY_UNIX}
```

Esempio:
```
https://query1.finance.yahoo.com/v7/finance/options/TSLA?date=1745539200
```

Risposta:
```json
{
  "optionChain": {
    "result": [{
      "options": [{
        "calls": [
          {
            "contractSymbol": "TSLA250425C00050000",
            "strike": 50.0,
            "lastPrice": 174.51,
            "bid": 176.30,
            "ask": 178.90,
            "change": -14.70,
            "percentChange": -7.77,
            "volume": 12,
            "openInterest": 12,
            "impliedVolatility": 5.04
          }
        ],
        "puts": [...]
      }]
    }]
  }
}
```

---

## Vantaggi Rispetto a Tradier

| Aspetto | Tradier | Yahoo Finance |
|---------|---------|---------------|
| Costo | Richiede API Key (scaduta) | **Gratuito** |
| Delay | Real-time (con abbonamento) | **~15 minuti** |
| Dati Extra | Solo prezzo | **IV, Greeks, Open Interest** |
| Rate Limit | Basso | Moderato |
| Affidabilità | Dipende da subscription | Molto stabile |

---

## Strategia di Implementazione

### Sfida Principale
Yahoo non permette di richiedere opzioni specifiche per contract symbol. Bisogna:
1. Raggruppare le opzioni per underlying ticker
2. Raggruppare per data di scadenza
3. Fare una chiamata per ogni combinazione ticker+expiry
4. Cercare l'opzione specifica nella risposta

### Logica

```text
Opzioni richieste:
├── TSLA 2025-04-25 Call $250
├── TSLA 2025-04-25 Put $200
├── TSLA 2025-05-16 Call $300
├── AAPL 2025-04-25 Call $200
└── AAPL 2025-04-25 Put $180

Chiamate API ottimizzate:
1. GET /options/TSLA?date=1745539200  → contiene entrambe le opzioni Apr 25
2. GET /options/TSLA?date=1747353600  → contiene opzione May 16
3. GET /options/AAPL?date=1745539200  → contiene entrambe le opzioni Apr 25
```

---

## Modifiche al Codice

### File: `supabase/functions/fetch-market-prices/index.ts`

#### 1. Aggiungere `'yahoo-options'` come source

```typescript
interface PriceData {
  // ...
  source: 'tradier' | 'yahoo' | 'justetf' | 'yahoo-options' | 'error';
  // ...
}
```

#### 2. Nuova funzione `fetchYahooOptionPrices`

```typescript
async function fetchYahooOptionPrices(
  options: OptionRequest[]
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  if (options.length === 0) return results;

  // Group options by ticker + expiry for efficient fetching
  const groupedOptions = new Map<string, {
    ticker: string;
    expiryUnix: number;
    expiryStr: string;
    requests: OptionRequest[];
  }>();

  for (const opt of options) {
    const ticker = underlyingToTicker(opt.underlying);
    if (!ticker) {
      results.set(opt.originalId, {
        symbol: opt.underlying,
        price: null,
        source: 'error',
        error: `Cannot convert underlying "${opt.underlying}" to ticker`,
        // ... other fields
      });
      continue;
    }

    const expiryDate = new Date(opt.expiry);
    const expiryUnix = Math.floor(expiryDate.getTime() / 1000);
    const key = `${ticker}:${expiryUnix}`;

    if (!groupedOptions.has(key)) {
      groupedOptions.set(key, {
        ticker,
        expiryUnix,
        expiryStr: opt.expiry,
        requests: [],
      });
    }
    groupedOptions.get(key)!.requests.push(opt);
  }

  // Fetch each ticker+expiry combination
  for (const [key, group] of groupedOptions) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${group.ticker}?date=${group.expiryUnix}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });

      if (!response.ok) {
        console.error(`Yahoo Options error for ${group.ticker}: ${response.status}`);
        for (const opt of group.requests) {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            source: 'error',
            error: `Yahoo Options API returned ${response.status}`,
            // ...
          });
        }
        continue;
      }

      const data = await response.json();
      const optionData = data?.optionChain?.result?.[0]?.options?.[0];
      
      if (!optionData) {
        for (const opt of group.requests) {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            source: 'error',
            error: 'No option data found for expiry',
            // ...
          });
        }
        continue;
      }

      // Build map of contracts by strike+type
      const contractMap = new Map<string, any>();
      for (const call of optionData.calls || []) {
        contractMap.set(`C:${call.strike}`, call);
      }
      for (const put of optionData.puts || []) {
        contractMap.set(`P:${put.strike}`, put);
      }

      // Match each requested option
      for (const opt of group.requests) {
        const key = `${opt.optionType === 'call' ? 'C' : 'P'}:${opt.strike}`;
        const contract = contractMap.get(key);

        if (contract) {
          results.set(opt.originalId, {
            symbol: contract.contractSymbol,
            price: contract.lastPrice ?? null,
            change: contract.change ?? null,
            changePct: contract.percentChange ?? null,
            bid: contract.bid ?? null,
            ask: contract.ask ?? null,
            volume: contract.volume ?? null,
            lastUpdated: new Date().toISOString(),
            source: 'yahoo-options',
          });
        } else {
          results.set(opt.originalId, {
            symbol: opt.underlying,
            price: null,
            source: 'error',
            error: `Option not found: ${opt.optionType} strike ${opt.strike}`,
            // ...
          });
        }
      }
    } catch (error) {
      console.error(`Yahoo Options fetch error for ${group.ticker}:`, error);
      for (const opt of group.requests) {
        results.set(opt.originalId, {
          symbol: opt.underlying,
          price: null,
          source: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          // ...
        });
      }
    }
  }

  return results;
}
```

#### 3. Modificare la funzione principale

Sostituire la chiamata a Tradier con Yahoo Options:

```typescript
// PRIMA (Tradier)
const tradierApiKey = Deno.env.get('TRADIER_API_KEY');
const optionPrices = await fetchTradierOptionPrices(options, tradierApiKey || '');

// DOPO (Yahoo Finance)
const optionPrices = await fetchYahooOptionPrices(options);
```

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/fetch-market-prices/index.ts` | Aggiungere `fetchYahooOptionPrices`, rimuovere dipendenza da Tradier |

---

## Considerazioni Performance

### Rate Limiting
Yahoo Finance ha rate limits non documentati ma generosi. Per evitare blocchi:
- Delay di 100ms tra richieste consecutive
- Max ~100 richieste/minuto

### Ottimizzazione
Il raggruppamento per ticker+expiry riduce drasticamente le chiamate:
- **Scenario**: 164 opzioni su 20 underlying con 5 expiries ciascuno
- **Senza raggruppamento**: 164 chiamate
- **Con raggruppamento**: ~100 chiamate (20 tickers × 5 expiries)

---

## Vantaggi Finali

1. **Nessuna API Key necessaria** - Non serve più Tradier o Massive.com
2. **Dati gratuiti** - Yahoo Finance è completamente gratuito
3. **15 min delay accettabile** - Per il monitoraggio portfolio è sufficiente
4. **Dati extra** - Implied Volatility e Open Interest inclusi
5. **Affidabilità** - Yahoo Finance è molto stabile

---

## Nota sulla Key Massive.com

La chiave fornita (`1AsXKwR1s7IHTFGWzJjKEVNVzT8AbvVJ`) non sarà necessaria se usiamo Yahoo Finance. Tuttavia, posso conservarla come backup per Massive.com nel caso Yahoo dovesse essere bloccato o rate-limited in futuro.
