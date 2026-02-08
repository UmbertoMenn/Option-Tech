

# Piano: Aggiunta Toggle Naked Put, Strategie, Leap Call in Equity Exposure

## Obiettivo

Aggiungere tre nuovi toggle nella vista Equity Exposure (sotto il toggle "Protezioni") per includere/escludere dal calcolo totale:
- **Naked Put**
- **Strategie** 
- **Leap Call**

## Situazione Attuale

| Toggle | Stato |
|--------|-------|
| Protezioni | ✅ Già implementato |
| Naked Put | ❌ Da aggiungere |
| Strategie | ❌ Da aggiungere |
| Leap Call | ❌ Da aggiungere |

Attualmente il `dynamicGrandTotal` somma sempre tutti i componenti:
```typescript
const dynamicGrandTotal = useMemo(() => {
  const stockRisk = includeProtections ? totalPureStockRisk : grossPureStockRisk;
  return totalETFRisk + stockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk;
}, [...]);
```

---

## Modifiche

### 1. Nuovi Stati per i Toggle

Aggiungere 3 nuovi state hooks:

```typescript
const [includeProtections, setIncludeProtections] = useState(true);
const [includeNakedPut, setIncludeNakedPut] = useState(true);      // NUOVO
const [includeStrategies, setIncludeStrategies] = useState(true);  // NUOVO
const [includeLeapCall, setIncludeLeapCall] = useState(true);      // NUOVO
```

---

### 2. Aggiornare `dynamicGrandTotal`

Modificare il calcolo per rispettare i toggle:

```typescript
const dynamicGrandTotal = useMemo(() => {
  const stockRisk = includeProtections ? totalPureStockRisk : grossPureStockRisk;
  
  return (
    totalETFRisk + 
    stockRisk + 
    totalCommodityRisk + 
    (includeNakedPut ? totalNakedPutRisk : 0) +
    (includeLeapCall ? totalLeapCallRisk : 0) +
    (includeStrategies ? totalStrategyRisk : 0)
  );
}, [
  includeProtections, 
  includeNakedPut, 
  includeLeapCall, 
  includeStrategies,
  totalETFRisk, 
  totalPureStockRisk, 
  grossPureStockRisk, 
  totalCommodityRisk, 
  totalNakedPutRisk, 
  totalLeapCallRisk, 
  totalStrategyRisk
]);
```

---

### 3. Aggiornare `riskCategories`

Le categorie devono riflettere i toggle:

```typescript
const riskCategories = [
  // ... ETF, Stocks, Commodities (invariati)
  { 
    label: 'Rischio Naked PUT', 
    value: includeNakedPut ? totalNakedPutRisk : 0,  // Condizionale
    sortValue: totalNakedPutRisk,
    // ...
  },
  { 
    label: 'Rischio Leap Call', 
    value: includeLeapCall ? totalLeapCallRisk : 0,  // Condizionale
    sortValue: totalLeapCallRisk,
    // ...
  },
  { 
    label: 'Rischio Strategie', 
    value: includeStrategies ? totalStrategyRisk : 0,  // Condizionale
    sortValue: totalStrategyRisk,
    // ...
  },
];
```

---

### 4. Layout Toggle - Colonna Verticale

Modificare il layout della card per mostrare i toggle impilati verticalmente sotto il titolo:

