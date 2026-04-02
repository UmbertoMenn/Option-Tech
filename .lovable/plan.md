

## Aggiungere badge "GP" separato nelle Holdings Consolidate

### Problema
I GP holdings vengono aggiunti con `type: 'stock'` e il loro valore va in `stockRisk`, quindi nelle holdings consolidate appaiono sotto il badge "Stock" anziché avere un badge "GP" dedicato.

### Modifiche

#### 1. `src/lib/sectorExposure.ts`

- Aggiungere `'gp'` al tipo union di `sources[].type`: `'stock' | 'nakedPut' | 'leapCall' | 'strategy' | 'gp'`
- Aggiungere campo `gpRisk: number` a `ConsolidatedHolding`
- Inizializzare `gpRisk: 0` in `createHolding`
- Nel blocco GP stock holdings (riga 1016-1038): usare `holding.gpRisk += gp.market_value` invece di `holding.stockRisk`, e `type: 'gp'` invece di `type: 'stock'`
- Nel calcolo `totalExposure` (riga 1050-1058): includere `holding.gpRisk` nel totale

#### 2. `src/components/risk/EquityExposureView.tsx`

- Aggiungere variabile `hasGP = holding.gpRisk > 0` (accanto a hasStock, hasNakedPut, etc.)
- Aggiungere badge "GP" (colore emerald, come la categoria donut) dopo il badge Strategie:
  ```
  {hasGP && (
    <Badge variant="outline" className="... bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
      GP: {formatEUR(holding.gpRisk)}
    </Badge>
  )}
  ```

#### 3. `src/components/risk/HoldingBreakdownDialog.tsx`

- Aggiungere badge GP nei footer badges (riga 218-239), con lo stesso stile emerald

### File da modificare
1. `src/lib/sectorExposure.ts` — tipo source `'gp'`, campo `gpRisk`, logica GP separata
2. `src/components/risk/EquityExposureView.tsx` — badge GP nelle consolidated holdings
3. `src/components/risk/HoldingBreakdownDialog.tsx` — badge GP nel dialog di breakdown

