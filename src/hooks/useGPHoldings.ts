import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioContext, AGGREGATED_PORTFOLIO_ID, isUserAggregatedId, getUserIdFromAggregatedId } from '@/contexts/PortfolioContext';
import { useAuth } from '@/contexts/AuthContext';

export interface GPHoldingRow {
  id: string;
  portfolio_id: string;
  asset_type: string;
  description: string;
  quantity: number;
  market_value: number;
  price: number | null;
  currency: string;
  exchange_rate: number;
  weight_pct: number | null;
  ticker_code: string | null;
  price_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GPSummary {
  totalValue: number;
  cashValue: number;
  stockValue: number;
  bondValue: number;
  holdings: GPHoldingRow[];
}

export function useGPHoldings() {
  const { selectedPortfolio, selectedPortfolioId, isAggregatedView } = usePortfolioContext();
  const { isAdmin } = useAuth();
  
  const isGlobalAgg = selectedPortfolioId === AGGREGATED_PORTFOLIO_ID;
  const isUserAgg = isUserAggregatedId(selectedPortfolioId);
  const targetUserId = isUserAgg && selectedPortfolioId ? getUserIdFromAggregatedId(selectedPortfolioId) : null;

  const query = useQuery({
    queryKey: ['gp-holdings', isAggregatedView ? selectedPortfolioId : selectedPortfolio?.id],
    queryFn: async () => {
      if (isGlobalAgg && isAdmin) {
        const { data, error } = await supabase.from('gp_holdings').select('*');
        if (error) throw error;
        return data as GPHoldingRow[];
      }
      
      if (isUserAgg && targetUserId) {
        const { data: portfolios } = await supabase
          .from('portfolios').select('id').eq('user_id', targetUserId);
        if (!portfolios || portfolios.length === 0) return [];
        const ids = portfolios.map(p => p.id);
        const { data, error } = await supabase
          .from('gp_holdings').select('*').in('portfolio_id', ids);
        if (error) throw error;
        return data as GPHoldingRow[];
      }
      
      if (!selectedPortfolio?.id) return [];
      const { data, error } = await supabase
        .from('gp_holdings').select('*')
        .eq('portfolio_id', selectedPortfolio.id);
      if (error) throw error;
      return data as GPHoldingRow[];
    },
    enabled: !!selectedPortfolio?.id || (isGlobalAgg && isAdmin) || !!targetUserId,
  });

  const gpSummary: GPSummary = useMemo(() => {
    const holdings = query.data || [];
    const cashValue = holdings
      .filter(h => h.asset_type === 'cash')
      .reduce((sum, h) => sum + h.market_value, 0);
    const stockValue = holdings
      .filter(h => h.asset_type === 'stock')
      .reduce((sum, h) => sum + h.market_value, 0);
    const bondValue = holdings
      .filter(h => h.asset_type === 'bond')
      .reduce((sum, h) => sum + h.market_value, 0);
    return {
      totalValue: cashValue + stockValue + bondValue,
      cashValue,
      stockValue,
      bondValue,
      holdings,
    };
  }, [query.data]);

  return {
    gpHoldings: query.data || [],
    gpSummary,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
