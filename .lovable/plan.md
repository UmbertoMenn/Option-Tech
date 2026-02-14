

## Fix: scrollbar doppia e raggruppamento strategie nel tab "Per Strategia"

### Problema 1: Doppia barra di scorrimento

Il `DialogContent` (linea 628) ha gia `max-h-[85vh] overflow-y-auto`. Il tab "Per Strategia" aggiunge un secondo contenitore con `max-h-[400px] overflow-y-auto` (linea 1208), causando due scrollbar annidate.

**Fix**: Rimuovere `max-h-[400px] overflow-y-auto` dal div della lista strategie (linea 1208), lasciando che sia il `DialogContent` a gestire l'unico scroll, come avviene per tutti gli altri tab.

### Problema 2: Strategie "Altre" non raggruppate per tipo

Attualmente tutte le `groupedOtherStrategies` ricevono `groupOrder: 6` e come `strategyType` il valore di `gs.strategyName` (es. "Put Brown Wing", "Diagonal Put Spread"). Il sorting ordina per `groupOrder` e poi per `label`, ma dato che le strategie standard (Covered Call, Naked Put, ecc.) hanno ordini 1-5, tutte le "altre" si mescolano in un unico blocco disordinato.

**Fix**: Assegnare un `groupOrder` univoco per ogni `strategyName` distinto tra le "Altre Strategie". Questo si ottiene raccogliendo i nomi unici e assegnando ordini progressivi a partire da 6, garantendo che strategie dello stesso tipo (es. tutte le "Put Brown Wing") vengano raggruppate insieme con il proprio header.

### Modifiche

**File: `src/components/derivatives/AlertSettingsDialog.tsx`**

1. **Linea 1208**: Rimuovere `max-h-[400px] overflow-y-auto` dal div della lista strategie
   - Da: `<div className="space-y-1 max-h-[400px] overflow-y-auto">`
   - A: `<div className="space-y-1">`

2. **Linee 278-312**: Aggiornare la logica di `groupOrder` per le "Altre Strategie", assegnando ordini progressivi per nome strategia distinto:
   - Raccogliere i nomi unici di strategia dalle `groupedOtherStrategies`
   - Assegnare `groupOrder` = 6 + indice del nome nella lista unica
   - Risultato: "Diagonal Put Spread" (groupOrder 6), "Put Brown Wing" (groupOrder 7), ecc.
