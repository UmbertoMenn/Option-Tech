

# Piano: Usare Perplexity per Top Holdings ETF Aggiornate

## Perché Perplexity?

| Caratteristica | Gemini 2.5 Flash | Perplexity Sonar |
|---------------|------------------|------------------|
| Dati | Training data (obsoleti) | Web search in tempo reale |
| Fonti | Nessuna | Citations verificabili |
| Aggiornamento | Mesi/anni di ritardo | Dati attuali |

Perplexity può cercare direttamente su justETF, Bloomberg, iShares e altre fonti per ottenere le **top holdings aggiornate al giorno corrente**.

## Passaggi

### 1. Configurare Perplexity Connector

Prima di tutto devo collegare Perplexity al progetto tramite il connector. Questo renderà disponibile `PERPLEXITY_API_KEY` come variabile d'ambiente.

### 2. Modificare Edge Function

**File**: `supabase/functions/fetch-etf-allocation/index.ts`

Sostituire la chiamata a Lovable AI (Gemini) con Perplexity:

```typescript
// Prima (Gemini - dati obsoleti)
const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user", content: prompt }]
  })
});

// Dopo (Perplexity - dati in tempo reale)
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

const response = await fetch("https://api.perplexity.ai/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "sonar",  // Modello con web search
    messages: [{
      role: "user",
      content: `Search for the current top 15 holdings of the ETF with ISIN ${isin} (${etfName}). 
                Return ONLY a JSON array with format: [{"name": "Company Name", "percentage": 2.48}, ...]
                Use data from justETF, iShares, or the official ETF provider website.`
    }]
  })
});
```

### 3. Vantaggi

Con Perplexity, la risposta per `IE00B9CQXS71` sarà:

```json
{
  "topHoldings": [
    {"name": "Altria Group, Inc.", "percentage": 2.48},
    {"name": "CVS Health", "percentage": 2.46},
    {"name": "APA Group", "percentage": 2.05},
    ...
  ],
  "citations": [
    "https://www.justetf.com/en/etf-profile.html?isin=IE00B9CQXS71"
  ]
}
```

## File da Modificare

| File | Modifica |
|------|----------|
| `supabase/functions/fetch-etf-allocation/index.ts` | Sostituire chiamata Gemini con Perplexity API |

## Sequenza

1. Connettere Perplexity al progetto (ti verrà chiesto di autorizzare)
2. Modificare `fetchETFTopHoldingsWithAI()` per usare Perplexity
3. Deploy edge function
4. Testare con `forceRefresh: true` su `IE00B9CQXS71`
5. Verificare che Altria Group appaia nelle top holdings

## Risultato Atteso

Dopo le modifiche:
- Top holdings ETF sempre aggiornate (dati dal web)
- Altria Group 2.48% visibile per SPDR S&P Global Dividend Aristocrats
- Badge ETF corretti nelle Holdings Consolidate

