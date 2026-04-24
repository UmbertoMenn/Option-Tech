

## Fix definitivo holdings consolidate: identità canonica del sottostante, non matching testuale fragile

### 1) Com’è costruita oggi la logica ticker e dove si rompe

Oggi ci sono **tre logiche diverse**, non una sola.

#### A. Matching strategie/stock in `src/lib/derivativeStrategies.ts`
Il motore strategie usa:
- `normalizeForMatching(...)`
- `getCanonicalKey(...)`
- `matchOptionToStocks(...)`

Input usati:
- `option.underlying`
- `option.description`
- `option.ticker`
- `stock.description`
- `stock.ticker`

Questa logica serve a capire **quale stock è collegato a una gamba derivata**, non a costruire la chiave definitiva delle holdings.

#### B. Estrazione `tickerKey` in `src/lib/riskCalculator.ts`
Poi il Risk Analyzer crea il `tickerKey` così:
- stock: `resolveTickerKey(stock.description, stock.ticker)`
- naked put / leap / strategy: `resolveTickerKey(underlying, option.ticker)`

Questa è già una prima incongruenza:
- per gli stock usa la coppia `description + ticker`
- per i derivati usa `underlying + option.ticker`
- per le strategie usa addirittura `firstOption.ticker` o il testo del gruppo

Quindi la **stessa azienda** può produrre chiavi diverse a seconda della sorgente.

#### C. Consolidamento finale in `src/lib/sectorExposure.ts`
`calculateConsolidatedTopHoldings(...)` aggrega per `tickerKey`.

Il problema quindi non è nel consolidamento finale in sé:
- se il `tickerKey` arriva giusto, il merge funziona
- se il `tickerKey` nasce diverso a monte, il consolidamento mostra duplicati

---

### 2) Perché Lululemon / LULU oggi fallisce

Il caso tipico è questo:

```text
Stock diretto:
  ticker = LULU
  description = LULULEMON ATHLETICA INC

Derivato / strategia:
  underlying = LULULEMON ATHLETICA
  option.ticker = null oppure simbolo contratto/non affidabile
```

Con il codice attuale:

1. `resolveTickerKey(...)` **non riusa** davvero la stessa logica forte di `derivativeStrategies`
2. il dizionario `COMPANY_NAME_TO_TICKER` è **incompleto**: LULULEMON non è mappato
3. il resolver si appoggia a volte a `option.ticker`, che per i derivati **non è una fonte affidabile del sottostante**
4. quando il nome non viene risolto, cade nel fallback:
   - stock → `LULU`
   - derivato → `NAME:LULULEMON ATHLETICA`
5. risultato: due holdings separate per la stessa società

Questa è la vera causa del bug.

---

### 3) Incongruenze reali nel codice attuale

#### Incongruenza 1 — motore strategie e motore holdings non condividono la stessa identità canonica
`matchOptionToStocks(...)` riesce magari a capire che una gamba appartiene a Lululemon, ma quella informazione **non viene propagata** come identità canonica fino alle holdings consolidate.

#### Incongruenza 2 — `option.ticker` viene trattato come se fosse il ticker del sottostante
Non è sempre vero:
- può essere nullo
- può essere sporco
- può essere il simbolo del contratto opzione
- può essere meno affidabile di `linkedStock` o di `underlying`

#### Incongruenza 3 — mappe alias sparse e non allineate
Esistono:
- `SPECIAL_ALIASES` in `derivativeStrategies.ts`
- `COMPANY_NAME_TO_TICKER` in `sectorExposure.ts`

Sono due fonti diverse, con copertura diversa, e infatti casi come **LULULEMON/LULU** possono rompersi.

#### Incongruenza 4 — le strategie prendono il ticker dalla gamba, non dall’identità del sottostante
Per `strategyDetails` oggi il `tickerKey` viene da:
- `ic.soldPut.ticker`
- `dd.soldPut.ticker`
- `firstOption.ticker`

Questo è fragile. La strategia dovrebbe derivare la sua identità dal **sottostante canonico risolto**, non dalla prima opzione disponibile.

#### Incongruenza 5 — test ancora ancorati a logica legacy
I test continuano a coprire molto `getHoldingKey / isSameHolding`, ma il runtime delle holdings oggi dipende soprattutto da `resolveTickerKey(...)`.
Quindi i test danno una falsa sensazione di copertura.

---

### 4) Soluzione robusta e definitiva

