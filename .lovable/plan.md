## Verifica approfondita: sì, ci sono ancora bug residui nella risoluzione ticker delle holdings consolidate

Ho controllato il codice attuale e anche i dati reali dell’utente Mauro G. Il problema che segnali è reale: **Celestica, Constellation Energy, AppLovin e Redditi INC stanno ancora finendo nel fallback `NAME:`**, quindi la UI mostra la descrizione completa invece del ticker.

### Cosa ho verificato

#### 1. Nei dati reali di Mauro G questi sottostanti esistono solo come derivati, senza ticker valorizzato
Dalle posizioni del portfolio risultano righe come:
- `Celestica Inc` con `ticker = null`
- `Constellation Energy Corporation` con `ticker = null`
- `AppLovin Corp` con `ticker = null`
- `Redditi INC` con `ticker = null`

Quindi, per questi casi, il sistema **non può appoggiarsi al raw ticker della posizione** e deve necessariamente risolvere dal nome.

#### 2. Nel backend esistono già mapping corretti per questi nomi
In `underlying_mappings` ci sono già mapping validi:
- `Celestica Inc -> CLS`
- `Constellation Energy Corporation -> CEG`
- `AppLovin Corp -> APP`
- `Redditi INC -> RDDT`

Quindi il problema **non è che il ticker non esiste nel backend**.

#### 3. Il resolver canonico attuale NON usa `underlying_mappings`
In `src/lib/tickerIdentity.ts`, `resolveUnderlyingIdentity(...)` oggi usa solo:
1. `linkedStock`
2. `rawTicker`
3. alias statici in `CANONICAL_UNDERLYINGS`
4. fallback `NAME:...`

Non interroga né riceve:
- `underlying_mappings`
- `useUnderlyingPrices`
- una cache centralizzata dei mapping backend

Quindi, se il nome non è presente nella mappa hardcoded, cade nel fallback.

#### 4. I casi che segnali sono proprio fuori dalla mappa statica
Nel file `src/lib/tickerIdentity.ts` attuale **non vedo alias canonici** per:
- `Celestica / CLS`
- `Constellation Energy / CEG`
- `AppLovin / APP`
- `Reddit / RDDT`

Per questo oggi il resolver non riesce a trasformarli in ticker.

#### 5. La UI conferma il fallback, non un semplice problema di render
In `EquityExposureView.tsx`, quando `holding.ticker` è `null`, la UI:
- prova a mostrare un “presumed ticker” derivato dal primo token del nome
- se non riesce, mostra direttamente la descrizione

In `HoldingBreakdownDialog.tsx` inoltre compare il badge `fallback name` quando `tickerKey` inizia con `NAME:`.

Quindi non è solo un problema estetico: **la holding è davvero arrivata senza ticker canonico**.

### Perché succede ancora

Perché oggi convivono due sistemi:

```text
Backend / prezzi / monitoraggio:
  usa underlying_mappings + prezzi sottostanti

Holdings consolidate / risk analyzer:
  usa resolver statico locale (tickerIdentity.ts)
```

Questa è l’incongruenza principale.

Finché il Risk Analyzer si appoggia a una mappa hardcoded separata, continueranno a comparire casi non coperti appena entra un nome nuovo o leggermente diverso.

## Soluzione definitiva proposta

### Obiettivo
Far sì che la risoluzione ticker delle holdings consolidate usi una **sorgente canonica dinamica**, non solo alias hardcoded.

### A. Unificare la risoluzione ticker con i mapping backend

**File:** `src/lib/tickerIdentity.ts`

Estendere il resolver per accettare una mappa opzionale di override dinamici:

```ts
resolveUnderlyingIdentity(input, options?: {
  dynamicMappings?: Record<string, string>
})
```

Ordine di priorità nuovo:
1. `linkedStock`
2. `rawTicker` valido
3. `dynamicMappings` (derivati da `underlying_mappings`)
4. alias statici `CANONICAL_UNDERLYINGS`
5. fallback `NAME:`

Così:
- `Constellation Energy Corporation` → `CEG`
- `AppLovin Corp` → `APP`
- `Celestica Inc` → `CLS`
- `Redditi INC` → `RDDT`

anche se non esistono nella mappa hardcoded.

### B. Costruire una mappa dinamica nel Risk Analyzer

**File:** `src/components/risk/EquityExposureView.tsx` oppure hook dedicato

