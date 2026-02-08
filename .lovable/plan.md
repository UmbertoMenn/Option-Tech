
# Piano: Esposizione USD Storica per Snapshot

## Obiettivo

Salvare l'esposizione in USD (%) per ogni snapshot storico, in modo che il calcolo del benchmark con correzione valutaria utilizzi l'esposizione storica invece di quella attuale statica.

## Situazione Attuale

| Parametro | Comportamento |
|-----------|---------------|
| **Equity Exposure** | Salvata per ogni snapshot → Ponderazione dinamica nel tempo |
| **USD Exposure** | Usa valore attuale statico come proxy per tutto lo storico |

## Nuova Configurazione

| Parametro | Comportamento |
|-----------|---------------|
| **Equity Exposure** | Invariato - già dinamico |
| **USD Exposure** | Salvata per ogni snapshot → Correzione valutaria dinamica nel tempo |

---

## Modifiche

### 1. Database: Aggiungere colonna `usd_exposure_pct`

Nuova migrazione SQL:

```sql
ALTER TABLE historical_data
ADD COLUMN usd_exposure_pct NUMERIC(5,4) DEFAULT 0.8;

COMMENT ON COLUMN historical_data.usd_exposure_pct IS 
  'Esposizione in USD come frazione 0-1, default 0.8 (80%)';
```

---

### 2. Types: `src/types/historicalData.ts`

Aggiungere il nuovo campo:

```typescript
export interface HistoricalDataEntry {
  // ... campi esistenti ...
  equity_exposure_pct: number; // 0-1, default 0.6
  usd_exposure_pct: number;    // NUOVO: 0-1, default 0.8
  // ...
}

export interface HistoricalDataInput {
  // ... campi esistenti ...
  equity_exposure_pct: number;
  usd_exposure_pct: number;    // NUOVO
}
```

---

### 3. Hook: `src/hooks/useHistoricalData.ts`

Aggiungere `usd_exposure_pct` nella mutation upsert:

```typescript
.upsert({
  // ... campi esistenti ...
  equity_exposure_pct: entry.equity_exposure_pct,
  usd_exposure_pct: entry.usd_exposure_pct,  // NUOVO
})
```

---

### 4. Form: `src/components/dashboard/HistoricalDataForm.tsx`

Aggiungere:
- Nuova prop `currentUsdExposurePct` (0-1)
- Nuovo stato form `formUsdExposure`
- Nuovo campo input "USD Exposure (%)"
- Salvataggio nel `handleSave`
- Visualizzazione nella lista entry salvati

Layout form aggiornato:
```
[Equity Exposure (%)]  [USD Exposure (%)]
```

---

### 5. Benchmark Logic: `src/hooks/useBenchmarkData.ts`

Modificare la logica di correzione valutaria per usare l'esposizione storica:

```typescript
// PRIMA (statica):
if (currencyAdjusted && usdExposurePct && usdExposurePct > 0) {
  scaledReturn = scaledReturn - (usdExposurePct * eurusdVariation);
}

// DOPO (dinamica):
if (currencyAdjusted) {
  // Usa USD exposure dello snapshot PRECEDENTE (come per equity)
  const prevEntry = sortedHistory[index - 1];
  const historicalUsdPct = prevEntry.usd_exposure_pct;
  const usdPct = historicalUsdPct && historicalUsdPct > 0 
    ? historicalUsdPct 
    : (usdExposurePct ?? 0.8);
  
  if (usdPct > 0) {
    eurusdVariation = calculateEurusdVariation(entry.snapshot_date);
    scaledReturn = scaledReturn - (usdPct * eurusdVariation);
  }
}
```

---

### 6. Tooltip: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

Aggiornare la descrizione del currency adjustment:

```typescript
const currencyTooltip = hasUsdData
  ? `Aggiusta il benchmark per l'effetto valutario EUR/USD.\n\n` +
    `Ponderazione dinamica: L'esposizione USD varia nel tempo in base al valore salvato in ogni snapshot.\n` +
    `L'exposure di ciascun punto determina la correzione per il periodo successivo.\n\n` +
    `USD exposure attuale: ${usdPctFormatted}%\n` +
    `Derivati esclusi, bond inclusi.`
  : 'Dati esposizione USD non disponibili.';
```

---

## Flusso di Calcolo

```text
Snapshot N         Snapshot N+1
     │                   │
     │   Equity Exp. N   │
     │   USD Exp. N      │
     │                   │
     └───── usati per ───┘
           calcolare il
         benchmark return
           da N a N+1
```

---

## File Coinvolti

| File | Modifiche |
|------|-----------|
| `supabase/migrations/*.sql` | Nuova colonna `usd_exposure_pct` |
| `src/types/historicalData.ts` | Aggiungere `usd_exposure_pct` |
| `src/hooks/useHistoricalData.ts` | Salvare `usd_exposure_pct` |
| `src/components/dashboard/HistoricalDataForm.tsx` | Input USD exposure + display |
| `src/hooks/useBenchmarkData.ts` | Usare USD exposure storica |
| `src/components/dashboard/charts/PerformanceEvolutionChart.tsx` | Tooltip dinamico |

---

## Default Value

Il default di `usd_exposure_pct` è **0.8 (80%)** basato sulla tipica composizione di portafoglio con prevalenza di asset in USD.

---

## Vantaggi

1. **Accuratezza storica**: La correzione valutaria riflette l'effettiva esposizione al momento
2. **Coerenza**: Stesso approccio dinamico usato per equity exposure
3. **Trasparenza**: L'utente vede e può modificare l'esposizione USD per ogni snapshot