## Obiettivo
Creare una **singola pipeline canonica di identità del sottostante**, usata da:
- classificazione strategie
- risk calculator
- holdings consolidate
- GP holdings
- breakdown UI

Non più “matcher testuale da una parte + ticker resolver separato dall’altra”.

---

### A. Introdurre un resolver unico di identità

**Nuovo file:** `src/lib/tickerIdentity.ts`

Creare una funzione centrale, per esempio:

```ts
resolveUnderlyingIdentity({
  rawTicker,
  rawName,
  underlyingName,
  description,
  linkedStock,
  isin,
})
```

Output strutturato:

```ts
{
  tickerKey: string;        // es. "LULU"
  displayTicker: string|null;
  canonicalName: string;    // es. "LULULEMON ATHLETICA"
  source: 'linked_stock' | 'raw_ticker' | 'alias_map' | 'name_match' | 'fallback_name';
  confidence: 'high' | 'medium' | 'low';
}
```

#### Priorità del resolver
1. **`linkedStock`** se disponibile  
   È la fonte migliore: se il motore strategie ha già collegato la gamba allo stock corretto, quello deve vincere sempre.

2. **Ticker esplicito pulito**, solo se sembra davvero un ticker del sottostante  
   Non basta che sia valorizzato: va validato.

3. **Alias canonici / nome azienda normalizzato**  
   Usando una mappa unica centralizzata.

4. **Match esatto su nome normalizzato / token significativi**
   Mai substring permissive vaghe.

5. **Fallback deterministico**
   `NAME:...` solo come ultimissima spiaggia.

---

### B. Validare seriamente i ticker dei derivati

Nel resolver unico introdurre:
- `normalizeTickerCandidate(...)`
- `isLikelyUnderlyingTicker(...)`
- `isLikelyOptionContractSymbol(...)`

Regole:
- accettare ticker tipo `LULU`, `NVDA`, `ORCL`, `GOOGL`
- rimuovere prefissi/suffissi broker/exchange
- rifiutare ticker che sembrano simboli opzione / stringhe sporche
- non fidarsi di `option.ticker` se non supera i controlli

Così evitiamo che il campo ticker della gamba opzione inquini l’identità del sottostante.

---

### C. Unificare tutte le mappe alias in un solo posto

**Nuovo file condiviso oppure nel resolver unico**

Unificare:
- `SPECIAL_ALIASES`
- `COMPANY_NAME_TO_TICKER`

in una sola struttura, ad esempio:

```ts
CANONICAL_UNDERLYINGS = {
  LULU: ['LULU', 'LULULEMON', 'LULULEMON ATHLETICA', 'LULULEMON ATHLETICA INC'],
  GOOGL: ['GOOGL', 'GOOG', 'GOOGLE', 'ALPHABET', 'ALPHABET INC'],
  ORCL: ['ORACLE', 'ORCL', 'ORACLE CORP', 'ORACLE CORPORATION'],
  WDC: ['WDC', 'WESTERN DIGITAL', 'WESTERN DIGITAL CORP'],
  ...
}
```

Questo risolve subito il caso LULULEMON/LULU, ma soprattutto elimina la frammentazione logica.

Importante:
- matching per **frasi/token normalizzati**
- niente logiche `.includes()` troppo permissive
- preferenza per match esatto / token completo / alias canonico

---

### D. Propagare l’identità canonica dal motore strategie

**File:** `src/lib/derivativeStrategies.ts`

Estendere `ResolvedConfig` con metadati canonici:

```ts
underlyingIdentity?: {
  tickerKey: string;
  canonicalName: string;
  source: string;
}
```

Quando una config viene risolta:
- se esiste `linkedStock`, ricavare l’identità da quello
- altrimenti usare `config.underlying` + posizioni matchate

Così ogni strategia configurata produce **una sola identità sottostante canonica** già in fase di classificazione.

---

### E. Rifare `tickerKey` nel Risk Calculator usando solo il resolver unico

**File:** `src/lib/riskCalculator.ts`

Sostituire tutte le chiamate dirette a `resolveTickerKey(...)` con il nuovo resolver unico.

#### Regole per categoria
- **Stock**: usare `stock.ticker + stock.description + isin`
- **Naked Put / Leap**: usare `linked underlying identity` quando disponibile, altrimenti `underlying + description + validated option ticker`
- **Iron Condor / Double Diagonal / Other Strategy**:
  - prima scelta: identità del `linkedStock` / `resolvedConfig`
  - seconda scelta: underlying normalizzato
  - non usare più `firstOption.ticker` come fonte primaria

