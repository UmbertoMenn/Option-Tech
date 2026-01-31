

# Piano: Carousel in Risk Analyzer con Currency Exposure

## Obiettivo

Trasformare la pagina Risk Analyzer in un carousel a due viste:
1. **Equity Exposure** - La pagina attuale (esposizione per categoria di rischio)
2. **Currency Exposure** - Nuova vista che aggrega i rischi per valuta

---

## Architettura UI

### Struttura della Pagina

```text
+----------------------------------------------------------+
|  Header (invariato)                                       |
+----------------------------------------------------------+
|                                                          |
|    [<]  ●  ○   Vista: Equity Exposure              [>]   |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  Contenuto dinamico basato sulla vista selezionata       |
|                                                          |
+----------------------------------------------------------+
```

### Vista Currency Exposure

```text
+----------------------------------------------------------+
|                   CURRENCY EXPOSURE                       |
+----------------------------------------------------------+
|                                                          |
|      [Grafico Anello Grande e Sottile]                   |
|                                                          |
|              Esposizione: € 245.000                      |
|                                                          |
|           USD  ████████████████  65.2%                   |
|           EUR  ██████████        28.3%                   |
|           GBP  ███               4.1%                    |
|           JPY  █                 2.4%                    |
|                                                          |
+----------------------------------------------------------+
|                                                          |
|  Dettaglio per Valuta (accordion):                       |
|                                                          |
|  ▼ USD - € 159.740 (65.2%)                               |
|    • Stocks: € 85.000                                    |
|    • Naked PUT: € 45.000                                 |
|    • Strategie: € 29.740                                 |
|                                                          |
|  ▼ EUR - € 69.345 (28.3%)                                |
|    • Stocks: € 42.000                                    |
|    • Commodities: € 27.345                               |
|                                                          |
+----------------------------------------------------------+
```

---

## Logica di Calcolo Currency Exposure

I dati esistenti in `RiskAnalysis` contengono già la valuta per ogni posizione:

```typescript
interface CurrencyExposure {
  currency: string;
  totalRisk: number;         // In EUR
  percentage: number;
  breakdown: {
    stocks: number;
    commodities: number;
    nakedPuts: number;
    leapCalls: number;
    strategies: number;
  };
}

function calculateCurrencyExposure(analysis: RiskAnalysis): CurrencyExposure[] {
  const byCurrency = new Map<string, CurrencyExposure>();
  
  // Aggrega stockDetails per valuta
  for (const stock of analysis.stockDetails) {
    const curr = stock.currency;
    if (!byCurrency.has(curr)) {
      byCurrency.set(curr, { currency: curr, totalRisk: 0, breakdown: {...} });
    }
    byCurrency.get(curr)!.breakdown.stocks += stock.riskEUR;
    byCurrency.get(curr)!.totalRisk += stock.riskEUR;
  }
  
  // Ripeti per commodityDetails, nakedPutDetails, leapCallDetails, strategyDetails
  // ...
  
  // Calcola percentuali
  const total = analysis.grandTotal;
  return Array.from(byCurrency.values()).map(c => ({
    ...c,
    percentage: (c.totalRisk / total) * 100
  })).sort((a, b) => b.totalRisk - a.totalRisk);
}
```

---

## Componenti da Creare/Modificare

| File | Azione | Descrizione |
|------|--------|-------------|
| `src/pages/RiskAnalyzer.tsx` | Modificare | Aggiungere state viewMode e carousel, separare contenuti in componenti |
| `src/components/risk/RiskViewModeSelector.tsx` | Creare | Selettore carousel simile a ViewModeSelector |
| `src/components/risk/EquityExposureView.tsx` | Creare | Estrarre contenuto attuale della pagina |
| `src/components/risk/CurrencyExposureView.tsx` | Creare | Nuova vista con aggregazione per valuta |
| `src/lib/currencyExposure.ts` | Creare | Logica di calcolo esposizione valutaria |

---

## Dettagli Implementazione

### 1. RiskViewModeSelector

Componente simile a `ViewModeSelector` della Dashboard:

```typescript
export type RiskViewMode = 'equity' | 'currency';

const VIEW_LABELS: Record<RiskViewMode, string> = {
  equity: 'Equity Exposure',
  currency: 'Currency Exposure',
};

// UI: frecce + dots + label
```

### 2. CurrencyExposureView

Componente principale per la nuova vista:

- **Card Totale** con valore esposizione totale (stesso grandTotal)
- **Grafico Anello** grande (300x300) e sottile (innerRadius alto)
- **Legenda** colorata per valuta
- **Accordion** con breakdown per categoria dentro ogni valuta

### 3. Grafico Anello

Utilizzo di Recharts (già importato):

```typescript
<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie
      data={currencyData}
      cx="50%"
      cy="50%"
      innerRadius={100}   // Sottile
      outerRadius={130}
      paddingAngle={2}
      dataKey="totalRisk"
    >
      {currencyData.map((entry, index) => (
        <Cell key={index} fill={CURRENCY_COLORS[entry.currency]} />
      ))}
    </Pie>
  </PieChart>
</ResponsiveContainer>
```

### 4. Mappa Colori Valute

```typescript
const CURRENCY_COLORS: Record<string, string> = {
  'USD': '#3b82f6',  // Blue
  'EUR': '#22c55e',  // Green
  'GBP': '#a855f7',  // Purple
  'JPY': '#f59e0b',  // Amber
  'CHF': '#ef4444',  // Red
  'CAD': '#06b6d4',  // Cyan
  'AUD': '#f97316',  // Orange
  'OTHER': '#6b7280' // Gray
};
```

---

## Flusso Dati

```text
useRiskAnalysis()
       |
       v
{stockDetails, commodityDetails, nakedPutDetails, leapCallDetails, strategyDetails}
       |
       +---------> EquityExposureView (vista attuale)
       |
       +---------> calculateCurrencyExposure()
                          |
                          v
                   CurrencyExposure[]
                          |
                          v
                   CurrencyExposureView (nuova vista)
```

---

## Struttura RiskAnalyzer Refactored

```tsx
export function RiskAnalyzer() {
  const [viewMode, setViewMode] = useState<RiskViewMode>('equity');
  const riskAnalysis = useRiskAnalysis();
  
  // Calcola currency exposure dai dati esistenti
  const currencyExposure = useMemo(() => 
    calculateCurrencyExposure(riskAnalysis), 
    [riskAnalysis]
  );
  
  return (
    <div>
      {/* Header invariato */}
      
      <main>
        {/* Carousel selector */}
        <RiskViewModeSelector 
          viewMode={viewMode} 
          onViewModeChange={setViewMode} 
        />
        
        {/* Contenuto dinamico */}
        {viewMode === 'equity' ? (
          <EquityExposureView analysis={riskAnalysis} />
        ) : (
          <CurrencyExposureView 
            currencyExposure={currencyExposure}
            grandTotal={riskAnalysis.grandTotal}
          />
        )}
      </main>
    </div>
  );
}
```

---

## Vantaggi

1. **Riutilizzo dati**: Nessuna nuova query - usa gli stessi dati già calcolati
2. **Pattern coerente**: Stesso stile carousel della Dashboard
3. **Grafico visivo**: Anello grande e sottile per impatto visivo immediato
4. **Breakdown dettagliato**: Accordion mostra da dove viene ogni esposizione valutaria
5. **Estendibile**: Facile aggiungere altre viste al carousel in futuro

