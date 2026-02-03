
# Piano: Prezzi Sottostante Yahoo Finance per Strategie Derivati

## Obiettivo
Recuperare i prezzi aggiornati dei sottostanti da Yahoo Finance per tutte le strategie derivati e mostrarli nella pagina Strategie Derivati.

## Analisi Attuale

### Situazione Corrente
- I prezzi dei sottostanti (PS) vengono già visualizzati nella pagina Derivati, ma **solo per le opzioni che hanno un sottostante collegato** (posizione stock nel portafoglio)
- Per i derivati senza sottostante in portafoglio (es. Naked PUT su titoli non posseduti, Iron Condor, Double Diagonal), il prezzo sottostante non è disponibile
- L'edge function `update-prices-cron` contiene già la logica per chiamare Yahoo Finance API

### Problema Attuale
Le seguenti strategie non mostrano il prezzo sottostante (PS) perché non hanno uno stock collegato:
- **Naked PUT** senza stock in portafoglio
- **Iron Condor** 
- **Double Diagonal**
- **Altre Strategie** raggruppate

---

## Soluzione Proposta

### 1. Nuova Edge Function: `fetch-underlying-prices`

Creare un'edge function dedicata che:
- Riceve una lista di nomi sottostanti (underlying names) 
- Per ogni sottostante, risolve il ticker tramite AI o mappatura statica
- Chiama Yahoo Finance API per ottenere il prezzo
- Restituisce un dizionario `{ underlyingName: { price, currency } }`

```
POST /fetch-underlying-prices
Body: { underlyings: ["NVIDIA CORP", "APPLE COMPUTER, INC.", "AMAZON.COM INC"] }
Response: {
  "NVIDIA CORP": { price: 145.50, currency: "USD" },
  "APPLE COMPUTER, INC.": { price: 195.20, currency: "USD" },
  ...
}
```

### 2. Nuovo Hook: `useUnderlyingPrices`

Creare un hook React che:
- Estrae i nomi univoci dei sottostanti dalle strategie derivati
- Chiama l'edge function per ottenere i prezzi
- Gestisce caching e refresh
- Espone uno stato `{ prices, isLoading, error, refetch }`

### 3. Aggiornamento Pagina Derivati

Modificare `src/pages/Derivatives.tsx` per:
- Usare il nuovo hook `useUnderlyingPrices`
- Passare i prezzi ai componenti che non hanno il sottostante in portafoglio
- Mostrare "PS: $XXX" per tutte le strategie (non solo quelle con stock)

---

## Dettagli Tecnici

### Edge Function `fetch-underlying-prices`

```typescript
// supabase/functions/fetch-underlying-prices/index.ts

// Logica:
// 1. Riceve array di underlying names
// 2. Per ogni nome:
//    a. Cerca in cache locale (isin_mappings con ISIN sintetico)
//    b. Prova ticker resolution con AI
//    c. Chiama Yahoo Finance API per prezzo
// 3. Restituisce mappa prezzi
```

### Hook `useUnderlyingPrices`

```typescript
// src/hooks/useUnderlyingPrices.ts

export function useUnderlyingPrices(underlyings: string[]) {
  const [prices, setPrices] = useState<Record<string, { price: number; currency: string }>>({});
  const [isLoading, setIsLoading] = useState(false);
  
  // Fetch prices when underlyings change
  // Debounce per evitare chiamate multiple
  // Cache risultati per sessione
}
```

### Componenti Derivati Aggiornati

Ogni componente Row riceverà un prop `underlyingPrices`:

```tsx
// Per Iron Condor, Double Diagonal, ecc.
function IronCondorRow({ 
  ironCondor, 
  underlyingPrices  // NUOVO
}: { 
  ironCondor: IronCondorPosition;
  underlyingPrices: Record<string, { price: number; currency: string }>;
}) {
  const underlyingPrice = underlyingPrices[ironCondor.underlying]?.price || 0;
  // Usa underlyingPrice per ITM/OTM e display PS
}
```

---

## Informazioni sui Dati Yahoo Finance

**Risposta alla tua domanda: I dati Yahoo Finance sono in tempo reale o ritardati?**

Secondo la documentazione ufficiale di Yahoo Finance:

| Mercato | Ritardo |
|---------|---------|
| **NASDAQ (USA)** | **Real-time** |
| **NYSE/S&P (USA)** | **Real-time** |
| Italia (Borsa Italiana) | 20 min ritardo |
| Germania (XETRA) | 15 min ritardo |
| UK (LSE) | 20 min ritardo |
| Hong Kong (HKEX) | 15 min ritardo |
| Svizzera (SIX) | 30 min ritardo |
| Cambi valuta (EURUSD=X) | **Real-time** |

**Conclusione**: Per le azioni USA (NASDAQ, NYSE), i dati sono **real-time**. Per gli altri mercati europei e asiatici, c'è un ritardo di 15-30 minuti.

---

## File da Creare/Modificare

| File | Tipo | Descrizione |
|------|------|-------------|
| `supabase/functions/fetch-underlying-prices/index.ts` | NUOVO | Edge function per recuperare prezzi da Yahoo |
| `src/hooks/useUnderlyingPrices.ts` | NUOVO | Hook per gestire fetch e cache prezzi |
| `src/pages/Derivatives.tsx` | MODIFICA | Integrazione hook e passaggio prezzi ai componenti |

---

## Flusso Dati

```text
┌─────────────────────────────────────┐
│        Derivatives.tsx              │
│  1. Estrae lista underlying names   │
│  2. Chiama useUnderlyingPrices()    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│    useUnderlyingPrices Hook         │
│  1. Deduplica nomi                  │
│  2. Chiama edge function            │
│  3. Cache risultati                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  fetch-underlying-prices (Edge)     │
│  1. Risolve ticker (AI/mapping)     │
│  2. Chiama Yahoo Finance API        │
│  3. Ritorna prezzi                  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│        Yahoo Finance API            │
│  (Real-time per USA)                │
└─────────────────────────────────────┘
```

---

## Note Implementative

1. **Riutilizzo logica esistente**: L'edge function riutilizzerà le funzioni `fetchYahooPrice`, `inferTickerWithAI` e le mappature già presenti in `update-prices-cron`

2. **Ottimizzazione**: La chiamata viene fatta solo una volta al caricamento della pagina, con possibilità di refresh manuale

3. **Fallback**: Se un prezzo non è recuperabile, il campo PS mostra "-" come già avviene per gli stock senza prezzo

4. **Caching DB opzionale**: I prezzi potrebbero essere salvati in una tabella `underlying_prices_cache` per evitare chiamate ripetute
