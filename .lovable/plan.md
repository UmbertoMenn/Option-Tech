# Cap rischio Covered Call / De-Risking CC quando la call è ITM

## Logica richiesta

Nelle holdings consolidate (vista azioni del Risk Analyzer), per ogni posizione azionaria coperta da una Covered Call o De-Risking Covered Call la cui **call venduta è ITM** (`strike_call < prezzo_attuale`), il rischio reale delle azioni coperte deve essere ridotto:

- **Covered Call ITM**: rischio per azione = `strike_call` (da strike a 0). Il tratto sopra lo strike non è rischio perché alla scadenza saremo assegnati a `strike_call`.
- **De-Risking Covered Call ITM**: rischio per azione = `strike_call − strike_protezione`. Il put protegge sotto `strike_protezione`, la call cappa sopra `strike_call`.

Comportamento attuale: il rischio delle azioni con CC/DR-CC è calcolato come pieno valore (`shares × current_price`) per la quota non protetta da long PUT — la presenza di una CC non viene mai considerata una riduzione di rischio.

## Modifiche

### 1. `src/lib/riskCalculator.ts` — `calculateStockRisk`

Estendere la firma per ricevere anche `coveredCalls` e `deRiskingCoveredCalls`:

```ts
export function calculateStockRisk(
  stocks: Position[],
  longPuts: LongPutPosition[],
  coveredCalls: CoveredCallPosition[],
  deRiskingCoveredCalls: DeRiskingCoveredCallPosition[],
  allPositions: Position[]
): StockRiskDetail[]
```

Per ogni stock, dopo aver calcolato `unprotectedShares` (cioè le azioni non coperte da long PUT), determinare quante di queste sono coperte da CC/DR-CC con call ITM:

1. Trovare tutte le CC matchate sullo stock (via `matchesUnderlying(cc.option, stock)`) dove `cc.option.strike_price < stock.current_price` (call ITM). Calcolare `ccCoveredShares = Σ contractsCovered × 100`, `ccStrikeWeighted` (media pesata sulle azioni coperte).
2. Trovare le DR-CC matchate dove la call è ITM. Per ciascuna prendere `strike_call − strike_put` (≥ 0) come "per-share risk", pesato sulle azioni coperte.
3. Le DR-CC hanno priorità sulle CC sullo stesso lotto (un'azione coperta da DR-CC non viene contata anche come CC).
4. Le azioni coperte da CC/DR-CC sono sottoinsieme delle `unprotectedShares` (quelle non già protette da long PUT). Cap totale: `min(ccCoveredShares + drccCoveredShares, unprotectedShares)`.

Nuova formula del rischio:

```text
risk = (fullyUnprotectedShares * currentPrice)            // né PUT né CC
     + (ccItmShares * strikeCall_avg)                     // capped a strike (CC ITM)
     + (drccItmShares * (strikeCall - strikePut)_avg)     // capped a spread (DR-CC ITM)
     + (longPutProtectedShares * max(0, currentPrice - strikePut))  // come oggi
```

Se la CC è OTM (`strike_call ≥ current_price`) il cap non si applica: rischio invariato (full stock value), come oggi.

### 2. `analyzePortfolioRisk`

Passare le nuove categorie a `calculateStockRisk`:

```ts
const stockDetails = calculateStockRisk(
  stocks, categories.longPuts,
  categories.coveredCalls, categories.deRiskingCoveredCalls,
  positions,
);
```

### 3. UI — `StockRiskDetail` e tooltip

- Aggiungere campi opzionali a `StockRiskDetail` per esporre il dettaglio cap CC/DR-CC nel tooltip della tabella holdings (es. `ccCappedShares`, `ccCapStrike`, `drccCappedShares`, `drccCapSpread`).
- Aggiornare il tooltip in `EquityExposureView` (e `HoldingBreakdownDialog` se mostra il breakdown) per descrivere:
  - "Coperte da CC ITM: N azioni @ strike X → rischio per azione X"
  - "Coperte da DR-CC ITM: N azioni @ (call X − put Y) → rischio per azione X−Y"

Nessuna modifica ai totali Naked Put / Leap Call / Strategy. Nessuna modifica a Dashboard, Derivatives, edge functions, schema DB.

## Validazione

- Stock senza CC/DR-CC → rischio invariato.
- Stock con CC OTM → rischio invariato.
- Stock con CC ITM coprente tutte le azioni → `risk = strike × shares`.
- Stock con CC ITM parziale (es. 200 azioni, 1 contratto) → 100 azioni @ strike + 100 azioni @ price.
- Stock con DR-CC ITM → `risk = (strike_call − strike_put) × shares_coperte`.
- Combinazione long PUT + CC ITM sullo stesso stock: PUT protegge prima, CC cap si applica solo alle azioni residue.
