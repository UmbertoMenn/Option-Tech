
# Piano: Miglioramento Sistema Prezzi Live

## Problemi Identificati

### 1. I ticker sono sempre NULL
L'Excel parser non estrae il campo ticker - tutte le posizioni hanno `ticker: null`. Questo significa che l'API Yahoo Finance non riceve alcun ticker da cercare!

**Query di verifica:**
```sql
SELECT ticker, isin, asset_type FROM positions LIMIT 10
-- Risultato: TUTTI i ticker sono NULL
```

### 2. Tradier API - Token Non Valido
Dai log dell'edge function:
```
Tradier API error: 401 - Invalid Access Token
Fetching prices for 0 stocks and 110 options
```
Il token Tradier sembra essere scaduto o non valido.

### 3. Manca Mapping ISIN → Ticker
Per azioni/ETF europei (ISIN come IT0003132476 per ENI), non esiste un servizio che converta l'ISIN nel ticker corrispondente.

### 4. Underlying opzioni in formato descrittivo
Le opzioni hanno `underlying: "APPLE COMPUTER, INC."` invece di `"AAPL"`, quindi non possono essere convertite in simboli OCC.

### 5. Nessun feedback visivo per variazioni
Non c'è logica per mostrare il prezzo in rosso/verde per 45 secondi dopo ogni aggiornamento.

---

## Soluzione Proposta

### Fase 1: Mapping ISIN → Ticker (Nuovo Edge Function)

Creare un servizio che converta gli ISIN in ticker usando multiple fonti:

1. **OpenFIGI API** (gratuita) - Database Bloomberg per mapping ISIN → Ticker
2. **Yahoo Finance Search** - Fallback per cercare per ISIN
3. **Cache locale** - Tabella `isin_mappings` per evitare chiamate ripetute

**Nuova Edge Function: `resolve-isin`**
```typescript
// Input: ["IT0003132476", "US0378331005"]
// Output: { "IT0003132476": "ENI.MI", "US0378331005": "AAPL" }
```

### Fase 2: Mapping Underlying → Ticker per Opzioni

Creare una lookup table per convertire i nomi descrittivi in ticker:

| Underlying (Excel)           | Ticker |
|-----------------------------|--------|
| APPLE COMPUTER, INC.        | AAPL   |
| NVIDIA CORP                 | NVDA   |
| AMAZON.COM.INC              | AMZN   |
| META PLATFORMS              | META   |
| GOOGLE INC. (A)             | GOOGL  |

**Implementazione:**
- Tabella statica `underlying_to_ticker` nell'edge function
- Fallback: tentativo di parsing dal nome (es. "Tesla Inc" → "TSLA")

### Fase 3: Provider Multipli per ETF

