

## Obiettivo
Correggere il benchmark in modo che venga **scalato usando la % di Equity Exposure reale**, esattamente come nel Risk Analyzer:

> **Equity exposure % = Esposizione equity totale (EUR) / Valore degli asset (EUR)**

Così il benchmark non dipende più da:
- il fallback fisso “60%” in vista base
- il rapporto `netting / total_value` (che non è equity exposure)

---

## Stato attuale (perché ora è “sbagliato”)
Nel file `src/hooks/useBenchmarkData.ts` oggi la funzione `getEquityExposure()`:
- in `viewMode === 'base'` ritorna **0.6 fisso**
- nelle viste netting usa **netting/base** (che misura l’effetto derivati sul valore, non l’esposizione equity)

Quindi il benchmark viene scalato con un numero che **non è la % di equity exposure**.

---

## Soluzione (allineamento 1:1 con Risk Analyzer)
### 1) Calcolare la % equity exposure usando la stessa logica del Risk Analyzer
Useremo le stesse funzioni/librerie già presenti:
- `categorizeDerivatives(...)`
- `analyzePortfolioRisk(...)`

e poi calcoleremo:

- **Esposizione equity totale (EUR)** = `analysis.totalStockRisk`  
  (include **stocks + ETF azionari**, già netti delle protezioni Long PUT sulle azioni singole, esattamente come Risk Analyzer)
- **Valore degli asset (EUR)** = `summary.totalValue` (da `usePortfolio()`; include cash, bond, stock, etf, commodity; esclude derivati come già fa la dashboard)

Quindi:
- `equityExposurePct = totalStockRisk / summary.totalValue`

Con clamp di sicurezza:
- se `summary.totalValue <= 0` → fallback (es. 0.6) + warning
- clamp tra `[0, 1]` per evitare valori fuori scala

Nota: questa è la % che l’utente ha indicato (“NEL RISK ANALYZER”).

---

### 2) Passare questa % al calcolo benchmark e usarla davvero
Modifiche previste in `src/hooks/useBenchmarkData.ts`:

- aggiungere un parametro opzionale:
  - `equityExposurePct?: number | null`
- eliminare l’uso di `getEquityExposure(entry, viewMode)` (o lasciarlo solo come fallback se equityExposurePct non è disponibile)
- cambiare la formula di `scaledReturn` in modo che usi la % reale:

**Nuova logica di scaling (chiara e numerica):**
- `equityReturn` = media di URTH/SPY/ACWI/EXSA.DE (come oggi)
- `bondReturn` = ritorno di AGG (già calcolabile perché oggi calcoli AGG per il “balanced”)
- `scaledReturn = equityExposurePct * equityReturn + (1 - equityExposurePct) * bondReturn`

Questo rispetta esattamente “usa la % di equity exposure” e rende il benchmark intuitivo:
- se equity exposure = 80% → benchmark è 80% equity + 20% bond
- se equity exposure = 30% → 30% equity + 70% bond

---

### 3) Calcolare la % equity exposure nel grafico Dashboard (senza prop drilling pesante)
Modifiche previste in `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`:

- prendere i dati necessari via hook (React Query cache condivisa, quindi costo marginale basso):
  - `usePortfolio()` per `positions` + `summary.totalValue`
  - `useDerivativeOverrides()` per `overrides` (per matchare Risk Analyzer)
- calcolare `equityExposurePct` con `useMemo()` chiamando:
  - `categorizeDerivatives(derivatives, positions, overrides)`
  - `analyzePortfolioRisk(positions, categories)`
- passare `equityExposurePct` a `useBenchmarkData(historicalData, viewMode, currentDate, equityExposurePct)`

In alternativa (più pulita e riusabile), creerò un hook dedicato:
- `src/hooks/useEquityExposurePct.ts`
che incapsula tutto e torna:
- `equityExposurePct`
- `equityExposureEUR`
- `assetsTotalEUR`
- `isLoading`

Poi `PerformanceEvolutionChart` userà solo quel hook e passerà la % a `useBenchmarkData`.

---

### 4) Tooltip benchmark: mostrare i numeri reali usati
Aggiornamento in `PerformanceEvolutionChart.tsx` (nel `CustomLegend`):

Nel tooltip del Benchmark aggiungeremo una sezione esplicita, per evitare ambiguità:

Esempio testo:
- **Equity exposure (Risk Analyzer): 62.4%**
- Calcolo: **Esposizione equity 521.000€ / Asset 835.000€**
- Benchmark: `62.4% × Equity(URTH/SPY/ACWI/EXSA.DE) + 37.6% × Bond(AGG)`

Così è verificabile “con numeri reali” e non sembra magia.

---

## Edge case importanti
- Se mancano `positions` o `summary` (prima del load):
  - il benchmark resta calcolabile ma userà un fallback (temporaneo) e mostrerà un warning nel tooltip (“equity exposure non disponibile”).
- Se AGG manca o è stale:
  - useremo solo equityReturn (o 0 per bondReturn) e segnaleremo data gap come già fai ora.

---

## File toccati
1) `src/hooks/useBenchmarkData.ts`
   - aggiunta parametro `equityExposurePct`
   - nuova formula `scaledReturn` basata su equity exposure %
   - rimozione/depoteziamento di `getEquityExposure()` e `selectBenchmarkWeight()`

2) `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`
   - calcolo equity exposure % (Risk Analyzer-like)
   - passaggio della % a `useBenchmarkData`
   - tooltip: mostrare “Equity exposure” + numeri (EUR e %)

3) (Opzionale ma consigliato) `src/hooks/useEquityExposurePct.ts`
   - hook riusabile per mantenere la stessa metrica in futuro anche altrove

---

## Test / Verifica (end-to-end)
1) Apri **Risk Analyzer** e annota:
   - Esposizione equity totale (EUR) / Valore asset (EUR) = X%
2) Torna in Dashboard → tooltip Benchmark:
   - deve mostrare **lo stesso X%** (tolleranza piccola per rounding)
3) Controlla che la linea benchmark cambi coerentemente:
   - se X% è basso, benchmark deve “muoversi” meno
4) Verifica che il refresh benchmark continui a funzionare.

