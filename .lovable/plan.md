
# Piano: Correggere il Matching delle Protezioni nel Calcolo del Rischio

## Problema Identificato

Le protezioni PUT acquistate su NVIDIA non vengono applicate nel calcolo del rischio perché la logica di matching tra opzioni e sottostanti è **incoerente** tra i due moduli:

### Logica in `derivativeStrategies.ts` (FUNZIONA)

Usa una logica sofisticata con `findUnderlyingStock()`:
1. Normalizza i testi rimuovendo prefissi (AZ.), suffissi (CORP, INC, etc.)
2. Usa matching per token (NVIDIA contiene NVIDIA)
3. Gestisce alias speciali (GOOGLE = ALPHABET)
4. Cerca per ticker se disponibile

**Risultato**: PUT su "NVIDIA CORP" viene correttamente associata a stock "NVDA"

### Logica in `riskCalculator.ts` (NON FUNZIONA)

Usa una semplice comparazione di stringhe normalizzate:

```typescript
// Stock: usa ticker O description
const stockKey = normalizeForMatching(stock.ticker || stock.description);
// → "NVDA" per NVIDIA

// PUT: usa underlying O description  
const underlyingKey = normalizeForMatching(lp.option.underlying || lp.option.description);
// → "NVIDIA" per PUT su NVIDIA
```

**Problema**: `"NVDA" !== "NVIDIA"` → protezioni non trovate!

### Dati Reali dal Database

**Portfolio Principale:**
| Tipo | Descrizione | Quantità |
|------|-------------|----------|
| Stock | AZ.NVIDIA CORP (ticker: NVDA) | 1300 |
| PUT | NVIDIA CORP PUT 90 DEC/27 | +9 (acquistata) |
| PUT | NVIDIA CORP PUT 195 FEB/26 | -3 (venduta) |
| PUT | NVIDIA CORP PUT 180 MAR/26 | -1 (venduta) |

La PUT 90 DEC/27 (+9 contratti) dovrebbe proteggere 900 azioni, ma non viene riconosciuta.

---

## Soluzione

Modificare `src/lib/riskCalculator.ts` per usare una logica di matching coerente con `derivativeStrategies.ts`.

### Approccio

1. **Importare la logica di matching da derivativeStrategies** (evita duplicazione)
2. **Cambiare il sistema di raggruppamento** delle protezioni per usare matching flessibile invece di stringhe esatte

---

## Dettagli Tecnici

### 1. Esportare le utility di matching da derivativeStrategies.ts

```typescript
// Rendere pubbliche le funzioni esistenti
export function normalizeForMatching(text: string): string { ... }
export function getCanonicalKey(text: string): string | null { ... }
export function findUnderlyingStock(option: Position, stocks: Position[]): Position | undefined { ... }
```

### 2. Modificare calculateStockRisk in riskCalculator.ts

**Prima** (matching esatto per stringa):
```typescript
const putsByUnderlying = new Map<string, LongPutPosition[]>();
for (const lp of longPuts) {
  const underlyingKey = normalizeForMatching(lp.option.underlying || lp.option.description);
  putsByUnderlying.set(underlyingKey, [...]);
}

// Lookup con stringa esatta - FALLISCE per NVDA vs NVIDIA
const protectivePuts = putsByUnderlying.get(stockKey) || [];
```

**Dopo** (matching flessibile):
```typescript
// Per ogni stock, trova le protezioni con matching flessibile
const protectivePuts = longPuts.filter(lp => {
  // Usa la stessa logica di findUnderlyingStock ma al contrario:
  // verifica se questa PUT protegge questo stock
  return matchesUnderlying(lp.option, stock);
});
```

### 3. Nuova funzione matchesUnderlying

```typescript
function matchesUnderlying(option: Position, stock: Position): boolean {
  // 1. Normalizza i testi
  const optionText = normalizeForMatching(
    `${option.underlying || ''} ${option.description || ''}`
  );
  const stockText = normalizeForMatching(
    `${stock.ticker || ''} ${stock.description || ''}`
  );
  
  // 2. Match diretto
  if (optionText === stockText) return true;
  
  // 3. Match per ticker contenuto
  if (stock.ticker) {
    const tickerNorm = normalizeForMatching(stock.ticker);
    if (optionText.includes(tickerNorm)) return true;
  }
  
  // 4. Match per token
  const optionTokens = optionText.split(' ').filter(t => t.length > 2);
  const stockTokens = stockText.split(' ').filter(t => t.length > 2);
  
  // Se il nome dello stock è contenuto nell'opzione
  if (stockTokens.length > 0) {
    const matchCount = stockTokens.filter(t => optionTokens.includes(t)).length;
    // Per nomi singoli, basta 1 match; per nomi composti, almeno metà
    const threshold = stockTokens.length === 1 ? 1 : Math.ceil(stockTokens.length / 2);
    if (matchCount >= threshold) return true;
  }
  
  // 5. Alias speciali (GOOGLE = ALPHABET, etc.)
  const optionCanonical = getCanonicalKey(optionText);
  const stockCanonical = getCanonicalKey(stockText);
  if (optionCanonical && stockCanonical && optionCanonical === stockCanonical) {
    return true;
  }
  
  return false;
}
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/lib/derivativeStrategies.ts` | Esportare `normalizeForMatching`, `getCanonicalKey`, `SPECIAL_ALIASES` |
| `src/lib/riskCalculator.ts` | Importare utility da derivativeStrategies; riscrivere logica matching in `calculateStockRisk` |

---

## Risultato Atteso

Dopo la correzione, per NVIDIA:

| Metrica | Prima | Dopo |
|---------|-------|------|
| Stock Value | €209,343 | €209,343 |
| Protezioni trovate | 0 | 9 contratti |
| Protected Value | €0 | €81,000 (9 × 90 × 100) |
| **Risk** | €209,343 | **€128,343** |

La protezione PUT 90 verrà riconosciuta e il rischio sarà ridotto di €81,000.

---

## Note Aggiuntive

- La correzione si applica a **tutti** gli stock con opzioni, non solo NVIDIA
- Il matching token-based già funziona in derivativeStrategies per la classificazione, quindi la logica è testata
- La vista Equity, Currency e Sector Exposure beneficeranno tutte della correzione perché usano tutte `stockDetails` dal risk calculator
