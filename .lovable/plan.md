
# Piano: Riutilizzo Currency Exposure dal Risk Analyzer

## Problema

Il calcolo dell'esposizione valutaria con decomposizione ETF avviene solo nel Risk Analyzer e i dati restano locali. Per l'aggiustamento valutario del benchmark serve riutilizzare questi dati nella Dashboard.

## Soluzione

Creare un hook `useCurrencyExposure` che incapsula tutta la logica già presente nel Risk Analyzer, rendendola riutilizzabile ovunque.

## Modifiche Tecniche

### 1. Nuovo Hook: `src/hooks/useCurrencyExposure.ts`

Hook che incapsula la logica completa di calcolo currency exposure:

```typescript
export interface CurrencyExposureResult {
  exposures: CurrencyExposure[];
  usdExposure: CurrencyExposure | null;
  usdExposurePct: number;  // 0-1
  totalExposure: number;   // EUR
  isLoading: boolean;
  isETFDataLoading: boolean;
  etfCount: number;
  loadedETFCount: number;
}

export function useCurrencyExposure(options?: {
  includeDerivatives?: boolean;
  includeBonds?: boolean;
}): CurrencyExposureResult
```

Internamente:
- Usa `useRiskAnalysis()` per ottenere l'analisi del rischio
- Usa `useETFAllocations()` per le allocazioni ETF
- Effettua il fetch delle allocazioni ETF (come fa RiskAnalyzer)
- Applica `calculateCurrencyExposure()` + `applyETFDecomposition()`
- Estrae l'esposizione USD e calcola la percentuale

### 2. Edge Function: `supabase/functions/update-benchmark-prices/index.ts`

Aggiungere `EURUSD=X` alla lista dei ticker benchmark:

```typescript
const BENCHMARK_TICKERS = [
  "URTH", "SPY", "ACWI", "EXSA.DE", "AGG",
  "EURUSD=X"  // Nuovo ticker per tasso di cambio
];
```

### 3. Hook: `src/hooks/useBenchmarkData.ts`

Modifiche:
- Aggiungere parametri `usdExposurePct` e `currencyAdjusted`
- Recuperare i dati storici di `EURUSD=X`
- Calcolare la variazione cumulativa EUR/USD dalla data base
- Applicare formula: `adjustedReturn = nominalReturn - (usdExposurePct × eurusdVariation)`

### 4. Componente: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

Modifiche:
- Importare e usare `useCurrencyExposure({ includeDerivatives: false, includeBonds: true })`
- Aggiungere stato `currencyAdjusted` (toggle)
- Passare `usdExposurePct` e `currencyAdjusted` a `useBenchmarkData`
- Aggiungere toggle UI nella legenda
- Tooltip esplicativo:
  > "Aggiusta il benchmark per l'effetto valutario EUR/USD. Viene utilizzata l'esposizione in dollari attuale del portafoglio (XX.X%) come proxy per quella storica. Derivati esclusi, bond inclusi."

### 5. Refactor: `src/pages/RiskAnalyzer.tsx`

Sostituire la logica locale con il nuovo hook:

```typescript
// Prima (righe 42-144 circa)
const baseCurrencyExposure = useMemo(...);
const etfIsins = useMemo(...);
useEffect(() => { fetchMultipleAllocations... });
const currencyExposure = useMemo(...);

// Dopo
const {
  exposures: currencyExposure,
  isLoading: isCurrencyLoading,
  isETFDataLoading,
  etfCount,
  loadedETFCount
} = useCurrencyExposure({ includeDerivatives, includeBonds });
```

## Flusso Dati

```text
useCurrencyExposure()
       │
       ├── useRiskAnalysis()
       │
       ├── useETFAllocations()
       │      └── fetchMultipleAllocations()
       │
       ├── calculateCurrencyExposure()
       │
       └── applyETFDecomposition()
              │
              ▼
       { exposures, usdExposurePct, ... }
              │
     ┌────────┴────────┐
     │                 │
     ▼                 ▼
RiskAnalyzer    PerformanceEvolutionChart
(vista completa)  (solo usdExposurePct)
```

## File da Creare

| File | Descrizione |
|------|-------------|
| `src/hooks/useCurrencyExposure.ts` | Hook che incapsula calcolo currency exposure con decomposizione ETF |

## File da Modificare

| File | Modifiche |
|------|-----------|
| `supabase/functions/update-benchmark-prices/index.ts` | Aggiungere `EURUSD=X` ai ticker |
| `src/hooks/useBenchmarkData.ts` | Gestire EURUSD, calcolare aggiustamento valutario |
| `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` | Toggle UI + integrazione hook |
| `src/pages/RiskAnalyzer.tsx` | Refactor per usare il nuovo hook |

## Vantaggi

1. **Riuso del codice**: La logica di calcolo è centralizzata
2. **Consistenza**: Dashboard e Risk Analyzer usano gli stessi dati
3. **Manutenibilità**: Modifiche future in un solo punto
4. **Performance**: Il fetch ETF avviene una sola volta per sessione (cache del hook)
