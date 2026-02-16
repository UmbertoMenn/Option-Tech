

## Rimuovere la doppia barra di scorrimento nel dialog dei premi

### Problema

Il `DialogContent` ha `max-h-[85vh] overflow-y-auto` (scrollbar esterna) e la tabella operazioni ha un wrapper con `max-h-[250px] overflow-y-auto` (scrollbar interna). Questo crea due barre di scorrimento visibili contemporaneamente.

### Soluzione

Rimuovere il contenitore con scroll interno sulla tabella operazioni (`max-h-[250px] overflow-y-auto`), lasciando solo lo scroll del dialog esterno. La tabella si espandera' naturalmente all'interno del dialog scrollabile.

### Modifica

**`src/components/derivatives/CallPremiumCalculatorDialog.tsx`** -- linea 412

Sostituire:
```html
<div className="max-h-[250px] overflow-y-auto">
```

Con:
```html
<div>
```

Nessun'altra modifica necessaria. Il dialog esterno gestira' lo scroll di tutto il contenuto come prima.

