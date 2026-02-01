
# Piano: Recuperare Settori Dinamicamente da Yahoo Finance

## Problema

L'approccio attuale con mapping hardcoded non è scalabile e non funziona con titoli nuovi o meno comuni.

## Soluzione

Sfruttare la **Yahoo Finance Search API** che già restituisce il settore nel campo `sector`:

```json
{
  "symbol": "NVDA",
  "sector": "Technology",
  "industry": "Semiconductors"
}
```

Questo dato può essere salvato nel database e riutilizzato automaticamente.

---

## Architettura della Soluzione

```text
┌────────────────────────────────────────────────────────────────────┐
│                   Posizione: "AZ.NVIDIA CORP"                      │
│                   ISIN: US67066G1040                               │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│              Edge Function: update-prices-cron                      │
│  1. Cerca ISIN su Yahoo → trova ticker "NVDA"                      │
│  2. Yahoo Search restituisce: sector="Technology"                  │
│  3. Salva nel DB: isin_mappings (ticker + sector + industry)       │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│              Frontend: sectorExposure.ts                           │
│  1. Carica mappings da isin_mappings                               │
│  2. Per ogni posizione, cerca sector nel mapping                   │
│  3. Se non trovato, cerca per nome nella cache                     │
│  4. Calcola esposizione settoriale                                 │
└────────────────────────────────────────────────────────────────────┘
```

---

## Modifiche Tecniche

### 1. Aggiungere Colonne alla Tabella `isin_mappings`

```sql
ALTER TABLE isin_mappings
ADD COLUMN IF NOT EXISTS sector text,
ADD COLUMN IF NOT EXISTS industry text;
```

### 2. Aggiornare Edge Function `update-prices-cron`

**File**: `supabase/functions/update-prices-cron/index.ts`

Modificare `searchYahooByISIN` per estrarre e salvare anche `sector` e `industry`:

```typescript
async function searchYahooByISIN(isin: string): Promise<{
  ticker: string;
  name: string;
  exchange: string;
  sector?: string;    // NUOVO
  industry?: string;  // NUOVO
} | null> {
  const data = await response.json();
  const quotes = data.quotes || [];
  
  const bestMatch = quotes[0];
  
  return {
    ticker: bestMatch.symbol,
    name: bestMatch.shortname || bestMatch.longname || '',
    exchange: bestMatch.exchange || '',
    sector: bestMatch.sector || null,      // NUOVO
    industry: bestMatch.industry || null,  // NUOVO
  };
}

// Salvare nel database
await supabase.from('isin_mappings').upsert({
  isin,
  ticker: searchResult.ticker,
  exchange: searchResult.exchange,
  sector: searchResult.sector,      // NUOVO
  industry: searchResult.industry,  // NUOVO
  source: 'yahoo_search',
  last_verified_at: new Date().toISOString(),
}, { onConflict: 'isin' });
```

### 3. Creare Nuovo Hook `useSectorMappings`

**File**: `src/hooks/useSectorMappings.ts`

Hook per caricare le mappature settoriali dal database:

```typescript
export function useSectorMappings() {
  const [mappings, setMappings] = useState<Record<string, {
    ticker: string;
    sector: string;
    industry: string;
  }>>({});
  
  const fetchMappings = useCallback(async (isins: string[]) => {
    const { data } = await supabase
      .from('isin_mappings')
      .select('isin, ticker, sector, industry')
      .in('isin', isins)
      .not('sector', 'is', null);
    
    // Costruisci mappa per lookup rapido
    // ...
  }, []);
  
  return { mappings, fetchMappings };
}
```

### 4. Aggiornare `sectorExposure.ts`

**File**: `src/lib/sectorExposure.ts`

Modificare `calculateSectorExposure` per accettare anche le mappature settoriali:

