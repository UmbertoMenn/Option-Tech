
# Piano: Fix Badge "P!" (Protezione Parziale) per Override Manuali

## Problema
Quando un'opzione PUT viene spostata manualmente nella categoria "Protezioni" tramite il sistema di override, il badge "P!" (protezione parziale) non viene mostrato, anche se l'esposizione netta è maggiore di 0.

**Causa**: Nel codice di `categorizeDerivatives` (linee 142-152), quando viene applicato un override per la categoria "protection", `isPartial` è sempre hardcodato a `false`.

```typescript
case 'protection':
  if (position.option_type === 'put' && position.quantity > 0) {
    longPuts.push({
      option: position,
      underlying: linkedStock || null,
      contracts: position.quantity,
      isPartial: false  // ← PROBLEMA: sempre false
    });
  }
```

---

## Soluzione
Calcolare dinamicamente se la protezione è parziale anche per gli override manuali, verificando l'esposizione netta del sottostante.

### Logica Protezione Parziale
- **Protezione totale**: `esposizione netta ≤ 0`
- **Protezione parziale**: `esposizione netta > 0`

```
esposizione netta = (azioni possedute / 100) - (PUT comprate - PUT vendute)
```

---

## Dettaglio Tecnico

### File da Modificare
`src/lib/derivativeStrategies.ts`

### Modifiche al Codice

**Linee 142-152** - Calcolare `isPartial` dinamicamente:

```typescript
case 'protection':
  if (position.option_type === 'put' && position.quantity > 0) {
    // Calculate if this is a partial protection
    let isPartial = false;
    
    if (linkedStock && linkedStock.quantity > 0) {
      // Calculate net exposure for this underlying
      const stockContracts = Math.floor(linkedStock.quantity / 100);
      const optionContracts = position.quantity;
      
      // Find other PUT positions on the same underlying
      const underlyingKey = normalizeForMatching(position.underlying || position.description);
      const otherPuts = derivatives.filter(d => 
        d.id !== position.id &&
        d.option_type === 'put' &&
        normalizeForMatching(d.underlying || d.description) === underlyingKey
      );
      
      const otherBoughtContracts = otherPuts
        .filter(p => p.quantity > 0)
        .reduce((sum, p) => sum + p.quantity, 0);
      const otherSoldContracts = otherPuts
        .filter(p => p.quantity < 0)
        .reduce((sum, p) => sum + Math.abs(p.quantity), 0);
      
      // Total bought contracts including this position
      const totalBoughtContracts = optionContracts + otherBoughtContracts;
      const totalSoldContracts = otherSoldContracts;
      
      // Net exposure = stock contracts - (bought - sold)
      const netExposure = stockContracts - (totalBoughtContracts - totalSoldContracts);
      
      isPartial = netExposure > 0;
    }
    
    longPuts.push({
      option: position,
      underlying: linkedStock || null,
      contracts: position.quantity,
      isPartial
    });
    usedDerivatives.add(position.id);
  }
  break;
```

---

## Comportamento Atteso

| Scenario | Azioni | PUT Comprate | Esposizione | Badge |
|----------|--------|--------------|-------------|-------|
| NETEASE 80 azioni + 1 PUT 80 | 80 | 1 | 80/100 - 1 = -0.2 ≤ 0 | Nessuno (totale) |
| NETEASE 200 azioni + 1 PUT 80 | 200 | 1 | 200/100 - 1 = 1 > 0 | P! (parziale) |
| Override senza stock collegato | 0 | 1 | N/A | Nessuno |

---

## File Coinvolti

| File | Tipo Modifica |
|------|---------------|
| `src/lib/derivativeStrategies.ts` | Calcolo dinamico isPartial per override |

---

## Stima Effort
- Modifica singola funzione: ~15 minuti
- Testing: ~10 minuti
