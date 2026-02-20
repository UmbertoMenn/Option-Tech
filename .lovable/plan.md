

## Correzione Regola Profitto: Opzioni 2 e 3 unite

### Problema
Attualmente le 3 opzioni della regola "Se l'opzione venduta sta guadagnando" sono mutualmente esclusive (RadioGroup). In realta le opzioni 2 ("Se sulla prima scadenza disponibile, rollo su strike piu basso...") e 3 ("Se su scadenze successive, cerco opzione con strike lontano...") sono parte della stessa strategia e vanno sempre insieme. La scelta e tra:
- **Opzione A**: Aspetto che scada e rivendo call con barriera
- **Opzione B**: Roll attivo (prima scadenza -> roll down stesso expiry; scadenze successive -> cerca miglior opzione)

### Modifiche

#### 1. `src/lib/adjustmentRules.ts` -- Semplificare il tipo action

Il campo `action` della `ProfitRule` diventa:
- `'wait_and_sell'` -- aspetto scadenza
- `'roll_down'` -- roll attivo (combina la logica first expiry + any expiry)

I campi per first_expiry e any_expiry restano tutti presenti nella stessa interfaccia, perche vengono usati entrambi quando `action === 'roll_down'`.

Il default cambia da 3 valori a 2.

#### 2. `src/components/simulator/AdjustmentRuleEditor.tsx` -- UI aggiornata

La RadioGroup della sezione profitto passa da 3 opzioni a 2:
- **Opzione A**: "Aspetto che scada e rivendo call con barriera X%"
- **Opzione B**: "Roll attivo" -- quando selezionata, mostra **entrambi** i blocchi di parametri:
  - "Se sulla prima scadenza disponibile, rollo su strike piu basso con stessa scadenza, se il nuovo premio e maggiore di almeno X USD oppure X%"
  - "Se su scadenze successive, cerco opzione con strike lontano almeno X% dal sottostante, scadenza minima, premio non inferiore a X USD oppure X%"

Entrambi i sotto-blocchi sono sempre visibili quando si seleziona "Roll attivo".

#### 3. `src/lib/backtestEngine.ts` -- Logica combinata

Quando `action === 'roll_down'`, il motore:
1. Controlla se l'opzione attuale e sulla prima scadenza disponibile -> applica logica roll_down_first_expiry
2. Altrimenti (scadenze successive) -> applica logica roll_down_any_expiry

### Dettaglio tecnico

**adjustmentRules.ts**:
```text
ProfitRule.action: 'wait_and_sell' | 'roll_down'
// tutti i campi (minPremiumUsd, minPremiumPct, minDistancePct, rollDownMinPremiumUsd, rollDownMinPremiumPct) restano
```

**AdjustmentRuleEditor.tsx**:
- RadioGroup con 2 valori: `wait_and_sell`, `roll_down`
- Quando `roll_down` selezionato, mostra i parametri di entrambe le sotto-regole (first expiry + any expiry) come sotto-sezioni sempre visibili

**backtestEngine.ts**:
- Sostituire i casi `roll_down_first_expiry` e `roll_down_any_expiry` con un unico caso `roll_down` che internamente decide quale logica applicare in base alla scadenza corrente

### File coinvolti

| File | Modifica |
|------|----------|
| `src/lib/adjustmentRules.ts` | `action` diventa `'wait_and_sell' \| 'roll_down'`, default aggiornato |
| `src/components/simulator/AdjustmentRuleEditor.tsx` | RadioGroup da 3 a 2 opzioni, parametri roll mostrati insieme |
| `src/lib/backtestEngine.ts` | Unificare logica roll_down con decisione interna first/any expiry |

