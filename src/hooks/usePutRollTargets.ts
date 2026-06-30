import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface PutRollTarget {
  id: string;
  user_id: string;
  portfolio_id: string;
  strategy_key: string;
  target: number;
  created_at: string | null;
  updated_at: string | null;
}

interface SetTargetParams {
  strategyKey: string;
  /** null/undefined → cancella il target per questa PUT. */
  target: number | null;
  /** Portfolio reale che possiede la posizione. */
  portfolioId: string;
}

/**
 * Gestisce il "Target da recuperare" delle PUT vendute ITM da rollare al rialzo
 * (tabella `put_roll_targets`).
 *
 * A differenza di put_roll_flags (per-portfolio), questo valore è PRIVATO PER UTENTE:
 * la RLS filtra automaticamente su user_id = auth.uid(), quindi ogni utente — admin
 * compreso — vede e modifica solo i propri target. La query non ha bisogno di filtrare
 * per portfolio: la RLS restituisce già solo le righe dell'utente corrente.
 */
export function usePutRollTargets() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['put-roll-targets', userId],
    queryFn: async (): Promise<PutRollTarget[]> => {
      if (!userId) return [];
      // RLS limita già le righe a user_id = auth.uid().
      const { data, error } = await supabase.from('put_roll_targets').select('*');
      if (error) throw error;
      return (data || []) as PutRollTarget[];
    },
    enabled: !!userId,
  });

  /** Target salvato per uno strategy_key, oppure null se non impostato. */
  const getTarget = (strategyKey: string): number | null => {
    const row = targets.find(t => t.strategy_key === strategyKey);
    return row ? Number(row.target) : null;
  };

  const setTargetMutation = useMutation({
    mutationFn: async ({ strategyKey, target, portfolioId }: SetTargetParams) => {
      if (!userId) throw new Error('Utente non autenticato');
      if (!portfolioId) throw new Error('Portfolio non determinabile per il target');

      // Valore vuoto/nullo → cancella la riga.
      if (target === null || Number.isNaN(target)) {
        const { error } = await supabase
          .from('put_roll_targets')
          .delete()
          .eq('user_id', userId)
          .eq('portfolio_id', portfolioId)
          .eq('strategy_key', strategyKey);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('put_roll_targets')
        .upsert(
          {
            user_id: userId,
            portfolio_id: portfolioId,
            strategy_key: strategyKey,
            target,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,portfolio_id,strategy_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['put-roll-targets'] });
    },
    onError: (e: unknown) => {
      const err = e as { message?: string; code?: string; details?: string; hint?: string } | undefined;
      const detail = err?.message || err?.details || err?.hint || (e instanceof Error ? e.message : '');
      const code = err?.code ? ` [${err.code}]` : '';
      console.error('[put_roll_targets] update failed:', e);
      toast.error(`Errore salvataggio target${code}${detail ? ': ' + detail : ''}`);
    },
  });

  return {
    targets,
    isLoading,
    getTarget,
    setTarget: setTargetMutation.mutateAsync,
    isSaving: setTargetMutation.isPending,
  };
}