```typescript
export function calculateSectorExposure(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  sectorMappings: Record<string, { sector: string }>,  // NUOVO
  options: SectorExposureOptions = {}
): SectorExposure[] {
  // Per azioni singole:
  for (const stock of analysis.stockDetails) {
    if (!isETFByName(stock.underlying)) {
      // 1. Prima cerca nel mapping dinamico (per ISIN)
      let sector = 'Other';
      if (stock.isin && sectorMappings[stock.isin]?.sector) {
        sector = sectorMappings[stock.isin].sector;
      } else {
        // 2. Fallback al mapping statico (per ticker noti)
        sector = getStockSector(stock.underlying);
      }
      // ...
    }
  }
}
```

### 5. Aggiornare `RiskAnalyzer.tsx`

**File**: `src/pages/RiskAnalyzer.tsx`

Integrare il nuovo hook:

```typescript
const { mappings: sectorMappings, fetchMappings } = useSectorMappings();

// Fetch sector mappings when switching to sector view
useEffect(() => {
  const stockIsins = analysis.stockDetails
    .filter(s => s.isin && !isETFByName(s.underlying))
    .map(s => s.isin!);
  
  if (stockIsins.length > 0 && viewMode === 'sector') {
    fetchMappings(stockIsins);
  }
}, [analysis.stockDetails, viewMode]);

// Passa le mappature a calculateSectorExposure
const sectorExposure = useMemo(() => {
  return calculateSectorExposure(analysis, allocations, sectorMappings, { includeDerivatives });
}, [analysis, allocations, sectorMappings, includeDerivatives]);
```

---

## Flusso Completo

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Upload Excel con nuove posizioni                              │
│  └─ Posizione: "AZ.NVIDIA CORP", ISIN: US67066G1040                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Edge Function update-prices-cron (automatico/cron)            │
│  └─ Yahoo Search: "US67066G1040" → {ticker: "NVDA", sector: "Technology"}│
│  └─ Salva in isin_mappings: (isin, ticker, sector, industry)           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Utente apre Sector Allocation View                            │
│  └─ Frontend carica isin_mappings per ISIN delle posizioni             │
│  └─ calculateSectorExposure usa sector dal mapping dinamico            │
│  └─ NVIDIA → Technology ✓ (dinamicamente, senza hardcoding)            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Vantaggi

| Aspetto | Prima (Hardcoded) | Dopo (Dinamico) |
|---------|-------------------|-----------------|
| **Nuovi titoli** | Non riconosciuti | Riconosciuti automaticamente |
| **Manutenzione** | Aggiornamento manuale codice | Zero manutenzione |
| **Copertura** | ~200 ticker noti | Tutti i ticker su Yahoo Finance |
| **Aggiornamenti** | Mai | Ad ogni aggiornamento prezzi |

---

## File da Modificare/Creare

| File | Azione | Descrizione |
|------|--------|-------------|
| Migrazione SQL | Crea | Aggiungere colonne `sector`, `industry` a `isin_mappings` |
| `supabase/functions/update-prices-cron/index.ts` | Modifica | Estrarre e salvare sector/industry da Yahoo Search |
| `src/hooks/useSectorMappings.ts` | Crea | Hook per caricare mappature settoriali |
| `src/lib/sectorExposure.ts` | Modifica | Accettare mappature dinamiche |
| `src/pages/RiskAnalyzer.tsx` | Modifica | Integrare useSectorMappings |

---

## Edge Case: Titoli senza ISIN nel Database

Per i titoli che hanno solo la description (es. opzioni), manterremo il fallback al mapping statico o inferenza dal nome. Ma per le posizioni principali (azioni, ETF) che hanno sempre ISIN, il sistema sarà completamente dinamico.

---

## Risultato Atteso

- **Qualsiasi titolo nuovo** importato via Excel verrà classificato automaticamente
- **Il settore viene recuperato da Yahoo Finance** (fonte autorevole)
- **I dati sono cachati nel database** per riutilizzo futuro
- **Zero manutenzione** per aggiungere nuovi titoli
