
# Piano: Calcolo Robusto del Max Loss per le Strategie di Derivati

## Problema Identificato

Il calcolo attuale del Max Loss in `src/lib/riskCalculator.ts` presenta diverse criticità:

1. **Logica frammentata**: Il riconoscimento delle strategie si basa sui nomi (es. `Short Strangle`, `Bull Put Spread`) invece che sulla struttura matematica effettiva
2. **Assunzioni errate sui premi**: Il calcolo GP usa `avg_cost` ma non considera correttamente il segno (acquisto/vendita)
3. **Fallback imprecisi**: Quando la strategia non viene riconosciuta, il fallback non è sempre corretto
4. **Nessun controllo di backup**: Non c'è validazione che il max loss calcolato abbia senso

## Soluzione: Calcolo Universale Basato sulla Struttura

Implementare un algoritmo universale che calcola il max loss **senza dipendere dal nome della strategia**, basandosi solo su:
- **Segno della quantità**: qty < 0 = venduto, qty > 0 = comprato
- **Tipo opzione**: call o put
- **Strike price**
- **Premio pagato/incassato**: avg_cost × |qty| × 100

---

## Formula Universale del Max Loss

### Principio Base

Per QUALSIASI strategia di opzioni, il max loss si verifica in uno di questi scenari:
1. **Sottostante → 0**: Massimo rischio lato PUT
2. **Sottostante → ∞**: Massimo rischio lato CALL (teorico)
3. **Sottostante → strike specifico**: Per strategie limitate

### Calcolo del Payoff a Scadenza

```text
Per ogni opzione:
  Payoff CALL = max(0, Prezzo - Strike) × 100 × qty
  Payoff PUT  = max(0, Strike - Prezzo) × 100 × qty
  
  Premio = -qty × avg_cost × 100
  (negativo per vendute = incassato, positivo per comprate = pagato)
  
  Risultato Netto = Σ(Payoff + Premio) per tutte le gambe
```

### Scenari di Calcolo

| Scenario | Prezzo Sottostante | Rischio Principale |
|----------|-------------------|-------------------|
| PUT side | 0 | PUT vendute vanno ITM max |
| CALL side | Max strike + 100% | CALL vendute vanno ITM |
| Strike points | Ogni strike presente | Trova punto di max loss |

---

## Implementazione Tecnica

### 1. Nuova Funzione `calculateUniversalMaxLoss`

```typescript
interface OptionLeg {
  type: 'call' | 'put';
  strike: number;
  quantity: number;      // + = comprato, - = venduto
  avgCost: number;       // premio per contratto
}

function calculateUniversalMaxLoss(legs: OptionLeg[]): {
  maxLoss: number;
  worstPrice: number;
  calculation: string;
} {
  // Trova tutti i punti critici (strike + estremi)
  const strikes = legs.map(l => l.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  
  // Punti da testare: 0, ogni strike, max strike + 100
  const testPrices = [
    0,
    ...strikes,
    maxStrike + 100,
    maxStrike + 1000  // Per call scoperte
  ];
  
  let worstPayoff = Infinity;
  let worstPrice = 0;
  
  for (const price of testPrices) {
    const payoff = calculatePayoffAtPrice(legs, price);
    if (payoff < worstPayoff) {
      worstPayoff = payoff;
      worstPrice = price;
    }
  }
  
  // Payoff negativo = perdita → max loss = abs(payoff)
  return {
    maxLoss: Math.max(0, -worstPayoff),
    worstPrice,
    calculation: `Payoff @ $${worstPrice} = ${worstPayoff.toFixed(0)}`
  };
}
```

### 2. Funzione Helper `calculatePayoffAtPrice`

```typescript
function calculatePayoffAtPrice(legs: OptionLeg[], price: number): number {
  let totalPayoff = 0;
  
  for (const leg of legs) {
    const contracts = Math.abs(leg.quantity);
    const isLong = leg.quantity > 0;
    const multiplier = 100;
    
    // Valore intrinseco a scadenza
    let intrinsic: number;
    if (leg.type === 'call') {
      intrinsic = Math.max(0, price - leg.strike);
    } else {
      intrinsic = Math.max(0, leg.strike - price);
    }
    
    // Payoff dell'opzione
    const intrinsicValue = intrinsic * multiplier * contracts;
    
    // Premio: per LONG abbiamo pagato, per SHORT abbiamo incassato
    const premium = leg.avgCost * multiplier * contracts;
    
    if (isLong) {
      // Long: guadagno intrinseco - premio pagato
      totalPayoff += intrinsicValue - premium;
    } else {
      // Short: premio incassato - perdita intrinseca
      totalPayoff += premium - intrinsicValue;
    }
  }
  
  return totalPayoff;
}
```

