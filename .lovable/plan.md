
# Piano: Toggle Inclusione/Esclusione Derivati in Currency Exposure

## Obiettivo

Aggiungere un controllo toggle nella vista Currency Exposure del Risk Analyzer che permette di includere o escludere i derivati dall'analisi valutaria con un click.

---

## Componenti Interessati

| Categoria | Inclusa nel Toggle |
|-----------|-------------------|
| Stocks & ETF | ❌ Sempre incluso |
| Commodities | ❌ Sempre incluso |
| **Naked PUT** | ✅ Toggle |
| **Leap Call** | ✅ Toggle |
| **Strategie** | ✅ Toggle |

---

## Modifiche Previste

### 1. `src/lib/currencyExposure.ts`

Aggiungere un parametro opzionale alla funzione `calculateCurrencyExposure`:

```typescript
export interface CurrencyExposureOptions {
  includeDerivatives?: boolean; // default: true
}

export function calculateCurrencyExposure(
  analysis: RiskAnalysis, 
  options: CurrencyExposureOptions = {}
): CurrencyExposure[] {
  const { includeDerivatives = true } = options;
  
  // ... aggregazione stocks e commodities (sempre inclusi)
  
  if (includeDerivatives) {
    // Aggregare nakedPuts, leapCalls, strategies
  }
  
  // ...
}
```

---

### 2. `src/components/risk/CurrencyExposureView.tsx`

Aggiungere un toggle switch nell'header della vista:

```typescript
interface CurrencyExposureViewProps {
  // ... props esistenti
  includeDerivatives: boolean;
  onIncludeDerivativesChange: (value: boolean) => void;
}

// Nel render, vicino alla card "Esposizione Valutaria Totale":
<div className="flex items-center gap-2">
  <Switch 
    checked={includeDerivatives} 
    onCheckedChange={onIncludeDerivativesChange}
  />
  <Label className="text-sm">Includi Derivati</Label>
</div>
```

---

### 3. `src/pages/RiskAnalyzer.tsx`

Gestire lo stato del toggle e ricalcolare l'esposizione:

```typescript
const [includeDerivatives, setIncludeDerivatives] = useState(true);

const baseCurrencyExposure = useMemo(() => 
  calculateCurrencyExposure(analysis, { includeDerivatives }), 
  [analysis, includeDerivatives]
);

// Passare props al componente
<CurrencyExposureView 
  includeDerivatives={includeDerivatives}
  onIncludeDerivativesChange={setIncludeDerivatives}
  // ... altre props
/>
```

---

## UI Design

```text
┌─────────────────────────────────────────────────────────┐
│  [Esposizione Valutaria Totale]    [🔘 Includi Derivati]│
├─────────────────────────────────────────────────────────┤
│  €XXX,XXX                                               │
│  Non-EUR totale: €YYY,YYY                              │
│                                                         │
│  (quando toggle OFF)                                    │
│  ⚠️ Derivati esclusi dall'analisi                      │
└─────────────────────────────────────────────────────────┘
```

Il toggle sarà posizionato nella card principale con:
- Switch visibile con label "Includi Derivati"
- Indicatore visivo quando i derivati sono esclusi
- Ricalcolo immediato al click

---

## File da Modificare

| File | Azione |
|------|--------|
| `src/lib/currencyExposure.ts` | Aggiungere parametro `includeDerivatives` |
| `src/components/risk/CurrencyExposureView.tsx` | Aggiungere toggle switch UI |
| `src/pages/RiskAnalyzer.tsx` | Gestire stato e passare props |

---

## Risultato Atteso

- Toggle ON (default): Mostra esposizione completa con tutti i derivati
- Toggle OFF: Mostra solo Stocks, ETF e Commodities

La modifica è istantanea e il grafico a ciambella si aggiorna automaticamente.
