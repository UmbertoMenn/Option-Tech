# Fix conflitto Split / Aggrega nel wizard configurazione derivati

## Problema
Nel `StrategyConfigWizard`, la selezione utente è memorizzata in `selectedIdsByGroup: Map<groupKey, Set<positionId>>`. Quando si splitta una posizione (es. opzione qty 3 → 3 slot `__opt_slot_0/1/2`, oppure stock 300 → 3 slot `__slot_0/1/2`), l'ID "padre" già selezionato resta nel Set anche se non esiste più in `effectivePositions`. Analogamente al rejoin (aggrega), gli ID degli slot restano flaggati pur essendo scomparsi. Questo crea conflitti: il contatore "selezionati" mostra valori errati, e la creazione strategia può tentare di usare ID inesistenti o duplicati (parent + slot insieme).

## Soluzione
I due handler `handleSplitPosition` e `handleRejoinPosition` (righe ~854-880) devono ripulire `selectedIdsByGroup` rimuovendo sia il `posId` padre sia tutti gli ID slot derivati (`${posId}__opt_slot_*`, `${posId}__slot_*`) da ogni gruppo. È un'operazione locale, non tocca strategie già create né dati persistiti.

### Modifica
In `src/components/derivatives/StrategyConfigWizard.tsx`:

1. `handleSplitPosition(posId)`: dopo `setSplitPositionIds`, chiamare `clearSelectionsFor(posId)` che, per ogni Set in `selectedIdsByGroup`, rimuove `posId` e qualunque id che inizi con `${posId}__opt_slot_` o `${posId}__slot_` (per coprire il caso di un re-split dopo aggregazione).
2. `handleRejoinPosition(posId)`: stessa pulizia prima/dopo il `setSplitPositionIds`.

### Pseudo-codice
```ts
const clearSelectionsFor = (posId: string) => {
  setSelectedIdsByGroup(prev => {
    const next = new Map(prev);
    next.forEach((set, key) => {
      const cleaned = new Set(
        [...set].filter(id =>
          id !== posId &&
          !id.startsWith(`${posId}__opt_slot_`) &&
          !id.startsWith(`${posId}__slot_`)
        )
      );
      next.set(key, cleaned);
    });
    return next;
  });
};
```

## Scope
- File toccato: `src/components/derivatives/StrategyConfigWizard.tsx` (solo UI/stato locale).
- Nessuna modifica a DB, hook o logica di salvataggio.

## Verifica
1. Selezionare opzione qty 3 in un gruppo → splittare → il contatore "selezionati" torna a 0 per quella posizione, gli slot non risultano pre-selezionati.
2. Selezionare 2 slot di uno stock 300 → rejoin → il padre non risulta selezionato; il counter non eredita gli slot scomparsi.
3. Creazione strategia dopo split/rejoin non include ID fantasma.
