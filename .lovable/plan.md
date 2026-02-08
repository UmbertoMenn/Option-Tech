
# Piano: Ottimizzazione Risoluzione AI Settori + Rimozione Toast Bloccante

## Problemi Identificati

### 1. Lentezza nella Risoluzione AI
La edge function `update-prices-cron` processa gli strumenti **sequenzialmente** con un ciclo `for...of` che include:
- Delay di 200ms tra ogni richiesta
- 1-3 secondi per chiamata AI (Lovable AI Gateway)
- 39 strumenti × ~1.5s = **~60 secondi totali**

### 2. Toast Bloccante
Il toast `toast.loading()` di Sonner in `RiskAnalyzer.tsx` appare in basso a destra con `duration: Infinity`, bloccando l'accesso ai pulsanti sottostanti.

---

## Soluzione 1: Ottimizzare la Edge Function

### Approccio: Elaborazione in Batch Paralleli

Modificare la logica in `supabase/functions/update-prices-cron/index.ts` per:

1. **Raggruppare in batch di 5-8 strumenti** per evitare rate limiting
2. **Eseguire chiamate AI in parallelo** all'interno di ogni batch usando `Promise.all()`
3. **Ridurre il delay** tra batch a 100ms (invece di 200ms per ogni singolo item)

**Codice proposto** (righe ~782-860 e ~864-1018):

```typescript
// BEFORE: Sequential processing
for (const isin of isins) {
  // ... resolve one at a time
  await new Promise(resolve => setTimeout(resolve, 200));
}

// AFTER: Parallel batch processing
const BATCH_SIZE = 5;
const isinBatches = chunkArray(isins, BATCH_SIZE);

for (const batch of isinBatches) {
  const batchResults = await Promise.all(
    batch.map(async (isin) => {
      // ... resolve logic (unchanged)
      return { isin, ticker, sector, source };
    })
  );
  results.push(...batchResults);
  
  // Shorter delay between batches
  await new Promise(resolve => setTimeout(resolve, 100));
}
```

### Stima Miglioramento
- Prima: 39 × 1.5s = **~60 secondi**
- Dopo: 8 batch × (1.5s + 0.1s) = **~13 secondi** (~4.5x più veloce)

---

## Soluzione 2: Rimuovere il Toast Bloccante

### Approccio A: Rimuovere Completamente il Toast (Raccomandato)

Il feedback visivo è già presente nel componente `SectorAllocationView.tsx` (righe 276-287) con:
- Spinner + testo "Risoluzione AI in corso (N strumenti)..."
- Icona check verde "Settori aggiornati" al completamento

**Modifiche in `src/pages/RiskAnalyzer.tsx`**:

Rimuovere completamente l'useEffect che mostra il toast (righe 117-129):

```typescript
// REMOVE this entire useEffect:
useEffect(() => {
  if (resolvingCount > 0 && !toastShownRef.current) {
    toastShownRef.current = true;
    toast.loading(`Risoluzione AI settori per ${resolvingCount} strumenti...`, {
      id: 'sector-resolution',
      duration: Infinity,
    });
  } else if (resolvingCount === 0 && toastShownRef.current) {
    toast.dismiss('sector-resolution');
    toast.success('Settori aggiornati', { duration: 2000 });
    toastShownRef.current = false;
  }
}, [resolvingCount]);
```

Rimuovere anche la dichiarazione `toastShownRef` (riga ~31):

```typescript
// REMOVE:
const toastShownRef = useRef(false);
```

---

## File da Modificare

| File | Modifica |
|------|----------|
| `supabase/functions/update-prices-cron/index.ts` | Aggiungere funzione `chunkArray()` + riscrivere loop ISIN e names con batch paralleli |
| `src/pages/RiskAnalyzer.tsx` | Rimuovere useEffect del toast e relativo ref |

---

## Dettaglio Tecnico: Edge Function

### Helper Function da Aggiungere

```typescript
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

### Loop ISIN Ottimizzato (righe ~782-860)

```typescript
const BATCH_SIZE = 5;
const isinBatches = chunkArray(isins, BATCH_SIZE);

for (const batch of isinBatches) {
  const batchPromises = batch.map(async (isin) => {
    // 1. Check cache
    const { data: existing } = await supabase
      .from('isin_mappings')
      .select('ticker, sector, industry')
      .eq('isin', isin)
      .single();
    
    if (existing?.sector) {
      return { isin, ticker: existing.ticker, sector: existing.sector, source: 'cache' };
    }
    
    // 2. Resolve ticker if needed
    let ticker = existing?.ticker || null;
    const description = descriptions[isin] || '';
    
    if (!ticker) {
      const searchResult = await searchYahooByISIN(isin);
      if (!searchResult) {
        return { isin, sector: null, source: 'error', error: 'Could not resolve ticker' };
      }
      ticker = searchResult.ticker;
    }
    
    // 3. Get sector
    const sectorInfo = await fetchYahooSectorInfo(ticker, description);
    
    // 4. Upsert to DB
    await supabase
      .from('isin_mappings')
      .upsert({
        isin,
        ticker,
        sector: sectorInfo.sector,
        industry: sectorInfo.industry,
        source: sectorInfo.sector ? 'ai' : 'unknown',
        last_verified_at: new Date().toISOString(),
      }, { onConflict: 'isin' });
    
    return { isin, ticker, sector: sectorInfo.sector, source: sectorInfo.sector ? 'resolved' : 'unknown' };
  });
  
  const batchResults = await Promise.all(batchPromises);
  results.push(...batchResults.filter(r => r !== null));
  
  // Short delay between batches
  if (isinBatches.indexOf(batch) < isinBatches.length - 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

### Loop Names Ottimizzato (righe ~864-1018)

Stessa logica di batching per i nomi dei derivati.

---

## Riepilogo Benefici

| Aspetto | Prima | Dopo |
|---------|-------|------|
| Tempo risoluzione 39 strumenti | ~60 secondi | ~13 secondi |
| Toast bloccante | Sì | Rimosso |
| Feedback visivo | Toast + inline | Solo inline (già presente) |
| Complessità | Bassa | Media |

---

## Note Importanti

1. **Rate Limiting**: Il batch size di 5 è conservativo per evitare problemi con Yahoo Finance e Lovable AI Gateway
2. **Fallback**: La logica di fallback (cache DB → Yahoo → AI) rimane invariata
3. **Caching**: La prima esecuzione sarà più lenta, le successive useranno la cache
