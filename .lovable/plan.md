

## Rimuovere ETF dalle configurazioni strategie derivati

### Problema
Il Wizard "Riconfigura strategie" include ETF (oltre alle azioni) nel pool di posizioni disponibili (`allAvailable`). Gli ETF non dovrebbero far parte delle configurazioni strategie derivati.

### Modifica

**File: `src/components/derivatives/StrategyConfigWizard.tsx`**

Riga 345 — rimuovere `p.asset_type === 'etf'` dal filtro `stocks`:

```typescript
// PRIMA
const stocks = allPositions.filter(p => p.asset_type === 'stock' || p.asset_type === 'etf');

// DOPO
const stocks = allPositions.filter(p => p.asset_type === 'stock');
```

Riga 577 — aggiornare anche il check di risoluzione slot nel salvataggio:

```typescript
// PRIMA
if (p.asset_type !== 'stock' && p.asset_type !== 'etf') return p;

// DOPO
if (p.asset_type !== 'stock') return p;
```

Due righe da modificare nello stesso file. Nessun altro file coinvolto.

