
# Piano: Aggiornamento Prezzi Opzioni via Alpaca API

## Panoramica

Creare un cron job che aggiorni i prezzi di tutte le opzioni nel portafoglio ogni 5 minuti durante le ore di mercato, utilizzando l'API Alpaca con il feed "indicative" (gratuito, ritardo 15 minuti).

---

## Architettura della Soluzione

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLUSSO UPDATE PREZZI OPZIONI                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Cron trigger ogni 5 min (8:00-22:00 CET, Lun-Ven)                  │
│           │                                                             │
│           ▼                                                             │
│  2. Query: tutte le posizioni con asset_type = 'derivative'             │
│     per TUTTI gli utenti                                                │
│           │                                                             │
│           ▼                                                             │
│  3. Per ogni opzione: costruisci OCC symbol                             │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ GOOGL + 2026-02-21 + put + 295 → GOOGL 260221P00295000   │        │
│     └─────────────────────────────────────────────────────────┘        │
│           │                                                             │
│           ▼                                                             │
│  4. Batch API calls con rate limiting                                   │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ - Max 100 symbols per chiamata Alpaca                    │        │
│     │ - Max 200 chiamate API/minuto (free tier)                │        │
│     │ - Attendi 60s tra batch se si supera il limite           │        │
│     └─────────────────────────────────────────────────────────┘        │
│           │                                                             │
│           ▼                                                             │
│  5. UPDATE positions SET current_price = nuovo_prezzo                   │
│           │                                                             │
│           ▼                                                             │
│  6. Log risultati: updated, failed, stale                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Formato OCC Symbol

Le opzioni su Alpaca usano il formato OCC standard (21 caratteri):

| Parte | Lunghezza | Esempio | Note |
|-------|-----------|---------|------|
| Ticker | 6 char (padded) | `GOOGL ` | Spazi a destra |
| Data scadenza | 6 char | `260221` | YYMMDD |
| Tipo | 1 char | `P` | C=Call, P=Put |
| Strike | 8 char | `00295000` | Strike × 1000, padded a sinistra |

**Esempio completo:**
```
GOOGLE INC. (A) PUT 295 FEB/26 → GOOGL 260221P00295000
```

---

## 2. Mapping Underlying → Ticker

Dobbiamo risolvere il ticker dal nome aziendale. Il sistema utilizza già la tabella `underlying_mappings`:

```sql
SELECT ticker FROM underlying_mappings WHERE underlying = 'GOOGLE INC. (A)'
-- Ritorna: GOOGL
```

Se non esiste un mapping, l'opzione viene saltata (con log).

---

## 3. Rate Limiting Strategy

**Free Tier Alpaca:**
- 200 API calls/minuto
- Max 100 symbols per batch nell'endpoint `optionlatestquotes`

**Con 111 opzioni attuali:**
- 2 chiamate API (100 + 11) = ben sotto il limite
- Nessuna attesa necessaria

**Scenario futuro (300+ opzioni):**
- Ogni chiamata richiede ~100 symbols
- 3 chiamate = 3 API calls ≪ 200 limit
- Il rate limit diventa un problema solo con migliaia di opzioni

**Logica implementata:**
```
se (chiamate_nel_minuto >= 190):
    attendi (60 - secondi_trascorsi)
    reset contatore
```

---

## 4. Edge Function: `update-option-prices-cron`

**Nuovo file:** `supabase/functions/update-option-prices-cron/index.ts`

### Struttura principale

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Costruisce OCC symbol da dati opzione
function buildOccSymbol(
  ticker: string,
  expiryDate: string, // YYYY-MM-DD
  optionType: 'call' | 'put',
  strikePrice: number
): string {
  // Ticker padded a 6 caratteri
  const paddedTicker = ticker.toUpperCase().padEnd(6, ' ');
  
  // Data in formato YYMMDD
  const [year, month, day] = expiryDate.split('-');
  const dateStr = year.slice(-2) + month + day;
  
  // Tipo opzione
  const typeChar = optionType === 'call' ? 'C' : 'P';
  
  // Strike * 1000, padded a 8 caratteri
  const strikeInt = Math.round(strikePrice * 1000);
  const strikeStr = strikeInt.toString().padStart(8, '0');
  
  return `${paddedTicker}${dateStr}${typeChar}${strikeStr}`;
}

