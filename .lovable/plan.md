

## Problema reale: falsa protezione PUT 260 su MARA

### Diagnosi

Nel portafoglio di MAURO G.:
- **Stock**: `MARA HOLDINGS INC` (300 azioni)
- **PUT strike 260**: `Crowdstrike Holdings Inc PUT 260 MAY/26` (bought, qty=1)

La funzione `matchesUnderlying` in `riskCalculator.ts` (step 4, token matching) associa erroneamente la PUT Crowdstrike a MARA perché:

```text
Stock tokens:  ["mara", "holdings", "inc"]   (3 tokens)
Option tokens: ["crowdstrike", "holdings", "inc", ...]
Match count:   2 ("holdings", "inc")
Threshold:     ceil(3/2) = 2
Risultato:     2 >= 2 → TRUE (FALSO POSITIVO!)
```

I token "holdings" e "inc" sono parole generiche corporate che compaiono in centinaia di nomi di società. Il matching le considera significative, ma non lo sono.

**NON c'entra nulla Marathon Petroleum** — il bug è nel token matching che usa stopword generiche come token validi.

### Fix

**File: `src/lib/riskCalculator.ts`** — funzione `matchesUnderlying`, step 4 (righe 154-164)

Aggiungere un filtro per escludere corporate stopwords dal token matching, identico a quanto già fatto in `sectorExposure.ts`:

```typescript
const CORPORATE_STOPWORDS = new Set([
  'group', 'holding', 'holdings', 'company', 'companies', 'corp', 
  'corporation', 'limited', 'ltd', 'inc', 'incorporated', 'plc', 
  'ag', 'sa', 'spa', 'nv', 'bv', 'se', 'the'
]);

// Step 4: Token-based matching (filter stopwords)
const optionTokens = optionText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
const stockTokens = stockText.split(' ').filter(t => t.length > 2 && !CORPORATE_STOPWORDS.has(t));
```

Con il fix:
- Stock tokens filtrati: `["mara"]` (1 token)
- Option tokens filtrati: `["crowdstrike"]`
- Match count: 0 → **FALSE** ✓

Lo stesso fix va applicato anche in `derivativeStrategies.ts` se esiste token matching analogo nella funzione `findUnderlyingStock` / `matchOptionToStocks`.

### File da modificare
- `src/lib/riskCalculator.ts` — aggiungere CORPORATE_STOPWORDS e filtrare nello step 4

