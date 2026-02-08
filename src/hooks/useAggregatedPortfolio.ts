import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Portfolio, Position, PortfolioSummary, AssetType } from '@/types/portfolio';
import { AGGREGATED_PORTFOLIO_ID } from '@/contexts/PortfolioContext';

export interface AggregatedData {
  portfolio: Portfolio;
  positions: Position[];
  summary: PortfolioSummary;
}

export function useAggregatedPortfolio(enabled: boolean) {
  const { isAdmin } = useAuth();

  // Fetch all portfolios
  const allPortfoliosQuery = useQuery({
    queryKey: ['aggregated-portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*');
      
      if (error) throw error;
      return data as unknown as Portfolio[];
    },
    enabled: enabled && isAdmin,
  });

  // Fetch all positions
  const allPositionsQuery = useQuery({
    queryKey: ['aggregated-positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('positions')
        .select('*');
      
      if (error) throw error;
      return data as unknown as Position[];
    },
    enabled: enabled && isAdmin,
  });

  const portfolios = allPortfoliosQuery.data || [];
  const positions = allPositionsQuery.data || [];

  // Calculate aggregated portfolio
  const aggregatedPortfolio: Portfolio | null = portfolios.length > 0 ? {
    id: AGGREGATED_PORTFOLIO_ID,
    user_id: 'aggregated',
    name: 'Aggregato - Tutti gli Utenti',
    total_value: portfolios.reduce((sum, p) => sum + (p.total_value || 0), 0),
    cash_value: portfolios.reduce((sum, p) => sum + (p.cash_value || 0), 0),
    initial_value: portfolios.reduce((sum, p) => sum + (p.initial_value || 0), 0),
    initial_date: null,
    deposits: portfolios.reduce((sum, p) => sum + (p.deposits || 0), 0),
    average_balance: portfolios.reduce((sum, p) => sum + (p.average_balance || 0), 0),
    average_balance_date: null,
    snapshot_date: null,
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
  } : null;

  // Calculate summary
  const summary = calculateAggregatedSummary(positions, aggregatedPortfolio?.cash_value || 0);

  return {
    aggregatedPortfolio,
    positions,
    summary,
    isLoading: allPortfoliosQuery.isLoading || allPositionsQuery.isLoading,
    portfolioCount: portfolios.length,
    userCount: new Set(portfolios.map(p => p.user_id)).size,
  };
}

function calculateAggregatedSummary(positions: Position[], cashValue: number): PortfolioSummary {
  const byAssetType = new Map<AssetType, { value: number; profitLoss: number }>();
  
  let totalValue = cashValue;
  let totalProfitLoss = 0;
  
  positions.forEach(position => {
    // Derivatives are not included in totals
    if (position.asset_type === 'derivative') {
      return;
    }

    const value = position.market_value || 0;
    const pl = position.profit_loss || 0;

    totalValue += value;
    totalProfitLoss += pl;

    const existing = byAssetType.get(position.asset_type as AssetType) || { value: 0, profitLoss: 0 };
    byAssetType.set(position.asset_type as AssetType, {
      value: existing.value + value,
      profitLoss: existing.profitLoss + pl,
    });
  });
  
  // Add cash
  if (cashValue > 0) {
    byAssetType.set('cash', { value: cashValue, profitLoss: 0 });
  }
  
  const byAssetTypeArray = Array.from(byAssetType.entries()).map(([type, data]) => ({
    type,
    value: data.value,
    percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
    profitLoss: data.profitLoss,
  }));
  
  const investedValue = totalValue - cashValue;
  const totalProfitLossPct = investedValue > 0 ? (totalProfitLoss / (investedValue - totalProfitLoss)) * 100 : 0;
  
  return {
    totalValue,
    cashValue,
    investedValue,
    totalProfitLoss,
    totalProfitLossPct,
    byAssetType: byAssetTypeArray,
  };
}