### 3. Controllo di Backup (Sanity Check)

```typescript
function validateMaxLoss(legs: OptionLeg[], calculatedMaxLoss: number): number {
  // Backup 1: Per strategie con PUT vendute, max loss ≤ strike massimo × contratti × 100
  const soldPuts = legs.filter(l => l.type === 'put' && l.quantity < 0);
  const maxPutStrike = Math.max(...soldPuts.map(l => l.strike), 0);
  const totalPutContracts = soldPuts.reduce((s, l) => s + Math.abs(l.quantity), 0);
  const maxPutRisk = maxPutStrike * 100 * totalPutContracts;
  
  // Backup 2: Premium netto pagato/incassato
  const netPremium = legs.reduce((sum, l) => {
    return sum + (-l.quantity * l.avgCost * 100);
  }, 0);
  
  // Se abbiamo spread (PUT comprate che proteggono), usa spread width
  const boughtPuts = legs.filter(l => l.type === 'put' && l.quantity > 0);
  if (boughtPuts.length > 0 && soldPuts.length > 0) {
    const soldStrike = Math.max(...soldPuts.map(l => l.strike));
    const boughtStrike = Math.min(...boughtPuts.map(l => l.strike));
    const spreadWidth = Math.max(0, soldStrike - boughtStrike);
    const spreadRisk = spreadWidth * 100 * totalPutContracts - Math.max(0, netPremium);
    
    // Max loss non può superare spread risk
    return Math.min(calculatedMaxLoss, Math.max(0, spreadRisk));
  }
  
  return calculatedMaxLoss;
}
```

---

## Mapping per Ogni Tipo di Strategia

| Strategia | Formula Max Loss |
|-----------|-----------------|
| **Iron Condor** | max(PUT spread, CALL spread) × 100 × contratti - GP |
| **Double Diagonal** | Come Iron Condor (scadenze diverse non cambiano il max loss a scadenza corta) |
| **Bull Put Spread** | (Sold strike - Bought strike) × 100 × contratti - GP |
| **Bear Call Spread** | (Bought strike - Sold strike) × 100 × contratti - GP |
| **Short Strangle** | Sold PUT strike × 100 × contratti (rischio put side, call side infinito) |
| **Long Strangle** | Premio totale pagato |
| **Butterfly** | Larghezza ala × 100 × contratti - GP |
| **Naked Call** | Illimitato → stima conservativa |

**Tutti calcolati con la formula universale!**

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/lib/riskCalculator.ts` | Nuove funzioni universali + refactor calcoli esistenti |

---

## Esempio Pratico

Dati dal database - Accenture:

| Tipo | Strike | Qty | Avg Cost |
|------|--------|-----|----------|
| PUT | 380 | -1 | 110.30 |
| PUT | 220 | +1 | 12.20 |

**Calcolo attuale** (probabilmente errato):
- Potrebbe non riconoscere come Bull Put Spread

**Nuovo calcolo universale**:

```text
Test @ $0:
  PUT 380 venduta: 38000 intrinseco - 11030 premio = -26970
  PUT 220 comprata: 22000 intrinseco - 1220 premio = +20780
  Totale: -6190 → Max Loss = $6,190

Test @ $220:
  PUT 380 venduta: 16000 intrinseco - 11030 premio = -4970
  PUT 220 comprata: 0 intrinseco - 1220 premio = -1220
  Totale: -6190 → Max Loss = $6,190

Spread Width = 380 - 220 = 160
GP = 11030 - 1220 = 9810
Max Loss = (160 × 100 × 1) - 9810 = 6190 ✓
```

---

## Output Finale

```text
Calcolo robusto del Max Loss:
1. Analizza ogni gamba della strategia
2. Calcola payoff a tutti i prezzi critici (0, strike, +∞)
3. Trova il punto di massima perdita
4. Applica controlli di backup
5. Mostra formula trasparente nel tooltip
```
