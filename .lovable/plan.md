

## Fix Holding Consolidate: aggregazione per TICKER

### Problema attuale

`calculateConsolidatedTopHoldings` in `src/lib/sectorExposure.ts` aggrega per **descrizione testuale** tramite `getHoldingKey()` + stopwords + alias. Risultato:
- doppie posizioni per lo stesso titolo (es. "AZ.NVIDIA CORP" vs "NVIDIA" vs "NVDA" non sempre matchano)
- alcune posizioni mancano perché finiscono in chiavi diverse
- la fallback per nomi senza token significativi crea ulteriori duplicati nella `holdingsByExactName`

I dati sorgente (`StockRiskDetail`, `NakedPutRiskDetail`, `LeapCallRiskDetail`, `StrategyRiskDetail`) **già contengono** il campo `underlying` o un ticker risolvibile, ma il consolidamento ignora questa informazione e usa solo il testo libero.

### Soluzione: chiave canonica = TICKER

#### A. Estendere i RiskDetail con `tickerKey`

**File:** `src/lib/riskCalculator.ts`

Per ogni dettaglio prodotto (`stockDetails`, `nakedPutDetails`, `leapCallDetails`, `strategyDetails`) aggiungere un campo `tickerKey: string` calcolato in modo deterministico:

1. Per **stock**: usa `stock.ticker` se presente, altrimenti risolvi via `resolveUnderlyingTicker(underlying, ISIN)` (sistema già presente in `tech/market-data/ticker-resolution-system`)
2. Per **opzioni** (naked put, leap call, strategy): usa il ticker risolto dal sottostante via `resolveUnderlyingTicker(underlying)` o, se l'opzione ha già un `ticker` cleaned (es. "NVDA"), preferiscilo
3. Normalizzazione finale: uppercase, trim, rimozione suffissi `.MI`, `.DE`, `:US`, ecc.
4. Fallback: se nessun ticker risolvibile → `tickerKey = NORMALIZED_NAME` (così le aggregazioni residue mantengono comunque coerenza)

#### B. Riscrivere `calculateConsolidatedTopHoldings` per usare `tickerKey`

**File:** `src/lib/sectorExposure.ts`

Sostituire `holdingsByKey` + `holdingsByExactName` + `getHoldingKey` + `normalizeHoldingName` con un singolo `Map<tickerKey, ConsolidatedHoldingWithDetails>`.

```text
per ogni stock/np/leap/strategy:
  key = detail.tickerKey   // già pronto
  holding = map.get(key) || createHolding(displayName)
  // accumula stockRisk / nakedPutRisk / leapCallRisk / strategyRisk
  // preferisci come displayName la versione più pulita (ticker se nome troppo lungo)
```

Per i **GP holdings** (stock GP): risolvi anch'essi via `resolveUnderlyingTicker(description, ticker_code)` per allinearli alle stesse chiavi.

#### C. Display name canonico

Mantenere un campo `ticker` esplicito su `ConsolidatedHoldingWithDetails` e mostrarlo nella UI (`EquityExposureView.tsx`) accanto al nome esteso, formato:
```
NVDA — NVIDIA Corp
```
Così l'utente vede subito che il consolidamento ha funzionato.

#### D. Rimuovere logica obsoleta

- `getHoldingKey`, `isSameHolding`, `CORPORATE_STOPWORDS`, `SPECIAL_ALIASES` (per holdings) → marcate `@deprecated` ma mantenute solo per back-compat dei test esistenti
- Aggiornare i test in `src/test/holdingMatching.test.ts` per riflettere il nuovo schema basato su ticker (es. `tickerKey: 'BABA'` per tutte le varianti ALIBABA)

### File da modificare

1. `src/lib/riskCalculator.ts` — aggiungere `tickerKey` a tutti i RiskDetail
2. `src/lib/sectorExposure.ts` — riscrivere `calculateConsolidatedTopHoldings` per chiave-ticker
3. `src/components/risk/EquityExposureView.tsx` — mostrare `ticker — name`
4. `src/components/risk/HoldingBreakdownDialog.tsx` — header dialog con ticker
5. `src/test/holdingMatching.test.ts` — aggiornare assertion ai nuovi key ticker

### Risultato atteso

- **Una sola riga per NVIDIA** anche con descrizioni miste ("AZ.NVIDIA CORP", "NVIDIA", opzioni con underlying "NVDA")
- **Una sola riga per ALPHABET/GOOGLE** unificata via ticker risolto (`GOOGL` o `GOOG`)
- **Una sola riga per ALIBABA** anche con prefissi italiani
- Posizioni che prima sparivano (perché finivano in chiavi diverse) ora compaiono raggruppate correttamente
- Holding consolidate finalmente coerenti con ciò che si vede nelle altre sezioni del Risk Analyzer

### Dettagli tecnici

```text
Sorgente unica della chiave: ticker risolto via
  resolveUnderlyingTicker(underlying, isin?) -> "NVDA" | "BABA" | ...

Aggregazione:
  Map<tickerKey, ConsolidatedHolding>
  no più stopwords, no più jaccard, no più alias map

Display:
  ticker (chiave) + name (descrizione più pulita disponibile)
```

