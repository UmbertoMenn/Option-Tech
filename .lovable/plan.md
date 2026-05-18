## Problema

L'utente `maurog` ha 4 strategie CC/DR-CC sintetiche configurate (APPLE +CALL150/-CALL315, GOOGLE +CALL180/-CALL385, Broadcom +CALL150/-CALL420 e ALIBABA DR-CC con +CALL/-CALL/-PUT/+PUT) ma non le vede correttamente nel Risk Analyzer.

La causa è che la logica delle sintetiche (`calculateSyntheticCcDrccRisk`) produce entries in `stockDetails` con `stockValue = 0`, `stockQuantity = 0`, `stockPrice = 0` e solo `riskEUR` valorizzato. Tre viste downstream del Risk Analyzer ignorano `riskEUR` e usano invece `stockValue / exchangeRate` (che vale 0 per le sintetiche), facendole sparire.

## Bug trovati

### 1. `src/lib/sectorExposure.ts` → Sector Allocation (sempre)
Riga 471: `grossValueEUR = stock.stockValue / stock.exchangeRate` = 0 per sintetiche. Le sintetiche **non compaiono mai** nel sector breakdown.

### 2. `src/lib/sectorExposure.ts` → Top Holdings (con toggle "Includi protezioni" OFF)
Riga 978-985: `stockRisk` viene calcolato come `stockValue/exchangeRate` = 0. Con il toggle protezioni OFF (riga 1117-1119), `totalExposure` usa `stockRisk` → 0 → la holding sintetica viene filtrata via dal `filter(h => h.totalExposure > 0)`.

### 3. `src/lib/currencyExposure.ts` → Currency Exposure (sempre)
Righe 113/117/124: usa `stock.stockValue` = 0 per sintetiche. Le sintetiche **non contribuiscono** al rischio per valuta.

### 4. `src/components/risk/EquityExposureView.tsx` → Dettaglio Stocks (cosmetico)
Riga 172-174: ordinamento per `stockValue / exchangeRate` = 0 → le sintetiche finiscono in fondo alla lista, poco visibili. La voce appare correttamente ma è "nascosta" tra molti elementi.

### 5. `src/components/risk/HoldingBreakdownDialog.tsx` → Breakdown dialog (cosmetico)
Riga ~88: mostra "0 azioni @ USD 0.00" per le sintetiche dentro la sezione "Stock Diretto", senza distinguerle.

## Modifiche

### 1. `src/lib/sectorExposure.ts` — `calculateSectorAllocation`
Nel loop `for (const stock of analysis.stockDetails)` (riga 462+), per le entry con `stock.isSynthetic === true`:
- usare `valueEUR = stock.riskEUR` invece di `stockValue/exchangeRate`
- saltare la branch ETF (le sintetiche non sono mai ETF) e assegnarle al settore via `sectorMappings` (per ticker) o `getStockSector(stock.underlying)`
- pushare nell'array `instruments` con la stessa forma usata per gli stock (categoria `stocks`, `isETF: false`)

### 2. `src/lib/sectorExposure.ts` — `calculateConsolidatedTopHoldings`
Nel loop "Direct stock risk" (riga 972-997), per `stock.isSynthetic === true`:
- forzare `stockRisk += stock.riskEUR` (oltre a `stockRiskWithProtection += stock.riskEUR`) così la holding sopravvive anche con il toggle protezioni OFF
- skippare il push in `stockDetails` (sarà gestito da una entry dedicata) oppure pushare una entry con `isSynthetic: true` aggiunto allo schema `stockDetails` per consentire al dialog di mostrarla in modo distinto (vedi punto 5)

### 3. `src/lib/currencyExposure.ts`
Nel loop `for (const stock of analysis.stockDetails)` (riga 108+), per `stock.isSynthetic === true`:
- usare `stock.riskEUR * stock.exchangeRate` come `riskOriginal` (per coerenza in valuta originale)
- usare `stock.riskEUR` come EUR equivalente

### 4. `src/components/risk/EquityExposureView.tsx`
Modificare `sortedPureStockDetails` (riga 171-175): chiave di ordinamento usa `riskEUR` quando `stockValue === 0` (sintetiche), altrimenti `stockValue / exchangeRate`. Mantiene l'ordine attuale per gli stock reali e fa risalire le sintetiche tra le posizioni di pari rischio.

### 5. `src/components/risk/HoldingBreakdownDialog.tsx`
Estendere lo schema `holding.stockDetails` con un flag `isSynthetic?: boolean` (popolato dal punto 2) e nel rendering della sezione "Stock Diretto" (riga ~85-110):
- se `stock.isSynthetic`: sostituire la riga "X azioni @ Y" con "Posizione Sintetica CC/DR-CC" e nascondere il rigo del prezzo
- mantenere il valore a destra (`riskEUR`)

## Cosa NON si tocca

- `riskCalculator.ts` / `derivativeStrategies.ts`: la logica di calcolo è già corretta, le sintetiche entrano in `stockDetails` con `isSynthetic: true` e `riskEUR` valorizzato.
- Wizard, netting (`useDerivativeNetting.ts`), monitoring, alert, DB, edge functions.
- `grandTotal` e `totalPureStockRisk` in `riskCalculator.ts`: già sommano correttamente le sintetiche.
