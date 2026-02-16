

## Fix: Sovrapposizione badge OOR con bottone calcolatrice in Double Diagonal

### Problema

La colonna grid per OptionStrat + Calcolatrice e' impostata a `2rem`, ma contiene due pulsanti che richiedono `4rem`. Questo causa la sovrapposizione del badge IR/OOR con il bottone calcolatrice.

### Soluzione

**File: `src/pages/Derivatives.tsx`** -- riga 1435

Modificare la classe grid del `DoubleDiagonalRow`: cambiare la terza colonna da `2rem` a `4rem`.

Prima:
```
grid-cols-[1.25rem_minmax(6rem,1fr)_2rem_4rem_3rem_auto_6rem_6rem_7rem_7rem]
```

Dopo:
```
grid-cols-[1.25rem_minmax(6rem,1fr)_4rem_4rem_3rem_auto_6rem_6rem_7rem_7rem]
```

Nessun'altra modifica necessaria. La colonna badge (4rem) e le colonne successive restano invariate.

