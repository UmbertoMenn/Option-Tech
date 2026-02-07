# Plan: Sistema di Avvisi Derivati

## ✅ COMPLETATO: Fix Avvisi Errati Multi-Leg

### Problema Risolto
La Edge Function `check-alerts` ora identifica **tutte** le strategie multi-leg prima di processare le singole posizioni.

### Logica Implementata

1. **Categorizzazione in ordine di priorità:**
   - Covered Call → identificate e marcate
   - Iron Condor → 4 gambe stessa scadenza
   - Double Diagonal → 4 gambe scadenze diverse
   - Altre Strategie → gruppi 2+ gambe (Strangle, Butterfly, Spread, ecc.)
   
2. **Set `usedPositionIds`:** tutte le gambe di strategie vengono marcate e **escluse** dagli alert singoli (Naked Put ITM, LEAP Gain, ecc.)

3. **Alert per strategie:**
   - **Iron Condor / Double Diagonal:** OOR + distanza dai lati venduti
   - **Range Strategies (Strangle, Spread, Alt DD):** OOR + distanza dai lati venduti
   - **Breakeven Strategies (Butterfly):** OOB basato su calcolo breakeven

### Risultato

| Sottostante | Strategia | Alert Generati |
|-------------|-----------|----------------|
| WESTERN DIGITAL | Double Diagonal | OOR/Distanza DD ✅ |
| ALIBABA | Put Broken Wing Butterfly | OOB ✅ |
| RIGETTI | Naked Put (singola) | Naked Put ITM ✅ |

Le gambe di strategie multi-leg **non** generano più alert singoli errati.
