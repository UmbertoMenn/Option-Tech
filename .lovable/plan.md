

## Fix: Stock con ticker europei non matchano con derivati nel monitoraggio

### Problemi identificati

**3 bug, 1 causa radice**: quando uno stock ha un ticker non-US (suffisso exchange europeo), il codice usa quel ticker direttamente come chiave nella balance map, senza tentare di risolverlo al ticker canonico US.

| Problema | Stock ticker | Chiave usata | Chiave derivati | Match? |
|----------|-------------|-------------|----------------|--------|
| HIVE 700 | `HIVE.V` | `HIVE.V` | (no derivati, ma archived) | ❌ archived non filtra |
| 9PDA.SG | `9PDA.SG` | `9PDA.SG` | (nessun derivato PDD) | ❌ mostra ticker europeo |
| B1C.DU | `B1C.DU` | `B1C.DU` | `BIDU` (da underlying BAIDU) | ❌ stock e derivati su chiavi diverse |

### Causa radice nel codice

In `computeAvailableCalls` e `computeUncoveredCalls`:
```typescript
// Riga problematica:
const key = stock.ticker ? stock.ticker.toUpperCase() : resolveKey(stock.description, underlyingPrices);
```
Se lo stock ha un ticker (anche europeo come `9PDA.SG`), viene usato direttamente senza mai provare a risolverlo tramite `underlyingPrices` o `SPECIAL_ALIASES`.

### Fix (2 file)

**1. `src/lib/derivativeStrategies.ts`** — Aggiungere BAIDU a SPECIAL_ALIASES:
```typescript
BAIDU: ['BAIDU', 'BIDU', 'BAIDU INC', 'BAIDU INC SPON ADR', 'BAIDU INC SPON ADR REP A'],
```

**2. `src/lib/monitoringEngine.ts`** — Nuova funzione `resolveStockKey` che:
1. Prova `resolveKey(stock.description)` prima (risolve `AZ.BAIDU INC - SPON ADR` → `BIDU` tramite normalizzazione e SPECIAL_ALIASES)
2. Se la description non risolve, prova `resolveKey(stock.ticker)` 
3. Solo come ultimo fallback usa `stock.ticker.toUpperCase()`

Applicare `resolveStockKey` in entrambe le funzioni:
- `computeAvailableCalls` (call da rivendere)
- `computeUncoveredCalls` (call non coperte)

```typescript
function resolveStockKey(stock: Position, underlyingPrices: Record<string, UnderlyingPrice>): { key: string; display: string } {
  // 1. Try description first (handles AZ. prefix, matches SPECIAL_ALIASES)
  if (stock.description) {
    const resolved = resolveTickerFromPrices(stock.description, underlyingPrices);
    if (resolved) return { key: resolved.toUpperCase(), display: resolved };
  }
  // 2. Try ticker resolution (handles 9PDA.SG → PDD via canonical key)
  if (stock.ticker) {
    const resolved = resolveTickerFromPrices(stock.ticker, underlyingPrices);
    if (resolved) return { key: resolved.toUpperCase(), display: resolved };
  }
  // 3. Fallback to raw ticker or description
  const fallback = stock.ticker || stock.description?.split(' ')[0] || 'N/A';
  return { key: fallback.toUpperCase(), display: fallback };
}
```

### Risultato atteso
- **HIVE**: stock risolve a `HIVE` (non `HIVE.V`), archived key risolve a `HIVE` → match, filtrato
- **9PDA.SG**: description `AZ.PDD HOLDINGS INC` → SPECIAL_ALIAS `PDD` → mostra `PDD`
- **B1C.DU**: description `AZ.BAIDU INC - SPON ADR` → SPECIAL_ALIAS `BAIDU` → ticker `BIDU`, stessa chiave dei derivati

