

## Selettore data a navigazione gerarchica (singolo Select)

### Problema
Ci sono due Select affiancati. L'utente vuole **un solo selettore** con navigazione drill-down: Anno → Mese → Data.

### Soluzione
Sostituire `DateSelectorDual` con un **singolo Select** che mostra 3 livelli di navigazione in sequenza:

1. **Stato iniziale**: mostra gli **anni** disponibili (es. 2026, 2025, 2024)
2. **Dopo aver scelto un anno**: mostra i **mesi** di quell'anno (es. Marzo, Febbraio, Gennaio) + un "← Indietro" per tornare agli anni
3. **Dopo aver scelto un mese**: mostra le **date** di quel mese in formato `dd/MM/yyyy` + un "← Indietro" per tornare ai mesi + "Nessuna" per resettare

Quando l'utente seleziona una data finale, il Select si chiude e mostra la data selezionata. Il trigger mostra sempre la data completa selezionata (es. `01/03/2026`) o "Seleziona data" se nessuna.

### Implementazione

**File: `src/components/dashboard/DateSelectorDual.tsx`** — riscrittura completa

- Usare un `Popover` invece di `Select` (per controllare apertura/chiusura e contenuto dinamico)
- Stato interno: `level` (`year` | `month` | `date`), `selectedYear`, `selectedMonth`
- Ogni livello è una lista di `Button` cliccabili dentro il `PopoverContent`
- Click su anno → passa a livello mese; click su mese → passa a livello date; click su data → chiude popover e chiama `onDateChange`
- Pulsante "← Indietro" per tornare al livello precedente
- Layout compatto, stessa larghezza del selettore attuale

### Risultato visivo
```
[Seleziona data ▼]        → click
  ┌──────────────┐
  │ 2026         │        → click "2026"
  │ 2025         │
  │ 2024         │
  └──────────────┘
  ┌──────────────┐
  │ ← Indietro   │
  │ Marzo        │        → click "Marzo"
  │ Febbraio     │
  │ Gennaio      │
  └──────────────┘
  ┌──────────────┐
  │ ← Indietro   │
  │ Nessuna      │
  │ 01/03/2026   │        → click → selezionata, popover chiuso
  │ 15/03/2026   │
  └──────────────┘
```

Trigger mostra: `01/03/2026` (o `Seleziona data` se nessuna)

### File modificati
- `src/components/dashboard/DateSelectorDual.tsx` — riscrittura con Popover + navigazione a 3 livelli