Usare i mapping già disponibili nel backend (`underlying_mappings`) per costruire una mappa:

```text
normalized underlying -> ticker
```

poi passarla a `calculateConsolidatedTopHoldings(...)`.

### C. Far ricevere i dynamic mappings al consolidamento

**File:** `src/lib/sectorExposure.ts`

Estendere `calculateConsolidatedTopHoldings(...)` con un parametro opzionale:

```ts
calculateConsolidatedTopHoldings(
  analysis,
  etfAllocations,
  options,
  limit,
  gpStockHoldings,
  dynamicMappings?
)
```

Per ogni holding che oggi usa `tickerKey` già precomputato, se il dettaglio arriva ancora in fallback `NAME:`, tentare una **seconda canonizzazione** con `dynamicMappings` prima di creare la riga finale.

Questo è importante perché:
- stock/NP/LEAP/strategy potrebbero aver generato `tickerKey` troppo presto
- il consolidamento è l’ultimo punto utile per correggere i fallback residui

### D. Allineare anche il Risk Calculator

**File:** `src/lib/riskCalculator.ts`

Dove oggi viene chiamato `resolveUnderlyingIdentity(...)`, prevedere il passaggio della mappa dinamica, così i `tickerKey` nascono già corretti a monte.

Questo evita che una stessa società produca:
- una voce `NAME:CONSTELLATION ENERGY CORPORATION`
- una voce `CEG`

in punti diversi del flusso.

### E. Tenere la mappa statica come fallback, non come sorgente primaria

La mappa hardcoded resta utile per:
- mega-cap frequenti
- alias noti
- casi offline

ma non deve più essere l’unica fonte.

### F. Aggiungere test reali per i casi Mauro G

**File:** `src/test/tickerIdentity.test.ts`

Aggiungere test specifici per:
- `Celestica Inc -> CLS`
- `Constellation Energy Corporation -> CEG`
- `AppLovin Corp -> APP`
- `Redditi INC -> RDDT`

sia in modalità:
- alias statico assente
- mapping dinamico presente

### G. Diagnostica più esplicita nella UI

**File:** `src/components/risk/HoldingBreakdownDialog.tsx`

Quando una holding è ancora `NAME:...`, mostrare anche la causa:
- `fallback name`
- `nessun mapping dinamico trovato`

Così i casi residui diventano immediatamente auditabili.

## File da modificare

1. `src/lib/tickerIdentity.ts`
   - supporto a `dynamicMappings`
   - priorità dinamica prima degli alias statici

2. `src/lib/riskCalculator.ts`
   - passare la mappa dinamica quando crea `tickerKey`

3. `src/lib/sectorExposure.ts`
   - seconda canonizzazione dei fallback `NAME:` nel consolidamento
   - supporto parametro `dynamicMappings`

4. `src/components/risk/EquityExposureView.tsx`
   - caricare/derivare i mapping backend e passarli al consolidamento

5. `src/components/risk/HoldingBreakdownDialog.tsx`
   - diagnostica fallback più chiara

6. `src/test/tickerIdentity.test.ts`
   - aggiungere casi Celestica / CEG / APP / RDDT

## Risultato atteso

- nelle holdings consolidate non vedrai più:
  - `Celestica Inc`
  - `Constellation Energy Corporation`
  - `AppLovin Corp`
  - `Redditi INC`
  come voci “senza ticker”
- vedrai invece:
  - `CLS — Celestica Inc`
  - `CEG — Constellation Energy Corporation`
  - `APP — AppLovin Corp`
  - `RDDT — Redditi INC`
- il sistema diventa robusto anche per nuovi sottostanti futuri già presenti nei mapping backend, senza dover aggiornare a mano la mappa statica ogni volta

## Dettagli tecnici

```text
Problema attuale:
positions -> riskCalculator -> resolveUnderlyingIdentity(static aliases only)
         -> fallback NAME:* -> holdings consolidate senza ticker

Pipeline corretta:
positions -> dynamic underlying_mappings + static aliases
         -> resolveUnderlyingIdentity(dynamic first)
         -> canonical tickerKey
         -> holdings consolidate con ticker sempre mostrabile
```

```text
Bug confermati:
- il resolver canonico non usa underlying_mappings
- la mappa hardcoded non copre Celestica / CEG / APP / RDDT
- la UI mostra descrizione completa perché riceve davvero holding.ticker = null
```