# Risk Analyzer: valorizzazione CC/DR-CC sintetiche

## Stato attuale (bug)
Le posizioni `coveredCalls` con `isSynthetic=true` e `deRiskingCoveredCalls` con `isSynthetic=true` non hanno un sottostante reale (no stock/ETF), quindi `calculateStockRisk()` non le itera mai e contribuiscono **0** al `grandTotal` del Risk Analyzer.

## Verifica preliminare wizard (+CALL ITM / -CALL come DR-CC sintetica)
Verificato in `StrategyConfigWizard.tsx`:
- Il dropdown `STRATEGY_OPTIONS` include "De-Risking Covered Call" → l'utente può selezionarla manualmente.
- Il checkbox "Sintetica" è disponibile ogni volta che `strategyType === 'derisking_covered_call'` (riga 1072 / 1105).
- Il collector salva sia `protectionPut` sia `syntheticCall`/`syntheticPut`, quindi la configurazione persiste correttamente.

**Bug collaterale trovato in `derivativeStrategies.ts` (case `derisking_covered_call`, riga 508-529):** quando una config DR-CC sintetica contiene solo `+CALL ITM` e `-CALL` (nessuna `protection put`), il codice entra nel ramo `else if (config.is_synthetic && (syntheticPut || syntheticCall))` e finisce in `coveredCalls.push(...)` invece che in `deRiskingCoveredCalls`. Va corretto in modo che, se la config dell'utente è esplicitamente `derisking_covered_call`, la posizione resti classificata come DR-CC sintetica anche senza protection put (con `protectionPut = undefined`). Serve quindi rendere `protectionPut` opzionale nella `DeRiskingCoveredCallPosition` e gestire l'assenza nelle UI esistenti (Derivatives.tsx già mostra il dettaglio della call sintetica; verificare che non assuma sempre `protectionPut` definito).

## Modifiche

### 1. `src/lib/derivativeStrategies.ts`
- Rendere `protectionPut?: Position` opzionale in `DeRiskingCoveredCallPosition`.
- Nel `case 'derisking_covered_call'`: se `config.is_synthetic` e `syntheticCall` (o `syntheticPut`) presente ma `protectionPut` assente → push in `deRiskingCoveredCalls` con `protectionPut: undefined`, **non** in `coveredCalls`.

### 2. `src/lib/riskCalculator.ts`
Aggiungere nuova funzione `calculateSyntheticCcDrccRisk(coveredCalls, deRiskingCoveredCalls)` che ritorna entries compatibili con `StockRiskDetail` (così appaiono naturalmente nella vista Equity Exposure e nei totali) con flag `isSynthetic: true`.

Formule (per ciascuna posizione, in valuta originale, poi /exchangeRate):
- **CC sintetica con `syntheticPut`** (sold PUT deep ITM):
  `risk = strike_put × |qty_put| × 100`
- **CC sintetica con `syntheticCall`** (bought CALL deep ITM):
  `risk = current_price_call × qty_call × 100` (market value)
- **DR-CC sintetica con `syntheticPut`** + `protectionPut`:
  `risk = (strike_syntheticPut − strike_protectionPut) × contracts × 100`
- **DR-CC sintetica con `syntheticCall`** (con o senza protectionPut):
  `risk = current_price_syntheticCall × qty_syntheticCall × 100`

Filtrare CC dal calcolo se la stessa option_id appartiene già a una DR-CC (evitare doppio conteggio, come già fatto in `calculateStockRisk`).

In `analyzePortfolioRisk`: chiamare la nuova funzione, fare push delle entries in `stockDetails` (o concatenare a un nuovo campo `syntheticDetails` poi mergiato), e includere il loro `riskEUR` in `totalStockRisk` e `grandTotal`.

### 3. `src/pages/Derivatives.tsx`
- Permettere il rendering di una DR-CC sintetica senza `protectionPut` (controllare che le 4 occorrenze del box dettaglio non assumano `protectionPut` sempre definito).

### 4. `src/components/risk/EquityExposureView.tsx`
- Marcare visivamente le entry sintetiche (badge "Sintetica") nella tabella Equity, riusando il flag `isSynthetic` aggiunto in `StockRiskDetail`.

## Cosa NON si tocca
- `useDerivativeNetting.ts` (già gestisce correttamente CC/DR-CC sintetiche).
- Wizard di configurazione (già supporta tutti i casi richiesti).
- DB / edge functions / monitoring.
