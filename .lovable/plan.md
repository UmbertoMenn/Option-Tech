## Problema
Nelle tabelle delle strategie derivati l'etichetta header "SOTTOSTANTE / STRATEGIA" appare visivamente disallineata rispetto al bordo sinistro della card perché è posizionata nella 3ª colonna della grid (dopo le colonne riservate al chevron e al badge "V"), anziché partire dall'estremità sinistra.

## Soluzione
In `src/pages/Derivatives.tsx` modificare le 7 righe di header grid (linee 665, 725, 777, 820, 863, 998, 1040) in modo che il label "Sottostante / Strategia":

1. Occupi anche le colonne iniziali vuote tramite `col-span-N` (N = numero di colonne iniziali "spaziatrici" + 1, tipicamente 3 per coveredCalls/longPuts/leapCalls, 2 per ironCondors/doubleDiagonals, 3 o 4 per le altre).
2. Eliminare i corrispondenti `<span />` placeholder che lo precedono.
3. Mantenere `text-left` esplicito e l'allineamento con `items-center`.

Esempio (linee 665-668):
```tsx
<div className="grid grid-cols-[...]">
  <span className="col-span-3 text-left">Sottostante / Strategia</span>
  <span /> {/* colonna dopo (es. icona link) */}
  ...
```

## Verifica
Controllare visivamente le 7 sezioni (Covered Calls, De-Risking CC, Iron Condor, Double Diagonal, Naked Put, LEAP Call, Long Put) per assicurarsi che il label parta dal bordo sinistro come gli altri header e che le colonne successive (Stato, Target, ecc.) restino correttamente allineate sopra i rispettivi valori.
