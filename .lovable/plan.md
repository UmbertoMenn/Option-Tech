

## Fix: linea prezzo invisibile nel grafico Backtest

### Problema

Il `BacktestChart` usa `stroke="hsl(var(--chart-2))"` per la linea del prezzo, ma la variabile CSS `--chart-2` **non è definita** nel tema. Il CSS definisce variabili custom come `--chart-bonds`, `--chart-stocks`, ecc. — ma non le standard `--chart-1` ... `--chart-5`. Il risultato è che la linea viene renderizzata con colore trasparente/invisibile.

### Soluzione

In `src/components/simulator/BacktestChart.tsx`, sostituire `hsl(var(--chart-2))` con un colore che esiste nel tema, ad esempio `hsl(var(--primary))` (blu elettrico) oppure un colore fisso come `#3b82f6`.

**File: `src/components/simulator/BacktestChart.tsx`** — riga 91:
- Da: `stroke="hsl(var(--chart-2))"`  
- A: `stroke="hsl(var(--primary))"`

Modifica singola, una riga.

