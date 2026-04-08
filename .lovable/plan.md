
Problema reale che ho verificato

- Nel backend GOOGLE è già salvato come 3 configurazioni distinte. Quindi il salvataggio non è più il punto che collassa i record.
- Il collasso avviene dopo la lettura: la pagina Derivati, il wizard e la riconciliazione non stanno ancora lavorando in modo davvero “config-driven” quando una config usa solo una parte di una riga aggregata.

Perché oggi vedi 2 strategie invece di 3

1. `src/lib/derivativeStrategies.ts` usa ancora `filterBySignatures`, che è 1-riga=1-match e ignora davvero `quantity_abs`.
   - Caso reale GOOGLE: esiste una CALL 305 con `quantity = -2`, ma due config diverse ne usano 1 contratto ciascuna.
   - La prima config si prende tutta la riga `-2`, la renderizza come 2 contratti, e la seconda resta senza gamba e sparisce.

2. Il ripristino del wizard non ricrea bene gli stock splittati.
   - Se una config salva anche un solo `linked_stock_slot_id` tipo `__slot_0`, oggi il titolo non viene splittato automaticamente alla riapertura.
   - Risultato: una strategia si prende il titolo intero e le altre si riaccorpano.

3. La riconciliazione può ancora distruggere strategie sorelle dello stesso sottostante.
   - `StrategyReconciliationDialog` risalva le config “changed”, ma non garantisce di reincludere tutte le altre config dello stesso underlying.
   - Questo può cancellare o rifondere configurazioni corrette.

Fix definitivo che implementerò

1. Creare un resolver unico, shared, quantity-aware
   - Nuova utility centralizzata che risolve `strategy_configurations` + posizioni correnti.
   - Deve produrre 1 risultato per config salvata.
   - Deve poter “affettare” la stessa riga reale in più gambe virtuali quando `quantity_abs` divide una posizione aggregata.
   - Deve risolvere anche gli stock slot salvati (`__slot_n`) in modo deterministico.

2. Sostituire il percorso `configOnly` in `categorizeDerivatives`
   - Eliminare la dipendenza da `filterBySignatures` per le config salvate.
   - Non consumare più l’intero `position.id` quando una config usa solo parte della quantità.
   - Renderizzare Covered Call, De-Risking, Naked Put, LEAP, Other, spread, ecc. usando le gambe già risolte dal resolver.
   - Portare anche `sort_order` nei risultati per mantenere l’ordine configurato.

3. Rendere il Wizard un ripristino fedele
   - `StrategyConfigWizard.restoreFromConfigs()` userà lo stesso resolver.
   - Auto-split derivati quando una config usa solo parte della quantità.
   - Auto-split stock se esiste qualunque `linked_stock_slot_id` con suffisso `__slot_`, anche se è uno solo.
   - Alla riapertura il wizard deve mostrare esattamente le 3 strategie GOOGLE separate.

4. Correggere la riconciliazione
   - `reconcileConfigs()` riuserà lo stesso matching centralizzato.
   - `StrategyReconciliationDialog` inizializzerà e risalverà tutte le config del sottostante coinvolto, non solo quelle con delta.
   - Così non potrà più cancellare o fondere strategie sorelle.

5. Allineare tutta la pagina Derivati alla stessa sorgente di verità
   - `needsWizard` in `src/pages/Derivatives.tsx` smetterà di usare matching semplificato.
   - Pagina, wizard, riconciliazione e cache useranno la stessa identica risoluzione config-driven.

File coinvolti

- `src/lib/derivativeStrategies.ts`
- nuovo helper condiviso in `src/lib/`
- `src/components/derivatives/StrategyConfigWizard.tsx`
- `src/lib/strategyReconciliation.ts`
- `src/components/derivatives/StrategyReconciliationDialog.tsx`
- `src/pages/Derivatives.tsx`

Nota importante

- Non serve un’altra migrazione database: il backend già contiene 3 righe GOOGLE distinte. Il bug è nella risoluzione/renderizzazione, non nella persistenza.

Verifica finale

1. Caso reale GOOGLE:
   - backend = 3 config
   - pagina Derivati = 3 strategie visibili
   - “Riconfigura strategie” = 3 card separate

2. Caso quantità aggregate:
   - una CALL `-2` distribuita su 2 config deve diventare 2 strategie visibili da 1 contratto ciascuna

3. Caso stock slot:
   - una config che salva solo `__slot_0` deve riaprire il wizard già splittata correttamente

4. Coerenza totale:
   - pagina Derivati, wizard, riconciliazione e badge arancione devono dare lo stesso identico risultato
