

## Fix: Titolo del carousel Risk Analyzer sopra ai controlli (come nella Dashboard)

### Problema
Il `RiskViewModeSelector` del Risk Analyzer mostra il titolo "Vista: Equity Exposure" sulla stessa riga delle frecce e dei pallini. Nella Dashboard invece il `ViewModeSelector` usa un layout verticale (`flex-col`) con il titolo sopra i controlli di navigazione.

### Soluzione
Modificare il componente `RiskViewModeSelector` (`src/components/risk/RiskViewModeSelector.tsx`) per adottare lo stesso layout a colonna della Dashboard:

1. Cambiare il contenitore principale da `flex items-center gap-4` a `flex flex-col items-center gap-2`
2. Spostare il testo "Vista: ..." fuori dalla riga dei controlli, posizionandolo come primo elemento (sopra)
3. Raggruppare frecce e pallini in un sotto-contenitore `flex items-center gap-4`

### Dettaglio tecnico

**File: `src/components/risk/RiskViewModeSelector.tsx`**

Il componente attualmente ha questa struttura:
```text
[flex row]
  < freccia | pallini | "Vista: Equity Exposure" | freccia >
```

Verra modificato in:
```text
[flex col]
  "Vista: Equity Exposure"
  [flex row]
    < freccia | pallini | freccia >
```

Questo replica esattamente il pattern del `ViewModeSelector` della Dashboard che usa `flex flex-col items-center gap-2` con il titolo come primo figlio e i controlli come secondo.
