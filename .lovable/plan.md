

# Piano: Miglioramenti Carousel Grafici Storici

## Modifiche Richieste

### 1. Istogramma affiancato al grafico lineare (stessa slide)

**File**: `src/components/dashboard/HistoricalChartsCarousel.tsx`

Ristrutturare la prima slide per mostrare i due grafici affiancati:
- **Sinistra (70%)**: Grafico lineare evoluzione rendimento
- **Destra (30%)**: Istogramma rendimento per anno

Le slide diventano 2 invece di 3:
| Slide | Contenuto |
|-------|-----------|
| 1 | Evoluzione Rendimento (linea) + Rendimento per Anno (barre) |
| 2 | Evoluzione Patrimonio |

Layout CSS:
```
Slide 1:
+---------------------------+-------------+
|  LineChart (flex-[2])     | BarChart    |
|  Rendimento % e P/L       | (flex-1)    |
+---------------------------+-------------+
```

---

### 2. Fix tooltip istogramma (testo nero illeggibile)

**File**: `src/components/dashboard/charts/YearlyReturnChart.tsx`

Il tooltip ha `contentStyle` con sfondo corretto ma manca il colore del testo. Aggiungere:

```typescript
<Tooltip
  contentStyle={{
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'hsl(var(--foreground))',  // <-- AGGIUNGERE
  }}
  // ...
/>
```

---

### 3. Carousel loop infinito

**File**: `src/components/dashboard/HistoricalChartsCarousel.tsx`

Embla Carousel supporta l'opzione `loop: true` tramite la prop `opts`:

```tsx
<Carousel 
  setApi={setApi} 
  opts={{ loop: true }}  // <-- AGGIUNGERE
  className="w-full"
>
```

Con questa opzione, cliccando "next" dall'ultima slide si torna alla prima, e viceversa.

---

### 4. Linea rendimento verde

**File**: `src/components/dashboard/charts/PerformanceEvolutionChart.tsx`

Cambiare il colore della linea del rendimento da `hsl(var(--primary))` a `hsl(var(--profit))` (verde):

```tsx
// Linea 186-194
<Line
  yAxisId="left"
  type="monotone"
  dataKey="returnPct"
  stroke="hsl(var(--profit))"        // <-- CAMBIARE (era --primary)
  strokeWidth={2}
  dot={{ r: 3, fill: 'hsl(var(--profit))' }}  // <-- CAMBIARE
  activeDot={{ r: 5 }}
  name="returnPct"
/>
```

---

## Riepilogo Modifiche per File

| File | Modifiche |
|------|-----------|
| `HistoricalChartsCarousel.tsx` | Unire slide 1 e 2 in layout affiancato; aggiungere `opts={{ loop: true }}`; aggiornare array `slides` |
| `YearlyReturnChart.tsx` | Aggiungere `color: 'hsl(var(--foreground))'` al tooltip |
| `PerformanceEvolutionChart.tsx` | Cambiare colore linea da `--primary` a `--profit` |

---

## Risultato Atteso

1. Prima slide mostra grafico lineare (rendimento % e P/L) sulla sinistra e istogramma annuale sulla destra
2. Il tooltip dell'istogramma ha testo leggibile (bianco su sfondo scuro)
3. Il carousel e infinito: dall'ultima slide si puo tornare alla prima e viceversa
4. La linea del rendimento % e verde invece che blu/primary

