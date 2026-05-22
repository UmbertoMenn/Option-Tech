## Obiettivo

Riallineare il calcolo del rischio per le posizioni sintetiche (CC e DR-CC) alle regole stabilite, eliminando l'ambiguità attuale che usa formule diverse in base alla disponibilità dello spot.

## Regole finali

### CC sintetica con Long CALL ITM + Short CALL
- Se `spot > strike short call` (short ITM): `rischio = PMC long call × contratti × 100`
- Se `spot < strike short call` (short OTM): `rischio = prezzo mercato long call × contratti × 100`
- Se `spot` non disponibile: fallback al prezzo di mercato della long call (caso conservativo)

### CC sintetica con short PUT ITM
- `rischio = strike put venduta × |qty| × 100`

### DR-CC sintetica con Long CALL ITM + Short CALL
- Casistica eliminata: viene trattata come CC sintetica (regola sopra), ignorando l'eventuale protection put.

### DR-CC sintetica con short PUT ITM + protection put
- `rischio = (strike put venduta − strike put protezione) × contratti × 100`

Tutti i risultati sono divisi per `exchangeRate` per la conversione in EUR.

## Modifiche

### `src/lib/riskCalculator.ts` — `calculateSyntheticCcDrccRisk`

Ramo CC sintetica con `syntheticCall`:
- Usare `avg_cost` (PMC) quando `spot >= shortStrike`
- Usare `current_price` quando `spot < shortStrike`
- Fallback `current_price ?? avg_cost` se spot non risolvibile
- Aggiornare la stringa `composition` per riflettere quale prezzo è stato usato

Ramo CC sintetica con `syntheticPut`: invariato.

Ramo DR-CC sintetica con `syntheticCall`:
- Spostare la posizione nel ramo CC (non più DR-CC) applicando le stesse formule del ramo CC syntheticCall
- L'eventuale protection put viene ignorata ai fini del rischio; segnalata solo nella composition
- `syntheticType` torna `cc_call` (anche se la strategia in DB era DR-CC sintetica)

Ramo DR-CC sintetica con `syntheticPut`: invariato (`(synStrike − protStrike) × contracts × 100`).

Aggiornare i commenti del docblock con le nuove formule.

## Tecnica

- Lo `SpotResolver` resta necessario per distinguere il caso "short ITM" da "short OTM" nel ramo call-based.
- Nessuna modifica a `derivativeStrategies.ts`, UI, DB, currency/sector exposure: consumano solo `riskEUR` e `syntheticType`. Le DR-CC sintetiche call-based continueranno a esistere in `coveredCalls`/`deRiskingCoveredCalls` per la classificazione UI dei derivativi, ma il risk analyzer le tratterà come CC.
- Risultato atteso NEBIUS (Long CALL 60, Short CALL 150, spot ≈ NEBIUS attuale): se spot > 150 → `PMC_long × qty × 100`; se spot < 150 → `mkt_long × qty × 100`.

## File toccati

- `src/lib/riskCalculator.ts`

Nessuna modifica ad altri file.