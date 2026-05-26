## Problema

In `src/lib/riskCalculator.ts` (Step 3, righe 315-329), il calcolo delle protezioni PUT su un titolo usa **due fonti**:

```ts
const classifiedPuts = longPuts.filter(...)           // PUT classificate come protezione
const additionalPuts = allBoughtPuts.filter(...)      // ⚠️ TUTTE le PUT comprate del titolo
```

Dove `allBoughtPuts = allPositions.filter(p => p.option_type==='put' && p.quantity>0)`. Questo significa che **qualsiasi** PUT comprata sul titolo (anche se gamba di Put Spread, Diagonal Put Spread, Iron Condor, Double Diagonal) viene contata come protezione del sottostante, abbattendo il rischio stock. Da qui il comportamento errato su NVIDIA.

Inoltre nel wizard di configurazione strategie (`StrategyConfigWizard.tsx`, riga 24) manca un'opzione esplicita per dichiarare una "Protezione pura (long PUT)" come strategia singola: oggi l'utente può farlo solo via override category `protection`, non via `strategy_configurations`.

## Specifica

Una PUT comprata viene trattata come "protezione del titolo" SOLO se appartiene a una di queste due categorie canoniche:

1. **DR-CC** (classica o sintetica) — `protectionPut` dentro `deRiskingCoveredCalls`
2. **Protezione pura** — long PUT esplicitamente classificata come tale (oggi: override `protection`; domani: anche strategia `protection` in `strategy_configurations`)

Tutte le altre PUT comprate (Put Spread, Diagonal Put Spread, Iron Condor, Double Diagonal, Altre Strategie generiche) **non** devono entrare nel calcolo della protezione né apparire come scudo nelle Holdings Consolidate.

## Architettura gerarchica (fonte unica)

```text
categorizeDerivatives() — UNICA classificatrice
├── deRiskingCoveredCalls[].protectionPut   → consumata da DR-CC step
└── longPuts[]                              → "protezione pura" (ex override 'protection'
                                              + nuova strategy_config 'protection')
                                              UNICA fonte per Step 3 protezioni stock

riskCalculator.calculateStockRisk()
├── Step 1: DR-CC (usa protectionPut interno)
├── Step 2: CC ITM cap
├── Step 3: protezioni = SOLO categories.longPuts (no più allBoughtPuts)
└── Step 4: shares scoperte
```

`allBoughtPuts` viene **rimosso** come fonte di protezione: la classificazione è già autoritativa.

## Modifiche

**1. `src/lib/riskCalculator.ts`** — `calculateStockRisk`
- Rimuovere `allBoughtPuts` e il blocco `additionalPuts` (righe 240-245, 323-325, 328, 337-339, 346-349).
- `protectionContracts = contractsFromClassified` (solo `classifiedPuts`).
- Le medie ponderate strike/prezzo usano solo `classifiedPuts`.
- DR-CC continua a funzionare via Step 1 (invariato).

**2. `src/lib/derivativeStrategies.ts`** — categorizzazione via config
- Aggiungere `case 'protection'` nello switch `config.strategy_type` (intorno alla riga 440, in linea con gli altri case):
  - Per ogni `matchedVirtual` con `option_type==='put' && quantity>0`, push in `longPuts` (stesso shape usato per override 'protection', righe 306-311).
  - Calcolare `isPartial` come nell'override (righe 290-303).
- Verificare che il fallback "isolated PUT cluster" (riga 749) e "fallback no strategy" (riga 913) restino invariati: queste sono già protezioni legittime.

**3. `src/components/derivatives/StrategyConfigWizard.tsx`** — UI selettore
- In `STRATEGY_OPTIONS` (riga 24-34) aggiungere:
  ```ts
  { value: 'protection', label: 'Protezione pura (long PUT)' }
  ```
- Posizione suggerita: dopo `derisking_covered_call` (semantica affine).

**4. `src/hooks/useStrategyConfigurations.ts`** — label
- In `STRATEGY_TYPE_LABELS` aggiungere `protection: 'Protezione pura (long PUT)'`.

**5. Nessuna modifica a `sectorExposure.ts` / `EquityExposureView.tsx`**
- Il flag `hasProtection` in `StockRiskDetail` diventa automaticamente coerente perché alimentato dai nuovi `classifiedPuts`.

## Cosa NON cambia

- DR-CC continua a proteggere il sottostante (Step 1).
- `strategy_configurations` resta single source of truth per i derivati.
- I calcoli su Iron Condor / Double Diagonal / Put Spread / Diagonal Put Spread restano invariati (le loro PUT vivono dentro la strategia, non come protezione separata).

## Verifica post-fix

- **NVIDIA**: il rischio stock NON deve essere abbattuto da PUT comprate appartenenti a put spread / diagonal / IC / DD. Lo scudo verde nelle Holdings Consolidate scompare se non esiste una vera protezione (DR-CC o `protection`).
- **CRDO/ASTS**: se l'utente configura la long PUT come `protection` (o se è già `protectionPut` di una DR-CC), continua a essere mostrata correttamente.
- Wizard: nuova voce "Protezione pura (long PUT)" selezionabile e salvabile in `strategy_configurations`.
