import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CallBuybackAlertConfig, CallBuybackAlertScope } from '@/lib/callBuybackAlerts';

export type CallBuybackAlertRow = CallBuybackAlertConfig & {
  created_at: string;
  updated_at: string;
};

/** Config degli avvisi "call da rivendere" del portafoglio. */
export function useCallBuybackAlerts(portfolioId: string | null | undefined) {
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['call-buyback-alerts', portfolioId],
    queryFn: async (): Promise<CallBuybackAlertRow[]> => {
      if (!portfolioId) return [];
      const { data, error } = await supabase
        .from('call_buyback_alerts' as never)
        .select('*')
        .eq('portfolio_id', portfolioId);
      if (error) {
        console.error('[useCallBuybackAlerts] fetch error:', error.message);
        return [];
      }
      return (data || []) as unknown as CallBuybackAlertRow[];
    },
    enabled: !!portfolioId,
    staleTime: 60_000,
  });

  return { alerts, isLoading };
}

export interface UpsertCallBuybackAlertInput {
  scope: CallBuybackAlertScope;
  /** Obbligatorio per scope='tranche', deve essere null per scope='call'. */
  buyback_id: string | null;
  underlying: string;
  strike: number;
  expiry_date: string;
  gain_threshold_pct: number | null;
  loss_threshold_pct: number | null;
  enabled?: boolean;
  cooldown_minutes?: number;
}

/**
 * Salvataggio delle soglie. Una config senza nessuna delle due direzioni non ha
 * significato: viene cancellata invece di essere salvata vuota (è il modo
 * naturale di "spegnere" l'avviso svuotando i campi).
 */
export function useCallBuybackAlertMutations(portfolioId: string | null | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['call-buyback-alerts', portfolioId] });

  const upsert = useMutation({
    mutationFn: async (input: UpsertCallBuybackAlertInput) => {
      if (!portfolioId) throw new Error('Portafoglio non selezionato');

      const hasThreshold = input.gain_threshold_pct != null || input.loss_threshold_pct != null;

      // Individua la config esistente sulla stessa chiave logica.
      let query = supabase
        .from('call_buyback_alerts' as never)
        .select('id')
        .eq('portfolio_id', portfolioId)
        .eq('scope', input.scope);
      query = input.scope === 'tranche'
        ? query.eq('buyback_id', input.buyback_id as string)
        : query
          .eq('underlying', input.underlying)
          .eq('strike', input.strike)
          .eq('expiry_date', input.expiry_date);
      const { data: existing, error: readErr } = await query.maybeSingle();
      if (readErr) throw new Error(readErr.message);
      const existingId = (existing as unknown as { id: string } | null)?.id ?? null;

      if (!hasThreshold) {
        if (existingId) {
          const { error } = await supabase
            .from('call_buyback_alerts' as never)
            .delete()
            .eq('id', existingId);
          if (error) throw new Error(error.message);
        }
        return;
      }

      const payload = {
        portfolio_id: portfolioId,
        scope: input.scope,
        buyback_id: input.scope === 'tranche' ? input.buyback_id : null,
        underlying: input.underlying,
        strike: input.strike,
        expiry_date: input.expiry_date,
        gain_threshold_pct: input.gain_threshold_pct,
        loss_threshold_pct: input.loss_threshold_pct,
        enabled: input.enabled ?? true,
        cooldown_minutes: input.cooldown_minutes ?? 480,
        updated_at: new Date().toISOString(),
      };

      if (existingId) {
        const { error } = await supabase
          .from('call_buyback_alerts' as never)
          .update(payload as never)
          .eq('id', existingId);
        if (error) throw new Error(error.message);
        return;
      }

      const { error } = await supabase
        .from('call_buyback_alerts' as never)
        .insert(payload as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const setEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('call_buyback_alerts' as never)
        .update({ enabled, updated_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase
        .from('call_buyback_alerts' as never)
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { upsert, setEnabled, remove };
}
