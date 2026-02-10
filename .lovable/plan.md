
## Modifica tooltip P! nelle Covered Call

### Cosa cambia

Il tooltip del badge "P!" nelle Covered Call viene aggiornato per mostrare il numero di **titoli scoperti** invece dei contratti scoperti.

### Dettaglio tecnico

**File**: `src/pages/Derivatives.tsx`, riga 716

Testo attuale:
```
Copertura parziale: {uncoveredContracts} contratti scoperti
```

Nuovo testo:
```
Covered Call parziale - numero titoli scoperti: {uncoveredContracts * 100}
```

Il calcolo moltiplica i contratti scoperti per 100 (ogni contratto = 100 azioni) per ottenere il numero effettivo di titoli non coperti.

Una sola riga da modificare.
