
# Piano: Aggiungere Vista "Sector Allocation" al Risk Analyzer

## Obiettivo

Aggiungere una terza vista al carousel del Risk Analyzer chiamata **"Sector Allocation"** che mostri:
1. **Esposizione azionaria per settore** con toggle includi/escludi derivati
2. **Decomposizione settoriale degli ETF** (dati da justETF)
3. **Top 20 titoli per esposizione** combinando azioni singole e holdings ETF

---

## Architettura della Soluzione

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                            RiskAnalyzer.tsx                              │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    RiskViewModeSelector                             │ │
│  │          [Equity] ─── [Currency] ─── [Sector] ◄── NUOVO             │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                  ↓                                       │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────────────┐   │
│  │EquityExposure│  │CurrencyExposure│  │ SectorAllocationView ◄─ NUOVO │  │
│  └──────────────┘  └───────────────┘  └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Dati Richiesti                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ • Azioni singole → Settore assegnato staticamente o inferito            │
│ • ETF → Fetch sector allocations da justETF (nuovo campo)               │
│ • Top Holdings ETF → Fetch top holdings da justETF (nuovo campo)        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Modifiche Previste

### 1. Aggiornare Edge Function `fetch-etf-allocation`

**File**: `supabase/functions/fetch-etf-allocation/index.ts`

Estendere lo scraper per estrarre anche:
- **Sector allocations**: `{ Technology: 28.45, Financials: 14.23, ... }`
- **Top 10 Holdings**: `[{ name: 'NVIDIA Corp.', percentage: 5.21, isin?: 'US67066G1040' }, ...]`

```typescript
// Nuovi campi da aggiungere allo scraping
interface JustETFData {
  // Campi esistenti
  name: string;
  countryAllocations: Record<string, number>;
  currencyAllocations: Record<string, number>;
  isHedged: boolean;
  // NUOVI campi
  sectorAllocations: Record<string, number>;  // es. { Technology: 28.45, Financials: 14.23 }
  topHoldings: Array<{ name: string; percentage: number; isin?: string }>;
}
```

Aggiungere regex per estrarre i settori dalla pagina justETF:
```typescript
// Sectors extraction (similar pattern to countries)
const sectorRowRegex = /data-testid="etf-holdings_sectors_row"[\s\S]*?data-testid="tl_etf-holdings_sectors_value_name"[^>]*>([^<]+)<[\s\S]*?data-testid="tl_etf-holdings_sectors_value_percentage"[^>]*>[\s]*([\d,\.]+)\s*%/gi;

// Top Holdings extraction
const holdingsRowRegex = /data-testid="etf-holdings_components_row"[\s\S]*?<a[^>]*stock-profiles\/([A-Z0-9]+)[^>]*>([^<]+)<[\s\S]*?(\d+[.,]\d+)\s*%/gi;
```

---

### 2. Aggiornare Tabella Database `etf_allocations`

**Migrazione SQL**:
```sql
ALTER TABLE etf_allocations 
ADD COLUMN IF NOT EXISTS sector_allocations jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS top_holdings jsonb DEFAULT '[]';
```

---

### 3. Aggiornare Hook `useETFAllocations`

**File**: `src/hooks/useETFAllocations.ts`

Estendere l'interfaccia `ETFAllocation`:
```typescript
export interface ETFAllocation {
  isin: string;
  name: string;
  countryAllocations: Record<string, number>;
  currencyAllocations: Record<string, number>;
  sectorAllocations: Record<string, number>;     // NUOVO
  topHoldings: Array<{                           // NUOVO
    name: string;
    percentage: number;
    isin?: string;
  }>;
  isHedged: boolean;
  cached?: boolean;
}
```

---

### 4. Creare Libreria `sectorExposure.ts`

**File**: `src/lib/sectorExposure.ts`

Funzioni per:
1. **Assegnare settori alle azioni singole** (mapping statico o inferenza da nome)
2. **Decomporre ETF per settore** (simile a `etfCurrencyDecomposition.ts`)
3. **Aggregare esposizione per settore**
4. **Calcolare top holdings combinati**

