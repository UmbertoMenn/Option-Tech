

## Modifiche richieste al Simulatore Covered Call

### 1. Aggiornare la descrizione dell'opzione "roll_up_positive"

**File:** `src/components/simulator/AdjustmentRuleEditor.tsx`, riga 87

Cambiare il testo da:
> "Rollo solo se la differenza e positiva di almeno:"

a:
> "Rollo su scadenza successiva con strike piu alto, solo se la differenza e positiva di almeno:"

### 2. Rendere i campi numerici completamente editabili

**File:** `src/components/simulator/AdjustmentRuleEditor.tsx` (tutti i campi `Input type="number"`)
**File:** `src/components/simulator/StrategyBuilder.tsx` (campo Distanza Call)

Il problema e che `parseFloat(e.target.value) || <default>` impedisce di cancellare il valore (una stringa vuota diventa il default). La soluzione e gestire la stringa vuota separatamente, permettendo all'utente di cancellare e riscrivere.

Approccio: usare `useState<string>` per il valore visualizzato e convertire a numero solo quando il campo perde il focus, oppure piu semplicemente rimuovere il fallback `|| X` dall'onChange, usando un valore controllato che accetti stringhe vuote.

In pratica, nei vari `onChange`, sostituire pattern come:
```
onChange={e => update({ field: parseFloat(e.target.value) || 5 })}
```
con:
```
onChange={e => update({ field: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
```

### 3. Rimuovere date inizio/fine da TickerSelector, tenere solo in StrategyBuilder

**File:** `src/components/simulator/TickerSelector.tsx`

- Rimuovere i campi "Data Inizio" e "Data Fine" (righe 241-262)
- Rimuovere gli state `startDate` e `endDate`
- Rimuovere il `filteredData` e passare direttamente `allData` a `onDataLoaded`
- Il mini-chart usa tutti i dati

**File:** `src/components/simulator/StrategyBuilder.tsx`

- Il `dateRange` gia riceve `from`/`to` dal padre, resta invariato
- Aggiungere logica: quando `entryDateStr` cade di sabato o domenica, spostare automaticamente al lunedi successivo (primo giorno utile)
- Impostare automaticamente `selectedExpiry` alla prima scadenza mensile successiva alla data di ingresso (gia fatto con `defaultExpiry`, basta assicurarsi che funzioni correttamente)

### 4. Preimpostare Distanza Call al 7%

**File:** `src/components/simulator/StrategyBuilder.tsx`, riga 25

Cambiare `useState(10)` in `useState(7)`.

### 5. Preimpostare Soglia di guadagno al 50%

**File:** `src/lib/adjustmentRules.ts`, riga 57

Nella funzione `getDefaultCoveredCallRules()`, cambiare `profitPct: 80` in `profitPct: 50`.

### Dettaglio tecnico

| # | File | Modifica |
|---|------|----------|
| 1 | `AdjustmentRuleEditor.tsx:87` | Aggiornare testo label |
| 2 | `AdjustmentRuleEditor.tsx` (tutti gli Input) + `StrategyBuilder.tsx:126` | Sostituire `\|\| default` con gestione stringa vuota |
| 3a | `TickerSelector.tsx` | Rimuovere sezione date e semplificare: emettere tutti i dati |
| 3b | `StrategyBuilder.tsx` | Aggiungere snap weekend -> lunedi per data ingresso |
| 4 | `StrategyBuilder.tsx:25` | Default callDistancePct = 7 |
| 5 | `adjustmentRules.ts:57` | Default profitPct = 50 |

