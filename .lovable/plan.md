

## Eliminare la barra di scorrimento orizzontale allargando la finestra del calcolatore premi

### Problema

La finestra del dialog "Calcolatrice Premi" utilizza `max-w-lg` (32rem / 512px), insufficiente per contenere la tabella operazioni con la nuova colonna "Scad." senza overflow orizzontale.

### Soluzione

Aumentare la larghezza massima del dialog a `max-w-2xl` (42rem / 672px), sufficiente per mostrare tutte le colonne senza barra di scorrimento orizzontale.

### Dettaglio tecnico

**`src/components/derivatives/CallPremiumCalculatorDialog.tsx`** -- linea 233

Sostituire:
```
max-w-lg
```
Con:
```
max-w-2xl
```

### File da modificare

| File | Modifica |
|---|---|
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Cambiare `max-w-lg` in `max-w-2xl` nella classe di `DialogContent` |