```typescript
// Mapping settori per azioni singole (basato su ticker noti)
const STOCK_SECTORS: Record<string, string> = {
  'AAPL': 'Technology',
  'MSFT': 'Technology',
  'GOOGL': 'Technology',
  'AMZN': 'Consumer Discretionary',
  'JPM': 'Financials',
  'JNJ': 'Healthcare',
  // ... altri ticker comuni
};

export interface SectorExposure {
  sector: string;
  totalRisk: number;         // In EUR
  percentage: number;
  instruments: SectorInstrument[];
}

export interface SectorInstrument {
  name: string;
  riskEUR: number;
  isETF: boolean;
  isFromETFDecomposition: boolean;  // true se derivato da ETF
  sourceETF?: string;               // Nome ETF di provenienza
}

export interface TopHolding {
  name: string;
  totalExposure: number;      // In EUR
  percentage: number;
  sources: Array<{
    source: string;           // Nome azione/ETF
    exposure: number;
    isDirectHolding: boolean; // true se azione diretta, false se da ETF
  }>;
}

// Calcola esposizione settoriale
export function calculateSectorExposure(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: { includeDerivatives: boolean }
): SectorExposure[];

// Calcola top holdings aggregati
export function calculateTopHoldings(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  limit: number = 20
): TopHolding[];
```

---

### 5. Aggiornare `RiskViewModeSelector`

**File**: `src/components/risk/RiskViewModeSelector.tsx`

Aggiungere la vista 'sector':
```typescript
export type RiskViewMode = 'equity' | 'currency' | 'sector';

const VIEW_LABELS: Record<RiskViewMode, string> = {
  equity: 'Equity Exposure',
  currency: 'Currency Exposure',
  sector: 'Sector Allocation',  // NUOVO
};

const VIEWS: RiskViewMode[] = ['equity', 'currency', 'sector'];
```

---

### 6. Creare Componente `SectorAllocationView`

**File**: `src/components/risk/SectorAllocationView.tsx`

Struttura UI:
```text
┌─────────────────────────────────────────────────────────────────────────┐
│  SECTOR ALLOCATION                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐  ┌───────────────────────────────┐ │
│  │ Esposizione Settoriale Totale   │  │      Donut Chart Settori      │ │
│  │ €XXX,XXX                        │  │      [Technology] 35%         │ │
│  │ Toggle: [x] Includi Derivati    │  │      [Financials] 20%         │ │
│  │ ETF analizzati: 5/5 ✓           │  │      [Healthcare] 15%         │ │
│  └─────────────────────────────────┘  │      ...                      │ │
│                                       └───────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  DETTAGLIO PER SETTORE (Accordion)                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ▼ Technology                     15 strumenti    €XXX,XXX  (35%)  │  │
│  │   ├─ 📈 NVIDIA           [Diretto]              €45,000           │  │
│  │   ├─ 📈 APPLE            [Diretto]              €32,000           │  │
│  │   ├─ 📊 iShares MSCI World [28.5% Tech]         €28,500           │  │
│  │   └─ ...                                                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ▶ Financials                      8 strumenti    €XXX,XXX  (20%)  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ...                                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  TOP 20 HOLDINGS                                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 1. NVIDIA Corp.              €65,000  (8.5%)                      │  │
│  │    ├─ Diretto: 200 azioni × $140                                  │  │
│  │    └─ Via ETF: iShares MSCI World (5.2%)                          │  │
│  │ 2. Apple                     €52,000  (6.8%)                      │  │
│  │    └─ Via ETF: iShares MSCI World (5.0%), Vanguard S&P500 (7.1%)  │  │
│  │ 3. Microsoft                 €48,000  (6.2%)                      │  │
│  │    └─ Diretto: 150 azioni × $420                                  │  │
│  │ ...                                                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 7. Aggiornare `RiskAnalyzer.tsx`

**File**: `src/pages/RiskAnalyzer.tsx`

Integrare la nuova vista:
```typescript
import { SectorAllocationView } from '@/components/risk/SectorAllocationView';
import { calculateSectorExposure, calculateTopHoldings } from '@/lib/sectorExposure';

// Nel componente:
// Fetch ETF allocations when switching to sector view (like currency view)
useEffect(() => {
  if (etfIsins.length > 0 && (viewMode === 'currency' || viewMode === 'sector') && !hasFetchedETFs) {
    setHasFetchedETFs(true);
    fetchMultipleAllocations(etfIsins);
  }
}, [etfIsins, viewMode, hasFetchedETFs, fetchMultipleAllocations]);

