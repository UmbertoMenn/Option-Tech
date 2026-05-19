## Problema

Nello step precedente le posizioni sintetiche (CC e DR-CC) sono state estratte da `stockDetails` e spostate nel nuovo array `syntheticCcDrccDetails` in `riskCalculator.ts`, ma:

1. La UI `EquityExposureView.tsx` non mostra ancora la nuova categoria "Rischio CC e DR-CC sintetiche" (né riepilogo, né donut, né accordion di dettaglio, né toggle).
2. Il `dynamicGrandTotal` non include `totalSyntheticCcDrccRisk` → il totale è sottostimato.
3. Il merge per "Aggregato Globale" in `useRiskAnalysis.ts` non somma `totalSyntheticCcDrccRisk` né concatena `syntheticCcDrccDetails`.
4. `sectorExposure.ts` e `currencyExposure.ts` cercano ancora le sintetiche dentro `stockDetails` (filtro `isSynthetic`) → ora ne trovano zero, quindi Sector view e Currency view perdono il contributo delle sintetiche.

## Modifiche

### `src/hooks/useRiskAnalysis.ts`
Nel ramo "Aggregato Globale" sommare il nuovo totale e concatenare l'array:
```
merged.totalSyntheticCcDrccRisk += result.totalSyntheticCcDrccRisk;
merged.syntheticCcDrccDetails.push(...result.syntheticCcDrccDetails);
```

### `src/components/risk/EquityExposureView.tsx`
- Destrutturare `totalSyntheticCcDrccRisk` e `syntheticCcDrccDetails` da `analysis`.
- Aggiungere stato `includeSynthCcDrcc` (default `true`).
- Includerlo in `dynamicGrandTotal`:  
  `(includeSynthCcDrcc ? totalSyntheticCcDrccRisk : 0)`
- Aggiungere nuova voce in `riskCategories` (tra "Rischio Stocks" e "Rischio Commodities"):
  - label: "Rischio CC e DR-CC sintetiche"
  - color: `bg-fuchsia-500`
  - icon: `Layers`
  - description: "Sintetiche: long CALL + short CALL / short PUT ITM + short CALL [+ protezione]"
- Aggiungere il toggle "CC/DR-CC sintetiche" nella riga dei toggle (accanto a Strategie / Naked PUT).
- Aggiungere un nuovo `AccordionItem` "Dettaglio CC e DR-CC sintetiche" subito dopo "Dettaglio Stocks", che elenca `syntheticCcDrccDetails` ordinati per `riskEUR` desc, mostrando:
  - underlying
  - badge tipo (CC / DR-CC, PUT-variant / CALL-variant) dal campo `syntheticType`
  - `composition` (es. "Long CALL 150 + Short CALL 170")
  - rischio in valuta originale ed EUR
- Rimuovere dal blocco "Dettaglio Stocks" il ramo `stock.isSynthetic` (badge "Sintetica", sort fallback su `riskEUR`) dato che ora le sintetiche non vivono lì: `sortedPureStockDetails` torna a ordinare solo per `stockValue/exchangeRate`.

### `src/lib/sectorExposure.ts`
- `calculateSectorAllocation` e `calculateConsolidatedTopHoldings`: estendere l'iterazione per processare anche `analysis.syntheticCcDrccDetails`, trattandole come oggi venivano trattate le `stockDetails` con `isSynthetic=true` (mapping settore via `getStockSector` sul ticker; importo = `riskEUR`).
- Mantenere il controllo `isSynthetic` per retrocompatibilità (se un domani torna popolato non rompe nulla), ma la sorgente primaria diventa `syntheticCcDrccDetails`.

### `src/hooks/useCurrencyExposure.ts` (o `src/lib/currencyExposure.ts`)
- Iterare anche su `analysis.syntheticCcDrccDetails` con la stessa logica usata per le sintetiche in `stockDetails`: importo = `riskEUR × exchangeRate` nella valuta originale dell'opzione, sempre incluse (non legate al toggle "Protezioni").

## Anti-bug

- `dynamicGrandTotal` somma le sintetiche **una sola volta** (sono fuori da `stockDetails`, quindi non c'è doppio conteggio con `totalPureStockRisk`/`grossPureStockRisk`).
- Sector e Currency totali tornano coerenti con `grandTotal` perché re-includiamo l'array dedicato.
- Il merge aggregato globale mantiene la stessa struttura del ramo singolo portfolio.
- Nessuna modifica a `riskCalculator.ts` (le formule restano quelle approvate nello step precedente).

## File toccati

- `src/hooks/useRiskAnalysis.ts`
- `src/components/risk/EquityExposureView.tsx`
- `src/lib/sectorExposure.ts`
- `src/lib/currencyExposure.ts` (o `src/hooks/useCurrencyExposure.ts`, a seconda di dove vive il loop)

Nessuna modifica a DB, edge functions, parser Excel o `derivativeStrategies.ts`.