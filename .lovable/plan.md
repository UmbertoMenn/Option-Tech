

# Piano: Filtro LEAP Call nel Calcolatore Premi

## Obiettivo
Escludere automaticamente le opzioni LEAP Call dai calcoli dei premi Covered Call, identificandole come:
- CALL con **strike alto** (OTM rispetto al prezzo corrente)
- Che sono **solo acquistate** nel file (nessuna vendita precedente dello stesso simbolo)

---

## Logica di Filtro

### Regola
```text
Per ogni simbolo CALL nel file:
├── Ha almeno una VENDITA? → Mantieni TUTTO (è Covered Call o rolling)
└── Solo ACQUISTI?
    ├── Strike > prezzo * 1.3 (30%+ OTM)? → LEAP → ESCLUDI
    └── Strike vicino al prezzo? → Mantieni (potrebbe essere chiusura)
```

### Esempi con BABA a $100

| Simbolo | Operazioni nel file | Strike | Azione |
|---------|---------------------|--------|--------|
| BABAH6C165 | Vendita + Acquisto | 165 | ✅ Covered Call rolling |
| BABAH6C165 | Solo Vendita | 165 | ✅ Covered Call |
| BABAG6C150 | Solo Acquisto | 150 | ❌ LEAP (strike 50% sopra) |
| BABAM6C105 | Solo Acquisto | 105 | ✅ Mantieni (strike vicino) |

---

## Modifiche Tecniche

### 1. `src/lib/orderFileParser.ts`

**Nuova funzione: `extractStrikeFromSymbol`**
```typescript
/**
 * Extract strike price from option symbol
 * BABAH6C165 → 165
 * TSLAG6P350 → 350
 */
export function extractStrikeFromSymbol(symbol: string): number | null {
  const match = symbol.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}
```

**Modifica: `filterAndCalculateCallPremiums`**

Aggiungere parametro `underlyingPrice` e logica di filtro:

```typescript
export function filterAndCalculateCallPremiums(
  orders: ParsedOrder[],
  ticker: string,
  underlyingPrice?: number  // NUOVO
): OrderParseResult {
  // Step 1: Filtro base (eseguito + CALL + ticker)
  const baseFiltered = orders.filter(order => {
    const isExecuted = order.status.toLowerCase() === 'eseguito';
    const isCall = order.optionType === 'CALL';
    const matchesTicker = symbolMatchesTicker(order.symbol, ticker);
    return isExecuted && isCall && matchesTicker;
  });
  
  // Step 2: Identifica simboli che hanno almeno una vendita
  const symbolsWithSells = new Set<string>();
  for (const order of baseFiltered) {
    if (order.operation === 'sell') {
      symbolsWithSells.add(order.symbol);
    }
  }
  
  // Step 3: Filtra le potenziali LEAP
  const LEAP_THRESHOLD = 1.3; // Strike > 130% del prezzo = LEAP
  
  const filteredOrders = baseFiltered.filter(order => {
    // Se il simbolo ha almeno una vendita → mantieni tutto
    if (symbolsWithSells.has(order.symbol)) {
      return true;
    }
    
    // Solo acquisti per questo simbolo → verifica se è LEAP
    if (order.operation === 'buy' && underlyingPrice && underlyingPrice > 0) {
      const strike = extractStrikeFromSymbol(order.symbol);
      if (strike !== null && strike > underlyingPrice * LEAP_THRESHOLD) {
        // Strike molto alto → LEAP → escludi
        if (import.meta.env.DEV) {
          console.log(`[LEAP filter] Excluded ${order.symbol} (strike ${strike} > ${underlyingPrice * LEAP_THRESHOLD})`);
        }
        return false;
      }
    }
    
    return true;
  });
  
  // ... resto del calcolo invariato ...
}
```

### 2. `src/components/derivatives/CallPremiumCalculatorDialog.tsx`

Passare `underlyingPrice` alla funzione di filtro:

```typescript
const result = filterAndCalculateCallPremiums(orders, ticker, underlyingPrice);
```

E anche in `recalculateMetrics`:

```typescript
const result = filterAndCalculateCallPremiums(orders, ticker, underlyingPrice);
```

### 3. `src/test/orderFileParserHtmlXls.test.ts`

Aggiungere test per la logica LEAP:

```typescript
describe('LEAP Call filtering', () => {
  it('should exclude buy-only CALL with high strike (LEAP)', () => {
    const orders: ParsedOrder[] = [
      { symbol: 'BABAG6C150', operation: 'buy', ... }, // 150 > 100*1.3 → LEAP
    ];
    const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
    expect(result.filteredOrders).toHaveLength(0);
  });
  
  it('should keep CALL with sell operation (Covered Call)', () => {
    const orders: ParsedOrder[] = [
      { symbol: 'BABAH6C165', operation: 'sell', ... },
    ];
    const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
    expect(result.filteredOrders).toHaveLength(1);
  });
  
  it('should keep buy if same symbol has a sell (rolling)', () => {
    const orders: ParsedOrder[] = [
      { symbol: 'BABAH6C165', operation: 'sell', ... },
      { symbol: 'BABAH6C165', operation: 'buy', ... },
    ];
    const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
    expect(result.filteredOrders).toHaveLength(2);
  });
});
```

---

## File Coinvolti

| File | Modifiche |
|------|-----------|
| `src/lib/orderFileParser.ts` | Nuova `extractStrikeFromSymbol`, modifica `filterAndCalculateCallPremiums` con logica LEAP |
| `src/components/derivatives/CallPremiumCalculatorDialog.tsx` | Passaggio `underlyingPrice` alla funzione di filtro |
| `src/test/orderFileParserHtmlXls.test.ts` | Nuovi test per filtro LEAP |

---

## Parametri

- **Soglia LEAP**: `1.3` (30% sopra il prezzo corrente)
  - Esempio: BABA a $100 → strike > $130 = LEAP
  - Questo valore può essere modificato se necessario

---

## Comportamento Atteso

Con file contenente:
- `BABAH6C165` venduta a 8,40
- `BABAG6C150` comprata a 14,95 (LEAP, strike alto, nessuna vendita)

E prezzo BABA = $100:
- La CALL venduta entra nel calcolo ✅
- La LEAP viene esclusa automaticamente ❌