// Calcola sector exposure
const sectorExposure = useMemo(() => {
  return calculateSectorExposure(analysis, allocations, { includeDerivatives });
}, [analysis, allocations, includeDerivatives]);

const topHoldings = useMemo(() => {
  return calculateTopHoldings(analysis, allocations, 20);
}, [analysis, allocations]);

// Nel render:
{viewMode === 'sector' && (
  <ErrorBoundary title="Errore nella vista Sector Allocation">
    <SectorAllocationView 
      sectorExposure={sectorExposure}
      topHoldings={topHoldings}
      grandTotal={sectorExposure.reduce((sum, s) => sum + s.totalRisk, 0)}
      isLoadingETFData={isETFDataLoading}
      etfCount={etfIsins.length}
      loadedETFCount={Object.keys(allocations).filter(isin => etfIsins.includes(isin)).length}
      includeDerivatives={includeDerivatives}
      onIncludeDerivativesChange={setIncludeDerivatives}
    />
  </ErrorBoundary>
)}
```

---

## Flusso Dati per Sector Allocation

```text
                    RiskAnalyzer
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   stockDetails     etfAllocations   derivatives
   (azioni singole)  (da justETF)    (se toggle on)
        │                │                │
        ▼                ▼                ▼
   ┌─────────────────────────────────────────┐
   │         calculateSectorExposure()       │
   ├─────────────────────────────────────────┤
   │ 1. Assegna settore a azioni singole     │
   │    (STOCK_SECTORS mapping)              │
   │ 2. Decompone ETF per settore            │
   │    (sectorAllocations × riskEUR)        │
   │ 3. Aggrega per settore                  │
   └─────────────────────────────────────────┘
                         │
                         ▼
                  SectorExposure[]
                         │
                         ▼
             SectorAllocationView
```

---

## Colori Settori

```typescript
export const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#3b82f6',        // Blue
  'Financials': '#10b981',        // Emerald
  'Healthcare': '#ef4444',        // Red
  'Consumer Discretionary': '#f59e0b', // Amber
  'Industrials': '#8b5cf6',       // Violet
  'Consumer Staples': '#06b6d4',  // Cyan
  'Energy': '#f97316',            // Orange
  'Materials': '#84cc16',         // Lime
  'Utilities': '#6366f1',         // Indigo
  'Real Estate': '#ec4899',       // Pink
  'Communication Services': '#14b8a6', // Teal
  'Other': '#6b7280',             // Gray
};
```

---

## File da Creare/Modificare

| File | Azione | Descrizione |
|------|--------|-------------|
| `supabase/functions/fetch-etf-allocation/index.ts` | Modifica | Aggiungere scraping settori e top holdings |
| Migrazione SQL | Crea | Aggiungere colonne `sector_allocations` e `top_holdings` |
| `src/hooks/useETFAllocations.ts` | Modifica | Estendere interfaccia `ETFAllocation` |
| `src/lib/sectorExposure.ts` | Crea | Logica calcolo esposizione settoriale |
| `src/components/risk/RiskViewModeSelector.tsx` | Modifica | Aggiungere vista 'sector' |
| `src/components/risk/SectorAllocationView.tsx` | Crea | Nuovo componente vista |
| `src/pages/RiskAnalyzer.tsx` | Modifica | Integrare nuova vista nel carousel |

---

## Considerazioni Tecniche

1. **Fallback settore azioni**: Per azioni senza mapping, usare "Other" o tentare inferenza dal nome
2. **Cache ETF**: I dati settoriali vengono cachati insieme agli altri dati ETF (7 giorni)
3. **Performance**: Limitare la lista top holdings a 20 elementi per evitare rendering pesante
4. **ETF senza dati settoriali**: Se justETF non restituisce settori, mostrare messaggio informativo
5. **Aggregazione duplicati**: Se un titolo appare sia come azione diretta sia come holding ETF, sommare le esposizioni

---

## Risultato Atteso

Una nuova vista nel Risk Analyzer che permette di:
- Visualizzare l'allocazione settoriale complessiva del portafoglio
- Vedere come gli ETF contribuiscono all'esposizione settoriale
- Identificare i 20 titoli con maggiore esposizione (considerando sia holdings dirette che via ETF)
- Filtrare includendo/escludendo derivati con il toggle
