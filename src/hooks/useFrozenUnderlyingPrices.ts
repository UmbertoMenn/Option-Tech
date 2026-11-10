import { useMemo } from 'react';
import { useHistoricalData } from '@/hooks/useHistoricalData';
import { useFullSnapshot } from '@/hooks/useFullSnapshot';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { Portfolio } from '@/types/portfolio';
import { mergeFrozenUnderlyingPrices } from '@/lib/frozenUnderlyingPrices';

/**
 * Prezzi CONGELATI dello snapshot del portafoglio (historical_data.snapshot_underlying_prices
 * della sua snapshot_date). In vista live, fallback ai prezzi live per i sottostanti non ancora
 * congelati; in Visualizzazione Storica NESSUN fallback live (cfr. lib/frozenUnderlyingPrices).
 *
 * Fonte unica per Dashboard, Risk Analyzer e Stress Lab.
 */
export function useFrozenUnderlyingPrices(
  portfolio: Portfolio | null | undefined,
  livePrices: Record<string, UnderlyingPrice>,
): Record<string, UnderlyingPrice> {
  return useFrozenUnderlyingPricesDetail(portfolio, livePrices).prices;
}

export function useFrozenUnderlyingPricesDetail(
  portfolio: Portfolio | null | undefined,
  livePrices: Record<string, UnderlyingPrice>,
): {
  prices: Record<string, UnderlyingPrice>;
  frozenRaw: Record<string, number>;
  isHistorical: boolean;
  isLoading: boolean;
} {
  const { historicalData, isLoading } = useHistoricalData(portfolio?.id);
  const { isHistoricalActive } = useFullSnapshot();

  const frozenRaw = useMemo(() => {
    const currentDate = portfolio?.snapshot_date;
    const entry = currentDate ? historicalData.find((h) => h.snapshot_date === currentDate) : null;
    return (entry?.snapshot_underlying_prices ?? {}) as Record<string, number>;
  }, [portfolio?.snapshot_date, historicalData]);

  const prices = useMemo(
    () => mergeFrozenUnderlyingPrices(livePrices, frozenRaw, !isHistoricalActive),
    [livePrices, frozenRaw, isHistoricalActive],
  );

  return { prices, frozenRaw, isHistorical: isHistoricalActive, isLoading };
}