```text
┌─────────────────────────────────────────────────────────────┐
│ 🛡️ Esposizione in Equity e Commodities  ℹ️                 │
│                                                             │
│ €1,234,567                                                  │
│ Somma di tutte le categorie di rischio                      │
│ (45.2% del valore asset)                                    │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [✓] Protezioni  [✓] Naked Put  [✓] Strategie  [✓] Leap  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

Layout orizzontale con i 4 toggle in una riga per sfruttare lo spazio:

```tsx
<div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-border/50">
  <div className="flex items-center gap-2">
    <Switch id="protections-toggle" checked={includeProtections} onCheckedChange={setIncludeProtections} />
    <Label htmlFor="protections-toggle" className="text-sm">Protezioni</Label>
  </div>
  <div className="flex items-center gap-2">
    <Switch id="naked-put-toggle" checked={includeNakedPut} onCheckedChange={setIncludeNakedPut} />
    <Label htmlFor="naked-put-toggle" className="text-sm">Naked Put</Label>
  </div>
  <div className="flex items-center gap-2">
    <Switch id="strategies-toggle" checked={includeStrategies} onCheckedChange={setIncludeStrategies} />
    <Label htmlFor="strategies-toggle" className="text-sm">Strategie</Label>
  </div>
  <div className="flex items-center gap-2">
    <Switch id="leap-call-toggle" checked={includeLeapCall} onCheckedChange={setIncludeLeapCall} />
    <Label htmlFor="leap-call-toggle" className="text-sm">Leap Call</Label>
  </div>
</div>
```

---

### 5. Aggiornare le Holdings Consolidate

Passare i nuovi flag a `calculateConsolidatedTopHoldings` per escludere le componenti non selezionate:

```typescript
const consolidatedHoldings = useMemo(() => {
  return calculateConsolidatedTopHoldings(analysis, etfAllocations, { 
    includeProtections,
    includeNakedPut,      // NUOVO
    includeStrategies,    // NUOVO
    includeLeapCall       // NUOVO
  });
}, [analysis, etfAllocations, includeProtections, includeNakedPut, includeStrategies, includeLeapCall]);
```

---

### 6. Aggiornare `calculateConsolidatedTopHoldings` (sectorExposure.ts)

Modificare la funzione per accettare i nuovi flag opzionali:

```typescript
interface ConsolidatedOptions {
  includeProtections?: boolean;
  includeNakedPut?: boolean;
  includeStrategies?: boolean;
  includeLeapCall?: boolean;
}

export function calculateConsolidatedTopHoldings(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: ConsolidatedOptions = {}
): ConsolidatedHoldingWithDetails[] {
  const { 
    includeProtections = true, 
    includeNakedPut = true,
    includeStrategies = true,
    includeLeapCall = true
  } = options;
  
  // Nel calcolo del totalRisk per ogni holding:
  // totalRisk = stockRisk + (includeNakedPut ? nakedPutRisk : 0) + ...
}
```

---

### 7. Aggiornare Tooltip Esplicativo

Aggiornare il tooltip della card principale per riflettere i nuovi toggle:

```typescript
<TooltipContent className="max-w-xs text-sm">
  <p>Usa i toggle per includere/escludere componenti dal totale:</p>
  <ul className="list-disc ml-4 mt-1">
    <li><b>Protezioni</b>: calcola azioni al netto delle Long PUT</li>
    <li><b>Naked Put</b>: include rischio Naked PUT (Strike × Ctr × 100)</li>
    <li><b>Strategie</b>: include Max Loss delle strategie</li>
    <li><b>Leap Call</b>: include valore di mercato Leap Call</li>
  </ul>
</TooltipContent>
```

---

## File Coinvolti

| File | Modifiche |
|------|-----------|
| `src/components/risk/EquityExposureView.tsx` | Nuovi toggle, calcolo dinamico, layout |
| `src/lib/sectorExposure.ts` | Estendere options per `calculateConsolidatedTopHoldings` |

---

## Comportamento Atteso

| Toggle | ON (default) | OFF |
|--------|--------------|-----|
| Protezioni | Azioni nette | Azioni lorde |
| Naked Put | Incluso nel totale | Escluso (mostra 0) |
| Strategie | Incluso nel totale | Escluso (mostra 0) |
| Leap Call | Incluso nel totale | Escluso (mostra 0) |

Quando un toggle è OFF:
1. Il valore viene escluso dal `dynamicGrandTotal`
2. La barra nella distribuzione mostra 0%
3. La categoria rimane visibile ma "spenta" nel grafico

---

## Vantaggi

1. **Flessibilità**: L'utente può vedere l'esposizione pura in azioni senza derivati
2. **Analisi scenari**: Confrontare rischio base vs rischio con derivati
3. **Coerenza**: Stesso pattern UX del toggle Protezioni esistente