Integrare **JustETF** per i prezzi degli ETF europei (già abbiamo l'edge function `fetch-etf-allocation`):

1. **Yahoo Finance** - Provider primario per ETF USA (ticker tipo "VWO", "SPY")
2. **JustETF Scraping** - Per ETF europei con ISIN (es. IE00B0M63623)
3. **Borsa Italiana** - Per ETF quotati su Borsa Italiana (via scraping o API)

**Flusso decisionale:**
```
ETF con ticker USA → Yahoo Finance
ETF con ISIN + .MI → Yahoo Finance (es. "SWDA.MI")
ETF con ISIN europeo → JustETF scraping (prezzo NAV)
```

### Fase 4: Feedback Visivo Variazione Prezzo (45 secondi)

Modificare il sistema per:

1. **Salvare il prezzo precedente** nel context
2. **Confrontare con il nuovo prezzo** ad ogni fetch
3. **Applicare classe CSS temporanea** (`price-up` / `price-down`)
4. **Rimuovere dopo 45 secondi** via timeout

**Nuova interfaccia LivePriceData:**
```typescript
interface LivePriceData {
  // ... campi esistenti
  previousPrice: number | null;  // NUOVO
  priceDirection: 'up' | 'down' | null;  // NUOVO
  directionTimestamp: number | null;  // NUOVO (per timeout 45s)
}
```

**CSS animato:**
```css
.price-up {
  color: #22c55e !important;  /* text-profit */
  animation: pulse-green 0.5s ease-out;
}

.price-down {
  color: #ef4444 !important;  /* text-loss */
  animation: pulse-red 0.5s ease-out;
}
```

---

## File da Creare

| File | Descrizione |
|------|-------------|
| `supabase/functions/resolve-isin/index.ts` | Edge function per mapping ISIN → Ticker via OpenFIGI |
| `src/lib/underlyingToTicker.ts` | Lookup table per underlying opzioni |

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/fetch-market-prices/index.ts` | Aggiungere supporto ISIN, integrare JustETF per ETF, aggiungere mapping underlying |
| `src/contexts/LivePricesContext.tsx` | Salvare prezzi precedenti, calcolare direzione, gestire timeout 45s |
| `src/components/dashboard/LivePriceBadge.tsx` | Applicare classi CSS per variazione prezzo |
| `src/index.css` | Aggiungere stili animati per price-up/price-down |
| `supabase/migrations/` | Nuova tabella `isin_mappings` per cache |

## Database: Nuova Tabella

```sql
CREATE TABLE isin_mappings (
  isin TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  exchange TEXT,
  source TEXT NOT NULL, -- 'openfigi', 'yahoo', 'manual'
  last_verified_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Architettura Aggiornata

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LivePricesContext                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐      │
│  │ previousPrices │  │ currentPrices │  │ priceDirections (45s) │      │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   fetch-market-prices (Edge Function)                │
│                                                                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│  │  resolve-isin │  │ Yahoo Finance │  │    Tradier    │            │
│  │  (OpenFIGI)   │  │  (Stock/ETF)  │  │   (Options)   │            │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘            │
│          │                  │                  │                     │
│          ▼                  ▼                  ▼                     │
│  ┌───────────────────────────────────────────────────────┐          │
│  │           Underlying → Ticker Mapping                  │          │
│  │  "APPLE COMPUTER, INC." → "AAPL"                      │          │
│  │  "NVIDIA CORP" → "NVDA"                               │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                      │
│  ┌───────────────────────────────────────────────────────┐          │
│  │           JustETF (fallback per ETF europei)          │          │
│  │  ISIN IE00B0M63623 → Prezzo NAV                       │          │
│  └───────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Dettaglio Implementazione: Feedback Visivo 45s

### LivePricesContext.tsx

```typescript
interface PriceState {
  current: LivePriceData;
  previous: LivePriceData | null;
  direction: 'up' | 'down' | null;
  directionExpiresAt: number | null;  // timestamp in ms
}

// Nel fetchPrices, confronta con i prezzi precedenti
const newStockPrices = { ...data.stocks };
for (const [symbol, newPrice] of Object.entries(newStockPrices)) {
  const oldPrice = previousStockPrices[symbol];
  if (oldPrice && newPrice.price && oldPrice.price) {
    if (newPrice.price > oldPrice.price) {
      newPrice.priceDirection = 'up';
      newPrice.directionTimestamp = Date.now();
    } else if (newPrice.price < oldPrice.price) {
      newPrice.priceDirection = 'down';
      newPrice.directionTimestamp = Date.now();
    }
  }
}
```

### LivePriceBadge.tsx

```typescript
const isDirectionActive = livePrice.directionTimestamp && 
  (Date.now() - livePrice.directionTimestamp) < 45000;

const priceClass = isDirectionActive
  ? livePrice.priceDirection === 'up' 
    ? 'text-profit animate-pulse-once' 
    : 'text-loss animate-pulse-once'
  : '';
```

---

## Priorità e Dipendenze

1. **Fase 1 (Critica)**: Mapping ISIN → Ticker
   - Senza questo, nessun prezzo stock/ETF funziona
   
2. **Fase 2 (Critica)**: Mapping Underlying → Ticker  
   - Senza questo, nessun prezzo opzione funziona
   
3. **Fase 3 (Miglioramento)**: JustETF per ETF europei
   - Fallback per ETF senza ticker Yahoo
   
4. **Fase 4 (UX)**: Feedback visivo 45 secondi
   - Puramente estetico, non blocca funzionalità

---

## Verifica Token Tradier

Prima di procedere, devo verificare che il token Tradier sia valido:

1. **Controllare che sia un token di produzione** (non sandbox)
2. **Verificare scadenza** - I token Tradier possono scadere
3. **Rigenerare se necessario** - Dalla dashboard Tradier

**Formato atteso:**
- Produzione: `Bearer XXXXX` (token alfanumerico ~30 caratteri)
- Sandbox: Richiede endpoint diverso (`sandbox.tradier.com`)

---

## Stima Effort

- **Fase 1** (ISIN → Ticker): ~2 messaggi
- **Fase 2** (Underlying → Ticker): ~1 messaggio  
- **Fase 3** (JustETF): ~1 messaggio
- **Fase 4** (Feedback 45s): ~1 messaggio

**Totale stimato**: 5 messaggi per implementazione completa
