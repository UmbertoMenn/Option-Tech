## Obiettivo
Semplificare e rendere coerente la classificazione strategie: ammettere strategie multi-gamba **incomplete** (con flag "gambe mancanti"), bloccare nel wizard solo le incompatibilità logiche reali, rinominare la categoria "Call da rivendere" e correggere il calcolo includendo le componenti sintetiche (Long Call ITM, Short Put ITM) di CC e DR-CC.

---

## 1. Wizard — Blocchi solo per incompatibilità logiche

**File:** `src/components/derivatives/StrategyConfigWizard.tsx`

Aggiungere una funzione `isCategoryCompatible(category, legs)` che valida le sole incompatibilità logiche (non blocca strategie incomplete):

| Categoria | Vincolo |
|---|---|
| `naked_put` | solo `option_type='put'` con `quantity<0`; **nessuna call** |
| `leap_call` | solo `option_type='call'` con `quantity>0`; **nessuna put** |
| `covered_call` / `de_risking_cc` | deve contenere almeno una call OR una componente sintetica (long call / short put); ammesso senza la sold call (incompleta) |
| `iron_condor` / `double_diagonal` / `other` | qualunque mix di call+put ammesso (anche incompleto) |

- Disabilitare nel selettore di categoria le opzioni incompatibili (con tooltip "Incompatibile: contiene PUT" ecc.).
- Bloccare il **Salva** se la combinazione è incompatibile, con messaggio chiaro.
- Mantenere `detectStrategyType` come suggerimento iniziale.

---

## 2. Categorizer — Ammettere strategie multi-gamba incomplete

**File:** `src/lib/derivativeStrategies.ts` (sezione configOnly Step 0.5, righe ~552-585)

Attualmente Iron Condor e Double Diagonal **vengono droppati** se manca anche una sola gamba (signature non matchata). Va modificato:

- Rimuovere il check `if (sc.length > 0 && bc.length > 0 && sp.length > 0 && bp.length > 0)`.
- Pushare sempre la posizione in `ironCondors` / `doubleDiagonals` con campi `soldPut/boughtPut/soldCall/boughtCall` **opzionali** (possibly null).
- Aggiungere ai tipi `IronCondorPosition` e `DoubleDiagonalPosition` un campo:
  ```ts
  missingLegs?: Array<'soldPut' | 'boughtPut' | 'soldCall' | 'boughtCall'>;
  isIncomplete?: boolean;
  ```
- Calcolare `missingLegs` confrontando con le 4 gambe attese; settare `isIncomplete = missingLegs.length > 0`.
- Per i campi opzionali rendere nullable: cambiare `soldPut: Position` → `soldPut: Position | null` (idem altre 3).
- Stesso trattamento per le multi-gamba in `groupedOtherStrategies` (Short Strangle, Put Spread, ecc. con qualche gamba mancante).

**Covered Call sintetica incompleta** (es. solo Long Call senza Call venduta):
- Step 0.5 covered_call attualmente richiede `Math.abs(call.quantity)` (la sold call). Estendere: se manca la sold call ma è presente almeno una componente sintetica (long call o short put), pushare comunque con `isIncomplete=true`, `missingLegs=['soldCall']`, `contractsCovered=0`.
- Aggiungere `isIncomplete?: boolean` e `missingLegs?: string[]` a `CoveredCallPosition` e `DeRiskingCoveredCallPosition`.

---

## 3. Render strategie incomplete + nuova sezione "Posizioni da monitorare"

**File:** `src/lib/monitoringEngine.ts`

- Aggiungere al `MonitoringResult` un nuovo campo:
  ```ts
  incompleteMultiLegStrategies: Array<{
    ticker: string;
    strategyName: string;        // "Iron Condor", "Double Diagonal", "Covered Call", ...
    missingLegs: string[];        // labels leggibili: "Short Call", "Long Put", ...
  }>;
  ```
- Funzione `computeIncompleteMultiLeg(categories)` che attraversa `ironCondors`, `doubleDiagonals`, `coveredCalls`, `deRiskingCoveredCalls`, `groupedOtherStrategies` e raccoglie quelle con `isIncomplete=true`.

**File:** `src/components/derivatives/DerivativesSummaryCard.tsx`

