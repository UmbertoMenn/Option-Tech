

## Nascondere sezioni vuote nella pagina Derivati

### Problema
Alcune sezioni (Put Spread, Diagonal Put Spread) hanno già il guard `{x.length > 0 && (...)}`, ma le altre sezioni vengono sempre renderizzate anche quando vuote, mostrando "Nessuna X presente".

### Soluzione
Wrappare ogni sezione con un controllo `length > 0`, come già fatto per Put Spread e Diagonal Put Spread.

### Modifiche a `src/pages/Derivatives.tsx`

Aggiungere il guard condizionale a queste 8 sezioni:

1. **Covered Call** (riga 553): `{categories.coveredCalls.length > 0 && (<Collapsible ...>...</Collapsible>)}`
2. **De-Risking Covered Call** (riga 605): `{categories.deRiskingCoveredCalls.length > 0 && (...)}`
3. **Iron Condor** (riga 655): `{categories.ironCondors.length > 0 && (...)}`
4. **Double Diagonal** (riga 695): `{categories.doubleDiagonals.length > 0 && (...)}`
5. **Naked Put** (riga 735): `{categories.nakedPuts.length > 0 && (...)}`
6. **Leap Call** (riga 847): `{categories.leapCalls.length > 0 && (...)}`
7. **Protezioni** (riga 887): `{categories.longPuts.length > 0 && (...)}`
8. **Altre Strategie** (riga 924): `{remainingOtherStrategies.length > 0 && (...)}`

Rimuovere anche i blocchi interni "Nessuna X presente" che diventano irraggiungibili.

### Nessuna modifica ad altri file

