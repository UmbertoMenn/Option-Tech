

# Piano: Correggere Scraping Settori ETF da justETF

## Problema Identificato

Lo scraping dei dati settoriali da justETF **non funziona** per due motivi:

1. **I dati sono caricati dinamicamente via JavaScript** - La sezione Holdings/Sectors è lazy-loaded e non presente nell'HTML statico
2. **Cache esistente senza settori** - Gli ETF cachati prima dell'aggiornamento hanno `sector_allocations: {}` e `top_holdings: []`

### Evidenza dal Database
```
sector_allocations: map[]  (vuoto per tutti gli ETF)
top_holdings: []  (vuoto per tutti gli ETF)
```

---

## Soluzione Proposta

### Approccio: Usare URL diretto della sezione Holdings

justETF ha una pagina dedicata per le holdings che contiene i dati in modo più accessibile:
- URL: `https://www.justetf.com/en/etf-profile.html?isin={ISIN}#holdings`
- Oppure: `https://www.justetf.com/servlet/download?isin={ISIN}&documentType=MR` per il factsheet PDF

La soluzione migliore è accedere all'API interna di justETF o scaricare il factsheet che contiene tutti i dati.

### Alternativa: Fallback con dati statici per ETF comuni

Per gli ETF più popolari (MSCI World, S&P 500, etc.), possiamo usare dati settoriali standard basati sulla composizione tipica dell'indice.

---

## Modifiche Tecniche

### 1. Aggiornare Edge Function `fetch-etf-allocation`

**File**: `supabase/functions/fetch-etf-allocation/index.ts`

#### Strategia Multi-Step:

```typescript
async function scrapeJustETF(isin: string) {
  // STEP 1: Tentare scraping dalla pagina principale
  const mainPageData = await scrapeMainPage(isin);
  
  // STEP 2: Se settori vuoti, tentare la pagina holdings dedicata
  if (Object.keys(mainPageData.sectorAllocations).length === 0) {
    const holdingsData = await scrapeHoldingsTab(isin);
    mainPageData.sectorAllocations = holdingsData.sectors;
    mainPageData.topHoldings = holdingsData.holdings;
  }
  
  // STEP 3: Se ancora vuoti, usare fallback basato su indice
  if (Object.keys(mainPageData.sectorAllocations).length === 0) {
    mainPageData.sectorAllocations = getIndexFallbackSectors(mainPageData.name);
  }
  
  return mainPageData;
}
```

#### Nuova Funzione: Scraping Tab Holdings

```typescript
async function scrapeHoldingsTab(isin: string): Promise<{
  sectors: Record<string, number>;
  holdings: TopHolding[];
}> {
  // Tentare di recuperare i dati dalla sezione holdings
  // che potrebbe essere disponibile in un formato diverso
  
  // Pattern alternativi da cercare nell'HTML completo:
  // 1. Tabelle con class="allocation-table" 
  // 2. Dati inline in script tags (JSON embedded)
  // 3. API calls visibili nell'HTML
  
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const response = await fetch(url, { 
    headers: { 
      'User-Agent': '...',
      'Accept': 'text/html,application/xhtml+xml',
      // Tentare header che potrebbero far caricare più contenuto
    } 
  });
  
  const html = await response.text();
  
  // Cercare pattern alternativi:
  
  // Pattern 1: Dati JSON embedded in script
  const jsonMatch = html.match(/var\s+etfData\s*=\s*(\{[\s\S]*?\});/);
  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[1]);
    return {
      sectors: data.sectorAllocations || {},
      holdings: data.topHoldings || []
    };
  }
  
  // Pattern 2: Tabelle allocation con dati strutturati
  // ...altri pattern...
  
  return { sectors: {}, holdings: [] };
}
```

#### Fallback per Indici Comuni

