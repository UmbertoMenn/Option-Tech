

## Fix: De-Risking Covered Call trattate come Covered Call nel Risk Analyzer

### Causa radice del 659K

Il config `derisking_covered_call` di SilviaS ha `quantity_abs` implicito = 1 per ogni firma. Ma molte posizioni hanno qty > 1 (es. NVIDIA CALL 185 qty=-2). Il config consuma 1 contratto, l'altro resta **orfano** → step 6.5 lo mette in `groupedOtherStrategies` → `calculateStrategyRisk` calcola il max loss → 659K.

Inoltre, la protezione put delle de-risking CC deve essere utilizzata come protezione stock, identicamente alle covered call normali.

### Logica corretta

Per il Risk Analyzer, le de-risking covered calls = covered calls:
- **Stock risk**: il rischio è `qty × price`, ridotto dalla protezione put (il bought put della de-risking CC). Già funziona tramite scan di `allBoughtPuts` in `calculateStockRisk`.
- **Strategy risk**: ZERO da de-risking CC. Le sold call sono coperture (cap al rialzo), non rischio aggiuntivo.
- **Orphan sold calls**: se un underlying ha già una covered call O de-risking CC, le sold call orfane sullo stesso underlying sono semplicemente covered call aggiuntive → rischio ZERO.

### Fix (1 file)

**`src/lib/riskCalculator.ts`** — funzione `calculateStrategyRisk`:

1. Riceve `categories` completo (già lo riceve)
2. Costruisce un `Set<string>` di underlying coperti: quelli presenti in `coveredCalls` o `deRiskingCoveredCalls`
3. Filtra `groupedOtherStrategies`: se TUTTE le opzioni del gruppo sono sold calls su un underlying coperto, skip (rischio = 0, è una covered call extra)
4. Per i gruppi misti, rimuove solo le sold calls coperte prima di calcolare il max loss

```text
coveredUnderlyings = Set of normalized underlyings from:
  - categories.coveredCalls[].option.underlying
  - categories.deRiskingCoveredCalls[].coveredCall.option.underlying

Per ogni groupedOtherStrategy:
  Se underlying è in coveredUnderlyings:
    → filtra le sold calls (sono covered)
    → se restano altre gambe, calcola max loss solo su quelle
    → se non restano gambe, skip intero gruppo
```

### Risultato atteso
- SilviaS: strategy risk = ~0 (tutte le sue strategie sono de-risking CC, le orphan calls sono covered)
- Stock risk: invariato (protezione put già trovata tramite scan allPositions)
- Nessun impatto su utenti senza de-risking CC

