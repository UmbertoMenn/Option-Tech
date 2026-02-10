

## Ottimizzazione Mobile

### Problemi identificati
1. La barra header (Dashboard, Derivatives, Risk Analyzer) contiene molti pulsanti che su mobile causano lo scroll dell'intera pagina invece di scorrere orizzontalmente solo la barra
2. La tabella delle posizioni nella Dashboard non ha scroll orizzontale contenuto
3. Le righe delle strategie derivati usano CSS Grid con 10-12 colonne fisse che non si adattano allo schermo mobile
4. Le card riepilogative nella pagina derivati si leggono male su mobile

### Modifiche previste

**1. Header - Dashboard (`src/components/dashboard/Dashboard.tsx`)**
- Rendere la sezione dei pulsanti nell'header scrollabile orizzontalmente con `overflow-x-auto` e `flex-nowrap`
- Su mobile, nascondere il testo dei pulsanti e mostrare solo le icone (usando classi `hidden sm:inline`)
- Evitare che la riga header causi scroll verticale della pagina

**2. Header - Derivatives (`src/pages/Derivatives.tsx`)**
- Stesso approccio: pulsanti di navigazione con scroll orizzontale e icone compatte su mobile

**3. Tabella Posizioni (`src/components/dashboard/PositionsTable.tsx`)**
- La tabella e gia dentro un `overflow-x-auto`, ma il container esterno potrebbe limitarla
- Assicurare che il wrapper abbia `overflow-x-auto` e la tabella `min-w-[800px]` per forzare lo scroll orizzontale invece di comprimere le colonne

**4. Righe Derivati - Tutte le Row components (`src/pages/Derivatives.tsx`)**
- Wrappare ogni riga di strategia (CoveredCallRow, LongPutRow, IronCondorRow, DoubleDiagonalRow, NakedPutRow, LeapCallRow, GroupedOtherStrategyRow) in un container con `overflow-x-auto`
- Aggiungere `min-w-[700px]` o simile al grid per garantire la leggibilita e lo scroll orizzontale su mobile

**5. Card Riepilogativa Derivati (`src/components/derivatives/DerivativesSummaryCard.tsx`)**
- Il layout a due colonne (`grid-cols-2`) nella parte superiore diventa `grid-cols-1` su mobile
- Garantire che i badge e i ticker wrappino correttamente

### Dettagli tecnici

Per l'header, il pattern sara:
```tsx
<div className="flex items-center gap-2 overflow-x-auto">
  <Button variant="outline" size="sm">
    <Icon className="w-4 h-4" />
    <span className="hidden sm:inline ml-2">Testo</span>
  </Button>
</div>
```

Per le tabelle e le righe grid, il pattern sara:
```tsx
<div className="overflow-x-auto">
  <div className="min-w-[750px]">
    {/* grid content */}
  </div>
</div>
```

### File coinvolti
- `src/components/dashboard/Dashboard.tsx` - header mobile
- `src/pages/Derivatives.tsx` - header mobile + wrapper scroll su tutte le Row
- `src/components/dashboard/PositionsTable.tsx` - min-width sulla tabella
- `src/components/derivatives/DerivativesSummaryCard.tsx` - layout responsive card
- `src/pages/RiskAnalyzer.tsx` - header mobile (stesso pattern per coerenza)

