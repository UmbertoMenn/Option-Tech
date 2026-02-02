
# Piano: Aggiungere Vista "Netting ex CC OTM e NP OTM" al Carousel Dashboard

## Obiettivo

Aggiungere una nuova vista nel carousel della dashboard principale, posizionata dopo "Netting ex CC", che mostri il valore netto del portafoglio escludendo anche il costo di riacquisto delle Naked PUT OTM (out-of-the-money).

## Logica di Calcolo

La nuova vista "Netting ex CC OTM e NP OTM" si basa sul valore "Netting ex CC" con una modifica:

- **Netting ex CC**: Esclude le Covered Call OTM; per le ITM sottrae il valore intrinsico
- **Netting ex CC OTM e NP OTM**: Come sopra, ma esclude anche il costo di riacquisto delle Naked PUT OTM

### Definizione Naked PUT OTM
Una PUT venduta (Naked PUT) e OTM quando:
- **Strike < Prezzo Sottostante** (l'opzione scadra senza valore)

Per le Naked PUT OTM, non ha senso spendere soldi per riacquistarle se il mercato e favorevole.

### Formula

```
Netting ex CC OTM e NP OTM = Netting ex CC - Costo Riacquisto Naked PUT OTM
```

Il costo di riacquisto di una Naked PUT e:
```
Costo = (prezzo_corrente × quantita × 100) / cambio
```

Per le PUT vendute (quantita negativa), questo valore e gia negativo nel netting, quindi escludendole non le sottraiamo.

---

## Implementazione Tecnica

### 1. Modificare `useDerivativeNetting.ts`

Aggiungere un nuovo campo `nettingExCCAndNP` al risultato:

```typescript
export interface NettingResult {
  nettingExCoveredCall: number;
  nettingTotal: number;
  nettingExCCAndNP: number;  // NUOVO: esclude anche Naked PUT OTM
}
```

**Logica**:
1. Identificare le Naked PUT dalla categorizzazione esistente
2. Per ogni Naked PUT, verificare se e OTM (strike < prezzo sottostante)
3. Se OTM, non sottrarre il costo di riacquisto
4. Se ITM o prezzo sottostante non disponibile, includere il costo di riacquisto

### 2. Modificare `ViewModeSelector.tsx`

Aggiungere il nuovo tipo di vista:

```typescript
export type ViewMode = 'base' | 'netting_total' | 'netting_ex_cc' | 'netting_ex_cc_np';

const VIEW_LABELS: Record<ViewMode, string> = {
  netting_ex_cc: 'Netting ex CC',
  netting_ex_cc_np: 'Netting ex CC OTM e NP OTM',  // NUOVO
  netting_total: 'Netting Totale',
  base: 'Base',
};

const VIEWS: ViewMode[] = ['base', 'netting_ex_cc', 'netting_ex_cc_np', 'netting_total'];
```

### 3. Modificare `DynamicPortfolioChart.tsx`

Aggiungere il rendering per la nuova vista:

```typescript
const CHART_TITLES: Record<ViewMode, string> = {
  // ...existing
  netting_ex_cc_np: 'Valore Portafoglio (Netting ex. CC OTM e NP OTM)',
};

// Nel renderChart():
if (viewMode === 'netting_ex_cc_np') {
  return (
    <div className="flex flex-col">
      <NettingChart
        baseValue={summary?.totalValue ?? 0}
        nettedValue={netting.nettingExCCAndNP}
        label="Netting ex. CC OTM e NP OTM"
      />
      <p className="text-xs text-muted-foreground px-4 mt-2 leading-relaxed">
        Come il Netting ex. Covered Call, ma esclude anche il costo di riacquisto 
        delle Naked PUT OTM (strike inferiore al prezzo del sottostante). 
        La logica e che, se ho venduto una PUT e il prezzo del sottostante e sopra lo strike, 
        l'opzione scadra senza valore e non ha senso spendere soldi per riacquistarla.
      </p>
    </div>
  );
}
```

### 4. Modificare `StatsCards.tsx`

Aggiungere le label per la nuova vista:

```typescript
const VIEW_LABELS: Record<ViewMode, { patrimonio: string; pl: string }> = {
  // ...existing
  netting_ex_cc_np: { 
    patrimonio: 'Patrimonio (Netting ex CC e NP OTM)', 
    pl: 'P/L (Netting ex CC e NP OTM)' 
  },
};
```

E aggiornare `getPatrimonioValue()`:

```typescript
case 'netting_ex_cc_np': return netting.nettingExCCAndNP;
```

### 5. Modificare `Dashboard.tsx`

Passare il nuovo valore di netting ai componenti figli.

---

## Schema Riassuntivo delle Viste

| Vista | Logica |
|-------|--------|
| Base | Valore asset (derivati esclusi) |
| Netting ex CC | Base + tutti i derivati, escluse CC OTM; CC ITM al valore intrinseco |
| **Netting ex CC OTM e NP OTM** | Come sopra, ma esclude anche NP OTM |
| Netting Totale | Base + tutti i derivati a prezzo di mercato |

---

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/hooks/useDerivativeNetting.ts` | Aggiungere calcolo `nettingExCCAndNP` e identificazione Naked PUT OTM |
| `src/components/dashboard/ViewModeSelector.tsx` | Aggiungere vista `netting_ex_cc_np` |
| `src/components/dashboard/DynamicPortfolioChart.tsx` | Aggiungere rendering e descrizione per nuova vista |
| `src/components/dashboard/StatsCards.tsx` | Aggiungere label e logica per nuova vista |
| `src/components/dashboard/Dashboard.tsx` | Passare nuovo valore netting ai componenti |
