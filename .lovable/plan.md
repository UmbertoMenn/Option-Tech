

## Ristrutturazione regola di profitto: Rolling Dinamico e Rolling Statico

### Cosa cambia

La sezione "Se l'opzione venduta sta guadagnando" passa da due opzioni (Roll attivo / Aspetto scadenza) a due nuove opzioni: **Rolling Dinamico** e **Rolling Statico**. Entrambe condividono la stessa sotto-regola per la prima scadenza, ma differiscono nel comportamento su scadenze successive. Tutti i parametri USD diventano **percentuali sul prezzo del sottostante**.

### Nuova struttura ProfitRule

```text
ProfitRule {
  profitPct: number           // soglia guadagno (invariato)
  action: 'dynamic' | 'static'

  // Prima scadenza (comune a entrambi)
  firstExpiryMinDistancePct: number   // distanza min strike dal sottostante
  firstExpiryMinPremiumPct: number    // premio min come % del sottostante

  // Rolling Dinamico – scadenze successive
  dynamicAnnualizedPremiumPct: number // soglia premi annualizzati netti %
  dynamicMinDistancePct: number       // distanza min strike dal sottostante

  // Rolling Statico – scadenze successive  
  staticMinDistancePct: number        // distanza min strike dal sottostante
  staticMinPremiumPct: number         // premio netto min come % del sottostante
}
```

### Modifiche per file

**1. `src/lib/adjustmentRules.ts`**
- Sostituire `ProfitRule` con la nuova interfaccia (rimuovere `wait_and_sell`, `newCallBarrierPct`, `minPremiumUsd`, `rollDownMinPremiumUsd`)
- Aggiornare `getDefaultCoveredCallRules()` con valori di default ragionevoli

**2. `src/components/simulator/AdjustmentRuleEditor.tsx`**
- RadioGroup con due opzioni: "Rolling Dinamico" e "Rolling Statico"
- Parametri prima scadenza condivisi (mostrati sempre)
- Parametri scadenze successive condizionali in base alla scelta
- Rolling Dinamico: soglia premi annualizzati %, distanza min strike %
- Rolling Statico: distanza min %, premio netto min %

**3. `src/lib/backtestEngine.ts`**
- `executeProfitRule`: 
  - **Prima scadenza** (comune): roll down su strike più basso stessa scadenza se premio netto ≥ `firstExpiryMinPremiumPct`% di S e distanza min `firstExpiryMinDistancePct`%
  - **Scadenze successive – Dinamico**: calcolo premi netti annualizzati (lookback max 1 anno dall'adjustment log); se guadagno > soglia % E premi annualizzati > soglia %, rollo indietro sulla prima scadenza disponibile anche in perdita, con distanza min strike
  - **Scadenze successive – Statico**: cerca scadenza più vicina con distanza min % e premio netto ≥ `staticMinPremiumPct`% di S (logica simile all'attuale ma con % invece di USD)
- Per il calcolo annualizzato nel Dinamico: somma dei premi netti incassati nell'ultimo anno / prezzo medio sottostante, annualizzato
- Rimuovere il branch `wait_and_sell` da `executeProfitRule` e da `sellNewCallAfterExpiry`
- In `sellNewCallAfterExpiry`: usare sempre `approachRule.rollUpMinDistancePct` come barriera (non c'è più `wait_and_sell`)

