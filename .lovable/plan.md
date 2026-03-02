

## Organizzare le date in modo sintetico con raggruppamento per anno/mese

### Problema
Sia il selettore date nella card PL che la lista snapshot nei Dati Storici mostrano tutte le date in una lista piatta. Con molti dati, lo scroll diventa infinito.

### Soluzione

**1. Card PL - Selettore data (StatsCards.tsx, righe 402-421)**

Raggruppare le date per anno dentro il `<SelectContent>`, usando `<SelectGroup>` + `<SelectLabel>` di Radix per creare sezioni collassabili visive:

```
── 2025 ──
  28 feb
  31 gen
── 2024 ──
  31 dic
  30 nov
  ...
```

- Raggruppare `historicalData` per anno con un `useMemo`
- Usare `<SelectGroup>` con `<SelectLabel>` per ogni anno
- Formattare le date in modo compatto: `dd MMM` (giorno e mese abbreviato), mostrando l'anno solo nell'intestazione del gruppo
- Aggiungere `max-h-[250px]` e `overflow-y-auto` al `SelectContent` per limitare l'altezza

**2. Dati Storici - Lista snapshot (HistoricalDataForm.tsx, righe 200-287)**

Raggruppare gli snapshot per anno con intestazioni visive:

- Raggruppare le entry per anno
- Mostrare un'intestazione anno (es. `── 2025 ──`) come separatore
- Ogni entry mostra solo `dd MMMM` senza l'anno (già nel gruppo)
- Mantenere il `max-h-[300px]` esistente

### File modificati
- `src/components/dashboard/StatsCards.tsx` — raggruppamento per anno nel Select
- `src/components/dashboard/HistoricalDataForm.tsx` — raggruppamento per anno nella lista snapshot

