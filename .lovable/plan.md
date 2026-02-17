

## Ottimizzazione Velocita "Posizioni da Monitorare"

### Problema identificato

L'hook `useUnderlyingPrices` ha due problemi principali:

1. **Nessuna cache cross-navigazione**: usa `useState`/`useEffect` manuali invece di React Query. Ogni volta che si naviga dalla Dashboard a Strategie Derivati, i prezzi vengono ricalcolati da zero.

2. **Query sequenziali (waterfall)**: il flusso attuale esegue fino a 4 step in serie:
   - Query 1: `underlying_mappings` con `.in(underlyings)`
   - Query 2: Se non tutti trovati, scarica TUTTI i mapping per matching normalizzato
   - Query 3: `underlying_prices` con `.in(tickers)`
   - Query 4: Edge function per i prezzi mancanti

### Soluzione

#### 1. Migrare `useUnderlyingPrices` a React Query (`src/hooks/useUnderlyingPrices.ts`)

- Sostituire `useState`/`useEffect` con `useQuery` di TanStack
- `queryKey: ['underlying-prices', underlyingsKey]` con `staleTime: 5 * 60 * 1000` (5 min, allineato al cron)
- I prezzi gia caricati dalla Dashboard restano in cache e vengono riutilizzati immediatamente nella pagina Derivati
- Mantenere la funzione `refetch` per il refresh manuale

#### 2. Parallelizzare le query DB

Invece di 4 step sequenziali, ridurre a 2 step:

- **Step 1 (parallelo)**: Lanciare contemporaneamente:
  - `underlying_mappings` (fetch tutti, la tabella e piccola) 
  - `underlying_prices` (fetch tutti)
- **Step 2**: Matching locale in memoria (istantaneo)
- **Step 3 (solo se necessario)**: Edge function per i prezzi mancanti (raro dopo il primo caricamento)

#### 3. Risultato atteso

| Scenario | Prima | Dopo |
|----------|-------|------|
| Prima navigazione Dashboard -> Derivati | ~2-3s (4 query sequenziali) | ~0.5s (2 query parallele) |
| Navigazione successiva (cache calda) | ~2-3s (stessi step) | Istantaneo (cache React Query) |

### File modificati

| File | Modifica |
|------|----------|
| `src/hooks/useUnderlyingPrices.ts` | Riscrittura con `useQuery`, parallelizzazione query, `staleTime` 5 min |

### Dettagli tecnici

```text
PRIMA (waterfall):
  underlying_mappings.in() ──> [wait] ──> all_mappings ──> [wait] ──> underlying_prices ──> [wait] ──> edge_fn
  |_______________|              |___________|              |______________|              |________|
       ~200ms                       ~300ms                      ~200ms                     ~500ms+

DOPO (parallelo + cache):
  Promise.all([all_mappings, all_prices]) ──> [match locale] ──> edge_fn (solo se serve)
  |__________________________________|         |___|              |________|
              ~300ms                           ~0ms             solo prima volta
```

- La tabella `underlying_mappings` e `underlying_prices` sono piccole (decine/centinaia di righe), quindi scaricarle interamente e un'ottimizzazione netta rispetto a query `.in()` multiple
- Il `staleTime` di 5 minuti si allinea al cron di aggiornamento prezzi

