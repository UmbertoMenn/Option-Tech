
## Obiettivo

Introdurre **`call_spread`** come categoria di prima classe (allo stesso livello di `put_spread` / `diagonal_put_spread`), con riconoscimento automatico, scelta nel wizard, e — quando una gamba manca — comparsa nella sezione "Strategie incomplete" della card di monitoraggio.

## Definizione

Una **Call Spread** è composta da **1 Long Call + 1 Short Call** sullo stesso sottostante, **stessa scadenza**. Se le scadenze differiscono → resta classificata come `diagonal_call_spread` (variante orizzontale, gestita come "Altre Strategie", coerente con la logica `put_spread` ≠ `diagonal_put_spread`).

Sia bull (long strike < short strike) che bear (long strike > short strike) ricadono nella stessa categoria `call_spread`; la differenza bull/bear continua a essere mostrata da `detectStrategyName`.

## Modifiche

### 1. `src/components/derivatives/StrategyConfigWizard.tsx`

- **`STRATEGY_OPTIONS`**: nuova voce `{ value: 'call_spread', label: 'Call Spread' }` (e `diagonal_call_spread` come opzione separata per simmetria con i put spread).
- **`detectStrategyType`**: prima dei rami CC/DR-CC, riconoscere il pattern "1+ Long Call & 1+ Short Call, niente put, niente stock" — se tutte le call hanno la stessa scadenza → `call_spread`, altrimenti `diagonal_call_spread`. Va posizionato **dopo** il check IC/DD e **prima** del check CC per evitare conflitti.
- **`isCategoryCompatible`**: aggiungere un case `call_spread` (e `diagonal_call_spread`) che rifiuta PUT nelle gambe. Le gambe mancanti restano ammesse (no blocco wizard).

### 2. `src/lib/derivativeStrategies.ts`

- Estendere il `switch (config.strategy_type)` (intorno a riga 540-700, dove vivono i case `iron_condor` / `double_diagonal`) con un nuovo `case 'call_spread'`:
  - Se `longCall.length >= 1 && shortCall.length >= 1` → crea entry in `groupedOtherStrategies` (riusando lo stesso shape già usato per `put_spread`) con `strategyName: detectStrategyName(...)` così la UI mostra "Bull/Bear Call Spread".
  - Se manca una gamba (solo long o solo short) → push in `incompleteStrategies` con `strategyType: 'call_spread'` e `missingLegs: ['Short Call']` o `['Long Call']`.
- `case 'diagonal_call_spread'` resta gestito dal ramo `default` (come già accade per `diagonal_put_spread`).
- Aggiornare la label map `STRATEGY_LABELS` in `computeIncompleteMultiLeg` (`monitoringEngine.ts`) con `call_spread: 'Call Spread'`.

### 3. `src/lib/monitoringEngine.ts`

- Estendere `STRATEGY_LABELS` in `computeIncompleteMultiLeg` con `call_spread: 'Call Spread'` (la pipeline esistente fa già il resto: l'entry incomplete viene mostrata in "Strategie incomplete" della `DerivativesSummaryCard`).
- **Nessun impatto** su `computeAvailableCalls`: le short call di una Call Spread sono già conteggiate via `allPositions` (RAW), e la long call della spread **non** è una copertura sintetica del sottostante (non sostituisce 100 azioni come la CC sintetica ITM), quindi NON va sommata a `syntheticCovered`.

### 4. `src/lib/monitoringEngine.ts` — Call non coperte

Verificare `computeUncoveredCalls`: le long call di una Call Spread oggi entrano nel calcolo come "bought call che offset le sold". Questo è corretto perché entrambe le gambe sono dello stesso sottostante: lo spread non lascia esposizione netta di call vendute. Nessuna modifica.

## Note tecniche

- **Compatibilità retroattiva**: configurazioni esistenti salvate come `other` con due call (bull/bear spread) continuano a funzionare via `detectStrategyName`. Solo nuove config o riclassificazioni manuali useranno il nuovo `call_spread`.
- **Iron Condor**: il check IC in `detectStrategyType` (richiede call + put) ha priorità, quindi non c'è ambiguità.
- **LEAP Call**: il check LEAP (`boughtCalls > 0 && soldCalls === 0`) resta valido — non viene toccato perché la Call Spread richiede entrambe.

## File toccati

- `src/components/derivatives/StrategyConfigWizard.tsx` — opzione select, `detectStrategyType`, `isCategoryCompatible`.
- `src/lib/derivativeStrategies.ts` — nuovo `case 'call_spread'` nel categorizer config-driven.
- `src/lib/monitoringEngine.ts` — label "Call Spread" in `STRATEGY_LABELS`.
