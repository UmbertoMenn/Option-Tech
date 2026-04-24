## Fix residuo holdings: ticker europei/HK e mappa canonica completa

### Diagnosi

Ho ispezionato il DB e trovato esattamente le posizioni che oggi cadono nel fallback `NAME:...` e mostrano la descrizione completa al posto del ticker:

```
description                | ticker
---------------------------|----------
DIR-TELECOM ITALIA SPA     | NULL
MERCEDES-BENZ GROUP AG     | NULL
FORTINET INC               | NULL
AZ.FORTINET INC            | NULL
STELLANTIS                 | NULL
DEUTSCHE POST AG           | NULL
AZ.PDD HOLDINGS INC        | 9PDA.SG
AZ.BYD CO LTD              | 1211.HK
```

### Cause reali

1. **`CANONICAL_UNDERLYINGS` incompleta** in `src/lib/tickerIdentity.ts`: mancano FORTINET, STELLANTIS, MERCEDES, DEUTSCHE POST, TELECOM ITALIA, FERRARI, BYD, ecc. La vecchia `COMPANY_NAME_TO_TICKER` in `sectorExposure.ts` (legacy) aveva FORTINET ma non veniva più usata dal nuovo resolver.
2. **Ticker numerici/exchange-suffix** (`1211.HK`, `9PDA.SG`, `RACE.MI`) falliscono `isLikelyUnderlyingTicker` (regex `^[A-Z][A-Z0-9]{0,5}$`) → vanno in fallback.
3. **`normalizeTickerCandidate` taglia a `.`** quindi `1211.HK` → `1211`, che resta non valido come ticker US.

### Soluzione

#### A. `src/lib/tickerIdentity.ts`
- **Estendere `CANONICAL_UNDERLYINGS`** con tutte le voci mancanti recuperate dalla legacy map (FTNT, CRWD, ZS, NET, SNOW, DDOG, MDB, DOCU, TWLO, OKTA, U, DNN, NXE) + nuove voci europee/HK (RACE, STLA, MBG, DPW, SAP, TIT, ISP, UCG, G, BYD).
- **Aggiungere `EXCHANGE_TICKER_TO_CANONICAL`**: lookup diretto per ticker grezzi tipo `1211.HK→BYD`, `9PDA.SG→PDD`, `RACE.MI→RACE`, `STLA.MI→STLA`, `MBG.DE→MBG`, ecc.
- **`resolveUnderlyingIdentity`**: prima di passare a `normalizeTickerCandidate`, controllare il `rawTicker` originale (uppercase) contro `EXCHANGE_TICKER_TO_CANONICAL`. Se match → ritorna identità con confidence `high`, source `alias_map`.

#### B. `src/lib/sectorExposure.ts`
- **Rimuovere** `COMPANY_NAME_TO_TICKER` (ora ridondante e fonte di confusione). Le aziende mancanti vengono migrate sopra.
- Mantenere solo il mapping `STOCK_SECTORS` (per i settori, non per i ticker).

#### C. `src/components/risk/EquityExposureView.tsx`
- **Fallback display**: se `holding.ticker` è null, mostrare comunque il primo token significativo della description (es. `MERCEDES — Mercedes-Benz Group AG`) marcato in modo discreto come "presunto" (testo muted invece di primary), così l'utente non vede mai una riga "nuda".

#### D. `src/test/tickerIdentity.test.ts`
- Aggiungere casi: `1211.HK→BYD`, `9PDA.SG→PDD`, `RACE.MI→RACE`, `MERCEDES-BENZ GROUP AG→MBG`, `FORTINET INC→FTNT`, `AZ.FORTINET INC→FTNT`, `STELLANTIS→STLA`, `DEUTSCHE POST AG→DPW`, `DIR-TELECOM ITALIA SPA→TIT`.

### File modificati
1. `src/lib/tickerIdentity.ts` — estensione mappa + EXCHANGE_TICKER_TO_CANONICAL + lookup prioritario.
2. `src/lib/sectorExposure.ts` — rimozione `COMPANY_NAME_TO_TICKER` legacy.
3. `src/components/risk/EquityExposureView.tsx` — fallback display token.
4. `src/test/tickerIdentity.test.ts` — nuovi casi europei/HK.

### Risultato atteso

- FORTINET, MERCEDES, STELLANTIS, DEUTSCHE POST, TELECOM ITALIA, BYD, PDD via 9PDA.SG → tutti consolidati su ticker canonico.
- Nessuna holding mostrerà più solo la descrizione: o c'è il ticker canonico, o c'è il primo token come presunto.
- Coerenza totale tra strategie derivati, risk calculator e holdings consolidate.