Questo è il punto chiave per evitare split tipo:
- stock = `LULU`
- strategia = `NAME:LULULEMON ATHLETICA`

---

### F. Fare convergere anche `calculateConsolidatedTopHoldings(...)` sul nuovo resolver

**File:** `src/lib/sectorExposure.ts`

`calculateConsolidatedTopHoldings(...)` continuerà ad aggregare per `tickerKey`, ma:
- il `tickerKey` dovrà arrivare solo dalla pipeline nuova
- `resolveTickerKey(...)` legacy va declassato o eliminato dal runtime
- `getHoldingKey / isSameHolding / normalizeHoldingName` vanno mantenuti solo se servono a test legacy, ma **non devono più essere una fonte logica parallela**

In pratica:
```text
classificazione -> identità canonica
risk details -> tickerKey canonico
holdings consolidate -> semplice merge per tickerKey
```

---

### G. Rendere il problema osservabile in UI/debug

**File:** `src/components/risk/HoldingBreakdownDialog.tsx`

Aggiungere, almeno in tooltip o in debug badge non invasivo:
- ticker canonico
- source di risoluzione (`linked_stock`, `alias_map`, `fallback_name`)

Così quando un caso futuro rompe, è immediatamente visibile se una holding è stata risolta:
- bene
- per alias
- con fallback debole

Questo accelera moltissimo il debug.

---

### H. Test seri end-to-end, non solo test legacy

**File:** `src/test/holdingMatching.test.ts`  
**Nuovo file consigliato:** `src/test/tickerIdentity.test.ts`

Casi obbligatori:

1. **LULULEMON / LULU**
   - stock `ticker=LULU`, description `LULULEMON ATHLETICA INC`
   - derivato `underlying=LULULEMON ATHLETICA`
   - risultato: unica holding `LULU`

2. **GOOGLE / ALPHABET / GOOG / GOOGL**
   - unica holding canonica

3. **ORACLE / ORCL**
   - unica holding canonica

4. **WESTERN DIGITAL / WDC**
   - unica holding canonica

5. **ticker sporco / broker prefix**
   - `AZ.LULU`, `LULU:US`, `LULU.US` → `LULU`

6. **option ticker non affidabile**
   - nome corretto del sottostante ma `option.ticker` sporco/null
   - deve comunque convergere su `LULU`

7. **fallback name**
   - solo se davvero impossibile risolvere ticker
   - deve produrre una sola chiave stabile, non duplicata

8. **strategy-based identity**
   - Iron Condor / Double Diagonal / Other Strategy devono usare il ticker del sottostante canonico, non quello della prima gamba

---

### 5) File da modificare

1. `src/lib/tickerIdentity.ts`  
   Nuovo resolver unico e condiviso dell’identità sottostante

2. `src/lib/derivativeStrategies.ts`  
   Esporre e propagare l’identità canonica nelle config risolte

3. `src/lib/riskCalculator.ts`  
   Tutti i `tickerKey` devono nascere dal resolver unico

4. `src/lib/sectorExposure.ts`  
   Consolidamento solo per chiave canonica; deprecazione runtime della logica legacy parallela

5. `src/components/risk/HoldingBreakdownDialog.tsx`  
   Diagnostica minima sulla fonte di risoluzione

6. `src/test/holdingMatching.test.ts`  
   Aggiornare i test reali sul runtime corrente

7. `src/test/tickerIdentity.test.ts`  
   Copertura unitaria dei casi alias/ticker sporchi/fallback

---

### 6) Risultato atteso

- **Lululemon athletica** e **LULU** finiscono sempre nella stessa holding
- le strategie derivate, gli stock diretti e le GP holdings condividono la **stessa identità canonica**
- non ci saranno più duplicati dovuti a:
  - nome esteso vs ticker
  - ticker sporco
  - opzione con `ticker` non affidabile
  - alias dispersi in file diversi
- il sistema resterà robusto anche per casi futuri, non solo per LULU

## Dettagli tecnici

```text
Pipeline nuova:

1. Resolve underlying identity once
   linkedStock > validated raw ticker > canonical alias/name match > NAME fallback

2. Attach identity to resolved strategy / risk details

3. Consolidate holdings only by canonical tickerKey

4. Expose resolution source for diagnostics
```

```text
Causa del bug LULU:
- motore strategie e motore holdings non condividono la stessa identità canonica
- alias map incompleta
- uso improprio di option.ticker
- fallback NAME:* che spezza il merge
```

