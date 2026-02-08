
# Piano: Separare gli State dei Toggle per Ogni Vista

## Problema

I toggle con lo stesso nome (Naked Put, Strategie, Leap Call) sono condivisi tra **Currency Exposure** e **Sector Allocation** perché usano le stesse variabili di state in `RiskAnalyzer.tsx`:

```typescript
const [includeNakedPut, setIncludeNakedPut] = useState(true);
const [includeStrategies, setIncludeStrategies] = useState(true);
const [includeLeapCall, setIncludeLeapCall] = useState(true);
```

Questi state vengono passati sia a `CurrencyExposureView` che a `SectorAllocationView`, quindi attivare/disattivare un toggle in una vista lo cambia anche nell'altra.

---

## Soluzione

Creare **state separati** per ogni vista, con prefissi specifici:

### State Separati per Vista

**Currency Exposure** (5 toggle):
- `currencyIncludeBonds`
- `currencyIncludeProtections`
- `currencyIncludeNakedPut`
- `currencyIncludeStrategies`
- `currencyIncludeLeapCall`

**Sector Allocation** (3 toggle):
- `sectorIncludeNakedPut`
- `sectorIncludeStrategies`
- `sectorIncludeLeapCall`

**Equity Exposure** (4 toggle):
Già gestiti internamente nel componente `EquityExposureView`

---

## Modifica Tecnica

**File**: `src/pages/RiskAnalyzer.tsx`

### 1. Aggiornare le dichiarazioni di state (linee 28-32)

**Prima**:
```typescript
const [includeBonds, setIncludeBonds] = useState(true);
const [includeProtections, setIncludeProtections] = useState(true);
const [includeNakedPut, setIncludeNakedPut] = useState(true);
const [includeStrategies, setIncludeStrategies] = useState(true);
const [includeLeapCall, setIncludeLeapCall] = useState(true);
```

**Dopo**:
```typescript
// Currency Exposure toggles
const [currencyIncludeBonds, setCurrencyIncludeBonds] = useState(true);
const [currencyIncludeProtections, setCurrencyIncludeProtections] = useState(true);
const [currencyIncludeNakedPut, setCurrencyIncludeNakedPut] = useState(true);
const [currencyIncludeStrategies, setCurrencyIncludeStrategies] = useState(true);
const [currencyIncludeLeapCall, setCurrencyIncludeLeapCall] = useState(true);

// Sector Allocation toggles
const [sectorIncludeNakedPut, setSectorIncludeNakedPut] = useState(true);
const [sectorIncludeStrategies, setSectorIncludeStrategies] = useState(true);
const [sectorIncludeLeapCall, setSectorIncludeLeapCall] = useState(true);
```

### 2. Aggiornare chiamata a `useCurrencyExposure` (linee 50-56)

```typescript
const {
  exposures: currencyExposure,
  ...
} = useCurrencyExposure({ 
  includeBonds: currencyIncludeBonds, 
  includeProtections: currencyIncludeProtections, 
  includeNakedPut: currencyIncludeNakedPut, 
  includeStrategies: currencyIncludeStrategies, 
  includeLeapCall: currencyIncludeLeapCall 
});
```

### 3. Aggiornare calcolo `sectorExposure` (linee 126-133)

```typescript
const sectorExposure = useMemo(() => {
  return calculateSectorExposure(analysis, allocations, { 
    includeNakedPut: sectorIncludeNakedPut, 
    includeStrategies: sectorIncludeStrategies, 
    includeLeapCall: sectorIncludeLeapCall, 
    sectorMappings 
  });
}, [analysis, allocations, sectorIncludeNakedPut, sectorIncludeStrategies, sectorIncludeLeapCall, sectorMappings]);
```

### 4. Aggiornare props di `CurrencyExposureView` (linee 212-221)

```tsx
<CurrencyExposureView 
  currencyExposure={currencyExposure}
  grandTotal={currencyExposure.reduce((sum, c) => sum + c.totalRisk, 0)}
  isLoadingETFData={isETFDataLoading}
  etfCount={etfCount}
  loadedETFCount={loadedETFCount}
  includeBonds={currencyIncludeBonds}
  onIncludeBondsChange={setCurrencyIncludeBonds}
  includeProtections={currencyIncludeProtections}
  onIncludeProtectionsChange={setCurrencyIncludeProtections}
  includeNakedPut={currencyIncludeNakedPut}
  onIncludeNakedPutChange={setCurrencyIncludeNakedPut}
  includeStrategies={currencyIncludeStrategies}
  onIncludeStrategiesChange={setCurrencyIncludeStrategies}
  includeLeapCall={currencyIncludeLeapCall}
  onIncludeLeapCallChange={setCurrencyIncludeLeapCall}
/>
```

### 5. Aggiornare props di `SectorAllocationView` (linee 232-237)

```tsx
<SectorAllocationView 
  sectorExposure={sectorExposure}
  grandTotal={sectorExposure.reduce((sum, s) => sum + s.totalRisk, 0)}
  isLoadingETFData={isETFDataLoading}
  etfCount={etfCount}
  loadedETFCount={loadedETFCount}
  includeNakedPut={sectorIncludeNakedPut}
  onIncludeNakedPutChange={setSectorIncludeNakedPut}
  includeStrategies={sectorIncludeStrategies}
  onIncludeStrategiesChange={setSectorIncludeStrategies}
  includeLeapCall={sectorIncludeLeapCall}
  onIncludeLeapCallChange={setSectorIncludeLeapCall}
  isResolvingSectors={sectorMappingsLoading}
  resolvingCount={resolvingCount}
  isAdmin={isAdmin}
  onRefreshMappings={...}
/>
```

---

## Riepilogo

| File | Modifiche |
|------|-----------|
| `src/pages/RiskAnalyzer.tsx` | Separare state: 5 toggle per Currency, 3 toggle per Sector |

---

## Risultato Atteso

- Toggle in **Currency Exposure** → cambiano solo i dati di Currency Exposure
- Toggle in **Sector Allocation** → cambiano solo i dati di Sector Allocation
- Toggle in **Equity Exposure** → già indipendenti (gestiti internamente)

Ogni vista avrà i propri toggle completamente indipendenti dalle altre.
