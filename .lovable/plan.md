

## Modifiche al Simulatore: Rimuovere Greeks, Annotazioni sul Grafico P/L, Prezzo Sottostante nei Log

### 1. Eliminare la card Greeks

Rimuovere il componente `GreeksChart` dalla pagina Simulator:
- **`src/pages/Simulator.tsx`**: rimuovere l'import di `GreeksChart` e la riga `<GreeksChart days={backtestResult.days} />`.
- Il file `src/components/simulator/GreeksChart.tsx` puo essere lasciato (non referenziato) o eliminato.

### 2. Annotazioni operazioni sul grafico Evoluzione P/L

Aggiungere al grafico un tooltip personalizzato che, sulle barre dove sono stati effettuati aggiustamenti, mostra la descrizione dell'operazione.

**`src/components/simulator/BacktestChart.tsx`**:
- Costruire una mappa `date -> description[]` dall'`adjustmentLog` nel `useMemo`.
- Aggiungere un campo `adjustmentDesc` ai dati del chart (stringa con le descrizioni concatenate, oppure `null`).
- Sostituire il `Tooltip` generico con un componente custom che, quando `adjustmentDesc` e presente, mostra un blocco aggiuntivo con il dettaglio dell'operazione (sfondo evidenziato).
- Aggiungere dei dot personalizzati sulla linea P/L solo sulle barre con aggiustamenti (usando `dot` con render function o `Scatter`), cosi l'utente vede visivamente dove sono avvenute le operazioni.

Esempio di custom tooltip:
```text
CustomTooltip:
  - P/L: $123.45
  - Prezzo: $178.50
  - [se adjustmentDesc presente]:
    --- Operazione ---
    Roll up: chiusa CALL K175, aperta CALL K185 exp 2024-04-19
```

### 3. Prezzo sottostante nel log aggiustamenti

**`src/lib/backtestEngine.ts`**: aggiungere `underlyingPrice: number` all'interfaccia `AdjustmentLog`. Nelle funzioni che creano log di aggiustamento (`executeApproachRule`, `executeProfitRule`, `handleExpiryDoNothing`, `sellNewCallAfterExpiry`), impostare il campo con il prezzo `S` corrente.

**`src/components/simulator/BacktestResults.tsx`**: aggiungere una colonna "Prezzo Sottostante" nella tabella "Log Aggiustamenti", mostrando `adj.underlyingPrice` formattato come `$XXX.XX`.

### Dettaglio tecnico

| File | Modifica |
|------|----------|
| `src/pages/Simulator.tsx` | Rimuovere import e uso di `GreeksChart` |
| `src/components/simulator/BacktestChart.tsx` | Aggiungere `adjustmentDesc` ai dati chart; custom tooltip con dettaglio operazione; dot evidenziati sulle barre con aggiustamenti |
| `src/lib/backtestEngine.ts` | Aggiungere `underlyingPrice: number` a `AdjustmentLog`; popolare in tutte le funzioni di aggiustamento |
| `src/components/simulator/BacktestResults.tsx` | Aggiungere colonna "Sottostante" nella tabella log aggiustamenti |

### Dettaglio implementazione chart

**chartData** includera:
```text
{
  date, pl, plPct, price,
  adjustmentDesc: string | null  // "Roll up: chiusa CALL K175..." oppure null
}
```

**Custom Tooltip**: componente React che riceve `payload` e `active`. Se la barra ha `adjustmentDesc`, mostra una sezione aggiuntiva con bordo colorato e icona.

**Dot personalizzati**: sulla linea Area P/L, usare una render function per `dot` che disegna un cerchio colorato (es. arancione) solo sulle barre con `adjustmentDesc !== null`. Questo rende immediatamente visibile dove sono avvenute le operazioni senza bisogno di hover.

