## Obiettivo
Sostituire il denominatore della percentuale "(X% del valore asset)" nella card "Esposizione in Equity e Commodities" del Risk Analyzer con il **Patrimonio Netting Totale** (`nettingTotal`), così da allinearla al valore usato in dashboard.

## Formula attuale (sbagliata)
```
% = dynamicGrandTotal / summary.totalValue × 100
```
`summary.totalValue` = cash + investito non-derivati. Esclude il netting dei derivati → percentuale gonfiata.

## Formula corretta
```
% = dynamicGrandTotal / nettingTotal × 100
```
dove `nettingTotal = summary.totalValue + totalNetting derivati` (stesso valore della card "Patrimonio Netting Totale" in dashboard), già esposto da `useDerivativeNetting`.

## Modifiche

### 1. `src/pages/RiskAnalyzer.tsx`
- Importare/usare `useDerivativeNetting` (se non già presente) per ottenere `netting.nettingTotal`.
- Passare a `<EquityExposureView>` un nuovo prop `portfolioNettingTotal={netting.nettingTotal}` invece (o in aggiunta) di `summary?.totalValue`.

### 2. `src/components/risk/EquityExposureView.tsx`
- Rinominare/aggiungere il prop `portfolioNettingTotal?: number`.
- Aggiornare la riga 527-531:
  - Denominatore: `portfolioNettingTotal`.
  - Etichetta: `(X% del Patrimonio Netting Totale)` per riflettere la nuova base.
- Aggiornare il tooltip della card se utile, indicando la base di confronto.

### 3. Nessun'altra logica toccata
Le percentuali interne alla composizione (sector exposure, top holdings) restano invariate: usano `dynamicGrandTotal` come base.

## Verifica
- Caricare un portafoglio con derivati aperti e controllare che la percentuale corrisponda a `Esposizione totale / Patrimonio Netting Totale` mostrato in dashboard.
- Quando `nettingTotal` non è disponibile (caricamento iniziale), la riga rimane nascosta come oggi.
