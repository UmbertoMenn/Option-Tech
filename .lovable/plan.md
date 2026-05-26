## Causa

Esistono due implementazioni diverse di "underlying senza mapping" con regole di normalizzazione non allineate.

**Diagnostica admin** (`src/components/admin/ResolutionDiagnostics.tsx:54`) — normalizzazione debole:
```js
s.toUpperCase().replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim()
```
Filtra solo `asset_type === 'derivative'`.

**Tab Ticker** (`src/hooks/useUnderlyingMappings.ts:80`) — normalizzazione forte:
```js
.toUpperCase()
.replace(/[.,]+/g, ' ').replace(/\s+/g, ' ')
.replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE)\b/g, '')
.replace(/[^A-Z0-9]/g, '')
```
Filtra `['OPTION','WARRANT','derivative']`.

Se in DB il mapping è `VERTIV HOLDINGS INC → VRT`, `BAIDU INC → BIDU`, `APPLIED MATERIALS INC → AMAT` e il derivato ha underlying `VERTIV` / `BAIDU` / `APPLIED MATERIALS`:
- Tab Ticker fa match (rimuove INC/HOLDINGS e spazi) → NON appare unresolved.
- Diagnostica NON fa match (mantiene suffissi e spazi) → appare "senza mapping".

## Fix

Allineare la diagnostica alla logica del Ticker Manager (l'unica corretta).

1. **`src/hooks/useUnderlyingMappings.ts`** — estrarre ed esportare la funzione di normalizzazione come `normalizeUnderlying`, usandola internamente al posto della copia locale.

2. **`src/components/admin/ResolutionDiagnostics.tsx`**:
   - Importare `normalizeUnderlying` e sostituire la `normalize` locale debole.
   - Estendere il filtro `asset_type` a `['OPTION','WARRANT','derivative']` per coerenza con la tab Ticker.

## Risultato

VERTIV, BAIDU, APPLIED MATERIALS (e qualunque underlying con suffisso societario tipo INC/CORP/HOLDINGS) smettono di comparire come "Underlying senza mapping" nella diagnostica, perché il check userà la stessa normalizzazione del Ticker Manager.

## File toccati

- `src/hooks/useUnderlyingMappings.ts` (export `normalizeUnderlying`)
- `src/components/admin/ResolutionDiagnostics.tsx` (import + filtro `asset_type`)

Nessuna modifica al database o ad altri flussi.
