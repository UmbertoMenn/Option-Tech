## Problema

Le posizioni sintetiche CC/DR-CC vengono già aggregate nelle "Holdings Consolidate" (in `calculateConsolidatedTopHoldings`, sezione 1b), ma:

1. Il loro rischio viene **sommato dentro `stockRisk`**, quindi non è distinguibile come categoria propria nel breakdown per holding.
2. Il toggle `includeSynthCcDrcc` presente in `EquityExposureView` **non viene passato** a `calculateConsolidatedTopHoldings`, quindi:
   - quando il toggle è OFF, il `dynamicGrandTotal` non le conta, ma le holdings consolidate continuano a sommarle (incoerenza visibile sui totali per holding);
   - quando il toggle è ON, contribuiscono a `stockRisk` mescolandosi con lo Stock Diretto e risultando invisibili al dettaglio.
3. Nel `HoldingBreakdownDialog` non esiste una sezione dedicata: l'unica traccia è una riga "Posizione Sintetica CC/DR-CC" annidata sotto "Stock Diretto", priva di subtotale e di badge proprio.

## Soluzione

Introdurre `syntheticRisk` come categoria di prima classe nelle holdings consolidate, allineata alle altre (`nakedPutRisk`, `leapCallRisk`, `strategyRisk`, `gpRisk`), con toggle dedicato e sezione dedicata nel dialog.

### File coinvolti

**`src/lib/sectorExposure.ts`**
- `ConsolidatedHoldingWithDetails`: aggiungere `syntheticRisk: number` e `syntheticDetails: Array<{ syntheticType, composition, riskEUR, currency, exchangeRate }>`.
- `createHolding`: inizializzare i nuovi campi.
- `ConsolidatedTopHoldingsOptions`: aggiungere `includeSynthCcDrcc?: boolean` (default `true`).
- Sezione 1 (stockDetails): rimuovere il ramo `isSynth` (codice morto: i synth non sono mai in `stockDetails`).
- Sezione 1b (syntheticCcDrccDetails): **non** sommare più a `stockRisk` / `stockRiskWithProtection`; sommare invece a `syntheticRisk` e popolare `syntheticDetails`. Mantenere l'aggregazione per `tickerKey` (così si fondono con la stessa holding stock se esiste).
- Sezione 5.5 (re-canonicalizzazione): aggiungere il merge di `syntheticRisk` e `syntheticDetails`.
- Blocco finale `totalExposure`: includere `(includeSynthCcDrcc ? holding.syntheticRisk : 0)`.

**`src/components/risk/EquityExposureView.tsx`**
- Passare `includeSynthCcDrcc` all'options di `calculateConsolidatedTopHoldings` e aggiungerlo alle dipendenze del `useMemo`.

**`src/components/risk/HoldingBreakdownDialog.tsx`**
- Nuova sezione "Sintetiche CC/DR-CC" (icona `Layers`, colore `fuchsia-500`), elenco con `composition` + `riskEUR` per riga e subtotale.
- Aggiungere il badge nel footer: `Sintetiche: {formatEUR(holding.syntheticRisk)}` quando `> 0`.
- Rimuovere il ramo speciale "Posizione Sintetica CC/DR-CC" dal blocco "Stock Diretto" (ora il blocco contiene solo stock reali).

### Cosa NON cambia
- Le formule di rischio in `riskCalculator.ts`.
- L'esposizione settoriale (`calculateSectorExposure`): già gestisce correttamente le synth come `breakdown.stocks` per settore — resta invariata.
- L'esposizione valutaria.
- Backend / RLS / hook.

### Risultato atteso
- Ogni holding mostra una riga `Sintetiche: € …` separata da Stock, PUT, LEAP, Strategie.
- Il toggle "Rischio CC e DR-CC sintetiche" gating sia il `dynamicGrandTotal` sia il `totalExposure` delle holdings consolidate (coerenza).
- Il dialog di breakdown elenca ogni posizione sintetica con la sua `composition` (es. `Long CALL 100 ITM (PMC 12.34) + Short CALL 110 (spot 115.20)`) e relativo rischio EUR.
