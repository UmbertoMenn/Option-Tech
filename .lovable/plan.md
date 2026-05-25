Due problemi nel dettaglio "CC e DR-CC sintetiche" del Risk Analyzer / Equity Exposure:

1. Il tooltip header è troppo lungo e finisce sotto la finestra.
2. I tooltip per riga non mostrano i numeri reali (strike, PMC, mkt, spot, qty, contracts, protStrike, prezzo per azione) usati nel calcolo — c'è solo `composition` come stringa generica e il `riskOriginal`/`riskEUR`.

## Modifiche

### 1) `src/components/ui/tooltip.tsx` (o solo dentro `CalcInfo`)
Rendere il `TooltipContent` usato da `CalcInfo` scrollabile per evitare che esca dallo schermo:
- Aggiungere `max-h-[70vh] overflow-y-auto` alla `TooltipContent` di `CalcInfo` in `EquityExposureView.tsx` (modifica locale, non globale).
- `collisionPadding` è già 8 → Radix riposiziona, ma il contenuto verticale lungo va comunque vincolato.

### 2) `src/components/risk/EquityExposureView.tsx` — `SYNTH_HEADER_TOOLTIP`
Accorciare drasticamente: tenere solo nomi delle 4 varianti + formula a 1 riga ciascuna + nota conversione EUR. Niente sezioni discorsive. La teoria estesa va per riga, dove servono i numeri.

### 3) `src/lib/riskCalculator.ts` — esporre i numeri usati nel calcolo
Aggiungere a `StockRiskDetail` un campo opzionale `syntheticBreakdown` con tutti i valori reali usati:

```ts
syntheticBreakdown?: {
  qty?: number;                 // per cc_call / drcc_call (quantità long CALL)
  longStrike?: number;
  shortStrike?: number;
  pmc?: number;
  mkt?: number;
  spot?: number | null;
  pricePerShare?: number;       // PMC oppure mkt scelto
  priceSource?: 'PMC' | 'mkt';
  // cc_put
  putStrike?: number;
  putQty?: number;              // |quantity|
  // drcc_put
  synPutStrike?: number;
  protPutStrike?: number;
  contracts?: number;
  perShare?: number;            // max(0, synPutStrike - protPutStrike)
};
```

Popolarlo in:
- `buildCallBasedEntry` → `{ qty, longStrike, shortStrike, pmc, mkt, spot, pricePerShare, priceSource }`
- Ramo `cc_put` → `{ putStrike: strike, putQty: qty, shortStrike }`
- Ramo `drcc_put` → `{ synPutStrike, protPutStrike, shortStrike, contracts, perShare }`

Nessun cambio alla logica di calcolo del rischio.

### 4) `src/components/risk/EquityExposureView.tsx` — `buildSynthTooltip`
Riscrivere per mostrare i NUMERI REALI step-by-step usando `syntheticBreakdown`. Formato per ogni variante:

**cc_call / drcc_call:**
```
DR-CC sintetica (CALL) — TICKER
Composizione: Long CALL 100 ITM (PMC 12.34) + Short CALL 110 (spot 115.20) [+ Protezione PUT 90]

Dati:
  qty long CALL    = 5
  strike long      = 100
  strike short     = 110
  PMC long         = 12.34
  mkt long         = 11.80
  spot underlying  = 115.20  → spot > strike short → uso PMC

Calcolo:
  pricePerShare = PMC = 12.34
  riskOriginal  = 12.34 × 5 × 100 = USD 6.170
  exchangeRate  = 1.0850 (USD/EUR)
  riskEUR       = 6.170 / 1.0850 = € 5.687
```

**cc_put:**
```
Dati:
  strike PUT short = 95
  |qty PUT|        = 3
  strike CALL short = 100

Calcolo:
  riskOriginal = 95 × 3 × 100 = USD 28.500
  riskEUR      = 28.500 / 1.0850 = € 26.268
```

**drcc_put:**
```
Dati:
  strike PUT sintetica = 95
  strike PUT protezione = 85
  contracts             = 3
  spread per azione     = max(0, 95 − 85) = 10

Calcolo:
  riskOriginal = 10 × 3 × 100 = USD 3.000
  riskEUR      = 3.000 / 1.0850 = € 2.765
```

Se `syntheticBreakdown` è assente (compatibilità), mostrare il tooltip attuale (composition + formula + riskOriginal/riskEUR) come fallback.

## File toccati
- `src/lib/riskCalculator.ts` — aggiungere campo `syntheticBreakdown` su `StockRiskDetail` + popolamento nei 3 punti.
- `src/components/risk/EquityExposureView.tsx` — accorciare `SYNTH_HEADER_TOOLTIP`, riscrivere `buildSynthTooltip` per usare i numeri reali, rendere il TooltipContent di `CalcInfo` scrollabile (`max-h-[70vh] overflow-y-auto`).

Nessuna modifica a RLS, edge functions, hook, altri view (Currency/Sector), o logica di rischio.