```typescript
const INDEX_SECTOR_FALLBACKS: Record<string, Record<string, number>> = {
  'MSCI WORLD': {
    'Technology': 24,
    'Financials': 15,
    'Healthcare': 12,
    'Consumer Discretionary': 11,
    'Industrials': 10,
    'Communication Services': 8,
    'Consumer Staples': 7,
    'Energy': 4,
    'Materials': 4,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'S&P 500': {
    'Technology': 32,
    'Healthcare': 12,
    'Financials': 11,
    'Consumer Discretionary': 10,
    'Industrials': 8,
    'Communication Services': 9,
    'Consumer Staples': 6,
    'Energy': 4,
    'Utilities': 2,
    'Real Estate': 2,
    'Materials': 4,
  },
  'MSCI EMERGING': {
    'Technology': 20,
    'Financials': 22,
    'Consumer Discretionary': 14,
    'Communication Services': 10,
    'Materials': 8,
    'Energy': 6,
    'Industrials': 6,
    'Consumer Staples': 5,
    'Healthcare': 4,
    'Utilities': 3,
    'Real Estate': 2,
  },
  'MSCI EUROPE': {
    'Financials': 17,
    'Healthcare': 15,
    'Industrials': 14,
    'Consumer Staples': 11,
    'Consumer Discretionary': 10,
    'Materials': 8,
    'Energy': 7,
    'Technology': 8,
    'Utilities': 4,
    'Communication Services': 3,
    'Real Estate': 3,
  },
};

function getIndexFallbackSectors(etfName: string): Record<string, number> {
  const upperName = etfName.toUpperCase();
  
  for (const [index, sectors] of Object.entries(INDEX_SECTOR_FALLBACKS)) {
    if (upperName.includes(index)) {
      console.log(`Using fallback sectors for index: ${index}`);
      return sectors;
    }
  }
  
  // Fallback generico per ETF azionari globali
  return {};
}
```

### 2. Invalidare Cache Esistente

Opzione A: Aggiungere parametro per forzare refresh
```typescript
// Nel frontend, quando si accede alla vista Sector:
fetchAllocation(isin, true); // forceRefresh = true
```

Opzione B: Migrazione SQL per invalidare cache senza settori
```sql
-- Invalida ETF senza dati settoriali per forzare ri-scraping
UPDATE etf_allocations 
SET last_fetched_at = '2020-01-01' 
WHERE sector_allocations = '{}' OR sector_allocations IS NULL;
```

### 3. Aggiornare `useETFAllocations` per Re-fetch Intelligente

**File**: `src/hooks/useETFAllocations.ts`

```typescript
const fetchAllocation = useCallback(async (
  isin: string, 
  forceRefresh = false
): Promise<ETFAllocation | null> => {
  // Se cached ma senza settori, forzare refresh
  if (!forceRefresh && allocations[isin]) {
    const hasNoSectors = Object.keys(allocations[isin].sectorAllocations || {}).length === 0;
    if (hasNoSectors) {
      console.log(`${isin} has no sector data, forcing refresh`);
      forceRefresh = true;
    }
  }
  
  // ... resto del codice ...
}, [allocations, loading]);
```

---

## Ordine di Implementazione

1. **Aggiornare Edge Function** con:
   - Pattern di scraping migliorati
   - Fallback per indici comuni
   - Logging dettagliato per debug

2. **Invalidare cache esistente** senza settori

3. **Aggiornare hook frontend** per forzare re-fetch quando mancano settori

4. **Testare** con ETF reali (IE00B4L5Y983 - iShares MSCI World)

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/fetch-etf-allocation/index.ts` | Migliorare scraping + aggiungere fallback |
| `src/hooks/useETFAllocations.ts` | Re-fetch intelligente se settori mancanti |
| Migrazione SQL | Invalidare cache senza settori |

---

## Risultato Atteso

- ETF con dati settoriali effettivi (quando disponibili) o fallback ragionevoli
- La vista Sector Allocation mostrerà:
  - ETF → decomposizione per settore basata su percentuali
  - Esempio: ETF con €100,000 e 24% Technology → €24,000 in Technology

