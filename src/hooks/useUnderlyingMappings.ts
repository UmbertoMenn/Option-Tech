import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface UnderlyingMapping {
  id: string;
  underlying: string;
  ticker: string;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Normalizzazione canonica per il confronto degli underlying con i mapping in DB.
 * Rimuove punteggiatura, spazi, suffissi societari (INC/CORP/LTD/LLC/PLC/CO/THE)
 * e ogni carattere non alfanumerico. Da usare ovunque si confronti un underlying
 * con la tabella `underlying_mappings`.
 */
export const normalizeUnderlying = (s: string): string =>
  s.toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');

export function useUnderlyingMappings() {
  const queryClient = useQueryClient();

  // Query: tutti i mapping esistenti
  const allMappings = useQuery({
    queryKey: ['underlying-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('underlying_mappings')
        .select('*')
        .order('underlying');
      
      if (error) throw error;
      return data as UnderlyingMapping[];
    },
  });

  // Query: underlying non risolti (derivati senza mapping)
  const unresolvedQuery = useQuery({
    queryKey: ['unresolved-underlyings'],
    queryFn: async () => {
      // Fetch underlying unici dai derivati
      const { data: derivatives, error: derivativesError } = await supabase
        .from('positions')
        .select('underlying')
        .in('asset_type', ['OPTION', 'WARRANT', 'derivative'])
        .not('underlying', 'is', null);
      
      if (derivativesError) throw derivativesError;
      
      const uniqueUnderlyings = [...new Set(
        derivatives
          ?.map(d => d.underlying)
          .filter((u): u is string => Boolean(u))
      )];

      // Fetch stock positions without ticker
      const { data: stocks, error: stocksError } = await supabase
        .from('positions')
        .select('description')
        .eq('asset_type', 'stock')
        .is('ticker', null);

      if (stocksError) throw stocksError;

      const stockNames = [...new Set(
        stocks
          ?.map(s => s.description?.replace(/^AZ\./i, '').trim())
          .filter((d): d is string => Boolean(d))
      )];

      // Merge derivative underlyings + stock names
      const allCandidates = [...new Set([...uniqueUnderlyings, ...stockNames])];

      if (allCandidates.length === 0) {
        return [];
      }

      // Fetch mapping esistenti
      const { data: mappings, error: mappingsError } = await supabase
        .from('underlying_mappings')
        .select('underlying');
      
      if (mappingsError) throw mappingsError;
      
      // Normalizza per confronto
      const normalize = (s: string) =>
        s.toUpperCase()
          .replace(/[.,]+/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|THE)\b/g, '')
          .replace(/[^A-Z0-9]/g, '');
      const mappedNormalized = new Set(mappings?.map(m => normalize(m.underlying)));
      
      // Trova quelli non risolti (confronto normalizzato)
      return allCandidates.filter(u => !mappedNormalized.has(normalize(u))).sort();
    },
  });

  // Mutation: crea/aggiorna mapping
  const upsertMapping = useMutation({
    mutationFn: async ({ underlying, ticker }: { underlying: string; ticker: string }) => {
      const { error } = await supabase
        .from('underlying_mappings')
        .upsert({
          underlying,
          ticker: ticker.toUpperCase(),
          source: 'admin-override',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'underlying' });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underlying-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['unresolved-underlyings'] });
      queryClient.invalidateQueries({ queryKey: ['underlying-prices'] });
    },
    onError: (error) => {
      console.error('Error upserting mapping:', error);
      toast.error('Errore nel salvataggio del mapping');
    },
  });

  // Mutation: elimina mapping
  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('underlying_mappings')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underlying-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['unresolved-underlyings'] });
      queryClient.invalidateQueries({ queryKey: ['underlying-prices'] });
    },
    onError: (error) => {
      console.error('Error deleting mapping:', error);
      toast.error('Errore nell\'eliminazione del mapping');
    },
  });

  return { 
    allMappings, 
    unresolvedQuery, 
    upsertMapping, 
    deleteMapping,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['underlying-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['unresolved-underlyings'] });
    }
  };
}
