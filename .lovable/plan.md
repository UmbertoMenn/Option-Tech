

## Fix: GP holdings nel Risk Analyzer come singoli titoli (non come settore unico)

### Problema

Il piano precedente prevedeva di aggiungere le azioni GP come un unico settore "Gestione Patrimoniale". L'utente correttamente nota che i GP holdings hanno tutti i dati necessari (ticker_code, description) per essere trattati come singoli titoli, esattamente come quelli del portfolio standard.

### Approccio

Passare i `gpHoldings` (di tipo stock) alle tre viste del Risk Analyzer come dati granulari, non come valore aggregato. Ogni holding GP stock diventa una riga nelle consolidated holdings, nella sector allocation e nella currency exposure.

---

### 1. `src/pages/RiskAnalyzer.tsx`

- Importare `useGPHoldings`
- Passare `gpHoldings` (filtrati per `asset_type === 'stock'`) a:
  - `EquityExposureView` (prop `gpStockHoldings`)
  - `SectorAllocationView` (prop `gpStockHoldings`) — anche inclusi in `stocksForSectorMapping` per risolvere i settori
  - `CurrencyExposureView` (prop `gpStockHoldings`)
- Aggiungere stato `includeGP` per ogni vista (equity, currency, sector) come per gli altri toggle
- Includere i ticker GP in `stocksForSectorMapping` per la risoluzione settori

### 2. `src/components/risk/EquityExposureView.tsx`

- Prop: `gpStockHoldings: GPHoldingRow[]`, `includeGP: boolean`, `onIncludeGPChange`
- Toggle "GP" nella sezione toggle
- Quando `includeGP` è attivo:
  - Sommare il valore GP stock al `dynamicGrandTotal`
  - Aggiungere ogni GP stock holding come riga nelle **Consolidated Holdings** (usando `getOrCreateHolding` con description/ticker_code)
  - Aggiungere categoria "GP Azioni" nel donut delle categorie di rischio

### 3. `src/components/risk/SectorAllocationView.tsx`

- Prop: `gpStockHoldings: GPHoldingRow[]`, `includeGP: boolean`, `onIncludeGPChange`
- Toggle "GP"
- Quando attivo, i GP stock vanno inclusi nel calcolo settoriale — ogni titolo GP viene mappato al proprio settore tramite ticker_code/description (stessa logica dei titoli normali)
- Passare i GP holdings a `calculateSectorExposure` come parametro aggiuntivo

### 4. `src/components/risk/CurrencyExposureView.tsx`

- Prop: `gpStockHoldings: GPHoldingRow[]`, `includeGP: boolean`, `onIncludeGPChange`
- Toggle "GP"
- Ogni GP holding ha `currency` e `exchange_rate` — va aggiunto alla distribuzione valutaria per currency

### 5. `src/lib/sectorExposure.ts`

- `calculateSectorExposure`: accettare parametro opzionale `gpStockHoldings` — per ogni holding, risolvere il settore via ticker_code (usando `STOCK_SECTORS` e `COMPANY_NAME_TO_TICKER`) e aggiungerlo come strumento nella categoria `stocks`
- `calculateConsolidatedTopHoldings`: accettare parametro opzionale `gpStockHoldings` — aggiungere ogni GP stock come holding consolidata (usando `getOrCreateHolding`)

### 6. `src/hooks/useCurrencyExposure.ts`

- Accettare parametro opzionale `gpStockHoldings` e `includeGP`
- Se attivo, aggiungere i GP stock raggruppati per valuta all'esposizione

---

### File da modificare
1. `src/pages/RiskAnalyzer.tsx` — import useGPHoldings, toggle GP per tutte le viste, passare gpStockHoldings
2. `src/components/risk/EquityExposureView.tsx` — toggle GP, GP nel dynamicGrandTotal, GP nelle consolidated holdings
3. `src/components/risk/SectorAllocationView.tsx` — toggle GP, GP nei settori granulari
4. `src/components/risk/CurrencyExposureView.tsx` — toggle GP, GP nelle valute
5. `src/lib/sectorExposure.ts` — supporto GP in calculateSectorExposure e calculateConsolidatedTopHoldings
6. `src/hooks/useCurrencyExposure.ts` — supporto GP nell'esposizione valutaria

