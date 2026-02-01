
# Piano: Implementare Risoluzione Ticker Dinamica

## Stato Attuale

Ho verificato il codice e confermato che **il piano non è stato ancora implementato**:

- ❌ La tabella `underlying_mappings` non esiste
- ❌ La funzione `underlyingToTicker` è ancora sincrona e usa solo la lookup table hardcoded
- ❌ Non c'è caching nel database

## Modifiche da Implementare

### 1. Creare Tabella Database

```sql
CREATE TABLE public.underlying_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL UNIQUE,
  ticker TEXT NOT NULL,
  source TEXT DEFAULT 'yahoo',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: pubblico in lettura, service role per scrittura
ALTER TABLE public.underlying_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read underlying mappings"
  ON public.underlying_mappings FOR SELECT USING (true);
```

### 2. Modificare Edge Function `fetch-market-prices`

Trasformare `underlyingToTicker` in funzione asincrona con:

1. **Lookup locale** (veloce)
2. **Cache database** (underlying_mappings)
3. **Yahoo Finance Search** come fallback
4. **Salvataggio in cache** dei nuovi risultati

```typescript
async function underlyingToTicker(
  underlying: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const normalized = underlying.toUpperCase().trim();
  
  // 1. Try local lookup
  if (UNDERLYING_TO_TICKER[normalized]) {
    return UNDERLYING_TO_TICKER[normalized];
  }
  
  // 2. Check database cache
  const { data: cached } = await supabase
    .from('underlying_mappings')
    .select('ticker')
    .eq('underlying', normalized)
    .maybeSingle();
  
  if (cached?.ticker) return cached.ticker;
  
  // 3. Resolve via Yahoo Search
  const ticker = await resolveViaYahooSearch(underlying);
  
  if (ticker) {
    // 4. Cache for future use
    await supabase.from('underlying_mappings').upsert({
      underlying: normalized,
      ticker,
      source: 'yahoo',
    }, { onConflict: 'underlying' });
  }
  
  return ticker;
}
```

### 3. Aggiungere Helper Yahoo Search

```typescript
async function resolveViaYahooSearch(underlying: string): Promise<string | null> {
  const searchTerm = underlying
    .replace(/\s+(INC|CORP|CORPORATION|CO|LTD|LLC|PLC)\.?$/i, '')
    .trim();
  
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchTerm)}&quotesCount=5`;
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0...' },
  });
  
  if (!response.ok) return null;
  
  const data = await response.json();
  const match = data?.quotes?.find(q => q.quoteType === 'EQUITY');
  
  return match?.symbol || null;
}
```

### 4. Pre-risolvere Tutti gli Underlying

Per efficienza, risolvere tutti gli underlying unici in batch prima del loop opzioni:

```typescript
async function resolveAllUnderlyings(
  options: OptionRequest[],
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  // 1. Batch check local + database
  // 2. Resolve missing via Yahoo (con rate limiting)
  // 3. Return map underlying → ticker
}
```

## File Coinvolti

| File | Azione |
|------|--------|
| Database | Creare tabella `underlying_mappings` |
| `supabase/functions/fetch-market-prices/index.ts` | Aggiungere risoluzione dinamica + caching |

## Vantaggi

| Prima | Dopo |
|-------|------|
| ~150 underlying supportati | Qualsiasi underlying |
| Errori per titoli nuovi | Auto-risoluzione dinamica |
| Aggiornamento codice per nuovi titoli | Cache automatica nel database |
