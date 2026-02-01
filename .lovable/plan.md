

# Piano: Fix Riconoscimento Ticker per Derivati

## Problema Identificato

Dai log dell'edge function:
```
Sector resolution completed in 9349ms: 0/0 ISINs, 13/33 names (40% successo)
```

**20 nomi su 33 non vengono risolti** perché:
1. Il regex per estrarre ticker fallisce con nomi come `AMAZON.COM.INC`, `ORACLE SYSTEMS INC.`
2. Il dizionario `specialMappings` ha solo ~12 voci

### Nomi Non Riconosciuti (dai log)
| Nome Derivato | Ticker Atteso | Settore |
|--------------|---------------|---------|
| AMAZON.COM.INC | AMZN | Consumer Discretionary |
| ORACLE SYSTEMS INC. | ORCL | Technology |
| Advanced Micro Devices Inc. | AMD | Technology |
| Micron Technology Inc | MU | Technology |
| Accenture PLC | ACN | Technology |
| AppLovin Corp | APP | Technology |
| WESTERN DIGITAL CORP | WDC | Technology |
| Celestica Inc | CLS | Technology |
| Redditi INC | RDDT | Communication Services |
| AZ.REGULUS THERAPEUTICS | RGLS | Healthcare |

---

## Causa Root

Nel file `supabase/functions/update-prices-cron/index.ts` (linee 816-856):

```typescript
// Regex troppo limitato
const tickerPatterns = [
  /^([A-Z]{1,5})(?:\s|$)/,  // ❌ Non funziona con "AMAZON.COM.INC"
];

// Dizionario incompleto
const specialMappings = {
  'IREN LTD': 'IREN',
  'ALPHABET': 'GOOGL',
  // ❌ Mancano AMAZON, ORACLE, AMD, MICRON, WESTERN DIGITAL, ecc.
};

if (!inferredTicker) {
  // ❌ Se non trova ticker, salta completamente - AI MAI CHIAMATA!
  console.log(`Could not infer ticker from name: ${name}`);
  continue;
}
```

---

## Soluzione

### Opzione A: Espandere Dizionario + AI Fallback per Ticker

Modificare la logica per:
1. Espandere `specialMappings` con tutti i nomi comuni
2. **Usare l'AI per inferire il ticker** quando non trovato localmente
3. Poi usare l'AI per il settore

```typescript
// 1. Espandere specialMappings
const specialMappings: Record<string, string> = {
  // Existing
  'IREN LTD': 'IREN',
  'MARA HOLDINGS': 'MARA',
  'ALPHABET': 'GOOGL',
  // ...
  
  // NEW - nomi comuni che falliscono
  'AMAZON': 'AMZN',
  'AMAZON.COM': 'AMZN',
  'ORACLE': 'ORCL',
  'ADVANCED MICRO DEVICES': 'AMD',
  'MICRON': 'MU',
  'ACCENTURE': 'ACN',
  'APPLOVIN': 'APP',
  'WESTERN DIGITAL': 'WDC',
  'CELESTICA': 'CLS',
  'REDDIT': 'RDDT',
  'REGULUS': 'RGLS',
  'SALESFORCE': 'CRM',
  'JD.COM': 'JD',
  'NVIDIA': 'NVDA',
  'BROADCOM': 'AVGO',
  'QUALCOMM': 'QCOM',
  'CISCO': 'CSCO',
  'INTEL': 'INTC',
  'ADOBE': 'ADBE',
  'PAYPAL': 'PYPL',
  'TESLA': 'TSLA',
  'APPLE': 'AAPL',
  'MICROSOFT': 'MSFT',
  'META': 'META',
  'NETFLIX': 'NFLX',
  'DISNEY': 'DIS',
  'VISA': 'V',
  'MASTERCARD': 'MA',
  'JPMORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'OKLO': 'OKLO',
  'ROCKET LAB': 'RKLB',
  'ASTERA': 'ALAB',
  'KLA': 'KLAC',
};

// 2. Se non trovato, usare AI per inferire ticker
if (!inferredTicker) {
  console.log(`Asking AI to infer ticker from: ${name}`);
  inferredTicker = await inferTickerWithAI(name);
}

// 3. Poi continuare con settore
if (inferredTicker) {
  const sectorInfo = await fetchSectorWithAI(inferredTicker, name);
  // ...
}
```

### Nuova Funzione: `inferTickerWithAI`

```typescript
async function inferTickerWithAI(companyName: string): Promise<string | null> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5-mini",
      messages: [{
        role: "user",
        content: `What is the stock ticker symbol for "${companyName}"? 
        Reply with ONLY the ticker symbol (e.g., AAPL, MSFT, GOOGL).
        If unknown, reply "UNKNOWN".`
      }],
      max_tokens: 20,
    }),
  });
  
  const data = await response.json();
  const ticker = data.choices?.[0]?.message?.content?.trim().toUpperCase();
  
  if (ticker && ticker !== 'UNKNOWN' && ticker.length <= 5 && /^[A-Z]+$/.test(ticker)) {
    console.log(`AI inferred ticker for "${companyName}": ${ticker}`);
    return ticker;
  }
  
  return null;
}
```

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/update-prices-cron/index.ts` | Espandere `specialMappings`, aggiungere `inferTickerWithAI()`, modificare flusso |

---

## Flusso Risultante

```
Nome derivato: "AMAZON.COM.INC"
      │
      ▼
1. Regex fallisce
      │
      ▼
2. specialMappings cerca "AMAZON" → trova "AMZN" ✓
      │
      ▼
3. fetchSectorWithAI("AMZN", "AMAZON.COM.INC")
      │
      ▼
4. Risultato: { ticker: "AMZN", sector: "Consumer Discretionary" }

---

Nome derivato: "Celestica Inc"
      │
      ▼
1. Regex fallisce  
2. specialMappings cerca "CELESTICA" → trova "CLS" ✓
      │
      ▼
3. fetchSectorWithAI("CLS", "Celestica Inc") → Technology

---

Nome derivato: "Sconosciuto XYZ Corp" (nome raro)
      │
      ▼
1. Regex fallisce
2. specialMappings non trova match
      │
      ▼
3. NEW: inferTickerWithAI("Sconosciuto XYZ Corp")
      │
      ▼
4. AI: "XYZ"
      │
      ▼
5. fetchSectorWithAI("XYZ", "Sconosciuto XYZ Corp") → Settore
```

---

## Risultato Atteso

| Metrica | Prima | Dopo |
|---------|-------|------|
| Nomi risolti | 13/33 (40%) | 30+/33 (90%+) |
| Derivati in "Other" | ~60% | <10% |
| Chiamate AI | 13 | ~35 (include ticker inference) |

