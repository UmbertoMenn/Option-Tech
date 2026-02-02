

# Piano: Spostare Top Holdings da Sector Allocation a Equity Exposure

## Panoramica

L'utente richiede di:
1. **Rimuovere** la sezione "Top 20 Holdings" dalla vista `SectorAllocationView`
2. **Aggiungere** una nuova sezione "Top 10 Holdings" nella vista `EquityExposureView`
3. La nuova sezione deve:
   - Analizzare le prime 10 partecipazioni di ogni ETF
   - Moltiplicare la quota percentuale per il valore dell'ETF in EUR
   - Sommare il rischio stocks e il rischio naked PUT del singolo titolo
   - Includere un toggle per includere/escludere le protezioni

## Flusso dei Dati

```text
┌─────────────────────────────────────────────────────────────────────┐
│                       Per ogni titolo nella Top 10:                  │
├─────────────────────────────────────────────────────────────────────┤
│  Esposizione Totale = (ETF Exposure) + (Stock Risk) + (Naked PUT)   │
│                                                                      │
│  Dove:                                                               │
│  • ETF Exposure = Σ (ETF Value × Holding %)                         │
│  • Stock Risk = Rischio azione diretta (con/senza protezioni)       │
│  • Naked PUT Risk = Strike × Contratti × 100 / Cambio               │
└─────────────────────────────────────────────────────────────────────┘
```

## Modifiche Richieste

### 1. Rimuovere Top 20 Holdings da SectorAllocationView

**File**: `src/components/risk/SectorAllocationView.tsx`

- Rimuovere le righe 319-384 che contengono la Card "Top 20 Holdings"
- Rimuovere `topHoldings` dalle props dell'interfaccia
- Aggiornare l'import di `TrendingUp` se non più necessario

### 2. Aggiornare RiskAnalyzer per non passare topHoldings a SectorAllocationView

**File**: `src/pages/RiskAnalyzer.tsx`

- Rimuovere la prop `topHoldings` dal componente `SectorAllocationView`
- Passare `topHoldings` (già calcolato) a `EquityExposureView` insieme alle altre props necessarie
- Passare anche `allocations` e `nakedPutDetails` per i calcoli aggregati

### 3. Creare Nuova Sezione Top 10 Holdings in EquityExposureView

**File**: `src/components/risk/EquityExposureView.tsx`

Aggiungere una nuova sezione Accordion dopo le strategie con:

- **Toggle "Includi Protezioni"**: Quando attivo, calcola il rischio stock al netto delle protezioni PUT; quando disattivo, usa il valore pieno
- **Calcolo Aggregato per ogni titolo**:
  ```typescript
  // Per ogni holding nella top 10:
  totalExposure = 
    + (Esposizione via ETF: somma di ETF_value × holding_percentage)
    + (Rischio Stock diretto: con o senza protezioni basato su toggle)
    + (Rischio Naked PUT: se presente su quel sottostante)
  ```

### 4. Aggiungere Helper per Calcolo Consolidato

**File**: `src/lib/sectorExposure.ts`

Aggiungere una nuova funzione `calculateConsolidatedTopHoldings`:

```typescript
export function calculateConsolidatedTopHoldings(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: { includeProtections: boolean },
  limit: number = 10
): ConsolidatedHolding[]
```

Questa funzione:
- Prende le top holdings da ogni ETF (prime 10)
- Calcola l'esposizione via ETF
- Cerca se esiste uno stock diretto con lo stesso nome e aggiunge il rischio
- Cerca se esiste una Naked PUT sullo stesso sottostante e aggiunge il rischio
- Ordina per esposizione totale decrescente

### 5. Interfaccia Utente della Nuova Sezione

La nuova sezione mostrerà:

| Rank | Titolo | via ETF | Stock | Naked PUT | Totale |
|------|--------|---------|-------|-----------|--------|
| 1. | NVIDIA | €15,234 | €8,500 | €12,000 | €35,734 |
| 2. | Apple | €12,100 | - | - | €12,100 |
| ... | ... | ... | ... | ... | ... |

Con:
- Badge per indicare le fonti (ETF, Diretto, Naked PUT)
- Colore verde per la parte protetta (se toggle attivo)
- Percentuale rispetto al totale holdings

## Dettagli Tecnici

### Props da Passare a EquityExposureView

```typescript
interface EquityExposureViewProps {
  analysis: RiskAnalysis;
  portfolioTotalValue?: number;
  // Nuove props:
  etfAllocations?: Record<string, ETFAllocation>;
  isLoadingETFData?: boolean;
}
```

### Nuova Interfaccia ConsolidatedHolding

```typescript
interface ConsolidatedHolding {
  name: string;
  etfExposure: number;          // Esposizione via ETF (€)
  stockRisk: number;            // Rischio stock diretto (€)
  stockRiskWithProtection: number; // Rischio stock con protezioni (€)
  nakedPutRisk: number;         // Rischio naked PUT (€)
  totalExposure: number;        // Totale con/senza protezioni
  sources: Array<{
    type: 'etf' | 'stock' | 'nakedPut';
    name: string;
    exposure: number;
    percentage?: number;
  }>;
}
```

### Logica di Matching

Per aggregare i dati, il sistema deve riconoscere lo stesso titolo attraverso diverse fonti:
- ETF holding name: "NVIDIA Corp"
- Stock diretto: "NVDA" o "NVIDIA CORP"  
- Naked PUT: "NVIDIA" (underlying)

Utilizzare la funzione di matching esistente `normalizeForMatching` e `getCanonicalKey` già presente in `derivativeStrategies.ts`.

## File da Modificare

| File | Azione |
|------|--------|
| `src/components/risk/SectorAllocationView.tsx` | Rimuovere sezione Top 20 Holdings |
| `src/components/risk/EquityExposureView.tsx` | Aggiungere sezione Top 10 Holdings con toggle |
| `src/pages/RiskAnalyzer.tsx` | Passare nuove props a EquityExposureView |
| `src/lib/sectorExposure.ts` | Aggiungere funzione `calculateConsolidatedTopHoldings` |

## Risultato Atteso

- La vista Sector Allocation non mostra più la sezione Top 20 Holdings
- La vista Equity Exposure include una nuova sezione accordion "Top 10 Holdings Consolidate"
- Ogni holding mostra l'esposizione aggregata da: ETF, Stock diretti, Naked PUT
- Un toggle permette di includere/escludere le protezioni nel calcolo del rischio stock
- L'ordinamento è per esposizione totale decrescente

