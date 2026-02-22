

## Correzioni Simulatore

### 1. Volatilita implicita default al 55%

**File:** `src/pages/Simulator.tsx`, riga 30

Cambiare `useState(30)` in `useState(55)`.

### 2. La data ingresso si resetta dopo il backtest

**Causa:** Lo state `rawEntryDate` vive dentro `StrategyBuilder` (riga 33) ed e inizializzato con `dateRange.from`. Ogni volta che il componente si ri-monta o `dateRange` cambia, la data torna all'inizio del database.

**Soluzione:** Spostare lo state `rawEntryDate` nel componente padre `Simulator.tsx`, cosi persiste per tutta la sessione. `StrategyBuilder` ricevera `rawEntryDate` e `setRawEntryDate` come props.

**File:** `src/pages/Simulator.tsx`
- Aggiungere state: `const [rawEntryDate, setRawEntryDate] = useState('')`
- Nel callback `handleDataLoaded`: impostare `rawEntryDate` solo se e ancora vuoto (prima volta)
- Passare `rawEntryDate` e `setRawEntryDate` come props a `StrategyBuilder`

**File:** `src/components/simulator/StrategyBuilder.tsx`
- Rimuovere lo state locale `rawEntryDate`
- Accettare `rawEntryDate` e `onRawEntryDateChange` nelle props
- Usare queste props al posto dello state locale

### 3. Il backtest parte dall'inizio del database

**Causa:** La logica di filtraggio in `handleRunBacktest` (riga 70-71) usa `entryDate` che viene da `handleLegsChange`. Ma dato che il punto 2 resettava la data, `entryDate` tornava alla prima data del file. Inoltre, i `legs` generati da `StrategyBuilder` hanno `entryDate` uguale alla data resettata.

**Soluzione:** Con il fix del punto 2, `entryDate` sara corretto perche `rawEntryDate` non si resettera piu. La logica di filtraggio a riga 70-71 gia fa `priceData.findIndex(p => p.date >= entryDate)` e passa solo i dati dalla data di ingresso in poi: funzionera correttamente una volta che la data e persistente.

### Dettaglio tecnico

| # | File | Modifica |
|---|------|----------|
| 1 | `Simulator.tsx:30` | `ivPct` default da 30 a 55 |
| 2 | `Simulator.tsx` | Aggiungere state `rawEntryDate`, passarlo come prop |
| 2 | `Simulator.tsx:52-56` | In `handleDataLoaded`, impostare `rawEntryDate` solo se vuoto |
| 2 | `StrategyBuilder.tsx` | Rimuovere state locale, accettare props `rawEntryDate`/`onRawEntryDateChange` |

