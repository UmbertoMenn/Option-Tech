

# Piano: Aggiunta Esposizione USD nel Tooltip + Rinomina Label

## Obiettivo
1. Aggiungere nel tooltip del grafico "Evoluzione Rendimento" l'esposizione USD (%) per ogni punto della curva
2. Rinominare "Rend. USD" in "Rend. Bnchmrk USD" per maggiore chiarezza

## Modifiche Necessarie

### 1. `src/hooks/useBenchmarkData.ts`

Il hook attualmente restituisce `equityPctUsed` ma **non** restituisce `usdPctUsed`. Devo aggiungere questo campo nell'output.

**Modifiche:**
- Aggiungere `usdPctUsed?: number` all'interfaccia del tipo di ritorno (riga ~256-262)
- Popolare `usdPctUsed` in tutti i punti dove viene calcolato (righe ~351-358 e ~431-438)

```typescript
// Struttura returns aggiornata
const returns: Array<{
  date: string;
  equityReturn: number;
  bondReturn: number;
  scaledReturn: number;
  eurusdVariation?: number;
  equityPctUsed?: number;
  usdPctUsed?: number;  // ← NUOVO
}> = [];
```

### 2. `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

**A. Aggiornare interfaccia `ChartDataPoint` (riga ~42-54)**
```typescript
interface ChartDataPoint {
  // ... esistenti
  benchmarkUsdPctUsed?: number;  // ← NUOVO
}
```

**B. Mappare il nuovo campo nel `benchmarkByDate` (righe ~360-375)**
```typescript
benchmarkByDate[br.date] = {
  // ... esistenti
  usdPctUsed: br.usdPctUsed,  // ← NUOVO
};
```

**C. Passare il valore ai punti dati (righe ~400-412 e ~429-441)**
```typescript
benchmarkUsdPctUsed: bm?.usdPctUsed,
```

**D. Aggiornare il tooltip (righe ~554-580)**
- Rinominare "Rend. USD" → "Rend. Bnchmrk USD" (riga ~568)
- Aggiungere riga con "Exp. USD" prima di "Var. EUR/USD" quando `currencyAdjusted` è attivo

```typescript
{/* Aggiunto: Esposizione USD */}
{currencyAdjusted && dataPoint.benchmarkUsdPctUsed !== undefined && (
  <div className="flex justify-between gap-4">
    <span>├─ Exp. USD:</span>
    <span className="font-mono">{(dataPoint.benchmarkUsdPctUsed * 100).toFixed(1)}%</span>
  </div>
)}
```

## Struttura Finale del Tooltip

Il tooltip mostrerà (quando Currency Adjusted è attivo):
```
Benchmark (Adj.): +7.54%
├─ Equity (USD):     +19.54%
├─ Bond (USD):       +7.81%
├─ Peso Equity:      49.2%
├─ Rend. Bnchmrk USD: +13.58%  ← Rinominato
├─ Exp. USD:         43.8%     ← NUOVO
├─ Var. EUR/USD:     +13.58%
└─ Rend. EUR:        +7.63%
```

## File Coinvolti
| File | Tipo Modifica |
|------|---------------|
| `src/hooks/useBenchmarkData.ts` | Aggiungere `usdPctUsed` all'output |
| `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` | Interfaccia + mapping + tooltip |

