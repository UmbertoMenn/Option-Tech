

# Piano: Fix Tooltip per Badge nelle Righe delle Strategie Derivati

## Problema Identificato

I tooltip sui badge (ITM, OTM, IR, OOR, IB, OOB, G, L) nelle righe delle strategie non funzionano. La causa è **identica** a quella risolta in `DerivativesSummaryCard.tsx`:

Il componente `CollapsibleTrigger asChild` renderizza un `<button>` nativo, e i tooltip Radix non funzionano quando il `TooltipTrigger` è annidato in un altro elemento interattivo come `<button>`.

## Soluzione

Usare lo stesso approccio applicato al `DerivativesSummaryCard.tsx`:
- Sostituire il pattern `<CollapsibleTrigger asChild><div ...>` con `<div role="button" onClick={...}>`
- Mantenere invariata la struttura e la posizione di tutti gli elementi interni
- Gestire l'evento click manualmente per toggle `isOpen`

## File da Modificare

**`src/pages/Derivatives.tsx`** - Modificare le seguenti funzioni Row:

| Funzione | Righe | Badge con Tooltip |
|----------|-------|-------------------|
| `CoveredCallRow` | 542-669 | ITM/OTM, P! |
| `LongPutRow` | 686-811 | ITM/OTM, P! |
| `IronCondorRow` | 847-1026 | IR/OOR |
| `DoubleDiagonalRow` | 1054-1224 | IR/OOR |
| `GroupedOtherStrategyRow` | 1319-1459 | IR/OOR, IB/OOB |
| `NakedPutRow` | 1669-1782 | ITM/OTM |
| `LeapCallRow` | 1804-1924 | G/L |

## Implementazione per Ogni Row

### Pattern Attuale (NON FUNZIONA)
```typescript
<Collapsible open={isOpen} onOpenChange={setIsOpen}>
  <CollapsibleTrigger asChild>
    <div className="grid ... cursor-pointer ...">
      {/* Badge con Tooltip - NON FUNZIONA */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="cursor-help">ITM</Badge>
        </TooltipTrigger>
        <TooltipContent>In The Money</TooltipContent>
      </Tooltip>
    </div>
  </CollapsibleTrigger>
</Collapsible>
```

### Pattern Corretto (FUNZIONA)
```typescript
<Collapsible open={isOpen} onOpenChange={setIsOpen}>
  {/* Rimosso CollapsibleTrigger asChild */}
  <div 
    role="button"
    tabIndex={0}
    onClick={() => setIsOpen(!isOpen)}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
    className="grid ... cursor-pointer ..."
  >
    {/* Badge con Tooltip - FUNZIONA */}
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          className="cursor-help"
          onClick={(e) => e.stopPropagation()}
        >
          ITM
        </Badge>
      </TooltipTrigger>
      <TooltipContent>In The Money</TooltipContent>
    </Tooltip>
  </div>
</Collapsible>
```

## Dettagli Tecnici

1. **Rimuovere `CollapsibleTrigger asChild`** dal wrapper della riga
2. **Aggiungere al `<div>` della riga**:
   - `role="button"` - accessibilità
   - `tabIndex={0}` - navigazione tastiera
   - `onClick={() => setIsOpen(!isOpen)}` - gestione click
   - `onKeyDown` - supporto Enter/Spazio
3. **Aggiungere `onClick={(e) => e.stopPropagation()}`** ai `TooltipTrigger` per evitare che il click sul badge espanda/chiuda la riga

## Perché Funziona

- Radix `Tooltip` richiede che il `TooltipTrigger` non sia annidato in elementi `<button>` nativi
- Usando `<div role="button">` invece di `CollapsibleTrigger asChild` (che genera un `<button>`), il tooltip può ricevere correttamente gli eventi hover/focus
- `e.stopPropagation()` sul badge previene che il click attivi l'espansione della riga

## Elementi NON Modificati

- Struttura della griglia CSS
- Ordine e posizione degli elementi
- Stili e classi
- Logica di calcolo ITM/OTM/IR/OOR/IB/OOB/G/L
- `CollapsibleContent` (rimane invariato)

