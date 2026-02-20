

## Aggiungere "Distanza min strike" alla prima sotto-regola del Roll attivo

### Problema
La sotto-regola "Se sulla prima scadenza disponibile, rollo su strike piu basso..." non ha il campo "Distanza min strike" che invece e presente nella seconda sotto-regola. L'utente vuole che anche il roll sulla prima scadenza rispetti una distanza minima dallo strike.

### Modifiche

#### 1. `src/lib/adjustmentRules.ts`
Aggiungere un campo `firstExpiryMinDistancePct: number` alla `ProfitRule` interface, con default 5. Questo campo definisce la distanza minima % dal sottostante per lo strike quando si fa roll down sulla prima scadenza.

#### 2. `src/components/simulator/AdjustmentRuleEditor.tsx`
Aggiungere un campo "Distanza min strike" + input numerico + "%" nella prima sotto-regola (linee 217-242), prima dei campi USD/%, identico a quello gia presente nella seconda sotto-regola.

#### 3. `src/lib/backtestEngine.ts`
Aggiornare la logica `roll_down` per il caso "prima scadenza" in modo che il nuovo strike sia almeno a `firstExpiryMinDistancePct`% di distanza dal prezzo del sottostante.

### File coinvolti

| File | Modifica |
|------|----------|
| `src/lib/adjustmentRules.ts` | Aggiungere `firstExpiryMinDistancePct` a `ProfitRule`, default 5 |
| `src/components/simulator/AdjustmentRuleEditor.tsx` | Aggiungere input "Distanza min strike" nella prima sotto-regola |
| `src/lib/backtestEngine.ts` | Usare `firstExpiryMinDistancePct` nella logica roll down prima scadenza |

