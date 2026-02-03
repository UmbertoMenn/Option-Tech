

# Piano per Ripristinare Layout Originale dei Badge con Tooltip Funzionanti

## Problema Attuale

Ho erroneamente spostato i badge alla destra della riga, modificando l'ordine degli elementi. L'utente vuole:
- **Ordine originale**: Icona → Titolo → Badge → Contatore → Freccia
- **Tooltip funzionanti** sui badge

## Soluzione

Invece di separare il badge dal button, userò un approccio diverso:
1. **Cambiare il wrapper da `<button>` a `<div>` cliccabile** con `role="button"` e `tabIndex={0}`
2. **Mantenere l'ordine originale** degli elementi
3. **Il tooltip funzionerà** perché non è più annidato in un elemento `<button>`

## Implementazione

### Struttura Corretta

```text
┌─────────────────────────────────────────────────────────────────┐
│ <div role="button" onClick={toggle}> (cliccabile)              │
│   ├─ Icona                                                      │
│   ├─ Titolo                                                     │
│   ├─ <Tooltip>                                                  │
│   │     └─ <span/Badge> ← tooltip funziona!                    │
│   ├─ Conteggio elementi                                        │
│   └─ Freccia ▲/▼                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Codice Modificato (CompactSection)

```typescript
function CompactSection({ ... }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="py-2 border-b border-border/50 last:border-b-0">
      {/* Header row - div cliccabile invece di button */}
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(!isExpanded); }}
        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors cursor-pointer"
      >
        <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
        <span className="text-sm font-bold text-foreground">{title}</span>
        
        {/* Badge con tooltip - STESSO ORDINE ORIGINALE */}
        {statusBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span 
                className={`inline-flex items-center rounded-full border text-[10px] px-1.5 py-0 h-4 cursor-help ${statusBadge.colorClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {statusBadge.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{BADGE_TOOLTIPS[statusBadge.label] || statusBadge.label}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        <span className="text-xs text-muted-foreground">
          ({items.length} {items.length === 1 ? 'elemento' : 'elementi'})
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>
      
      {/* Expandable items */}
      {isExpanded && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-6">
          {items.map((item, idx) => renderItem(item, idx))}
        </div>
      )}
    </div>
  );
}
```

## Perché Funziona

- **Radix Tooltip funziona** quando il trigger non è annidato in un `<button>` nativo
- Usando `<div role="button">` al posto di `<button>`, il tooltip può ricevere correttamente gli eventi hover/focus
- L'ordine degli elementi rimane esattamente come prima: Icona → Titolo → Badge → Contatore → Freccia
- `e.stopPropagation()` sul badge impedisce che il click sul badge espanda/contragga la sezione

## File da Modificare

- `src/components/derivatives/DerivativesSummaryCard.tsx` - Solo il componente `CompactSection` (righe 64-108)

## Risultato Atteso

| Elemento | Posizione | Comportamento |
|----------|-----------|---------------|
| Icona | Sinistra | Cliccabile per espandere |
| Titolo | Dopo icona | Cliccabile per espandere |
| Badge | Dopo titolo | Mostra tooltip all'hover |
| Contatore | Dopo badge | Cliccabile per espandere |
| Freccia | Destra | Cliccabile per espandere |

