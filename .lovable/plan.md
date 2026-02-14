
## Fix: Benchmark non rispecchia i pesi storici

### Problemi identificati

**Bug 1: `equity_exposure_pct = 0` trattato come "non impostato"**

In `useBenchmarkData.ts`, linee 330 e 341:
```text
const equityPct = historicalEquityPct && historicalEquityPct > 0
  ? historicalEquityPct
  : (equityExposurePct ?? 0.6);
```
Siccome `0` e' falsy in JavaScript, un portafoglio con 0% equity (tutti bond) usa il fallback (esposizione live attuale) invece di 0%. Stesso problema per `usd_exposure_pct`.

**Bug 2 (principale): Calcolo matematicamente scorretto dei rendimenti pesati**

Il codice attuale calcola il rendimento cumulativo di equity e bond DAL PRIMO punto, poi applica il peso del punto corrente a quel rendimento cumulativo totale:

```text
equityReturn = (prezzo_attuale - prezzo_base) / prezzo_base  // cumulativo da inizio
scaledReturn = peso_equity_punto_N × equityReturn_cumulativo  // SBAGLIATO
```

Questo significa che modificare il peso equity di un punto storico non produce l'effetto corretto, perche' lo stesso rendimento cumulativo viene semplicemente ri-pesato. Il benchmark non rispecchia la reale evoluzione dei pesi nel tempo.

**Calcolo corretto** (composizione periodo per periodo):

```text
Per ogni periodo [N → N+1]:
  rendimento_equity_periodo = (prezzo_equity_N+1 - prezzo_equity_N) / prezzo_equity_N
  rendimento_bond_periodo = (prezzo_bond_N+1 - prezzo_bond_N) / prezzo_bond_N
  rendimento_pesato_periodo = peso_equity_N × eq_periodo + (1-peso_N) × bond_periodo
  (+ aggiustamento valutario per il periodo)

Composizione:
  valore_cumulativo = valore_cumulativo × (1 + rendimento_pesato_periodo)
  rendimento_cumulativo% = (valore_cumulativo - 1) × 100
```

### Soluzione

**File: `src/hooks/useBenchmarkData.ts`**

1. Correggere i check per `equity_exposure_pct` e `usd_exposure_pct`:
   - Sostituire `historicalEquityPct && historicalEquityPct > 0` con `historicalEquityPct != null && historicalEquityPct >= 0`
   - Applicare in 4 punti: linee 330, 341, 419, 429

2. Riscrivere il calcolo dei rendimenti nella sezione `sortedHistory.forEach` (linee 266-367):
   - Per ogni periodo tra due snapshot consecutivi, calcolare il rendimento di equity e bond per quel singolo periodo
   - Usare `getClosestPrice` per ottenere i prezzi ad entrambe le estremita del periodo
   - Applicare il peso equity del punto iniziale del periodo
   - Comporre i rendimenti moltiplicativamente
   - Applicare l'aggiustamento valutario per-periodo (variazione EUR/USD nel periodo, pesata per l'esposizione USD del periodo)

3. Riscrivere la sezione del punto corrente (linee 370-454):
   - Calcolare il rendimento del periodo dall'ultimo snapshot al punto corrente
   - Comporre con il rendimento cumulativo calcolato fino all'ultimo snapshot
   - Usare l'esposizione equity/USD dell'ultimo snapshot

4. Mantenere invariata l'interfaccia di ritorno (`equityReturn`, `bondReturn`, `scaledReturn`, `eurusdVariation`, `equityPctUsed`, `usdPctUsed`) per compatibilita con il tooltip del grafico.

### Dettaglio tecnico della nuova logica

```text
// Struttura del loop principale
let cumulativeFactor = 1.0;  // Parte da 1 (= 0% rendimento)

sortedHistory.forEach((entry, index) => {
  if (index === 0) {
    returns.push({ date, scaledReturn: 0, ... });
    return;
  }

  const prevEntry = sortedHistory[index - 1];
  const prevDate = prevEntry.snapshot_date;
  const currDate = entry.snapshot_date;

  // Rendimenti di PERIODO (non cumulativi)
  const equityPeriodReturns = EQUITY_BENCHMARKS.map(ticker => {
    const prevPrice = getClosestPrice(ticker, prevDate).price;
    const currPrice = getClosestPrice(ticker, currDate).price;
    return (currPrice - prevPrice) / prevPrice;
  });
  const avgEquityPeriodReturn = media(equityPeriodReturns);

  const bondPrevPrice = getClosestPrice('AGG', prevDate).price;
  const bondCurrPrice = getClosestPrice('AGG', currDate).price;
  const bondPeriodReturn = (bondCurrPrice - bondPrevPrice) / bondPrevPrice;

  // Peso dal punto PRECEDENTE
  const equityPct = prevEntry.equity_exposure_pct (con fallback corretto);

  // Rendimento pesato del periodo
  let periodReturn = equityPct * avgEquityPeriodReturn + (1 - equityPct) * bondPeriodReturn;

  // Aggiustamento valutario per-periodo
  if (currencyAdjusted) {
    const usdPct = prevEntry.usd_exposure_pct (con fallback corretto);
    const eurusdPrev = getClosestPrice('EURUSD=X', prevDate).price;
    const eurusdCurr = getClosestPrice('EURUSD=X', currDate).price;
    const eurusdPeriodVariation = (eurusdCurr / eurusdPrev) - 1;
    periodReturn = periodReturn - usdPct * eurusdPeriodVariation;
  }

  // Composizione moltiplicativa
  cumulativeFactor *= (1 + periodReturn);
  const scaledReturn = (cumulativeFactor - 1) * 100;

  returns.push({ date: currDate, scaledReturn, equityPctUsed: equityPct, ... });
});
```

### Impatto

- Il benchmark riflette correttamente l'evoluzione storica dei pesi equity/bond/USD
- Modificare i pesi nello storico dati produce un aggiornamento immediato e visibile del benchmark
- I tooltip continuano a mostrare la scomposizione trasparente (equity return, bond return, peso usato, variazione EUR/USD)

### File da modificare

| File | Modifica |
|---|---|
| `src/hooks/useBenchmarkData.ts` | Fix fallback `0`, riscrittura calcolo con composizione per-periodo |
