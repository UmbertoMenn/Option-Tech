# Piano: Rimuovere ETF e Aggiungere Leap Call alle Holdings Consolidate

## Stato: ✅ COMPLETATO

## Obiettivo Raggiunto

1. ✅ **Rimossa** la scomposizione degli ETF (top holdings) dalle Holdings Consolidate
2. ✅ **Aggiunta** l'esposizione delle Leap Call (premio pagato) alle Holdings Consolidate
3. ✅ **Rimosso** tutto il codice backend per scraping/AI delle top holdings ETF (~250 righe)

## Modifiche Effettuate

### 1. Edge Function: `supabase/functions/fetch-etf-allocation/index.ts`

**Rimosso completamente:**
- `EXCLUDED_HOLDING_NAMES` - Array nomi esclusi per holdings
- `hasValidTopHoldings()` - Funzione validazione holdings
- `fetchETFTopHoldingsFromProvider()` - Dispatcher provider scraping
- `scrapeSSGAHoldings()` - Scraping SSGA
- `parseSSGAHoldings()` - Parser SSGA
- `fetchETFTopHoldingsWithAI()` - Fallback AI Gemini per holdings
- Logica top holdings in `scrapeJustETF()` - Sezione "TOP HOLDINGS"
- Chiamata AI fallback nel `serve()` per top holdings

**Mantenuto:**
- Scraping sector/country/currency allocations
- Fallback AI per sector allocations

### 2. Logic: `src/lib/sectorExposure.ts`

**Modificata interfaccia `ConsolidatedHolding`:**
- Rimossa `etfExposure`
- Aggiunta `leapCallRisk`
- Modificato `sources.type` da `'etf' | 'stock' | 'nakedPut'` a `'stock' | 'nakedPut' | 'leapCall'`

**Modificata interfaccia `ConsolidatedHoldingWithDetails`:**
- Rimossa `etfDetails`
- Aggiunta `leapCallDetails` con: strike, contracts, avgCost, premiumPaid, expiry

**Modificato `calculateConsolidatedTopHoldings()`:**
- Rimossa sezione "1. Add ETF holdings"
- Rinumerate sezioni (1=Stock, 2=Naked PUT, 3=Leap Call)
- Aggiunta sezione "4. Add Leap Call risk (premium paid)"
- Formula aggiornata: `totalExposure = stockPart + nakedPutRisk + leapCallRisk`

### 3. UI: `src/components/risk/EquityExposureView.tsx`

**Modificato:**
- Rimosso badge ETF (cyan)
- Aggiunto badge LEAP (amber)
- Aggiornata descrizione: "Stock diretti + Naked PUT + Leap Call"

### 4. UI: `src/components/risk/HoldingBreakdownDialog.tsx`

**Modificato:**
- Rimossa sezione "ETF Details"
- Aggiunta sezione "Leap Call Details" con:
  - Strike, contratti, PMC, scadenza
  - Subtotale LEAP in amber

### 5. Hook: `src/hooks/useETFAllocations.ts`

**Semplificato:**
- Rimossa logica di force refresh per `hasNoTopHoldings`

## Risultato

Le **Holdings Consolidate** ora mostrano:

| Fonte | Colore Badge | Calcolo |
|-------|-------------|---------|
| **Stock** | Blu/Verde | Valore azioni (con/senza protezioni) |
| **PUT** | Rosso | Strike × Contratti × 100 / Cambio |
| **LEAP** | Ambra | PMC × Contratti × 100 / Cambio |

Formula: `TotalExposure = StockRisk(+/-protezioni) + NakedPutRisk + LeapCallRisk`

L'edge function è alleggerita di ~250 righe, nessuna chiamata AI per top holdings ETF, e il Risk Analyzer continua a funzionare per sector/currency/country allocations.
