
# Piano: Funzionalità "Pulisci Dati Portfolio"

## Obiettivo
Permettere all'utente di svuotare tutti i dati visibili del portfolio corrente (posizioni, grafici, statistiche) mantenendo il portfolio stesso e i dati storici.

---

## Analisi Dati Collegati al Portfolio

Le seguenti tabelle hanno `portfolio_id` come foreign key:

| Tabella | Descrizione | CASCADE? | Azione Proposta |
|---------|-------------|----------|-----------------|
| `positions` | Posizioni correnti (azioni, bond, ETF, derivati) | SI | **ELIMINARE** |
| `derivative_overrides` | Override manuali strategie derivati | Ha FK a positions | **ELIMINARE** (prima di positions) |
| `strategy_cache` | Cache strategie per avvisi | SI | **ELIMINARE** |
| `covered_call_premiums` | Premi covered call calcolati | SI | **ELIMINARE** |
| `historical_data` | Snapshot storici (grafico evoluzione) | SI | **PRESERVARE** (opzionale) |
| `deposits` | Versamenti e prelievi | SI | **PRESERVARE** (opzionale) |
| `alert_states` | Stati avvisi (safe/alerted) | SI | **ELIMINARE** (reset) |
| `alerts` | Cronologia avvisi generati | SI | **ELIMINARE** |

---

## Problematiche Identificate

### 1. Ordine di Cancellazione (Foreign Key)
`derivative_overrides` ha colonne FK che puntano a `positions`:
- `position_id`, `sold_call_id`, `sold_put_id`, `bought_call_id`, `bought_put_id`, `linked_stock_id`

**Soluzione**: Eliminare `derivative_overrides` **PRIMA** di `positions`.

### 2. Dati Storici e Versamenti
Questi dati sono inseriti manualmente dall'utente e hanno valore storico. Eliminarli potrebbe causare perdita di informazioni preziose.

**Soluzione**: Offrire due opzioni:
- **Pulizia Rapida**: Elimina solo posizioni e cache (dati che vengono ricreati con upload)
- **Reset Completo**: Elimina tutto inclusi dati storici e versamenti

### 3. Stato UI dopo Pulizia
Dopo la pulizia, la UI mostrera valori a zero o vuoti. Bisogna gestire correttamente:
- Invalidazione cache React Query
- Azzeramento valori nel record `portfolios` (`total_value`, `cash_value`, `snapshot_date`)

### 4. Azione Irreversibile
L'utente deve essere chiaramente avvertito che l'operazione non puo essere annullata.

---

## Implementazione

### 1. Nuovo Hook: `useClearPortfolio`

Creare `src/hooks/useClearPortfolio.ts` con:

```typescript
type ClearMode = 'quick' | 'full';

interface ClearResult {
  positionsDeleted: number;
  overridesDeleted: number;
  // ...
}

function useClearPortfolio() {
  const clearPortfolioData = async (portfolioId: string, mode: ClearMode) => {
    // 1. Elimina derivative_overrides (ha FK a positions)
    await supabase.from('derivative_overrides').delete().eq('portfolio_id', portfolioId);
    
    // 2. Elimina positions
    await supabase.from('positions').delete().eq('portfolio_id', portfolioId);
    
    // 3. Elimina cache e stati
    await supabase.from('strategy_cache').delete().eq('portfolio_id', portfolioId);
    await supabase.from('covered_call_premiums').delete().eq('portfolio_id', portfolioId);
    await supabase.from('alert_states').delete().eq('portfolio_id', portfolioId);
    await supabase.from('alerts').delete().eq('portfolio_id', portfolioId);
    
    // 4. Se mode === 'full', elimina anche storici
    if (mode === 'full') {
      await supabase.from('historical_data').delete().eq('portfolio_id', portfolioId);
      await supabase.from('deposits').delete().eq('portfolio_id', portfolioId);
    }
    
    // 5. Azzera valori nel portfolio
    await supabase.from('portfolios').update({
      total_value: 0,
      cash_value: 0,
      snapshot_date: null,
    }).eq('id', portfolioId);
    
    // 6. Invalida tutte le query
    queryClient.invalidateQueries();
  };
  
  return { clearPortfolioData, isClearing };
}
```

### 2. Componente Dialog di Conferma

Creare `src/components/dashboard/ClearDataDialog.tsx`:

```text
+-----------------------------------------------+
|  ⚠️  Pulisci Dati Portfolio                   |
+-----------------------------------------------+
|                                               |
|  Stai per eliminare i dati del portfolio      |
|  "{Portfolio Principale}".                    |
|                                               |
|  Scegli cosa eliminare:                       |
|                                               |
|  ○ Pulizia Rapida                             |
|    Elimina posizioni, strategie e avvisi.     |
|    Mantiene dati storici e versamenti.        |
|                                               |
|  ○ Reset Completo                             |
|    Elimina TUTTO inclusi dati storici         |
|    e versamenti. Azione irreversibile!        |
|                                               |
+-----------------------------------------------+
|                    [Annulla]  [Pulisci]       |
+-----------------------------------------------+
```

### 3. Posizionamento UI

Aggiungere un pulsante "Pulisci Dati" nella sezione "Gestione Dati" della Dashboard, accanto a FileUploader:

```text
┌─ Gestione Dati ───────────────────────────────┐
│  [📊 Dati Storici]  [💰 Versamenti]           │
│                                               │
│  ┌─ Carica Portfolio ─────────────────────┐   │
│  │  📤 Trascina il file Excel qui...      │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  [🗑️ Pulisci Dati Portfolio]                  │  ← NUOVO
└───────────────────────────────────────────────┘
```

### 4. Modifiche ai File

| File | Modifica |
|------|----------|
| `src/hooks/useClearPortfolio.ts` | Nuovo hook per gestire la logica di pulizia |
| `src/components/dashboard/ClearDataDialog.tsx` | Nuovo dialog con scelta modalita |
| `src/components/dashboard/Dashboard.tsx` | Aggiungere pulsante e stato dialog |

---

## Riepilogo Dati Eliminati per Modalita

| Dato | Pulizia Rapida | Reset Completo |
|------|:--------------:|:--------------:|
| Posizioni | ✅ | ✅ |
| Override derivati | ✅ | ✅ |
| Cache strategie | ✅ | ✅ |
| Premi covered call | ✅ | ✅ |
| Stati avvisi | ✅ | ✅ |
| Cronologia avvisi | ✅ | ✅ |
| Dati storici | ❌ | ✅ |
| Versamenti/Prelievi | ❌ | ✅ |
| Metadati portfolio | Reset | Reset |

---

## Considerazioni UX

1. **Pulsante disabilitato** se non ci sono dati da pulire (positions.length === 0)
2. **Loading state** durante l'operazione
3. **Toast di conferma** con riepilogo elementi eliminati
4. **Colore destructive** per il pulsante e l'azione nel dialog
