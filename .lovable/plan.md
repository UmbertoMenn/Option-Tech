

# Piano: Toggle Protezioni nella vista Equity Exposure

## Obiettivo
1. Rimuovere "Totale" dal titolo della card principale
2. Aggiungere toggle "Protezioni" per mostrare rischio stocks al netto/lordo delle protezioni
3. Aggiornare dinamicamente la descrizione del rischio stocks nel grafico a barre
4. Mostrare il valore ridotto dalle protezioni (quando toggle attivo)
5. Impostare il tooltip con testo fisso (non dinamico)

---

## Modifiche Tecniche

### File: `src/components/risk/EquityExposureView.tsx`

#### 1. Titolo Card

```
// Da:
"Esposizione Totale in Equity e Commodities"

// A:
"Esposizione in Equity e Commodities"
```

#### 2. Aggiungere Toggle "Protezioni" nella Card principale

Nella sezione della card con l'esposizione totale, aggiungere un toggle:

```typescript
<div className="flex items-center gap-2 mt-4">
  <Switch 
    id="protections-toggle"
    checked={includeProtections}
    onCheckedChange={setIncludeProtections}
  />
  <Label htmlFor="protections-toggle" className="text-sm">
    Protezioni
  </Label>
</div>
```

Nota: lo stato `includeProtections` esiste già nel componente.

#### 3. Calcolare valori lordo/netto per gli Stocks

Aggiungere un `useMemo` per calcolare:
- **Gross Stock Risk**: Somma di (stockValue / exchangeRate) per tutti gli stocks puri (non ETF)
- **Protection Savings**: Gross - Net (valore ridotto dalle protezioni)

```typescript
const { grossPureStockRisk, protectionSavings } = useMemo(() => {
  const pureStocks = stockDetails.filter(s => !s.isETF);
  
  // Gross = valore lordo senza considerare protezioni
  const gross = pureStocks.reduce((sum, s) => 
    sum + (s.stockValue / s.exchangeRate), 0
  );
  
  // Net = rischio attuale (già al netto delle protezioni)
  const net = pureStocks.reduce((sum, s) => sum + s.riskEUR, 0);
  
  return {
    grossPureStockRisk: gross,
    protectionSavings: gross - net
  };
}, [stockDetails]);
```

#### 4. Dinamica del rischio Stocks nel grafico a barre

L'array `riskCategories` deve usare valori dinamici in base al toggle:

```typescript
{ 
  label: 'Rischio Stocks', 
  // Se protezioni attive: usa valore netto, altrimenti lordo
  value: includeProtections ? totalPureStockRisk : grossPureStockRisk, 
  percentage: getPercentage(includeProtections ? totalPureStockRisk : grossPureStockRisk),
  color: 'bg-blue-500',
  icon: TrendingUp,
  // Descrizione dinamica
  description: includeProtections 
    ? 'Azioni individuali (al netto di protezioni PUT)' 
    : 'Azioni individuali (al lordo di protezioni PUT)',
  // Dati extra per mostrare il risparmio protezioni
  protectionSavings: includeProtections ? protectionSavings : 0,
  showProtectionSavings: includeProtections && protectionSavings > 0
}
```

#### 5. Mostrare il valore ridotto dalle protezioni

Nel rendering del grafico a barre, dopo il valore principale, mostrare il risparmio protezioni:

```typescript
<div className="text-right">
  <span className="font-semibold">{formatEUR(cat.value)}</span>
  <span className="text-muted-foreground text-sm ml-2">({cat.percentage.toFixed(1)}%)</span>
  {/* Nuova riga per mostrare risparmio protezioni */}
  {cat.showProtectionSavings && (
    <div className="text-xs text-green-500">
      Protezioni: -{formatEUR(cat.protectionSavings)}
    </div>
  )}
</div>
```

#### 6. Aggiornare il Grand Total dinamicamente

Il grandTotal deve riflettere il toggle:

```typescript
const dynamicGrandTotal = useMemo(() => {
  const stockRisk = includeProtections ? totalPureStockRisk : grossPureStockRisk;
  return totalETFRisk + stockRisk + totalCommodityRisk + totalNakedPutRisk + totalLeapCallRisk + totalStrategyRisk;
}, [includeProtections, ...]);
```

#### 7. Tooltip FISSO (non dinamico)

Il tooltip avrà sempre lo stesso testo:

```typescript
<TooltipContent className="max-w-xs text-sm">
  <p>
    Se toggle "Protezioni" attivo, le azioni singole sono calcolate al netto delle protezioni (Long PUT). Il rischio Strategie è calcolato come il max loss di ogni strategia. Le Leap Call sono calcolate come il valore di mercato (prezzo × contratti × 100).
  </p>
</TooltipContent>
```

---

## Riepilogo Modifiche

| Elemento | Prima | Dopo |
|----------|-------|------|
| Titolo card | "Esposizione Totale in Equity e Commodities" | "Esposizione in Equity e Commodities" |
| Toggle Protezioni | Non presente nella card | Toggle con label "Protezioni" |
| Descrizione Rischio Stocks (ON) | - | "Azioni individuali (al netto di protezioni PUT)" |
| Descrizione Rischio Stocks (OFF) | - | "Azioni individuali (al lordo di protezioni PUT)" |
| Valore protezioni (ON) | Non mostrato | Riga "Protezioni: -XXX €" in verde sotto il valore |
| Grand Total | Fisso (netto) | Dinamico in base al toggle |
| Tooltip | Dinamico | **FISSO** con testo specificato |

---

## Dettagli UI

- **Posizione Toggle**: All'interno della card principale, sotto le informazioni percentuali
- **Stile Toggle**: Usa componenti esistenti `Switch` e `Label`
- **Valore Protezioni**: Testo verde (`text-green-500`), font normale (non bold), prefisso "Protezioni: -"
- **Descrizione**: Testo piccolo sotto il nome della categoria nel grafico a barre

---

## File Modificato

- `src/components/risk/EquityExposureView.tsx`

