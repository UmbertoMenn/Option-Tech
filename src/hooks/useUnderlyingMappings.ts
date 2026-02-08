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
      
      if (uniqueUnderlyings.length === 0) {
        return [];
      }
      
      // Fetch mapping esistenti
      const { data: mappings, error: mappingsError } = await supabase
        .from('underlying_mappings')
        .select('underlying');
      
      if (mappingsError) throw mappingsError;
      
      const mappedUnderlyings = new Set(mappings?.map(m => m.underlying));
      
      // Trova quelli non risolti
      return uniqueUnderlyings.filter(u => !mappedUnderlyings.has(u)).sort();
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
