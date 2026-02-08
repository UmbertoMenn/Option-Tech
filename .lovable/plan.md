
# Piano: Correzione Equity Exposure per Benchmark (Solo Protezioni)

## Problema

Il benchmark del grafico Evoluzione Rendimento utilizza l'`equity_exposure_pct` che include **tutte le categorie di derivati**: Naked PUT, Leap CALL, Strategie.

L'utente ha correttamente identificato che:
- Le **Naked PUT** non sono esposizione equity diretta, ma solo potenziale
- Le **Leap CALL** e **Strategie** hanno un profilo rischio/rendimento diverso dalla detenzione diretta di equity
- Un confronto corretto richiede un'esposizione calcolata con **solo le protezioni** (Long PUT che proteggono le azioni)

## Soluzione

### Formula Corretta per Benchmark

```text
Equity Exposure = (ETF + Stocks al netto protezioni + Commodities) / Valore Totale Assets
```

Configurazione toggle equivalente:
- Protezioni: ✅ ON (azioni nette)
- Naked Put: ❌ OFF
- Strategie: ❌ OFF
- Leap Call: ❌ OFF

---

## Modifiche Tecniche

### 1. `src/hooks/useEquityExposurePct.ts`

**Aggiungere parametri di configurazione** per permettere il calcolo con/senza derivati:

```typescript
export interface UseEquityExposurePctOptions {
  includeNakedPut?: boolean;     // default: true
  includeStrategies?: boolean;   // default: true
  includeLeapCall?: boolean;     // default: true
}

export function useEquityExposurePct(options: UseEquityExposurePctOptions = {}): EquityExposureResult {
  const {
    includeNakedPut = true,
    includeStrategies = true,
    includeLeapCall = true
  } = options;
  
  // ...calcolo con filtro basato sulle opzioni...
}
```

**Modificare il calcolo del `grandTotal`** per rispettare i flag:

```typescript
// grandTotal dinamico
const grandTotal = 
  analysis.totalStockRisk +        // Azioni (già nette protezioni)
  analysis.totalCommodityRisk +    // Commodities
  (includeNakedPut ? analysis.totalNakedPutRisk : 0) +
  (includeLeapCall ? analysis.totalLeapCallRisk : 0) +
  (includeStrategies ? analysis.totalStrategyRisk : 0);
```

---

### 2. `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

**Modificare la chiamata a `useEquityExposurePct`** (linea ~249):

```typescript
// Get equity exposure for BENCHMARK only: protections on, all others off
const { 
  equityExposurePct, 
  equityExposureEUR, 
  assetsTotalEUR, 
  hasData: hasEquityData 
} = useEquityExposurePct({
  includeNakedPut: false,
  includeStrategies: false,
  includeLeapCall: false
});
```

---

### 3. Aggiornare il Tooltip del Benchmark

**Modificare la descrizione** in `CustomLegend` (linee 122-128):

```typescript
const benchmarkDescription = hasEquityData
  ? `Paniere Equity/Bond ponderato per l'equity exposure storica del portafoglio.\n\n` +
    `Ponderazione dinamica: Il peso Equity/Bond varia nel tempo in base all'esposizione salvata in ogni snapshot.\n` +
    `L'exposure di ciascun punto determina la ponderazione per il periodo successivo.\n\n` +
    `⚠️ Nota metodologica: Per comparabilità, l'esposizione equity esclude Naked PUT, Leap CALL e Strategie.\n` +
    `I derivati rappresentano esposizione potenziale con profilo rischio/rendimento diverso dalla detenzione diretta di equity.\n\n` +
    `Equity exposure attuale: ${equityPctFormatted}%\n` +
    `Benchmark attuale: ${equityPctFormatted}% × Equity (SPY/QQQ) + ${bondPctFormatted}% × Bond (AGG)`
  : 'Paniere Equity/Bond ponderato per l\'equity exposure storica del portafoglio.\nEquity exposure non disponibile - usando fallback 60%.';
```

---

### 4. Aggiornare i Dati Storici (equity_exposure_pct)

**Nel `Dashboard.tsx`**, quando si salva lo snapshot, calcolare l'equity exposure **con la stessa logica** del benchmark:

```typescript
// Calcolare equity exposure per benchmark (solo protezioni)
const { equityExposurePct: benchmarkEquityPct } = useEquityExposurePct({
  includeNakedPut: false,
  includeStrategies: false,
  includeLeapCall: false
});

// Usare questo valore nel salvataggio snapshot
upsertHistoricalData({
  // ...
  equity_exposure_pct: benchmarkEquityPct, // ← ora coerente con il benchmark
  // ...
});
```

---

## Riepilogo File da Modificare

| File | Modifiche |
|------|-----------|
| `src/hooks/useEquityExposurePct.ts` | Aggiungere interfaccia opzioni + logica condizionale per grandTotal |
| `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` | Passare opzioni all'hook + aggiornare tooltip benchmark |
| `src/components/dashboard/Dashboard.tsx` | Usare hook con opzioni per salvare equity_exposure_pct coerente |

---

## Risultato Atteso

1. **Benchmark corretto**: Il confronto con SPY/QQQ/AGG utilizzerà un'equity exposure che rappresenta l'esposizione **diretta** a mercati azionari

2. **Tooltip informativo**: L'utente saprà che le strategie derivati sono state escluse per motivi metodologici

3. **Coerenza storica**: Gli snapshot futuri salveranno un'equity_exposure_pct coerente con la nuova logica
