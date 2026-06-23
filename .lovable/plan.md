## Obiettivo
Rendere la pagina Risk / Margin Simulator (`RiskSimulator.tsx`) completamente compatibile con il tema chiaro, attualmente bloccata sui colori scuri hardcodati.

## Problema
Il componente `StressLabContent` e tutte le card interne (`Panel`) usano un oggetto `C` con colori esadecimali fissi (`#0B0E14`, `#131722`, `#1E222D`, `#D1D4DC`, ecc.). Quando l'utente passa al tema chiaro:
- Il contorno della pagina (header, container) cambia correttamente (usa classi Tailwind tematiche).
- La sezione centrale (sfondo, card, bordi, testi) rimane scura perché gli stili sono inline.

## Piano di refactoring

1. **Tema dinamico**: leggere il tema attivo da `next-themes` dentro `StressLabContent`.

2. **Palette condizionale**: sostituire l'oggetto costante `C` con un oggetto `colors` calcolato al render in base al tema:
   - Dark → valori attuali (terminal-style).
   - Light → valori chiari mappati su `hsl(var(--card))`, `hsl(var(--card-foreground))`, `hsl(var(--border))`, ecc.

3. **Componenti interni**: aggiornare `Panel`, `Info`, `StatCard` e le parti del return di `StressLabContent` per usare il nuovo oggetto `colors` invece di `C`.

4. **Stili globali inline**: convertire il blocco `<style>` del range/table/scrollbar per usare le variabili CSS tematiche o classi Tailwind.

5. **Recharts**: passare i colori dinamici anche alle prop `stroke` e `fill` dei grafici.

6. **Verifica visiva**: scattare screenshot in entrambi i temi per confermare leggibilità.

## Considerazioni
- Il file ha ~2400 linee con molti riferimenti a `C`; la modifica sarà estesa ma meccanica.
- Non si tocca la logica matematica (`src/lib/stressLab.ts`, `useStressLab.ts`).
- Si mantiene l'aspetto "terminal" nel tema scuro; nel tema chiaro si adatta alle variabili del design system.
