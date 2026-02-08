
## Problema Identificato

La discrepanza tra il totale dell'esposizione settoriale e la torta è causata da due problemi distinti:

### Problema 1: Race Condition nei Mapping Settoriali
Il `useMemo` per `sectorExposure` viene calcolato anche quando `sectorMappings` è ancora vuoto. Quando i mapping arrivano dal database, il calcolo viene rifatto, ma c'è un momento iniziale dove il fallback statico potrebbe non funzionare correttamente per alcuni strumenti.

### Problema 2: Filtro Inconsistente
Il `grandTotal` passato come prop include TUTTI i settori:
```typescript
grandTotal={sectorExposure.reduce((sum, s) => sum + s.totalRisk, 0)}
```

Ma la torta e la legenda usano `safeSectorExposure` che esclude settori con `totalRisk <= 0`:
```typescript
const safeSectorExposure = sectorExposure.filter((s) => s.totalRisk > 0);
```

Questo può creare discrepanze se alcuni settori hanno rischio zero.

---

## Soluzione Proposta

### Parte 1: Allineare il calcolo del grandTotal nella vista

In `SectorAllocationView.tsx`, ricalcolare il `grandTotal` usando `safeSectorExposure` invece di riceverlo come prop:

```typescript
// Invece di usare grandTotal passato come prop
const displayedGrandTotal = safeSectorExposure.reduce((sum, s) => sum + s.totalRisk, 0);
```

Questo garantisce che il totale visualizzato corrisponda esattamente alla somma dei settori mostrati nella torta.

### Parte 2: Aggiungere logging di debug

Aggiungere log temporanei per tracciare:
- Quali strumenti vengono assegnati a quale settore
- Il valore `maxLossEUR` delle strategie
- Lo stato dei `sectorMappings` al momento del calcolo

### Parte 3: Verificare il flusso per META PLATFORMS

Per la strategia META PLATFORMS Iron Condor, verificare che:
1. L'underlying sia correttamente identificato come "META PLATFORMS"
2. Il ticker "META" venga estratto e trovato nei mapping
3. Il `maxLossEUR` sia un valore positivo

---

## Modifiche Tecniche

### File: src/components/risk/SectorAllocationView.tsx

Modificare il calcolo del totale per usare solo i dati effettivamente visualizzati:

```typescript
// Prima di safeSectorExposure (linea 205)
const safeSectorExposure = sectorExposure.filter((s) => {
  return (
    typeof s.sector === 'string' &&
    Number.isFinite(s.totalRisk) &&
    s.totalRisk > 0 &&
    Number.isFinite(s.percentage)
  );
});

// NUOVO: Ricalcolare il totale dai dati visualizzati
const displayedGrandTotal = safeSectorExposure.reduce((sum, s) => sum + s.totalRisk, 0);
```

Sostituire `grandTotal` con `displayedGrandTotal` nel template dove viene visualizzato il totale (linea ~244):

```typescript
<div className="text-3xl font-bold text-primary">{formatEUR(displayedGrandTotal)}</div>
```

### File: src/pages/RiskAnalyzer.tsx (opzionale)

In alternativa, passare il grandTotal ricalcolato:

```typescript
grandTotal={sectorExposure.filter(s => s.totalRisk > 0).reduce((sum, s) => sum + s.totalRisk, 0)}
```

---

## Benefici

- Il totale visualizzato corrisponderà sempre esattamente alla somma dei settori nella torta
- Eliminata la discrepanza visiva tra i due valori
- Non ci saranno più strumenti "fantasma" che contribuiscono al totale ma non appaiono nella visualizzazione

## File da Modificare

| File | Modifica |
|------|----------|
| `src/components/risk/SectorAllocationView.tsx` | Ricalcolare `grandTotal` internamente da `safeSectorExposure` |

## Testing

Dopo le modifiche, verificare su MauroG che:
1. META PLATFORMS Iron Condor appaia in "Communication Services"
2. Il totale esposizione settoriale corrisponda alla somma dei settori nella torta
3. Tutti gli strumenti derivati (strategie, naked put, leap call) appaiano nei rispettivi settori
