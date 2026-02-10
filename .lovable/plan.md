

## Fallback a regularMarketPrice per opzioni senza bid/ask

### Problema

Quando la option chain (`v7/finance/options`) non contiene il contratto cercato oppure restituisce bid/ask/lastPrice tutti a 0, l'opzione viene segnata come "failed" senza alcun prezzo.

### Soluzione

Aggiungere un secondo tentativo: per ogni opzione che fallisce il pricing dalla option chain, chiamare l'endpoint `v8/finance/chart/{OCC_SYMBOL}` per ottenere almeno il `regularMarketPrice` come fallback.

### Modifiche al file `supabase/functions/update-option-prices-cron/index.ts`

1. **Nuova funzione `fetchFallbackPrice(occSymbol, crumb, cookie)`**:
   - Chiama `https://query2.finance.yahoo.com/v8/finance/chart/{OCC_SYMBOL}?crumb=...` con autenticazione
   - Estrae `regularMarketPrice` dalla risposta
   - Ritorna il prezzo o `null`

2. **Modifica del loop principale** (righe 298-320):
   - Quando `getMidPrice()` ritorna `null` (contratto non trovato o prezzi a 0), invece di segnare subito come "failed", chiama `fetchFallbackPrice()`
   - Se il fallback restituisce un prezzo valido, aggiorna il database e logga come "fallback regularMarketPrice"
   - Solo se anche il fallback fallisce, segna come "failed"

3. **Logging migliorato**:
   - Log specifico per distinguere: `[Price] mid`, `[Price] lastPrice`, `[Price] fallback regularMarketPrice`, `[Price] FAILED`

### Flusso di priorita dei prezzi

```text
1. (bid + ask) / 2    -- dalla option chain v7
2. lastPrice           -- dalla option chain v7
3. regularMarketPrice  -- dal chart endpoint v8 (NUOVO fallback)
4. FAILED              -- nessun prezzo disponibile
```

### Note tecniche

- Il fallback aggiunge chiamate API solo per le opzioni che falliscono (attualmente ~11 su 234), quindi l'impatto sul rate limiting e minimo
- Delay di 300ms tra ogni chiamata di fallback per rispettare i limiti Yahoo
- Le chiamate di fallback vengono fatte inline, subito dopo il fallimento del pricing dalla chain

