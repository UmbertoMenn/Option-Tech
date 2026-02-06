
# Piano: Integrazione Finnhub.io per Prezzi US + Indicatore Prezzo Non Aggiornato

## Obiettivo
1. Utilizzare **Finnhub.io** (piano gratuito) per i ticker del mercato **USA**
2. Mantenere **Yahoo Finance** per i ticker **europei/italiani** (es. `.MI`, `.DE`, `.SW`)
3. Gestire il rate limit di **60 chiamate/minuto** con batching automatico
4. Mostrare un **triangolo rosso lampeggiante** quando un prezzo sottostante non e aggiornato

---

## Architettura Proposta

```text
┌─────────────────────────────────────────────────────────────────┐
│                      CRON JOB (ogni 5 min)                      │
│                  update-underlying-prices-cron                  │
│                                                                 │
│  1. Recupera ticker da posizioni attive                         │
│  2. Separa in due gruppi:                                       │
│     - US tickers (NVDA, AMZN, ...) → Finnhub API                │
│     - EU tickers (RACE.MI, SAP.DE, ...) → Yahoo Finance         │
│                                                                 │
│  3. Finnhub: batch 60 ticker/minuto                             │
│     - Se 120 ticker: 60 subito, wait 60sec, altri 60            │
│                                                                 │
│  4. Salva in underlying_prices + failed_tickers                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Identificazione Ticker EU vs US

I ticker europei hanno un suffisso specifico:
- `.MI` = Milano (Italia)
- `.DE` = Germania
- `.SW` = Svizzera
- `.PA` = Parigi
- `.AS` = Amsterdam
- `.L` = Londra

**Logica di classificazione:**
```typescript
function isEuropeanTicker(ticker: string): boolean {
  const euSuffixes = ['.MI', '.DE', '.SW', '.PA', '.AS', '.L', '.MC', '.BR'];
  return euSuffixes.some(suffix => ticker.toUpperCase().endsWith(suffix));
}
```

---

## Modifiche da Implementare

### 1. Salvare API Key Finnhub come Secret

L'API key `d62ph1pr01qnpu826or0d62ph1pr01qnpu826org` verra salvata come secret Supabase `FINNHUB_API_KEY`.

### 2. Edge Function `update-underlying-prices-cron`

**Nuovo flusso:**

```typescript
// 1. Separa ticker US ed EU
const usTickers = uniqueTickers.filter(t => !isEuropeanTicker(t));
const euTickers = uniqueTickers.filter(t => isEuropeanTicker(t));

// 2. Fetch EU via Yahoo Finance (come prima)
for (const ticker of euTickers) {
  const price = await fetchYahooPrice(ticker);
  // upsert...
}

// 3. Fetch US via Finnhub con batching 60/min
const FINNHUB_RATE_LIMIT = 60;
const batches = chunkArray(usTickers, FINNHUB_RATE_LIMIT);

for (let i = 0; i < batches.length; i++) {
  if (i > 0) {
    console.log("Waiting 60 seconds for Finnhub rate limit...");
    await delay(60000); // Wait 1 minute between batches
  }
  
  for (const ticker of batches[i]) {
    const price = await fetchFinnhubPrice(ticker, FINNHUB_API_KEY);
    if (price) {
      // upsert to underlying_prices
    } else {
      // Mark as failed - save to failed_tickers list
    }
    await delay(50); // Small delay between calls
  }
}
```

**Funzione Finnhub:**
```typescript
async function fetchFinnhubPrice(ticker: string, apiKey: string): Promise<{price: number; currency: string} | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Finnhub API returned ${response.status} for ${ticker}`);
      return null;
    }
    
    const data = await response.json();
    // Finnhub response: { c: currentPrice, h: high, l: low, o: open, pc: previousClose, t: timestamp }
    const price = data.c; // Current price
    
    if (!price || price <= 0) {
      console.log(`Invalid Finnhub price for ${ticker}: ${price}`);
      return null;
    }
    
    return { price, currency: 'USD' };
  } catch (error) {
    console.error(`Error fetching Finnhub price for ${ticker}:`, error);
    return null;
  }
}
```