- Aggiungere una nuova `<CompactSection>` **"Strategie incomplete"** (badge arancio "MANCA GAMBA"), che elenca `ticker — Strategia (manca: Short Call)`.
- Posizione consigliata: prima di "Call da rivendere".

**File:** `src/pages/Derivatives.tsx` (sezioni IC, DD, CC, DR-CC, Other)

- Renderizzare le strategie incomplete nella loro card normale, con badge "INCOMPLETA" e indicazione delle gambe mancanti accanto al ticker.
- Gestire i campi null/optional nelle gambe (skip riga gamba se mancante o mostrare "—").

---

## 4. Rinomina + correzione calcolo "Call da rivendere"

### Rinomina
- `src/components/derivatives/DerivativesSummaryCard.tsx:330` → titolo "**COVERED CALL / D-R CC DA RIVENDERE**".
- `src/lib/monitoringEngine.ts` `buildSnapshotSections` → cambia title `'Call da rivendere'` → `'Covered Call / D-R CC da rivendere'`.
- `supabase/functions/daily-briefing/index.ts` se referenzia la stringa, aggiornare.

### Correzione formula in `computeAvailableCalls`

Formula nuova:
```
potential = floor(owned / 100)
          + long_calls_in_synthetic_CC
          + long_calls_in_synthetic_DR_CC
          + short_puts_ITM_in_synthetic_CC
          + short_puts_ITM_in_synthetic_DR_CC
available = potential - sold_calls_totali
```

Implementazione:
- Aggiungere `categories: DerivativeCategories` alla firma di `computeAvailableCalls` (già esiste `categories` in `computeMonitoring`, passarlo).
- Iterare `categories.coveredCalls` + `categories.deRiskingCoveredCalls` filtrando `cc.isSynthetic === true`:
  - Se `cc.syntheticCall` presente → sommare `|syntheticCall.quantity|` al `syntheticCovered` del relativo underlying.
  - Se `cc.syntheticPut` presente → sommare `|syntheticPut.quantity|` al `syntheticCovered`.
  - Per DR-CC: stessa cosa su `dr.coveredCall.syntheticCall` / `dr.coveredCall.syntheticPut`.
- Mappare l'underlying col solito `resolveKey(cc.option.underlying, underlyingPrices)`.
- Conteggio finale:
  ```ts
  potential = Math.floor(owned/100) + syntheticCovered;
  available = potential - soldCalls;
  ```
- Continuare a filtrare gli archived underlyings come oggi.

### Coerenza
Verificare che `computeUncoveredCalls` (già usa `syntheticCovered`) resti coerente: la stessa Long Call ITM **non** deve essere contata anche come "long call che offset una short call" via `netSoldCalls -= bought`. Già oggi `computeUncoveredCalls` decrementa `netSoldCalls` per ogni long call: se la stessa long call è anche `syntheticCall` di una CC, otteniamo doppio conteggio. **Fix:** in `computeUncoveredCalls`, escludere dal decremento `netSoldCalls` le long calls che sono già `syntheticCall` di una CC/DR-CC sintetica (raccogliere gli `id` in un Set prima del loop).

---

## File toccati
1. `src/components/derivatives/StrategyConfigWizard.tsx` — validazione incompatibilità
2. `src/lib/derivativeStrategies.ts` — tipi nullable + `isIncomplete`/`missingLegs`; rimozione drop in configOnly per IC/DD/CC; supporto CC sintetica incompleta
3. `src/lib/monitoringEngine.ts` — nuova sezione `incompleteMultiLegStrategies`, fix `computeAvailableCalls` + dedup synthetic in `computeUncoveredCalls`
4. `src/components/derivatives/DerivativesSummaryCard.tsx` — render nuova sezione + rinomina titolo
5. `src/pages/Derivatives.tsx` — badge "INCOMPLETA" e gestione gambe null nelle card IC/DD/CC/DR-CC/Other
6. `supabase/functions/daily-briefing/index.ts` — eventuale rinomina sezione nel briefing

Nessuna modifica DB.

## Non-goals
- Non si modificano gli override `single` (rimangono con le 5 categorie attuali).
- Non si tocca lo Step 1-7 di auto-classificazione (solo configOnly Step 0.5).
- Nessuna logica nuova per le strategie complete: solo quelle incomplete cambiano comportamento.