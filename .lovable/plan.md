
# Piano: Correzione Completa Aggregazione Vista Globale

## Diagnosi dei Problemi

### Problema 1: Rendimenti Falsati
I grafici calcolano il rendimento partendo dal primo punto della serie. Se Portfolio A ha snapshot dal 01/01 e Portfolio B entra solo il 01/06, l'ingresso di B non viene trattato come "nuovo capitale" - il valore sale improvvisamente senza che ci sia un apporto, falsando il rendimento.

### Problema 2: Giacenza Media = 0
La giacenza media viene calcolata in `StatsCards.tsx` usando `portfolio.snapshot_date` come data finale. Anche con `aggregatedSnapshotDate` corretto, la formula non considera i "versamenti sintetici" (ingresso di nuovi portafogli).

### Problema 3: Grafici Non Interpolano Correttamente
L'interpolazione attuale gestisce bene i portafogli che **già esistono**, ma non crea "apporti sintetici" quando un portafoglio **compare per la prima volta**.

---

## Strategia: Apporti Sintetici per Nuovi Portafogli

Quando aggreghiamo i dati storici, dobbiamo:
1. Per ogni portafoglio, identificare la sua **data di ingresso** (primo snapshot)
2. Nelle date precedenti, quel portafoglio contribuisce 0
3. Alla data di ingresso, il suo valore iniziale viene registrato come **apporto sintetico** (synthetic deposit)
4. Gli apporti sintetici vengono sommati ai depositi reali per il calcolo di giacenza media e P/L

---

## Modifiche Richieste

### 1. Modificare `useHistoricalData.ts` - Calcolare Apporti Sintetici

Estendere `aggregateHistoricalWithInterpolation` per restituire anche gli apporti sintetici:

```typescript
interface AggregatedHistoricalResult {
  entries: HistoricalDataEntry[];
  syntheticDeposits: { date: string; amount: number; portfolioId: string }[];
}

function aggregateHistoricalWithInterpolation(
  data: HistoricalDataEntry[],
  viewMode: ViewMode = 'base'
): AggregatedHistoricalResult {
  // ... codice esistente per raggruppamento ...
  
  const syntheticDeposits: { date: string; amount: number; portfolioId: string }[] = [];
  
  // Per ogni portfolio, registra il valore alla prima data come apporto sintetico
  byPortfolio.forEach((entries, portfolioId) => {
    if (entries.length === 0) return;
    const firstEntry = entries[0]; // già ordinato ascendente
    const firstValue = getValueForViewMode(firstEntry, viewMode);
    syntheticDeposits.push({
      date: firstEntry.snapshot_date,
      amount: firstValue,
      portfolioId,
    });
  });
  
  // ... resto del codice per aggregazione ...
  
  return { entries: aggregated, syntheticDeposits };
}
```

### 2. Modificare l'hook per esporre i synthetic deposits

```typescript
export function useHistoricalData(portfolioId: string | undefined) {
  // ...
  
  const historicalDataQuery = useQuery({
    queryKey: ['historical-data', portfolioId],
    queryFn: async () => {
      // Vista aggregata
      if (isAggregated && isAdmin) {
        const { data, error } = await supabase
          .from('historical_data')
          .select('*')
          .order('snapshot_date', { ascending: false });
        
        if (error) throw error;
        return aggregateHistoricalWithInterpolation(data as HistoricalDataEntry[]);
      }
      
      // Portfolio singolo - nessun synthetic deposit
      const { data, error } = await supabase
        .from('historical_data')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .order('snapshot_date', { ascending: false });
      
      if (error) throw error;
      return { 
        entries: data as HistoricalDataEntry[], 
        syntheticDeposits: [] 
      };
    },
    // ...
  });
  
  return {
    historicalData: historicalDataQuery.data?.entries || [],
    syntheticDeposits: historicalDataQuery.data?.syntheticDeposits || [],
    // ... resto invariato
  };
}
```

### 3. Modificare `Dashboard.tsx` - Passare Synthetic Deposits