### 3. Nuova Colonna `last_updated_at` per Tracciare Freshness

La tabella `underlying_prices` ha gia `updated_at`. Useremo questo campo per determinare se un prezzo e "stale".

**Definizione "stale":** prezzo non aggiornato da piu di 10 minuti (2 cicli cron).

### 4. Modifica Hook `useUnderlyingPrices`

Aggiungere informazione sulla freshness del prezzo:

```typescript
export interface UnderlyingPrice {
  price: number;
  currency: string;
  ticker?: string;
  isStale?: boolean;  // NUOVO: true se updated_at > 10 minuti fa
}

// Nel fetch:
const isStale = new Date().getTime() - new Date(p.updated_at).getTime() > 10 * 60 * 1000;

results[underlying] = {
  price: tickerPrices[ticker].price,
  currency: tickerPrices[ticker].currency,
  ticker,
  isStale, // Aggiungi flag
};
```

### 5. Componente UI: Triangolo Rosso Lampeggiante

Creare un componente riutilizzabile per indicare prezzo non aggiornato:

```typescript
// src/components/ui/stale-price-indicator.tsx
function StalePriceIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertTriangle 
          className="w-3 h-3 text-red-500 animate-pulse ml-1" 
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>Prezzo non aggiornato</p>
      </TooltipContent>
    </Tooltip>
  );
}
```

### 6. Modifica Visualizzazione PS nelle Row Components

In tutti i componenti che mostrano "PS: $XXX", aggiungere il triangolo se `isStale`:

```tsx
{/* Col 7: PS */}
<div className="text-right flex items-center justify-end">
  {hasUnderlyingPrice ? (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-sm text-muted-foreground cursor-help">
            PS: {formatCurrency(underlyingPrice, 'USD')}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Prezzo Sottostante</p>
        </TooltipContent>
      </Tooltip>
      {priceData?.isStale && <StalePriceIndicator />}
    </>
  ) : (
    <span className="text-sm text-muted-foreground">-</span>
  )}
</div>
```

---

## Rate Limit Management

| Scenario | Ticker US | Batches | Tempo Totale |
|----------|-----------|---------|--------------|
| Piccolo | 30 | 1 | ~3 sec |
| Medio | 60 | 1 | ~6 sec |
| Grande | 120 | 2 | ~66 sec (60 + 6) |
| XL | 180 | 3 | ~126 sec |

Il cron job e schedulato ogni 5 minuti, quindi anche 180 ticker rientrano nel tempo disponibile.

---

## File da Creare/Modificare

| File | Azione | Descrizione |
|------|--------|-------------|
| **Supabase Secrets** | Aggiungere | `FINNHUB_API_KEY` |
| `supabase/functions/update-underlying-prices-cron/index.ts` | Modificare | Dual provider (Finnhub + Yahoo) con batching |
| `supabase/functions/fetch-underlying-prices/index.ts` | Modificare | Usare Finnhub per on-demand US tickers |
| `src/hooks/useUnderlyingPrices.ts` | Modificare | Aggiungere flag `isStale` |
| `src/components/ui/stale-price-indicator.tsx` | Creare | Triangolo rosso lampeggiante |
| `src/pages/Derivatives.tsx` | Modificare | Mostrare indicatore stale nelle row |

---

## Note Tecniche

- **Finnhub Free Plan**: 60 API calls/minuto, solo mercato USA
- **Yahoo Finance**: nessun limite ufficiale, usato per EU (delay ~15 min)
- **Stale threshold**: 10 minuti (2 cicli cron mancati)
- **Fallback**: se Finnhub fallisce per un ticker US, non viene usato Yahoo come fallback (per rispettare i termini del piano free)
