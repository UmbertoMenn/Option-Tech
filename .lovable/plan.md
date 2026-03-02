

## Semplificare il grafico Backtest: solo Prezzo + Operazioni

### Modifiche in `src/components/simulator/BacktestChart.tsx`

1. **Rimuovere** la linea `stockPL` e l'area `strategyPL` (con relativo gradiente)
2. **Rimuovere** l'asse Y sinistro (`yAxisId="pl"`) e la `ReferenceLine` a y=0
3. **Promuovere** la linea `price` come unica serie: asse Y sinistro, `strokeWidth={2}`, `opacity={1}`, colore pieno
4. **Mantenere** i dot delle operazioni (pallini `CustomDot`) sulla linea del prezzo
5. **Rimuovere** la `Legend` (una sola serie, non serve)
6. **Aggiornare** il tooltip: mostrare solo Prezzo e descrizione operazione, rimuovere P/L Sottostante e P/L Strategia
7. **Rimuovere** i campi `stockPL` e `strategyPL` da `chartData` e `ChartDataPoint`

