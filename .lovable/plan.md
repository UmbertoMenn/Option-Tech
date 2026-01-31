
# Piano: Estensione Prezzi Live a Strategie Derivati e Risk Analyzer

## Obiettivo
Estendere il sistema di prezzi live già implementato nella Dashboard alle pagine **Strategie Derivati** e **Risk Analyzer**, permettendo l'aggiornamento automatico ogni 5 minuti dei prezzi di mercato e il ricalcolo in tempo reale di tutti i valori derivati (P/L, Market Value, rischio, netting).

---

## Situazione Attuale

### Cosa funziona già
- **Edge Function `fetch-market-prices`**: recupera prezzi da Yahoo Finance (azioni/ETF) e Tradier (opzioni USA)
- **Hook `useLivePrices`**: polling ogni 5 minuti, restituisce prezzi live per ticker
- **Dashboard**: mostra badge live nella colonna "Prezzo" della tabella posizioni
- **Componenti UI**: `LivePriceBadge` e `LivePriceIndicator` già pronti

### Cosa manca
1. **I prezzi live sono solo visuali** - non aggiornano `current_price`, `market_value`, `profit_loss`
2. **Strategie Derivati** - usa dati statici da `usePortfolio`, nessun prezzo live
3. **Risk Analyzer** - calcola rischio su `current_price` statico, non si aggiorna
4. **Netting Dashboard** - il calcolo usa prezzi del database, non live

---

## Architettura della Soluzione

```text
                    ┌─────────────────────────────────────────┐
                    │     LivePricesContext (NUOVO)           │
                    │  - stockPrices, optionPrices            │
                    │  - applyLivePricesToPositions()         │
                    │  - polling ogni 5 min                   │
                    └─────────────┬───────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
    ┌───────────┐         ┌─────────────┐         ┌─────────────┐
    │ Dashboard │         │ Derivatives │         │ Risk        │
    │           │         │   Page      │         │ Analyzer    │
    │ positions │         │ categories  │         │ analysis    │
    │ con live  │         │ con live    │         │ con live    │
    │ prices    │         │ prices      │         │ prices      │
    └───────────┘         └─────────────┘         └─────────────┘
```

---

## Fasi di Implementazione

### Fase 1: Creare il Context Centralizzato per i Prezzi Live

**Nuovo file: `src/contexts/LivePricesContext.tsx`**

Questo context:
- Wrappa l'intera applicazione
- Carica i prezzi live una sola volta (non duplica chiamate API)
- Espone una funzione `applyLivePricesToPositions(positions)` che restituisce posizioni con prezzi aggiornati
- Ricalcola automaticamente `current_price`, `market_value`, `profit_loss`

```typescript
// Logica di ricalcolo per ogni posizione
function recalculatePosition(position, livePrice) {
  const newPrice = livePrice?.price ?? position.current_price;
  const quantity = position.quantity;
  const avgCost = position.avg_cost ?? 0;
  const exchangeRate = position.exchange_rate ?? 1;
  
  // Per derivati: moltiplicatore 100
  const multiplier = position.asset_type === 'derivative' ? 100 : 1;
  
  const marketValue = (newPrice * quantity * multiplier) / exchangeRate;
  const costBasis = (avgCost * quantity * multiplier) / exchangeRate;
  const profitLoss = marketValue - costBasis;
  
  return {
    ...position,
    current_price: newPrice,
    market_value: marketValue,
    profit_loss: profitLoss,
    _isLive: true, // flag per indicare prezzo live
  };
}
```

### Fase 2: Nuovo Hook `usePositionsWithLivePrices`

**Nuovo file: `src/hooks/usePositionsWithLivePrices.ts`**

Hook che combina `usePortfolio` con i prezzi live dal context:

```typescript
function usePositionsWithLivePrices() {
  const { positions, summary, ... } = usePortfolio();
  const { applyLivePricesToPositions, isLoading, lastFetched } = useLivePricesContext();
  
  const livePositions = useMemo(() => 
    applyLivePricesToPositions(positions),
    [positions, applyLivePricesToPositions]
  );
  
  // Ricalcola summary con prezzi live
  const liveSummary = useMemo(() => 
    calculateSummary(livePositions),
    [livePositions]
  );
  
  return { positions: livePositions, summary: liveSummary, isLive: true, ... };
}
```

### Fase 3: Aggiornare la Pagina Strategie Derivati

**File: `src/pages/Derivatives.tsx`**

Modifiche:
1. Importare e usare `usePositionsWithLivePrices` invece di `usePortfolio`
2. Aggiungere `LivePriceIndicator` nell'header
3. Le categorie (Covered Call, Naked Put, etc.) useranno automaticamente i prezzi live
4. I calcoli P/L si aggiorneranno in tempo reale

```typescript
// Prima
const { portfolio, positions, isLoading } = usePortfolio();

// Dopo
const { portfolio, positions, isLoading, isLive, lastFetched, refresh } = usePositionsWithLivePrices();
```

**Miglioramenti UI**:
- Badge "LIVE" pulsante accanto ai prezzi aggiornati
- Indicatore stato connessione nell'header
- Pulsante refresh manuale

