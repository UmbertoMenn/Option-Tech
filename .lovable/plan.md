

# Piano: Fix Race Condition nella Selezione Portfolio

## Problema Identificato

Ho trovato **due problemi** che causano lo switch indesiderato:

### 1. Ordinamento Non Deterministico

I portfolio hanno lo stesso timestamp `last_updated`:

| Portfolio | last_updated |
|-----------|-------------|
| Portafoglio test 1 | 2026-02-02 10:00:13.543 |
| Portfolio Principale | 2026-02-02 10:00:13.543 |

Quando due record hanno lo stesso valore di ordinamento, PostgreSQL può restituirli in **ordine casuale** tra una query e l'altra!

### 2. Bug nella Logica di Inizializzazione

```typescript
// Linea 66 - Il problema è qui:
if (hasInitialized && selectedId && portfolios.some(p => p.id === selectedId)) {
  return;
}
```

Questa condizione ha un **problema logico**:
- Al primo render: `hasInitialized = false`, quindi la condizione è `false` e si prosegue
- Ma `selectedId` è già valorizzato da localStorage (nello `useState` iniziale)!
- Se `portfolios[0].id` è diverso da `selectedId`, viene sovrascritto

### Flusso Problematico Attuale

```text
1. useState inizializza selectedId = "portfolio-A" (da localStorage) ✓
2. hasInitialized = false
3. Query ritorna portfolios con ordine casuale → portfolios[0] = "portfolio-B"
4. useEffect esegue:
   - hasInitialized = false → condizione di early return è FALSE
   - savedId = "portfolio-A" 
   - portfolios.some(p => p.id === savedId) → POTREBBE essere TRUE o FALSE
     a causa dell'ordine non deterministico della cache
   - Se FALSE → setSelectedId(portfolios[0].id) → "portfolio-B" ❌
5. hasInitialized = true (troppo tardi!)
```

---

## Soluzione

### 1. Aggiungere Ordinamento Secondario Deterministico

Modificare la query per avere un ordinamento stabile:

```typescript
.order('last_updated', { ascending: false, nullsFirst: false })
.order('created_at', { ascending: false }) // Aggiunto: ordinamento secondario
```

### 2. Correggere la Logica di Protezione

Il problema principale è che controlliamo `hasInitialized` prima di verificare se `selectedId` è già valido. Dobbiamo invertire la logica:

```typescript
useEffect(() => {
  if (portfoliosQuery.isLoading || portfoliosQuery.isFetching) return;
  if (portfolios.length === 0) return;
  
  // PRIMA verifica se selectedId attuale è valido - se sì, non fare nulla
  if (selectedId && portfolios.some(p => p.id === selectedId)) {
    if (!hasInitialized) setHasInitialized(true);
    return; // ← Selezione già valida, esci!
  }
  
  // Solo se selectedId NON è valido, prova con localStorage
  const savedId = localStorage.getItem(SELECTED_PORTFOLIO_KEY);
  const savedExists = savedId && portfolios.some(p => p.id === savedId);
  
  if (savedExists) {
    setSelectedId(savedId);
  } else {
    // Fallback
    const fallbackId = portfolios[0].id;
    setSelectedId(fallbackId);
    localStorage.setItem(SELECTED_PORTFOLIO_KEY, fallbackId);
  }
  
  setHasInitialized(true);
}, [portfolios, portfoliosQuery.isLoading, portfoliosQuery.isFetching, selectedId, hasInitialized]);
```

### 3. Aggiungere staleTime più alto

Per evitare refetch durante la navigazione iniziale:

```typescript
staleTime: 30000, // 30 secondi invece di 5
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `src/contexts/PortfolioContext.tsx` | Correggere logica useEffect, aggiungere ordinamento secondario, aumentare staleTime |

---

## Codice Completo della Modifica

```typescript
// Query con doppio ordinamento deterministico
const portfoliosQuery = useQuery({
  queryKey: ['portfolios', user?.id],
  queryFn: async () => {
    if (!user) return [];
    
    const { data, error } = await supabase
      .from('portfolios')
      .select('*')
      .eq('user_id', user.id)
      .order('last_updated', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }); // Ordinamento secondario
    
    if (error) throw error;
    return data as unknown as Portfolio[];
  },
  enabled: !!user,
  staleTime: 30000, // 30 secondi
});

// Auto-selezione robusta - LOGICA CORRETTA
useEffect(() => {
  if (portfoliosQuery.isLoading || portfoliosQuery.isFetching) return;
  if (portfolios.length === 0) return;
  
  // PRIMA: verifica se selezione attuale è già valida
  if (selectedId && portfolios.some(p => p.id === selectedId)) {
    // Selezione valida - marca come inizializzato ed esci
    if (!hasInitialized) setHasInitialized(true);
    return;
  }
  
  // SOLO se selectedId non valido, prova localStorage
  const savedId = localStorage.getItem(SELECTED_PORTFOLIO_KEY);
  const savedExists = savedId && portfolios.some(p => p.id === savedId);
  
  if (savedExists) {
    setSelectedId(savedId);
    localStorage.setItem(SELECTED_PORTFOLIO_KEY, savedId); // Conferma in localStorage
  } else {
    // Fallback: primo della lista (ora con ordine deterministico)
    const fallbackId = portfolios[0].id;
    setSelectedId(fallbackId);
    localStorage.setItem(SELECTED_PORTFOLIO_KEY, fallbackId);
  }
  
  setHasInitialized(true);
}, [portfolios, portfoliosQuery.isLoading, portfoliosQuery.isFetching, selectedId, hasInitialized]);
```

---

## Flusso Corretto Dopo le Modifiche

```text
1. useState inizializza selectedId = "portfolio-A" (da localStorage)
2. hasInitialized = false
3. Query ritorna portfolios (ordine deterministico)
4. useEffect esegue:
   - selectedId = "portfolio-A"
   - portfolios.some(p => p.id === "portfolio-A") → TRUE
   - → RETURN immediato, selezione preservata ✓
5. hasInitialized = true
6. Nessun cambio indesiderato ✓
```

---

## Note Tecniche

1. **Ordinamento deterministico**: `last_updated DESC, created_at DESC` garantisce ordine stabile
2. **Controllo priorità**: Prima verifica se `selectedId` attuale è valido, solo dopo controlla localStorage
3. **staleTime 30s**: Riduce refetch inutili che potrebbero causare race condition
4. **Conferma localStorage**: Riscrivi sempre l'ID selezionato per evitare inconsistenze