// Fetch quotes da Alpaca (batch fino a 100)
async function fetchAlpacaQuotes(
  symbols: string[],
  apiKey: string,
  apiSecret: string
): Promise<Record<string, number>> {
  const url = new URL('https://data.alpaca.markets/v1beta1/options/quotes/latest');
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('feed', 'indicative'); // Free tier
  
  const response = await fetch(url.toString(), {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Alpaca API error: ${response.status}`);
  }
  
  const data = await response.json();
  const results: Record<string, number> = {};
  
  // Estrai mid-price da ogni quote
  for (const [symbol, quote] of Object.entries(data.quotes || {})) {
    const bid = quote.bp || 0; // Bid price
    const ask = quote.ap || 0; // Ask price
    if (bid > 0 && ask > 0) {
      results[symbol] = (bid + ask) / 2; // Mid price
    } else if (ask > 0) {
      results[symbol] = ask;
    } else if (bid > 0) {
      results[symbol] = bid;
    }
  }
  
  return results;
}
```

### Flow principale

```typescript
serve(async (req) => {
  // 1. Fetch tutte le opzioni attive
  const { data: options } = await supabase
    .from('positions')
    .select('id, underlying, strike_price, expiry_date, option_type')
    .eq('asset_type', 'derivative')
    .not('expiry_date', 'is', null);
  
  // 2. Risolvi ticker per ogni underlying
  const optionsWithTickers = [];
  for (const opt of options) {
    const { data: mapping } = await supabase
      .from('underlying_mappings')
      .select('ticker')
      .eq('underlying', opt.underlying)
      .single();
    
    if (mapping?.ticker) {
      optionsWithTickers.push({ ...opt, ticker: mapping.ticker });
    }
  }
  
  // 3. Costruisci OCC symbols
  const symbolToPositionId: Record<string, string[]> = {};
  for (const opt of optionsWithTickers) {
    const symbol = buildOccSymbol(
      opt.ticker,
      opt.expiry_date,
      opt.option_type,
      opt.strike_price
    );
    if (!symbolToPositionId[symbol]) {
      symbolToPositionId[symbol] = [];
    }
    symbolToPositionId[symbol].push(opt.id);
  }
  
  // 4. Batch API calls (100 symbols alla volta)
  const symbols = Object.keys(symbolToPositionId);
  const batches = chunkArray(symbols, 100);
  
  let updated = 0;
  let failed = 0;
  
  for (const batch of batches) {
    const quotes = await fetchAlpacaQuotes(batch, apiKey, apiSecret);
    
    // 5. Update positions
    for (const [symbol, price] of Object.entries(quotes)) {
      const positionIds = symbolToPositionId[symbol];
      for (const posId of positionIds) {
        await supabase
          .from('positions')
          .update({ current_price: price })
          .eq('id', posId);
        updated++;
      }
    }
    
    failed += batch.length - Object.keys(quotes).length;
  }
  
  return { success: true, updated, failed };
});
```

---

## 5. Configurazione Cron Job

**File:** `supabase/config.toml`

```toml
[functions.update-option-prices-cron]
verify_jwt = false
```

**SQL per cron (da eseguire manualmente):**

```sql
SELECT cron.schedule(
  'update-option-prices-every-5-min',
  '*/5 8-22 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://uareyloxlpvaxmzygpgo.supabase.co/functions/v1/update-option-prices-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## 6. Secret da Configurare

Dovrai fornire le credenziali Alpaca:

| Nome Secret | Descrizione |
|-------------|-------------|
| `ALPACA_API_KEY` | API Key ID dal dashboard Alpaca |
| `ALPACA_API_SECRET` | API Secret Key dal dashboard Alpaca |

Queste si trovano su: https://app.alpaca.markets/paper/dashboard/overview → API Keys

---

## 7. Gestione Casi Speciali

### Opzioni Scadute
```typescript
// Filtra opzioni già scadute
const activeOptions = options.filter(o => 
  new Date(o.expiry_date) >= new Date()
);
```

### Underlying Senza Ticker Mapping
```typescript
// Log warning ma continua
if (!mapping?.ticker) {
  console.warn(`No ticker mapping for: ${opt.underlying}`);
  continue;
}
```

### Symbol Non Trovato su Alpaca
```typescript
// Alcune opzioni potrebbero non esistere (OTC, esotiche)
if (!quotes[symbol]) {
  console.log(`No quote for symbol: ${symbol}`);
  failed++;
}
```

### Normalizzazione Underlying per Lookup

L'underlying nel DB potrebbe essere formattato diversamente dalla cache. Esempio:
- DB: `GOOGLE INC. (A)`
- Cache: `GOOGLE INC (A)` (senza punto)

Utilizziamo la stessa funzione `normalizeName` già presente in `fetch-underlying-prices`:

```typescript
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    // ... altri suffissi
    .trim();
}
```

---

## 8. File Coinvolti

| File | Azione |
|------|--------|
| `supabase/functions/update-option-prices-cron/index.ts` | **NUOVO** - Edge function principale |
| `supabase/config.toml` | Aggiungere `[functions.update-option-prices-cron]` |

---

## 9. Stima Performance

| Metrica | Valore |
|---------|--------|
| Opzioni attuali | ~111 |
| API calls per run | 2 (100 + 11 symbols) |
| Tempo stimato | ~3-5 secondi |
| Rate limit usage | ~1% del limite (2/200) |

---

## 10. Considerazioni Ritardo 15 Minuti

Con il feed `indicative` gratuito:
- I prezzi sono ritardati di 15 minuti
- Sufficiente per valutazione portafoglio e calcolo margini
- Per trading attivo sarebbe necessario il feed `opra` (a pagamento)

---

## Prossimi Passi

1. Richiedere le API keys Alpaca tramite tool `add_secret`
2. Creare la edge function
3. Aggiungere configurazione a `config.toml`
4. Schedulare il cron job via SQL
5. Testare manualmente chiamando la funzione
6. Verificare che i prezzi si aggiornino correttamente nelle positions
