
# Piano: Tooltip Dettagliato con Calcoli Reali - Istogramma Rendimento Annuo

## Obiettivo

Mostrare nel tooltip dell'istogramma i calcoli effettuati con i numeri reali, in modo che l'utente possa vedere esattamente come viene calcolato il rendimento annuo.

## Esempio di Tooltip Atteso

```
Anno 2024

Valore iniziale:     € 850.000
Valore finale:       € 920.000
Versamenti:          € 20.000
────────────────────────────────
P/L:                 € 50.000
Giacenza media:      € 860.000
────────────────────────────────
Rendimento:          +5,81%

Formula: (920.000 - 850.000 - 20.000) / (850.000 + 20.000/2) × 100
```

---

## Modifiche

### File: `src/components/dashboard/charts/YearlyReturnChart.tsx`

#### 1. Espandere l'interfaccia `YearlyDataPoint`

Includere tutti i valori intermedi necessari per il tooltip:

```typescript
interface YearlyDataPoint {
  year: string;
  returnPct: number;
  startValue: number;    // NUOVO
  endValue: number;      // NUOVO
  deposits: number;      // NUOVO (yearDeposits)
  pl: number;            // NUOVO
  avgBalance: number;    // NUOVO
}
```

#### 2. Salvare i valori nel data array

Nel `useMemo`, salvare tutti i valori calcolati:

```typescript
data.push({
  year,
  returnPct,
  startValue,    // NUOVO
  endValue,      // NUOVO
  deposits: yearDeposits,  // NUOVO
  pl,            // NUOVO
  avgBalance,    // NUOVO
});
```

#### 3. Creare un Custom Tooltip

Sostituire il Tooltip standard con un componente custom che mostra il breakdown completo:

```typescript
import { formatEUR, formatPercentage, formatNumber } from '@/lib/formatters';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: YearlyDataPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  
  const data = payload[0].payload;
  const isProfit = data.returnPct >= 0;
  
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-semibold text-foreground mb-2">Anno {data.year}</p>
      
      <div className="space-y-1 text-muted-foreground">
        <div className="flex justify-between gap-4">
          <span>Valore iniziale:</span>
          <span className="text-foreground font-medium">{formatEUR(data.startValue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Valore finale:</span>
          <span className="text-foreground font-medium">{formatEUR(data.endValue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Versamenti:</span>
          <span className="text-foreground font-medium">{formatEUR(data.deposits)}</span>
        </div>
      </div>
      
      <div className="border-t border-border my-2" />
      
      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>P/L:</span>
          <span className={`font-medium ${isProfit ? 'text-profit' : 'text-loss'}`}>
            {formatEUR(data.pl)}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>Giacenza media:</span>
          <span className="text-foreground font-medium">{formatEUR(data.avgBalance)}</span>
        </div>
      </div>
      
      <div className="border-t border-border my-2" />
      
      <div className="flex justify-between gap-4">
        <span className="font-semibold">Rendimento:</span>
        <span className={`font-bold ${isProfit ? 'text-profit' : 'text-loss'}`}>
          {formatPercentage(data.returnPct)}
        </span>
      </div>
      
      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
        P/L ÷ (Valore iniziale + Versamenti/2)
      </p>
    </div>
  );
}
```

#### 4. Usare il Custom Tooltip nel grafico

```tsx
<Tooltip content={<CustomTooltip />} />
```

---

## Struttura del Tooltip Finale

| Sezione | Contenuto |
|---------|-----------|
| **Header** | Anno XXXX |
| **Valori** | Valore iniziale, Valore finale, Versamenti |
| **Calcoli** | P/L, Giacenza media |
| **Risultato** | Rendimento % (colorato) |
| **Formula** | Spiegazione breve della formula |

---

## File Coinvolti

| File | Modifiche |
|------|-----------|
| `src/components/dashboard/charts/YearlyReturnChart.tsx` | Espandi data model, aggiungi custom tooltip |

---

## Vantaggi

1. **Trasparenza**: L'utente vede esattamente come viene calcolato il rendimento
2. **Debug facile**: Se qualcosa non torna, i numeri sono visibili
3. **Educativo**: Mostra la formula della giacenza media ponderata
