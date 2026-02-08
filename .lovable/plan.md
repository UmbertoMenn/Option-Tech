

## Obiettivo
Aggiungere un banner di debug nella vista Sector Allocation che mostri quali strumenti mancano dalla visualizzazione e il motivo dell'esclusione.

## Cosa verrà aggiunto

Un componente collapsibile (Alert/Collapsible) nella parte superiore della sezione Sector Allocation che mostra:
- Numero di strumenti attesi vs effettivamente visualizzati
- Lista degli strumenti esclusi raggruppata per motivo:
  - **EUROFOREX**: esclusi dal calcolo
  - **Toggle OFF**: esclusi perché il toggle corrispondente è disattivato
  - **Rischio zero o non valido**: strumenti con `riskEUR = 0`, `NaN` o `Infinity`
  - **Settore con totale zero**: strumenti il cui settore è stato filtrato via dalla UI

## Implementazione Tecnica

### File: `src/components/risk/SectorAllocationView.tsx`

1. Aggiungere nuove props per ricevere i dati grezzi necessari al confronto:
```typescript
interface SectorAllocationViewProps {
  // ... existing props ...
  // Per debug banner
  rawStockDetails?: StockRiskDetail[];
  rawNakedPutDetails?: NakedPutRiskDetail[];
  rawLeapCallDetails?: LeapCallRiskDetail[];
  rawStrategyDetails?: StrategyRiskDetail[];
}
```

2. Calcolare gli strumenti mancanti con `useMemo`:
```typescript
const missingInstrumentsAnalysis = useMemo(() => {
  const expected: Array<{ name: string; category: string; risk: number }> = [];
  const displayed = new Set<string>();
  
  // Costruisci set strumenti visualizzati
  for (const sector of safeSectorExposure) {
    for (const instr of sector.instruments) {
      displayed.add(instr.name);
    }
  }
  
  // Costruisci lista attesa (escludi EUROFOREX)
  // ... logica per ogni categoria ...
  
  // Calcola mancanti e motivo
  const missing: Array<{ name: string; reason: string; risk: number }> = [];
  // ... confronto ...
  
  return { expected: expected.length, displayed: displayed.size, missing };
}, [safeSectorExposure, rawStockDetails, ...]);
```

3. Renderizzare il banner solo se ci sono strumenti mancanti:
```typescript
{missingInstrumentsAnalysis.missing.length > 0 && (
  <Collapsible>
    <Alert variant="destructive">
      <AlertTriangle className="w-4 h-4" />
      <AlertTitle>
        {missingInstrumentsAnalysis.missing.length} strumenti non visualizzati
      </AlertTitle>
      <CollapsibleTrigger>Mostra dettagli</CollapsibleTrigger>
    </Alert>
    <CollapsibleContent>
      {/* Lista raggruppata per motivo */}
    </CollapsibleContent>
  </Collapsible>
)}
```

### File: `src/pages/RiskAnalyzer.tsx`

Passare i dati grezzi al componente:
```typescript
<SectorAllocationView 
  // ... existing props ...
  rawStockDetails={analysis.stockDetails}
  rawNakedPutDetails={analysis.nakedPutDetails}
  rawLeapCallDetails={analysis.leapCallDetails}
  rawStrategyDetails={analysis.strategyDetails}
/>
```

## Ragioni di esclusione che verranno rilevate

| Motivo | Descrizione |
|--------|-------------|
| `EUROFOREX` | Strumento escluso perché contiene "EUROFOREX" nel nome |
| `Toggle Naked Put OFF` | Toggle Naked Put disattivato |
| `Toggle Strategie OFF` | Toggle Strategie disattivato |  
| `Toggle Leap Call OFF` | Toggle Leap Call disattivato |
| `Rischio = 0` | Il valore `riskEUR` o `maxLossEUR` è zero |
| `Rischio non valido` | Il valore è `NaN` o `Infinity` |
| `Settore filtrato` | Lo strumento esiste ma il suo settore ha `totalRisk <= 0` |

## UI del Banner

- **Colore**: Giallo/Warning (non rosso, perché alcune esclusioni sono intenzionali)
- **Icona**: AlertTriangle
- **Stato collassato**: Mostra solo conteggio "X strumenti non visualizzati"
- **Stato espanso**: Lista dettagliata raggruppata per motivo

## File da modificare

| File | Modifica |
|------|----------|
| `src/components/risk/SectorAllocationView.tsx` | Aggiungere props, logica di confronto e banner UI |
| `src/pages/RiskAnalyzer.tsx` | Passare i dati grezzi dell'analisi come props |

