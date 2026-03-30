

## Bug: Config "consuma tutto il sottostante" impedisce strategie multiple per lo stesso underlying

### Problema identificato
In `categorizeDerivatives` (riga 274-458 di `derivativeStrategies.ts`), quando si processa un config, **ogni case del switch consuma TUTTE le posizioni rimanenti del sottostante** con il pattern:
```typescript
for (const opt of remaining.filter(d => !usedDerivatives.has(d.id))) {
  usedDerivatives.add(opt.id);
}
```

Per UNH con 2 config (`diagonal_put_spread` + `naked_put`):
1. `diagonal_put_spread` → cade nel `default` → **tutte e 3** le PUT vengono consumate come "otherStrategies"
2. `naked_put` → `remaining` è vuoto → non fa nulla

Risultato: tutte e 3 le gambe in un unico gruppo "Diagonal Put Spread".

### Soluzione
Modificare ogni case dello switch in STEP 0.5 per consumare solo le posizioni che **matchano le signatures** della config corrente, non tutto il sottostante. Le posizioni non matchate devono restare disponibili per config successive dello stesso underlying.

### Modifiche a `src/lib/derivativeStrategies.ts`

**1. Aggiungere funzione helper per filtrare `remaining` solo per signatures matchate:**
```typescript
function filterBySignatures(
  positions: Position[], 
  signatures: PositionSignature[]
): Position[] {
  const matched: Position[] = [];
  const usedSigs = new Set<number>();
  for (const p of positions) {
    const sigIdx = signatures.findIndex((sig, i) => 
      !usedSigs.has(i) &&
      (p.option_type || '').toLowerCase() === sig.option_type.toLowerCase() &&
      Math.abs((p.strike_price || 0) - sig.strike) < 0.01 &&
      (p.expiry_date || '') === sig.expiry &&
      (p.quantity >= 0 ? 1 : -1) === sig.quantity_sign
    );
    if (sigIdx >= 0) {
      matched.push(p);
      usedSigs.add(sigIdx);
    }
  }
  return matched;
}
```

**2. In ogni case dello switch (covered_call, derisking_covered_call, iron_condor, double_diagonal, naked_put, leap_call, default):**
- Rimuovere il pattern "consume ALL remaining" 
- Al suo posto: utilizzare `filterBySignatures(remaining, config.position_signatures)` per limitare le posizioni a quelle dichiarate nella config
- Le posizioni non matchate restano nel pool per la config successiva

**3. Per il `default` case** (che gestisce `diagonal_put_spread`, `put_spread`, `other`):
- Cambiare da `for (const opt of remaining)` a iterare solo sui `filterBySignatures` match

Questo permette a due config diverse (es. `diagonal_put_spread` con 2 sigs + `naked_put` con 1 sig) sullo stesso underlying di funzionare indipendentemente.

### File da modificare
- **`src/lib/derivativeStrategies.ts`** — aggiungere helper + rimuovere "consume all remaining" da tutti i case del config switch

