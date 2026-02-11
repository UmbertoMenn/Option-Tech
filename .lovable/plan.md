

## Fix allineamento colonne all'interno di ogni sezione strategia

### Problema
Ogni riga di una stessa sezione (es. ogni Covered Call) e un contenitore CSS Grid indipendente. Le colonne definite come `auto` si dimensionano in base al contenuto di quella singola riga, quindi se una riga ha un badge P! e un'altra no, oppure se una descrizione e piu lunga, le colonne successive si disallineano tra righe diverse della stessa sezione.

### Soluzione
Sostituire tutte le colonne `auto` con larghezze fisse, cosi ogni riga di una stessa sezione avra colonne identiche indipendentemente dal contenuto.

### Dettaglio tecnico

**File: `src/pages/Derivatives.tsx`**

#### 1. Covered Call (riga 715) - 13 colonne

Attuale:
```
[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_auto_8rem_6rem_4.5rem_5rem_8rem]
```

Nuovo:
```
[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_3rem_2rem_2rem_8rem_6rem_4.5rem_5rem_8rem]
```

Mappatura colonne con larghezze fisse:
- Col 1 Chevron: `1.25rem` (icona 4x4 = 1rem + margine)
- Col 2 V/A Badge: `2rem` (badge piccolo)
- Col 3 Descrizione: `minmax(8rem,1fr)` (resta flessibile)
- Col 4 OptionStrat: `2rem` (icona bottone)
- Col 5 Badges P!/Override: `3rem` (spazio per uno o due badge)
- Col 6 ITM/OTM: `3rem` (badge testo)
- Col 7 Menu: `2rem` (icona)
- Col 8 Calculator: `2rem` (icona)
- Col 9 UNIT: `8rem` (invariato)
- Col 10 PS: `6rem` (invariato)
- Col 11 Contratti: `4.5rem` (invariato)
- Col 12 PMC: `5rem` (invariato)
- Col 13 Prezzo: `8rem` (invariato)

#### 2. Long Put (riga 938) - 11 colonne

Attuale:
```
[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_6rem_4.5rem_5rem_7rem]
```

Nuovo:
```
[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_3rem_2rem_6rem_4.5rem_5rem_7rem]
```

- Col 1 Chevron: `1.25rem`
- Col 2 V/A Badge: `2rem`
- Col 3 Descrizione: `minmax(8rem,1fr)`
- Col 4 OptionStrat: `2rem`
- Col 5 Badges P!/Override: `3rem`
- Col 6 ITM/OTM: `3rem`
- Col 7 Menu: `2rem`
- Col 8-11: invariati

#### 3. Iron Condor (riga 1120) - 13 colonne

Attuale:
```
[auto_minmax(6rem,1fr)_auto_auto_auto_3rem_5rem_6rem_6rem_4.5rem_6rem_6.5rem_7rem]
```

Nuovo:
```
[1.25rem_minmax(6rem,1fr)_2rem_2rem_3rem_3rem_5rem_6rem_6rem_4.5rem_6rem_6.5rem_7rem]
```

- Col 1 Chevron: `1.25rem`
- Col 2 Underlying: `minmax(6rem,1fr)`
- Col 3 Badge IC: `2rem`
- Col 4 OptionStrat: `2rem`
- Col 5 IR/OOR: `3rem`
- Col 6 Scadenza: `3rem`
- Col 7-13: invariati

#### 4. Double Diagonal (riga 1358) - 11 colonne

Attuale:
```
[auto_minmax(6rem,1fr)_auto_auto_3rem_auto_6rem_6rem_4.5rem_6rem_7rem]
```

Nuovo:
```
[1.25rem_minmax(6rem,1fr)_2rem_3rem_3rem_auto_6rem_6rem_4.5rem_6rem_7rem]
```

- Col 1 Chevron: `1.25rem`
- Col 2 Underlying: `minmax(6rem,1fr)`
- Col 3 OptionStrat: `2rem`
- Col 4 IR/OOR: `3rem`
- Col 5 Scadenze: `3rem` (era `3rem`, ok)
- Col 6 PUT spread: `auto` -> manteniamo perche il testo varia
- Col 7-11: invariati

#### 5. Grouped Strategy (riga 1654) - 10 colonne

Attuale:
```
[auto_minmax(10rem,1fr)_auto_12rem_3.5rem_9rem_4rem_4.5rem_6rem_5rem]
```

Nuovo:
```
[1.25rem_minmax(10rem,1fr)_2rem_12rem_3.5rem_9rem_4rem_4.5rem_6rem_5rem]
```

- Col 1 Chevron: `1.25rem`
- Col 3 OptionStrat: `2rem`
- Resto invariato

#### 6. Naked Put (riga 2023) - 11 colonne

Attuale:
```
[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_6rem_4.5rem_5rem_7rem]
```

Nuovo:
```
[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_2rem_2rem_6rem_4.5rem_5rem_7rem]
```

- Col 1 Chevron: `1.25rem`
- Col 2 V Badge: `2rem`
- Col 3 Descrizione: `minmax(8rem,1fr)`
- Col 4 OptionStrat: `2rem`
- Col 5 ITM/OTM: `3rem`
- Col 6 Override: `2rem`
- Col 7 Menu: `2rem`
- Col 8-11: invariati

#### 7. Leap Call (riga 2176) - 11 colonne

Attuale:
```
[auto_auto_minmax(8rem,1fr)_auto_auto_auto_auto_6rem_4.5rem_5rem_8rem]
```

Nuovo:
```
[1.25rem_2rem_minmax(8rem,1fr)_2rem_3rem_2rem_2rem_6rem_4.5rem_5rem_8rem]
```

Stessa struttura del Naked Put con ultima colonna 8rem (per la %).

### Cosa NON cambia
- Nessuna logica di calcolo
- Nessun dato, badge, pulsante o tooltip rimosso
- Il contenuto espanso (CollapsibleContent) resta invariato
- Le colonne a larghezza fissa gia esistenti (PS, Contratti, PMC, Prezzo) restano identiche
