## Obiettivo

Nella card "Evoluzione patrimonio alle scadenze" (Dashboard) i derivati devono:
1. Concorrere al **patrimonio totale** in modo coerente (MV iniziale + decadimento BS fino a scadenza, con gestione dell'esercizio se ITM).
2. Essere **inclusi nel toggle "Equity"**, perché tutti i derivati hanno sottostante azionario.

## Diagnosi

File chiave: `src/lib/portfolioProjection.ts`, `src/components/dashboard/PatrimonyProjectionCard.tsx`, `src/components/dashboard/DynamicPortfolioChart.tsx`, `src/hooks/usePortfolio.ts`.

Stato attuale:
- `summary.totalValue` (passato come `baseValue`) **esclude** i derivati (`usePortfolio.calculateSummary` salta `asset_type === 'derivative'`).
- `buildProjectionInputs` somma `derivMVT0` solo dentro `patrimonyT0` e `equityT0`, e nel grafico calcola il valore derivati con Black-Scholes lungo la timeline.
- A scadenza il derivato collassa all'intrinseco, ma **non viene modellato l'esercizio**: una covered call ITM resta come "−intrinseco" sul lato derivato e le azioni sottostanti restano comunque nel bucket equity (sopravvalutazione). Una short put ITM analogamente lascia equity invariato anziché materializzare un acquisto azionario al strike.
- Il toggle `equity` in teoria include i derivati (`equityT0 = equityFlat + derivMVT0`, `equitySleeve = equityFlat·shock + derivVal`), ma se nello snapshot percepito dall'utente i derivati sembrano "spariti" è perché:
  - per posizioni nette short OTM, `derivMVT0` è negativo e tende a 0 a scadenza → la linea sale, ma il valore iniziale appare ridotto rispetto al "valore assets" mostrato in Dashboard.
  - se manca il prezzo sottostante (`hasUnderlying=false`), il derivato resta piatto al MV iniziale per tutta la timeline → indistinguibile da "non incluso".

## Modifiche

### 1. `src/lib/portfolioProjection.ts`

- **Esercizio a scadenza** (`patrimonyAt`): quando `tp.date >= expiry`, per ciascuna gamba derivato con sottostante:
  - short call ITM (`S>K`, qty<0): aggiungere al bucket equity `qty·100·(K−S)/fx` (effetto consegna azioni al strike) e azzerare il contributo derivato.
  - long call ITM: simmetrico positivo.
  - short put ITM (`S<K`, qty<0): aggiungere `qty·100·(K−S)/fx` (acquisto azioni al strike: cash out già implicito nel valore intrinseco negativo).
  - long put ITM: simmetrico.
  - OTM: contributo derivato 0, equity invariato.
  
  Implementazione: separare `derivVal` in `derivVal` + `equityAdjustmentAtExpiry`, sommare quest'ultimo a `equitySleeve`.

- **Derivati senza prezzo sottostante**: invece di lasciarli piatti a `mvT0`, decadere linearmente verso 0 sulla loro `T0` (interpretazione conservativa: assenza di sottostante = no ITM rilevabile, premio temporale si estingue). Registrarli comunque in `derivsNoUnderlying` come warning.

- **Tracking diagnostica**: ritornare in `ProjectionInputs` un campo `derivMVT0` separato (somma assoluta dei MV derivati) per poter mostrare un badge informativo "include N derivati per €X".

### 2. `src/components/dashboard/PatrimonyProjectionCard.tsx`

- Mostrare nella sezione info, accanto ai badge bond, un badge **"N derivati"** con tooltip che elenca i sottostanti e il segno (long/short) — chiarisce visivamente che sono inclusi.
- Aggiornare la nota in fondo per esplicitare: "Le opzioni ITM a scadenza vengono esercitate: per le covered call le azioni vengono consegnate al strike, per le short put vengono acquistate al strike. Il toggle **Equity** comprende azioni, ETF e derivati (tutti su sottostante azionario)."
- Rinominare il toggle da `Equity` a `Equity (incl. derivati)` per evitare ambiguità.

### 3. Test

Aggiornare/integrare `src/test/portfolioProjection.test.ts`:
- Covered call OTM → a scadenza equityFlat invariato, derivVal=0, patrimonio = baseValue + premio incassato.
- Covered call ITM con S>K → equity ridotto di `(S−K)·qty·100`, derivVal=0.
- Short put ITM con S<K → equity aumentato (acquisto azioni) di `(K−S)·qty·100`.
- Toggle `equity` con sole opzioni (no azioni) → `equityT0 = derivMVT0`, sleeve evolve correttamente.

## Tecnico

- `ProjectionScope = 'equity'` continua a usare `equitySleeve` ma ora include anche `equityAdjustmentAtExpiry`.
- Nessuna modifica a `usePortfolio` o allo schema DB.
- Nessuna modifica a `Dashboard.tsx` oltre a verificare che `positions` includa effettivamente i derivati (già il caso).

## Non incluso

- Roll automatico dei derivati prima della scadenza.
- Riallocazione cash post-esercizio in altri asset (resta cash).
- Modifiche a Risk Analyzer / Stress Lab.
