import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  AGGREGATED_PORTFOLIO_ID,
  getUserIdFromAggregatedId,
  isUserAggregatedId,
  usePortfolioContext,
} from '@/contexts/PortfolioContext';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_ROLL_PARAMS } from '@/lib/stressLab';

export interface StressRollSettings {
  enabled: boolean;
  triggerPct: number;
  maxMonthsForward: number;
  strikeStepPct: number;
  minNetCreditPct: number;
  maxRolls: number;
}

const defaults: StressRollSettings = {
  enabled: false,
  triggerPct: DEFAULT_ROLL_PARAMS.triggerPct,
  maxMonthsForward: DEFAULT_ROLL_PARAMS.maxMonthsForward,
  strikeStepPct: DEFAULT_ROLL_PARAMS.strikeStepPct,
  minNetCreditPct: DEFAULT_ROLL_PARAMS.minNetCreditPct,
  maxRolls: DEFAULT_ROLL_PARAMS.maxRolls,
};

type SettingsRow = {
  enabled: boolean;
  trigger_pct: number;
  max_months_forward: number;
  strike_step_pct: number;
  min_net_credit_pct: number;
  max_rolls: number;
};

const fromRow = (row: SettingsRow): StressRollSettings => ({
  enabled: row.enabled,
  triggerPct: row.trigger_pct,
  maxMonthsForward: row.max_months_forward,
  strikeStepPct: row.strike_step_pct,
  minNetCreditPct: row.min_net_credit_pct,
  maxRolls: row.max_rolls,
});

function targetUserId(
  selectedPortfolioId: string | null,
  selectedPortfolio: { id: string; user_id: string } | null,
  ownUserId: string | null,
  isAdmin: boolean,
): string | null {
  if (!ownUserId || !selectedPortfolioId || selectedPortfolioId === AGGREGATED_PORTFOLIO_ID) return null;
  const target = isUserAggregatedId(selectedPortfolioId)
    ? getUserIdFromAggregatedId(selectedPortfolioId)
    : selectedPortfolio?.id === selectedPortfolioId ? selectedPortfolio.user_id : null;
  return target && (target === ownUserId || isAdmin) ? target : null;
}

export function useStressRollSettings() {
  const { user, isAdmin } = useAuth();
  const { selectedPortfolioId, selectedPortfolio, isReady } = usePortfolioContext();
  const queryClient = useQueryClient();
  const ownerId = isReady
    ? targetUserId(selectedPortfolioId, selectedPortfolio, user?.id ?? null, isAdmin)
    : null;
  const [draft, setDraft] = useState<{ ownerId: string; settings: StressRollSettings } | null>(null);

  const query = useQuery({
    queryKey: ['stress-roll-settings', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      if (!ownerId) return null;
      const { data, error } = await supabase
        .from('stress_lab_roll_settings')
        .select('enabled, trigger_pct, max_months_forward, strike_step_pct, min_net_credit_pct, max_rolls')
        .eq('user_id', ownerId)
        .maybeSingle();
      if (error) throw error;
      return data ? fromRow(data) : null;
    },
  });

  // La bozza è legata all'utente visualizzato: cambiando cliente non si mostrano
  // né si salvano per errore i valori del cliente precedente.
  const settings = ownerId && draft?.ownerId === ownerId
    ? draft.settings
    : ownerId && query.data ? query.data : defaults;
  const canEdit = !!ownerId && !query.isPending && !query.isError;

  const updateSettings = (updates: Partial<StressRollSettings>) => {
    if (!canEdit || !ownerId) return;
    setDraft((current) => ({
      ownerId,
      settings: { ...(current?.ownerId === ownerId ? current.settings : query.data ?? defaults), ...updates },
    }));
  };

  const setSetting = <K extends keyof StressRollSettings>(key: K, value: StressRollSettings[K]) =>
    updateSettings({ [key]: value });

  const mutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: StressRollSettings }) => {
      const { data, error } = await supabase.from('stress_lab_roll_settings').upsert({
        user_id: id,
        enabled: values.enabled,
        trigger_pct: values.triggerPct,
        max_months_forward: values.maxMonthsForward,
        strike_step_pct: values.strikeStepPct,
        min_net_credit_pct: values.minNetCreditPct,
        max_rolls: values.maxRolls,
      }, { onConflict: 'user_id' }).select('enabled, trigger_pct, max_months_forward, strike_step_pct, min_net_credit_pct, max_rolls').single();
      if (error) throw error;
      return { id, values, saved: fromRow(data) };
    },
    onSuccess: ({ id, values, saved }) => {
      queryClient.setQueryData(['stress-roll-settings', id], saved);
      setDraft((current) => current?.ownerId === id && current.settings === values ? null : current);
      toast.success('Parametri del rolling salvati');
    },
    onError: (error) => {
      toast.error('Impossibile salvare i parametri del rolling', { description: error.message });
    },
  });

  const save = () => {
    if (!ownerId || !canEdit || mutation.isPending) return;
    mutation.mutate({ id: ownerId, values: settings });
  };

  return {
    settings,
    setSetting,
    updateSettings,
    save,
    canEdit,
    isSaving: mutation.isPending,
    loadError: query.isError,
    retry: query.refetch,
    selectedUserId: ownerId,
  };
}
