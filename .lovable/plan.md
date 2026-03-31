
Diagnosi reale dal codice

- `src/lib/derivativeStrategies.ts`: oggi le configurazioni strategia non hanno davvero l’ultima parola. Prima vengono applicati i `single overrides` (`protection`, `covered_call`, ecc.), poi le `strategy_configurations`. Se sulla PUT BAIDU esiste un override storico a `protection`, quella PUT entra subito in `longPuts` e viene marcata come usata; la DRCC salvata non la può più assorbire. Questo spiega perché i fix precedenti sul ramo strict non hanno chiuso il bug.
- `src/hooks/usePortfolio.ts`: dopo ogni upload gli override vengono rimappati sulle nuove posizioni, quindi un override sbagliato può sopravvivere all’infinito e continuare a sabotare BAIDU.
- `src/components/derivatives/StrategyReconciliationDialog.tsx`: il flusso di riconciliazione non usa `linked_stock_slot_ids`; ripristina e salva solo `linked_stock_id`. Se salvi da lì, perdi gli slot reali e quando riapri “Riconfigura strategie” i titoli tornano disponibili fuori dalle CC/DRCC.
- `src/lib/derivativeStrategies.ts`: resta anche una piccola incoerenza nel matching strict/orphans (`Step 6.5` usa ancora solo `normalizeForMatching`), da allineare per eliminare ogni fuga residua.

Implementazione definitiva

1. Rendere la configurazione manuale prioritaria sugli override singoli
   - In `categorizeDerivatives`, determinare prima quali posizioni sono coperte da `strategyConfigs` tramite matching strict per sottostante + firme.
   - Gli override singoli su quelle posizioni devono essere ignorati, oppure applicati solo ai residui non configurati.
   - Effetto: una PUT inclusa in una DRCC salvata non potrà più finire in Protezioni/Long Put per colpa di un override storico.

2. Ripulire gli override confliggenti quando salvo una configurazione
   - Introdurre in `src/pages/Derivatives.tsx` un handler centrale per il salvataggio configurazioni.
   - Questo handler dovrà:
     - salvare le `strategy_configurations`
     - eliminare i `single overrides` riferiti alle gambe derivate incluse nelle configurazioni appena salvate
   - Così il problema non ritorna al prossimo upload/rimappaggio.

3. Chiudere il path strict in `src/lib/derivativeStrategies.ts`
   - Usare un unico helper `underlyingKey = getCanonicalKey(...) || normalizeForMatching(...)` in:
     - filtro iniziale dei `remaining`
     - strict guard
     - Step 6.5 orphan cleanup
   - Nei rami `covered_call` e `derisking_covered_call` usare solo le gambe `filterBySignatures(...)`, marcarle subito come usate e non lasciare competere euristiche parallele.

4. Sistemare definitivamente gli slot stock anche nella riconciliazione
   - `src/components/derivatives/StrategyReconciliationDialog.tsx` deve essere allineato al wizard:
     - restore di tutti gli slot salvati in `linked_stock_slot_ids`
     - save di tutti gli slot con suffisso `__slot_n`
     - fallback legacy da `linked_stock_id` solo se l’array è vuoto
   - Aggiornare anche il tipo locale `WizardStrategy` e il payload usato nel save.

5. Riallineare i dettagli secondari
   - Rimuovere il trattamento `etf` residuo dalla riconciliazione per essere coerenti col wizard già corretto.
   - Preservare `linked_stock_slot_ids` anche quando la riconciliazione mantiene configurazioni non toccate.

6. Regressioni da aggiungere
   - Test unitario su `categorizeDerivatives`: config BAIDU `derisking_covered_call` + override storico `protection` sulla stessa PUT => la PUT deve stare solo in `deRiskingCoveredCalls`, mai in `longPuts`.
   - Test sul matching strict con canonical key/alias.
   - Test logico su wizard/riconciliazione: save + reopen con più stock slots => gli stessi slot restano assegnati e non tornano nel pool disponibile.

File da toccare

- `src/lib/derivativeStrategies.ts`
- `src/pages/Derivatives.tsx`
- `src/hooks/useDerivativeOverrides.ts`
- `src/components/derivatives/StrategyConfigWizard.tsx`
- `src/components/derivatives/StrategyReconciliationDialog.tsx`
- `src/test/...`

Note tecniche

- Non serve una nuova migrazione: `linked_stock_slot_ids` esiste già in tabella.
- Non vanno toccati i file auto-generati dell’integrazione backend.
- Questa correzione attacca le due cause strutturali viste nel codice reale:
  - priorità sbagliata tra override singoli e configurazioni strategia
  - perdita degli slot stock nel flusso di riconciliazione
