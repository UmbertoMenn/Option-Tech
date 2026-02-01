
# Piano: Short Strangle - Max Loss solo lato PUT + Warning Illimitato

## Obiettivo

Per le strategie **Short Strangle**, calcolare il Max Loss considerando **solo la PUT venduta** (rischio definito) e aggiungere un **triangolino giallo** con tooltip che spiega la convenzione adottata.

---

## Motivazione

Lo Short Strangle ha:
- **Lato PUT**: Rischio definito = Strike PUT × Contratti × 100 - Premio netto
- **Lato CALL**: Rischio teoricamente **illimitato** (il sottostante può salire all'infinito)

Visualizzare il rischio CALL illimitato non ha senso pratico. La convenzione corretta è mostrare il rischio PUT (definito) con un indicatore che avverte della natura illimitata del rischio CALL.

---

## Modifiche Previste

### 1. `src/lib/universalMaxLoss.ts`

Aggiungere funzione per riconoscere Short Strangle e calcolare solo il rischio PUT:

```typescript
/**
 * Detect if the strategy is a Short Strangle (1+ sold PUT + 1+ sold CALL, no protection)
 */
function isShortStrangle(legs: OptionLeg[]): boolean {
  const soldPuts = legs.filter(l => l.type === 'put' && l.quantity < 0);
  const soldCalls = legs.filter(l => l.type === 'call' && l.quantity < 0);
  const boughtPuts = legs.filter(l => l.type === 'put' && l.quantity > 0);
  const boughtCalls = legs.filter(l => l.type === 'call' && l.quantity > 0);
  
  // Short Strangle: solo opzioni vendute, nessuna protezione
  return soldPuts.length > 0 && soldCalls.length > 0 && 
         boughtPuts.length === 0 && boughtCalls.length === 0;
}

/**
 * Calculate Short Strangle max loss using only the PUT side.
 * Returns maxLoss @ price = 0 for the PUT leg minus net premium.
 */
function calculateShortStrangleMaxLoss(legs: OptionLeg[]): MaxLossResult {
  const soldPuts = legs.filter(l => l.type === 'put' && l.quantity < 0);
  
  // Max loss PUT side = Strike × |qty| × 100 per ogni PUT venduta
  const putMaxLoss = soldPuts.reduce((sum, put) => {
    return sum + put.strike * Math.abs(put.quantity) * 100;
  }, 0);
  
  // Net premium received (credito netto)
  const netPremium = legs.reduce((sum, l) => sum + (-l.quantity * l.avgCost * 100), 0);
  
  // Max Loss = Rischio PUT - Premio netto incassato
  const maxLoss = Math.max(0, putMaxLoss - netPremium);
  
  return {
    maxLoss,
    worstPrice: 0,
    calculation: `Short Strangle: PUT side risk @ $0 = ${putMaxLoss.toFixed(0)} - GP ${netPremium.toFixed(0)} = ${maxLoss.toFixed(0)}`,
    isUnlimited: true  // Flag per UI
  };
}
```

Modificare `calculateUniversalMaxLoss` per intercettare gli Short Strangle:

```typescript
export function calculateUniversalMaxLoss(legs: OptionLeg[]): MaxLossResult {
  // ... existing code ...
  
  // CASO SPECIALE: Short Strangle → usa solo rischio PUT
  if (isShortStrangle(legs)) {
    return calculateShortStrangleMaxLoss(legs);
  }
  
  // ... rest of existing universal calculation ...
}
```

---

### 2. `src/lib/riskCalculator.ts`

Aggiungere campo `hasUnlimitedRisk` all'interfaccia `StrategyRiskDetail`:

```typescript
export interface StrategyRiskDetail {
  strategyName: string;
  underlying: string;
  maxLoss: number;
  maxLossEUR: number;
  currency: string;
  exchangeRate: number;
  calculation: string;
  hasUnlimitedRisk: boolean;  // NUOVO: indica rischio teoricamente illimitato
}
```

Passare il flag `isUnlimited` dal risultato del calcolo:

```typescript
function calculateGroupedStrategyMaxLoss(group: GroupedOtherStrategy): { 
  maxLoss: number; 
  calculation: string;
  isUnlimited: boolean;  // NUOVO
} {
  const legs = positionsToLegs(group.options.map(o => o.option));
  const result = calculateUniversalMaxLoss(legs);
  
  return {
    maxLoss: result.maxLoss,
    calculation: `${group.strategyName}: ${result.calculation}`,
    isUnlimited: result.isUnlimited
  };
}
```

---

### 3. `src/components/risk/EquityExposureView.tsx`

Aggiungere triangolino giallo con tooltip per strategie con rischio illimitato:

```typescript
{strat.hasUnlimitedRisk && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <AlertTriangle className="w-4 h-4 text-amber-500" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium text-amber-500">Rischio Illimitato</p>
        <p className="text-sm">
          Il Max Loss mostrato considera solo il lato PUT (rischio definito). 
          Il lato CALL ha rischio teoricamente illimitato.
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

---

## UI Preview

```text
┌─────────────────────────────────────────────────────────────┐
│  Short Strangle  ⓘ  ⚠️                      €25,850        │
│  ADOBE                                    ML: USD 25,850    │
└─────────────────────────────────────────────────────────────┘
                      ↑
           Triangolo giallo: "Rischio Illimitato - 
           Il Max Loss mostrato considera solo il lato PUT..."
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/lib/universalMaxLoss.ts` | Aggiungere `isShortStrangle()` e `calculateShortStrangleMaxLoss()` |
| `src/lib/riskCalculator.ts` | Aggiungere `hasUnlimitedRisk` a `StrategyRiskDetail` e passare flag |
| `src/components/risk/EquityExposureView.tsx` | Aggiungere triangolino giallo con tooltip |

---

## Esempio Adobe

Prima (calcolo errato con rischio CALL illimitato):
- Max Loss: ~$299,850 (prezzo teorico @10x strike)

Dopo (solo rischio PUT):
- Strike PUT: $275
- Contratti: 1
- GP: $735 + $915 = $1,650
- **Max Loss PUT side: $275 × 100 - $1,650 = $25,850** ✓
- **Indicatore**: ⚠️ Rischio Illimitato (lato CALL)
