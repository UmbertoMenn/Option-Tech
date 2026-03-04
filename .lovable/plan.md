

## Rimuovere il tasto "Salva Snapshot"

### Modifiche in `src/components/dashboard/Dashboard.tsx`

1. Rimuovere i due blocchi UI "Salva Snapshot" (mobile dropdown item + desktop button)
2. Rimuovere `Save` dall'import lucide-react
3. Rimuovere `isUpserting` dalla destrutturazione di `useHistoricalData`
4. Rimuovere la funzione `handleSaveSnapshot` che non sarà più referenziata

