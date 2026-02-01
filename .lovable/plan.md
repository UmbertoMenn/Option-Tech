
# Piano: Recuperare i Settori Dinamicamente (Correzione)

## Problema Identificato

Il codice attuale cerca il settore nella risposta della **Yahoo Search API**, ma quella API **non restituisce mai il settore**:

```json
// Yahoo Search API response - NO SECTOR!
{
  "symbol": "NVDA",
  "shortname": "NVIDIA Corporation", 
  "exchange": "NMS",
  "quoteType": "EQUITY"
  // ⚠️ sector/industry NON PRESENTI
}
```

I dati nel database confermano che tutti i settori sono `null`:
```
isin: IE00B4L5Y983, ticker: IWDA.L, sector: NULL
isin: US67066G1040, ticker: NVDA, sector: NULL
```

## Soluzione: Usare la Yahoo Finance Quote API

Il settore è disponibile nella **Quote Summary API** di Yahoo Finance:

```
https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=assetProfile
```

Questa API restituisce:
```json
{
  "quoteSummary": {
    "result": [{
      "assetProfile": {
        "sector": "Technology",
        "industry": "Semiconductors"
      }
    }]
  }
}
```

---

## Modifiche Tecniche

### 1. Aggiungere Funzione per Fetch Asset Profile

**File**: `supabase/functions/update-prices-cron/index.ts`

```typescript
// Fetch sector/industry from Yahoo Quote Summary API
async function fetchYahooSectorInfo(ticker: string): Promise<{
  sector: string | null;
  industry: string | null;
}> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) return { sector: null, industry: null };
    
    const data = await response.json();
    const profile = data.quoteSummary?.result?.[0]?.assetProfile;
    
    return {
      sector: profile?.sector || null,
      industry: profile?.industry || null,
    };
  } catch (error) {
    console.error(`Error fetching sector for ${ticker}:`, error);
    return { sector: null, industry: null };
  }
}
```

### 2. Modificare `resolveISINToTicker` per Chiamare l'API Settori

Dopo aver risolto l'ISIN in ticker, chiamare `fetchYahooSectorInfo()`:

```typescript
async function resolveISINToTicker(supabase, isin, description): Promise<string | null> {
  // ... existing search logic ...
  
  if (!searchResult) return null;
  
  // NUOVO: Fetch sector/industry using the resolved ticker
  const sectorInfo = await fetchYahooSectorInfo(searchResult.ticker);
  
  // Save to cache with sector info
  await supabase.from('isin_mappings').upsert({
    isin,
    ticker: searchResult.ticker,
    exchange: searchResult.exchange,
    sector: sectorInfo.sector,      // From Quote Summary API
    industry: sectorInfo.industry,  // From Quote Summary API
    source: 'yahoo_search',
    last_verified_at: new Date().toISOString(),
  }, { onConflict: 'isin' });
  
  return searchResult.ticker;
}
```

### 3. Aggiungere Endpoint Manuale per Popolare Settori Mancanti

Per i ticker già nel database senza settore, creare un processo che li popola:

```typescript
// Nella stessa edge function, aggiungere una modalità "update-sectors"
if (mode === 'update-sectors') {
  // Get all isin_mappings with missing sector
  const { data: missing } = await supabase
    .from('isin_mappings')
    .select('isin, ticker')
    .is('sector', null);
  
  for (const row of missing || []) {
    if (row.ticker) {
      const sectorInfo = await fetchYahooSectorInfo(row.ticker);
      if (sectorInfo.sector) {
        await supabase.from('isin_mappings').update({
          sector: sectorInfo.sector,
          industry: sectorInfo.industry,
        }).eq('isin', row.isin);
      }
    }
  }
}
```

### 4. Chiamare Automaticamente l'Update Settori nel Frontend

**File**: `src/hooks/useSectorMappings.ts`

Aggiungere logica per triggerare l'update dei settori mancanti:

```typescript
const fetchMappings = useCallback(async (isins: string[]) => {
  // 1. Fetch existing mappings from DB
  const { data } = await supabase
    .from('isin_mappings')
    .select('isin, ticker, sector, industry')
    .in('isin', isins);
  
  // 2. Check which ISINs are missing sector data
  const missingIsins = isins.filter(isin => {
    const mapping = data?.find(d => d.isin === isin);
    return !mapping || !mapping.sector;
  });
  
  // 3. If there are missing sectors, trigger edge function to fetch them
  if (missingIsins.length > 0) {
    await supabase.functions.invoke('update-prices-cron', {
      body: { mode: 'update-sectors', isins: missingIsins }
    });
    
    // Re-fetch after update
    // ...
  }
}, []);
```

---

## Flusso Corretto Risultante

```
┌────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Upload Excel con posizione "AZ.NVIDIA CORP" (ISIN: US67066G1040) │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Edge Function (update-prices-cron)                               │
│  2a. Yahoo Search API: ISIN → ticker "NVDA"                               │
│  2b. Yahoo Quote Summary API: ticker "NVDA" → sector "Technology"    ←NEW │
│  2c. Salva in isin_mappings: {isin, ticker, sector, industry}             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Utente apre Sector Allocation View                               │
│  └─ Frontend legge isin_mappings con sector già popolato                  │
│  └─ Se sector mancante, chiama edge function per aggiornare               │
│  └─ NVIDIA → Technology ✓                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/update-prices-cron/index.ts` | Aggiungere `fetchYahooSectorInfo()` e modalità `update-sectors` |
| `src/hooks/useSectorMappings.ts` | Chiamare edge function per settori mancanti |

---

## Migrazione Dati Esistenti

Dopo il deploy, verrà eseguito un update one-time per popolare i settori di tutti i ticker già nel database che hanno `sector: null`.

---

## Risultato Atteso

- **Automatico**: Quando carichi un Excel, i settori vengono popolati automaticamente
- **Retroattivo**: I ticker già esistenti senza settore vengono aggiornati al primo accesso alla vista Sector
- **Nessuna manutenzione**: Tutto dinamico tramite Yahoo Finance
