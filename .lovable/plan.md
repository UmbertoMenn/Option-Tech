## Problema

Lo snapshot scrive `equity_exposure_pct = 40.3%` mentre il Risk Analyzer UI mostra **17.3% (protezioni incluse)**. Sono due formule diverse e il valore del Risk Analyzer è quello "vero" usato come riferimento.

### Cosa fa oggi lo snapshot (`src/lib/uploadSnapshot.ts`)
```
equity_exposure_pct = riskAnalysis.grandTotal / totalValue
```
- **Numeratore**: `grandTotal` puro (stock + ETF + commodity + naked put + leap call + strategie + sintetiche CC/DR-CC), **senza** azioni GP.
- **Denominatore**: `totalValue` (= posizioni snapshot non‑derivati + cash + GP).

### Cosa mostra il Risk Analyzer (`EquityExposureView.tsx` riga 531)
```
dynamicGrandTotal / portfolioNettingTotal
```
- **Numeratore** (`dynamicGrandTotal`, riga 294): `totalETFRisk + totalPureStockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk + displayedSyntheticCcDrccRisk + gpStockTotalValue` — quindi **include la quota stock delle GP** e usa stock al netto delle protezioni (toggle default = on).
- **Denominatore**: `portfolioNettingTotal` (= `totalValue + nettingResult.totalNetting` = `netting_total` salvato in `historical_data`), non `totalValue`.

Due differenze: GP stock nel numeratore + uso del netting al denominatore. Da qui la divergenza 17.3% vs 40.3%.

`useEquityExposurePct.ts` ha la stessa formula dello snapshot e quindi soffre dello stesso disallineamento ovunque venga letto in app.

## Obiettivo

Far sì che `equity_exposure_pct` (e `usd_exposure_pct`) scritti nello snapshot coincidano esattamente con il numero mostrato nel Risk Analyzer "Protezioni incluse" (default UI: tutti i toggle ON, GP incluso, protezioni applicate). Stesso allineamento per `useEquityExposurePct`, così benchmark e card mostrano lo stesso valore.

## Modifiche

### 1. `src/lib/uploadSnapshot.ts`
- Dopo `analyzePortfolioRisk`, calcolare `gpStockTotalValue`:
  - Query `gp_holdings` per `portfolio_id`, filtrare `asset_type = 'stock'`, sommare `market_value` (con stessa logica di allineamento temporale già usata per `gpTotalValue`).
- Calcolare `equityNumerator` come somma esattamente equivalente a `dynamicGrandTotal` con toggle default ON e protezioni incluse:
  ```
  numerator = totalETFRisk + totalPureStockRisk + totalCommodityRisk
            + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk
            + totalSyntheticCcDrccRisk + gpStockTotalValue
  ```
  (è equivalente a `grandTotal + gpStockTotalValue`, ma esplicito per chiarezza).
- Denominatore: usare `nettingTotal` (già calcolato sopra) al posto di `totalValue`:
  ```
  equityExposurePct = nettingTotal > 0
    ? clamp01(numerator / nettingTotal)
    : 0.6;
  ```
- `usdExposurePct`: rimane sulla stessa base (somma per valuta dei rischi). Nessuna modifica strutturale: la composizione per valuta non cambia se aggiungiamo le GP solo sul totale equity. Lasciato invariato in questo step.

### 2. `src/lib/stagingCalculator.ts`
Stessa formula applicata anche alla scrittura "live" in `portfolio_latest_values`, per coerenza con lo snapshot e con la UI.

### 3. `src/hooks/useEquityExposurePct.ts`
Allinearlo alla stessa formula del Risk Analyzer:
- Aggiungere `gpStockTotalValue` al numeratore (lettura da `useGPHoldings`, filtrando `asset_type='stock'`).
- Cambiare denominatore: prendere `nettingTotal` invece di `summary.totalValue`. Recuperarlo dal calcolo netting già esistente (`computeSinglePortfolioNetting`) oppure dal valore esposto nelle card. Per aggregato globale, sommare i netting per portafoglio.
- Toggle `includeNakedPut`, `includeStrategies`, `includeLeapCall` restano supportati per consumatori specifici, ma il default (tutti ON) deve produrre lo stesso numero del Risk Analyzer.

### 4. Snapshot già scritti (retroattivo, opzionale)
Per i portafogli già toccati (es. SilviaS), proporre uno script di ricalcolo che riscrive `equity_exposure_pct` / `usd_exposure_pct` su `historical_data` usando la nuova formula. Eseguito solo dopo conferma.

### 5. Niente cambi a netting, riskCalculator, currencyExposure
Le funzioni di calcolo sottostanti restano identiche. Cambia solo l'aggregazione finale che viene salvata.

## Verifica

- Dopo le modifiche, ricaricare il portafoglio di SilviaS e confrontare:
  - Risk Analyzer (default toggle, protezioni incluse) → es. 17.3%.
  - `historical_data.equity_exposure_pct` per la stessa data → deve coincidere (±0.1%).
- Verificare anche un portafoglio senza GP per assicurarsi che il numero non cambi rispetto al Risk Analyzer.

## Fuori scope (gestito in modifiche separate già discusse)

- Saltare la scrittura di `equity_exposure_pct` quando ci sono `strategy_configurations` da aggiornare (reconciliation pendente).
- Carry‑forward su NULL in `useBenchmarkData`.
- Pulizia retroattiva dei valori corrotti (4.3%, 2.6%, ...).

Questi tre punti verranno applicati nello stesso passaggio di build solo se confermati.