Passare i synthetic deposits ai componenti che ne hanno bisogno:

```typescript
const { 
  historicalData, 
  syntheticDeposits, // NEW
  // ...
} = useHistoricalData(portfolio?.id);

// Combinare depositi reali e sintetici per i grafici
const allDepositsForCharts = useMemo(() => {
  if (!isAggregatedView) return deposits;
  
  const syntheticAsDeposits: DepositEntry[] = syntheticDeposits.map(sd => ({
    id: `synthetic-${sd.portfolioId}-${sd.date}`,
    portfolio_id: 'AGGREGATED',
    deposit_date: sd.date,
    amount: sd.amount,
    description: 'Apporto sintetico (ingresso portafoglio)',
    created_at: '',
    updated_at: '',
  }));
  
  return [...deposits, ...syntheticAsDeposits];
}, [deposits, syntheticDeposits, isAggregatedView]);

// Passare ai grafici e a StatsCards
<StatsCards
  allDeposits={allDepositsForCharts}
  // ...
/>

<HistoricalChartsCarousel
  deposits={allDepositsForCharts}
  // ...
/>
```

### 4. Modificare `StatsCards.tsx` - Usare Depositi Combinati

Nessuna modifica necessaria al componente stesso - riceverà già i depositi combinati tramite la prop `allDeposits`.

### 5. Modificare i Grafici - Usare Depositi Combinati

**`PerformanceEvolutionChart.tsx`** e **`YearlyReturnChart.tsx`**:
- Già ricevono `deposits` come prop
- Con i synthetic deposits inclusi, i calcoli di P/L e giacenza media saranno corretti

---

## Logica di Calcolo Rendimento con Apporti Sintetici

Esempio con 2 portafogli:
- **Portfolio A**: primo snapshot 01/01/2025, valore 100k
- **Portfolio B**: primo snapshot 01/06/2025, valore 50k

| Data | Valore A | Valore B | Totale | Apporti | Giacenza Media | Rendimento |
|------|----------|----------|--------|---------|----------------|------------|
| 01/01 | 100k | - | 100k | 100k (synth A) | 100k | 0% |
| 01/03 | 110k | - | 110k | - | 100k | +10% |
| 01/06 | 120k | 50k | 170k | 50k (synth B) | 125k | ~16% |
| 01/09 | 130k | 60k | 190k | - | 150k | ~17% |

Formula: `P/L = Valore Attuale - Valore Iniziale - Σ Apporti`
Rendimento: `P/L ÷ Giacenza Media`

---

## Riepilogo File da Modificare

| File | Modifiche |
|------|-----------|
| `src/hooks/useHistoricalData.ts` | Calcolare e restituire `syntheticDeposits` insieme ai dati aggregati |
| `src/components/dashboard/Dashboard.tsx` | Combinare depositi reali e sintetici, passarli ai componenti figli |
| `src/types/historicalData.ts` | (Opzionale) Aggiungere tipo per synthetic deposit |

---

## Comportamento Atteso

### Vista Aggregata
1. **Grafici Rendimento**: Il rendimento parte da 0% per il primo portafoglio. Quando un nuovo portafoglio entra, il suo valore viene trattato come apporto sintetico, mantenendo la continuità del rendimento.
2. **Giacenza Media**: Calcolata correttamente considerando gli apporti sintetici come versamenti.
3. **P/L**: `Valore Attuale - Valore Primo Snapshot - Depositi Reali - Apporti Sintetici`

### Vista Portfolio Singolo
Comportamento invariato - nessun apporto sintetico.

---

## Edge Cases Gestiti

1. **Portfolio che chiude**: L'ultimo valore viene mantenuto (carry forward) - già gestito
2. **Portfolio con un solo snapshot**: Contribuisce solo a quella data
3. **Date identiche per primo snapshot**: Ogni portafoglio ha comunque il suo apporto sintetico
4. **ViewMode diversi**: L'apporto sintetico usa il valore della viewMode selezionata (Base/Netting/etc)
