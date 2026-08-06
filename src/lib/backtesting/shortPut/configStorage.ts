/** Persistenza delle configurazioni di backtest su Supabase (tabella backtest_configs). */
import { supabase } from '@/integrations/supabase/client';
import { ShortPutConfig } from './types';

const STRATEGY_ID = 'cash_secured_put';

export interface SavedBacktestConfig {
  id: string;
  name: string;
  config: ShortPutConfig;
  updatedAt: string;
}

export async function listSavedConfigs(): Promise<SavedBacktestConfig[]> {
  const { data, error } = await supabase
    .from('backtest_configs')
    .select('id, name, config, updated_at')
    .eq('strategy_id', STRATEGY_ID)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    config: row.config as unknown as ShortPutConfig,
    updatedAt: row.updated_at as string,
  }));
}

/** Salva o sovrascrive la configurazione con questo nome per l'utente corrente. */
export async function saveConfig(name: string, config: ShortPutConfig): Promise<SavedBacktestConfig> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Il nome della configurazione non può essere vuoto.');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Sessione non valida: effettua di nuovo il login.');

  const { data, error } = await supabase
    .from('backtest_configs')
    .upsert(
      {
        user_id: userData.user.id,
        strategy_id: STRATEGY_ID,
        name: trimmed,
        config: config as unknown as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,strategy_id,name' },
    )
    .select('id, name, config, updated_at')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id as string,
    name: data.name as string,
    config: data.config as unknown as ShortPutConfig,
    updatedAt: data.updated_at as string,
  };
}

export async function deleteConfig(id: string): Promise<void> {
  const { error } = await supabase.from('backtest_configs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
