
## Feedback di Caricamento Derivati + Diagnostica Admin

### Parte 1: Indicatore di caricamento nella pagina Strategie Derivati

Aggiungere un feedback visivo inline nella card "Posizioni da monitorare" che mostri lo stato di risoluzione dei prezzi, identico allo stile del Risk Analyzer:

- **Durante il caricamento**: Badge blu con spinner "Risoluzione prezzi in corso (N strumenti)..."
- **Completato**: Badge verde con check "Prezzi aggiornati"

Per implementarlo serve separare il fetch in due fasi nell'hook `useUnderlyingPrices`:
1. **Fase locale** (veloce): restituisce subito i prezzi gia presenti in DB
2. **Fase edge function** (lenta): lancia in background per i missing, con contatore esposto

L'hook esporra due nuovi campi:
- `missingCount`: numero di underlying per cui serve la edge function
- `isFetchingMissing`: booleano per lo stato di caricamento background

La card `DerivativesSummaryCard` ricevera questi campi e mostrera il feedback inline sotto il titolo.

### Parte 2: Sezione diagnostica nel pannello Admin

Aggiungere un nuovo tab "Diagnostica" nel pannello Admin con una card che mostra gli strumenti problematici, suddivisi per tipo di rallentamento:

| Sezione | Cosa mostra | Fonte dati |
|---------|-------------|------------|
| Ticker senza mapping | Underlying senza entry in `underlying_mappings` (causano chiamata edge function lenta) | Confronto posizioni vs mappings |
| Ticker senza prezzo | Underlying con mapping ma senza prezzo in `underlying_prices` | Confronto mappings vs prices |
| Settori non risolti | ISIN senza settore in `isin_mappings` | Confronto posizioni vs isin_mappings |

Ogni sezione indica quanti strumenti rallentano il sistema e quali sono, con possibilita di risolvere direttamente.

### File modificati

| File | Modifica |
|------|----------|
| `src/hooks/useUnderlyingPrices.ts` | Separare in due query React Query: locale (veloce) + edge function (background). Esporre `missingCount` e `isFetchingMissing` |
| `src/components/derivatives/DerivativesSummaryCard.tsx` | Aggiungere badge di stato caricamento sotto il titolo della card |
| `src/pages/Derivatives.tsx` | Passare i nuovi campi `missingCount` e `isFetchingMissing` alla summary card |
| `src/components/admin/AdminPanel.tsx` | Aggiungere tab "Diagnostica" con icona |
| `src/components/admin/ResolutionDiagnostics.tsx` | **Nuovo file**: componente diagnostica che mostra gli strumenti problematici per prezzo, settore ed esposizione valutaria |

### Dettagli tecnici

**Hook `useUnderlyingPrices` - due fasi:**

```text
Query 1: ['underlying-prices-local', key]
  -> Promise.all(mappings, prices) -> match locale -> return immediato
  -> calcola missingUnderlyings

Query 2: ['underlying-prices-missing', key]  
  -> enabled: missingCount > 0
  -> chiama edge function solo per i missing
  -> aggiorna i risultati in background

useMemo: merge risultati Query 1 + Query 2
```

**Componente diagnostica Admin:**
- Esegue 3 query parallele (positions, underlying_mappings, underlying_prices, isin_mappings)
- Calcola le differenze per identificare i "buchi"
- Mostra i risultati in cards con contatore e lista espandibile
- Include un pulsante "Risolvi" che rimanda ai tab Ticker/Settori esistenti
