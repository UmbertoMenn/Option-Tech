
Hai ragione: il problema non è il raggio del pallino ma il meccanismo tooltip di `ComposedChart` (modalità axis), che non usa davvero la vicinanza al marker per mostrare i dettagli operazione.  
Per risolverlo in modo definitivo senza rompere l’allineamento, cambio approccio: tooltip operazione gestito direttamente dai pallini (eventi sul marker), non dallo snap dell’asse X.

## Piano definitivo (senza regressioni)

### 1) Non toccare il mapping dati (evita errori precedenti)
File: `src/components/simulator/BacktestChart.tsx`
- Mantengo **un solo dataset**: `chartData` condiviso tra `Line` e `Scatter`.
- Nessun `scatterData` filtrato separato (così i pallini restano perfettamente allineati alla linea prezzo).

### 2) Tooltip operazione “prossimità reale” sui pallini
- Introduco stato locale: `hoveredOperation` (dato operazione + posizione mouse).
- Nel `CustomScatterDot`:
  - pallino visibile arancione (`r=7`);
  - hit-area ampia (`r=22/24`) quasi invisibile (`rgba(..., 0.001)`), `pointerEvents="all"`;
  - eventi `onMouseEnter` + `onMouseMove` per aprire/aggiornare tooltip immediatamente;
  - `onMouseLeave` per chiudere.
- Il tooltip viene renderizzato come overlay HTML custom (non dipendente dallo snap asse X), quindi si attiva appena sei vicino al pallino.

### 3) Evitare conflitti/flicker tooltip
- Quando il tooltip operazione custom è attivo, sopprimo il tooltip Recharts standard (quello axis) per evitare doppio tooltip.
- Tooltip custom con `pointer-events: none` per evitare sfarfallio quando il cursore passa vicino al box tooltip.

### 4) Sicurezza anti-regressione grafica
- Non cambio assi, brush, linea prezzo, dominio Y o ordinamento date.
- Mantengo la logica descrizioni operazioni (join per date uguali) invariata.
- Il `CustomTooltip` attuale resta come fallback quando non c’è hover operazione custom.

## Dettagli tecnici implementativi
- `useState<HoveredOperation | null>` nel componente.
- `CustomScatterDot` convertito in renderer collegato allo stato (con handler mouse).
- Tooltip custom posizionato con coordinate cursore (`clientX/clientY` o coordinate chart convertite), offset leggero per leggibilità.
- Condizione render: solo se `payload.adjustmentDesc` presente.

## Verifica E2E (obbligatoria)
1. Esegui backtest su `/simulator` con più operazioni.
2. Muovi il mouse **vicino** ai pallini (senza centrarli): tooltip deve comparire subito.
3. Verifica che i pallini restino allineati alla linea prezzo.
4. Verifica assenza flicker e assenza doppio tooltip.
5. Test rapido desktop + viewport mobile/tablet per assicurare usabilità hover/focus.