### Fase 4: Aggiornare il Risk Analyzer

**File: `src/hooks/useRiskAnalysis.ts`**

Modifiche:
1. Accettare posizioni con prezzi live come parametro
2. Ricalcolare tutti i rischi in tempo reale

```typescript
// Prima
export function useRiskAnalysis() {
  const { positions, isLoading } = usePortfolio();
  // ... calcoli su prezzi statici
}

// Dopo
export function useRiskAnalysis(livePositions?: Position[]) {
  const { positions: dbPositions, isLoading } = usePortfolio();
  const positions = livePositions ?? dbPositions;
  // ... calcoli su prezzi live
}
```

**File: `src/pages/RiskAnalyzer.tsx`**

Modifiche:
1. Usare `usePositionsWithLivePrices`
2. Passare posizioni live a `useRiskAnalysis`
3. Aggiungere `LivePriceIndicator` nell'header
4. I valori di rischio si aggiorneranno automaticamente

**Impatto sui calcoli**:
- `totalStockRisk`: ricalcolato con prezzi azioni live
- `totalNakedPutRisk`: invariato (basato su strike, non prezzo)
- `totalLeapCallRisk`: invariato (basato su PMC, non prezzo)
- `totalStrategyRisk`: Max Loss invariato (basato su spread width)

### Fase 5: Aggiornare Dashboard per Netting Live

**File: `src/hooks/useDerivativeNetting.ts`**

Il netting già usa `current_price` dalle posizioni. Con posizioni live, il netting si aggiornerà automaticamente:
- `nettingTotal`: aggiornato con prezzi opzioni live
- `nettingExCoveredCall`: aggiornato (ITM/OTM check con prezzo live sottostante)

**File: `src/components/dashboard/Dashboard.tsx`**

Modifiche:
1. Usare `usePositionsWithLivePrices`
2. Il netting si aggiornerà automaticamente
3. I grafici mostreranno valori live

### Fase 6: Componenti UI Aggiuntivi

**Nuovo file: `src/components/derivatives/LivePriceCell.tsx`**

Cella specializzata per mostrare prezzi live nelle tabelle derivati:

```typescript
function LivePriceCell({ option, livePrice }) {
  return (
    <div className="flex items-center gap-1">
      <span>{formatCurrency(livePrice?.price ?? option.current_price)}</span>
      {livePrice && (
        <Badge variant="outline" className="text-xs animate-pulse">
          LIVE
        </Badge>
      )}
    </div>
  );
}
```

---

## Dettagli Tecnici

### Gestione dello Stato

```text
App.tsx
  └─ LivePricesProvider
       └─ AuthProvider
            └─ PortfolioProvider
                 └─ Routes
                      ├─ Dashboard (usePositionsWithLivePrices)
                      ├─ Derivatives (usePositionsWithLivePrices)
                      └─ RiskAnalyzer (usePositionsWithLivePrices)
```

### Ottimizzazione Performance

1. **Single Source of Truth**: un solo polling per tutta l'app
2. **Memoizzazione**: `useMemo` per ricalcoli costosi
3. **Debouncing**: evita ricalcoli troppo frequenti
4. **Lazy Loading**: i prezzi si caricano solo quando la pagina è visibile

### Gestione Errori

- Se il fetch fallisce, si usano i prezzi del database come fallback
- Indicatore visivo rosso se disconnesso
- Toast notification per errori persistenti

---

## File da Creare

| File | Descrizione |
|------|-------------|
| `src/contexts/LivePricesContext.tsx` | Context provider per prezzi live centralizzato |
| `src/hooks/usePositionsWithLivePrices.ts` | Hook che combina posizioni + prezzi live |
| `src/components/derivatives/LivePriceCell.tsx` | Componente cella con prezzo live |

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/App.tsx` | Wrap con `LivePricesProvider` |
| `src/pages/Derivatives.tsx` | Usare hook live + aggiungere indicatore |
| `src/pages/RiskAnalyzer.tsx` | Usare hook live + aggiungere indicatore |
| `src/hooks/useRiskAnalysis.ts` | Accettare posizioni esterne |
| `src/components/dashboard/Dashboard.tsx` | Usare hook live (opzionale, già funziona) |

---

## Risultato Finale

Dopo l'implementazione:

1. **Dashboard**: continua a funzionare, con netting che usa prezzi live
2. **Strategie Derivati**: 
   - Prezzi opzioni aggiornati ogni 5 min
   - P/L ricalcolato in tempo reale
   - Badge LIVE sui prezzi aggiornati
3. **Risk Analyzer**:
   - Esposizione equity ricalcolata con prezzi live
   - Grafico distribuzione rischio aggiornato
   - Currency exposure aggiornata

---

## Stima Effort

- **Fase 1-2** (Context + Hook): ~2 messaggi
- **Fase 3** (Derivatives): ~1 messaggio  
- **Fase 4** (Risk Analyzer): ~1 messaggio
- **Fase 5-6** (Dashboard + UI): ~1 messaggio

**Totale stimato**: 4-5 messaggi per implementazione completa
