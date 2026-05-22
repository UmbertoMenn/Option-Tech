# Tooltip (i) di spiegazione calcolo nel dettaglio del Risk Analyzer

## Obiettivo
Nel dialog "Breakdown" del Risk Analyzer, aggiungere accanto a ogni riga (Stock, PUT, LEAP, Strategie, Sintetiche CC/DR-CC) un'icona (i) che, al hover, mostra la formula con cui è stato calcolato il rischio, usando i numeri reali della posizione.

## Approccio (minimale)
Le formule per Stock, Naked PUT, LEAP Call e Strategie sono ricostruibili nel dialog dai campi già presenti (`quantity`, `price`, `strike`, `contracts`, `marketPrice`, `protectionStrike`, `protectionContracts`). Nessuna modifica al calcolo del rischio. Per le sintetiche CC/DR-CC riutilizziamo la stringa `composition` già prodotta da `calculateSyntheticCcDrccRisk` nel piano precedente: va solo propagata fino al dialog.

## File da modificare

### `src/components/risk/HoldingBreakdownDialog.tsx` (modifica principale)
- Importare `Info` da `lucide-react` (Tooltip già importato).
- Aggiungere accanto al valore EUR di ogni riga un `<Info className="w-3.5 h-3.5 text-muted-foreground" />` come trigger di tooltip.
- Contenuto del tooltip costruito inline per ciascun tipo:
  - **Stock**: `qty × price × FX = value` (+ riga `− contracts × strike × 100 × FX` se protetto).
  - **Sintetica CC/DR-CC**: mostra `composition` propagata.
  - **Naked PUT**: `contracts × strike × 100 × FX = riskEUR`.
  - **LEAP Call**: `contracts × marketPrice × 100 × FX = marketValue`.
  - **Strategia**: testo `Max Loss universale calcolato sul payoff a scadenza` + nota se `hasUnlimitedRisk`.
- Formula renderizzata con classe `font-mono text-xs`.

### `src/lib/sectorExposure.ts` (solo propagazione)
- Aggiungere campo opzionale `composition?: string` all'interfaccia di `stockDetails` in `ConsolidatedHoldingWithDetails`.
- Passare `s.composition` quando viene fatto il push del dettaglio sintetico (sezione 1b, da `syntheticCcDrccDetails`).

## Note
- Zero modifiche a database, RLS, edge functions, o logica di calcolo.
- `riskCalculator.ts` non viene toccato: `composition` è già emesso dal piano precedente.
- Valori formattati con i formatter esistenti (`formatNumber`, `formatEUR`).
