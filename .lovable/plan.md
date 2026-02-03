
# Piano: Correzione Visualizzazione Prezzi Sottostante

## Problema Identificato

I prezzi per JPMorgan, Lululemon, Progressive e Uber vengono correttamente recuperati dall'edge function (confermato dai log), ma non vengono visualizzati nell'interfaccia.

### Causa Root
Il hook `useUnderlyingPrices` ha un problema nella gestione delle dipendenze dell'useEffect:

```typescript
useEffect(() => {
  if (underlyings.length > 0) {
    fetchPrices();
  }
}, [fetchPrices, underlyings.length]);  // ← PROBLEMA: usa .length invece dell'array
```

Questo causa:
1. Se l'array cambia contenuto ma mantiene la stessa lunghezza, l'effect non si ri-triggera
2. Potenziale mismatch tra i nomi richiesti e quelli nell'array attuale

---

## Soluzione

### File: `src/hooks/useUnderlyingPrices.ts`

1. **Creare una chiave stabile** basata sul contenuto dell'array, non sulla lunghezza
2. **Usare la chiave come dipendenza** dell'useEffect invece di `underlyings.length`
3. **Rimuovere la dipendenza circolare** di `fetchPrices` dall'useCallback

### Codice Corretto

```typescript
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UnderlyingPrice {
  price: number;
  currency: string;
  ticker?: string;
}

export interface UseUnderlyingPricesResult {
  prices: Record<string, UnderlyingPrice>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUnderlyingPrices(underlyings: string[]): UseUnderlyingPricesResult {
  const [prices, setPrices] = useState<Record<string, UnderlyingPrice>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);
  const lastKeyRef = useRef<string>('');

  // Create a stable key from the underlyings array
  const underlyingsKey = useMemo(() => {
    const unique = [...new Set(underlyings.filter(u => u && typeof u === 'string'))];
    return unique.sort().join('|');
  }, [underlyings]);

  useEffect(() => {
    const fetchPrices = async () => {
      const uniqueUnderlyings = [...new Set(underlyings.filter(u => u && typeof u === 'string'))];
      
      if (uniqueUnderlyings.length === 0) {
        return;
      }

      // Don't refetch if we already have the same underlyings
      if (hasFetchedRef.current && lastKeyRef.current === underlyingsKey) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log(`Fetching prices for ${uniqueUnderlyings.length} underlyings:`, uniqueUnderlyings);
        
        const { data, error: fetchError } = await supabase.functions.invoke('fetch-underlying-prices', {
          body: { underlyings: uniqueUnderlyings }
        });

        if (fetchError) {
          throw new Error(fetchError.message || 'Failed to fetch underlying prices');
        }

        if (data?.prices) {
          setPrices(data.prices);
          console.log(`Received ${Object.keys(data.prices).length} underlying prices:`, Object.keys(data.prices));
        }

        hasFetchedRef.current = true;
        lastKeyRef.current = underlyingsKey;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error fetching prices';
        console.error('Error fetching underlying prices:', errorMessage);
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    if (underlyings.length > 0) {
      fetchPrices();
    }
  }, [underlyings, underlyingsKey]);

  const refetch = useCallback(() => {
    hasFetchedRef.current = false;
    lastKeyRef.current = '';
    // Force re-run of effect by triggering a state change
    setPrices({});
  }, []);

  return { prices, isLoading, error, refetch };
}
```

---

## Modifiche Chiave

| Aspetto | Prima | Dopo |
|---------|-------|------|
| Dipendenza useEffect | `underlyings.length` | `underlyingsKey` (hash del contenuto) |
| fetchPrices | useCallback con dipendenza circolare | Funzione inline nell'useEffect |
| Debug logging | Minimo | Aggiunto log degli underlyings richiesti |
| Refetch | Resettava solo `hasFetchedRef` | Resetta anche `lastKeyRef` e `prices` |

---

## File Modificati

| File | Modifica |
|------|----------|
| `src/hooks/useUnderlyingPrices.ts` | Refactoring dipendenze e logica fetch |

---

## Verifica

Dopo la modifica:
1. Aprire la pagina Strategie Derivati (`/derivatives`)
2. Verificare nella console i log: "Fetching prices for X underlyings: [...]"
3. Verificare che JPMorgan, Lululemon, Progressive, Uber mostrino "PS: $XXX"
4. Aprire una Naked PUT e verificare il badge ITM/OTM corretto
