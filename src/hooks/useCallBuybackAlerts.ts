import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  CallBuybackAlertConfig,
  CallBuybackAlertMode,
  CallBuybackAlertScope,
  CallBuybackPriceDirection,
} from '@/lib/callBuybackAlerts';

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
  alert_mode: CallBuybackAlertMode;
  gain_threshold_pct: number | null;
  loss_threshold_pct: number | null;
  price_direction: CallBuybackPriceDirection | null;
  price_target: number | null;
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

      const hasRequiredThreshold = input.alert_mode === 'price'
        ? input.price_target != null
        : input.gain_threshold_pct != null;
      if (!hasRequiredThreshold) {
        throw new Error(input.alert_mode === 'price'
          ? 'Inserisci un prezzo target per mantenere attivo l’avviso.'
          : 'Inserisci una soglia di guadagno per mantenere attivo l’avviso.');
      }

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

      const payload = {
        portfolio_id: portfolioId,
        scope: input.scope,
        buyback_id: input.scope === 'tranche' ? input.buyback_id : null,
        underlying: input.underlying,
        strike: input.strike,
        expiry_date: input.expiry_date,
        alert_mode: input.alert_mode,
        gain_threshold_pct: input.gain_threshold_pct,
        loss_threshold_pct: input.loss_threshold_pct,
        price_direction: input.price_direction,
        price_target: input.price_target,
        // Gli avvisi delle call da rivendere sono sempre attivi. L'utente può
        // modificarne soglia/modalità, ma non spegnerli accidentalmente.
        enabled: true,
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

  return { upsert };
}
