import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export type ClearMode = 'quick' | 'full';

export interface ClearResult {
  overridesDeleted: number;
  positionsDeleted: number;
  strategyCacheDeleted: number;
  premiumsDeleted: number;
  alertStatesDeleted: number;
  alertsDeleted: number;
  historicalDataDeleted: number;
  depositsDeleted: number;
}

export function useClearPortfolio() {
  const [isClearing, setIsClearing] = useState(false);
  const queryClient = useQueryClient();

  const clearPortfolioData = async (
    portfolioId: string,
    mode: ClearMode
  ): Promise<ClearResult> => {
    setIsClearing(true);

    const result: ClearResult = {
      overridesDeleted: 0,
      positionsDeleted: 0,
      strategyCacheDeleted: 0,
      premiumsDeleted: 0,
      alertStatesDeleted: 0,
      alertsDeleted: 0,
      historicalDataDeleted: 0,
      depositsDeleted: 0,
    };

    try {
      // 1. Elimina derivative_overrides PRIMA (ha FK a positions)
      const { data: overrides, error: overridesError } = await supabase
        .from('derivative_overrides')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (overridesError) throw overridesError;
      result.overridesDeleted = overrides?.length ?? 0;

      // 2. Elimina positions
      const { data: positions, error: positionsError } = await supabase
        .from('positions')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (positionsError) throw positionsError;
      result.positionsDeleted = positions?.length ?? 0;

      // 3. Elimina strategy_cache
      const { data: strategies, error: strategiesError } = await supabase
        .from('strategy_cache')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (strategiesError) throw strategiesError;
      result.strategyCacheDeleted = strategies?.length ?? 0;

      // 4. Elimina covered_call_premiums
      const { data: premiums, error: premiumsError } = await supabase
        .from('covered_call_premiums')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (premiumsError) throw premiumsError;
      result.premiumsDeleted = premiums?.length ?? 0;

      // 5. Elimina alert_states
      const { data: alertStates, error: alertStatesError } = await supabase
        .from('alert_states')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (alertStatesError) throw alertStatesError;
      result.alertStatesDeleted = alertStates?.length ?? 0;

      // 6. Elimina alerts
      const { data: alerts, error: alertsError } = await supabase
        .from('alerts')
        .delete()
        .eq('portfolio_id', portfolioId)
        .select('id');
      
      if (alertsError) throw alertsError;
      result.alertsDeleted = alerts?.length ?? 0;

      // 7. Se mode === 'full', elimina anche dati storici e versamenti
      if (mode === 'full') {
        const { data: historicalData, error: historicalError } = await supabase
          .from('historical_data')
          .delete()
          .eq('portfolio_id', portfolioId)
          .select('id');
        
        if (historicalError) throw historicalError;
        result.historicalDataDeleted = historicalData?.length ?? 0;

        const { data: deposits, error: depositsError } = await supabase
          .from('deposits')
          .delete()
          .eq('portfolio_id', portfolioId)
          .select('id');
        
        if (depositsError) throw depositsError;
        result.depositsDeleted = deposits?.length ?? 0;
      }

      // 8. Azzera valori nel portfolio
      const { error: updateError } = await supabase
        .from('portfolios')
        .update({
          total_value: 0,
          cash_value: 0,
          snapshot_date: null,
        })
        .eq('id', portfolioId);
      
      if (updateError) throw updateError;

      // 9. Invalida tutte le query per aggiornare la UI
      await queryClient.invalidateQueries();

      // Toast di conferma
      const totalDeleted = 
        result.positionsDeleted + 
        result.overridesDeleted + 
        result.strategyCacheDeleted +
        result.premiumsDeleted +
        result.alertStatesDeleted +
        result.alertsDeleted +
        result.historicalDataDeleted +
        result.depositsDeleted;

      toast.success(`Pulizia completata`, {
        description: `Eliminati ${totalDeleted} record dal portfolio`,
      });

      return result;
    } catch (error) {
      console.error('Errore durante la pulizia del portfolio:', error);
      toast.error('Errore durante la pulizia', {
        description: error instanceof Error ? error.message : 'Errore sconosciuto',
      });
      throw error;
    } finally {
      setIsClearing(false);
    }
  };

  return { clearPortfolioData, isClearing };
}
