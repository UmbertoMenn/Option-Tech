

## Modifiche: Date Picker + Curva IV con punti mensili

### 1. TickerSelector -- Aggiungere date picker Start/End

Dopo il caricamento del CSV, aggiungere due campi data (Start Date / End Date) usando il componente `DateInput` gia esistente. Le date sono vincolate al range del CSV caricato. Solo i dati tra start e end vengono passati al parent via `onDataLoaded`.

L'output cambia: il CSV viene parsato e salvato internamente come `allData`, ma `onDataLoaded` emette solo la fetta filtrata tra start e end date.

### 2. IVCurveEditor -- Linea arancione + punti mensili automatici

**Colore**: la linea IV e i punti Scatter diventano arancioni (`#f97316` / `orange`).

**Punti automatici**: quando il componente riceve `priceData`, genera automaticamente un punto IV per ogni primo giorno di mese nel range (es. se il range va da 2024-01-15 a 2024-06-20, crea punti per 2024-01-15, 2024-02-01, 2024-03-01, 2024-04-01, 2024-05-01, 2024-06-01, 2024-06-20). Tutti inizializzati al 30%.

L'admin non aggiunge punti cliccando sul grafico (la funzionalita click-to-add viene rimossa). I punti sono fissi sulle date mensili; l'admin puo solo trascinare verticalmente per cambiare la IV o usare l'input numerico.

### 3. Simulator.tsx -- Gestione date range

L'inizializzazione dei `ivPoints` si sposta nel `IVCurveEditor` (o viene ricalcolata quando cambiano le date). Quando `handleDataLoaded` viene chiamato, i punti IV vengono generati automaticamente in base alle date filtrate.

---

### Dettaglio tecnico

**TickerSelector.tsx**:
- Nuovo state: `startDate`, `endDate` (Date | undefined)
- Dopo il parsing del CSV, auto-imposta start = primo giorno, end = ultimo giorno
- Due `DateInput` con `disabled` che limita al range del CSV
- `onDataLoaded` emette `priceData` filtrata tra start e end
- Cambio di start/end ri-emette i dati filtrati

**IVCurveEditor.tsx**:
- Colore linea e scatter: `#f97316` (arancione) invece di `hsl(var(--chart-2))`
- Nuova prop opzionale: nessuna -- i punti vengono generati internamente quando `priceData` cambia
- Funzione `generateMonthlyPoints(priceData)`: crea un punto al primo giorno di ogni mese + primo e ultimo giorno del range, tutti a 30% IV
- Rimuovere `handleChartClick` (niente piu click-to-add)
- Rimuovere pulsante "Elimina" (i punti sono fissi)
- Mantenere: drag verticale, input numerico, IV Piatta, Reset

**Simulator.tsx**:
- L'inizializzazione dei `ivPoints` in `handleDataLoaded` usa la nuova logica mensile (o delega al componente)

### File coinvolti

| File | Modifica |
|------|----------|
| `src/components/simulator/TickerSelector.tsx` | Aggiunta date picker start/end con DateInput, filtraggio dati |
| `src/components/simulator/IVCurveEditor.tsx` | Colore arancione, punti mensili fissi, rimozione click-to-add e elimina punto |
| `src/pages/Simulator.tsx` | Aggiornamento inizializzazione ivPoints con logica mensile |
