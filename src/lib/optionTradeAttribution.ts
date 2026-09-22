import { supabase } from '@/integrations/supabase/client';
import { FlussiTitoliOptionTrade } from '@/lib/flussiCsvParser';

export type AttributionPriceSource =
  | 'exact_trade_date'
  | 'previous_close'
  | 'snapshot_proxy'
  | 'missing'
  /** Spot implicito dalla gamba ricomprata di un roll ITM. */
  | 'roll_implied'
  /** Spot = prezzo di vendita/acquisto delle azioni dopo l'assegnazione. */
  | 'assignment_sale'
  /** Spot = prezzo di un'operazione sulle azioni dello stesso sottostante (±1 giorno). */
  | 'stock_trade'
  /** Premio temporale impostato a mano. */
  | 'manual'
  /** Vendita ITM senza riferimento: split dalla chiusura, da verificare. */
  | 'close_itm_estimate';

/** Fonti che rendono lo split intrinseco/tempo affidabile senza segnalazioni. */
export const RELIABLE_SPLIT_SOURCES: AttributionPriceSource[] = [
  'exact_trade_date', 'previous_close', 'roll_implied', 'assignment_sale', 'stock_trade', 'manual',
];

export interface HistoricalUnderlyingPrice {
  ticker: string;
  requested_date: string;
  price_date: string | null;
  close_price: number | null;
  source: AttributionPriceSource;
}
export interface OptionPremiumSplit {
  intrinsicPerShare: number;
  timeValuePerShare: number;
  /** true se il premio osservato è inferiore all'intrinseco teorico. */
  intrinsicCappedToPremium: boolean;
}

/**
 * Separa un premio opzione in intrinseco e tempo preservando sempre
 * l'identità: intrinsicPerShare + timeValuePerShare = premiumPerShare.
 *
 * Un prezzo stale può risultare inferiore all'intrinseco teorico. In quel
 * caso l'intrinseco viene limitato al premio osservato e il tempo posto a 0:
 * la riconciliazione contabile resta esatta e la qualità viene segnalata.
 */
export function splitOptionPremium(
  optionType: 'call' | 'put',
  strike: number,
  premiumPerShare: number,
  underlyingPrice: number,
): OptionPremiumSplit {
  const premium = Math.max(0, Number(premiumPerShare) || 0);
  const theoreticalIntrinsic = optionType === 'call'
    ? Math.max(0, underlyingPrice - strike)
    : Math.max(0, strike - underlyingPrice);
  const intrinsicPerShare = Math.min(premium, theoreticalIntrinsic);
  return {
    intrinsicPerShare,
    timeValuePerShare: Math.max(0, premium - intrinsicPerShare),
    intrinsicCappedToPremium: theoreticalIntrinsic > premium + 1e-8,
  };
}

/**
 * Recupera il close del sottostante alla data operazione. Per weekend/festivi
 * l'edge function restituisce l'ultimo close precedente e lo dichiara come
 * `previous_close`. Il fallimento non blocca mai l'ingest PMC.
 */
export async function fetchHistoricalUnderlyingPrices(
  trades: Pick<FlussiTitoliOptionTrade, 'underlyingTicker' | 'tradeDate'>[],
  resolveUnderlyingKey: (ticker: string) => string,
): Promise<Map<string, HistoricalUnderlyingPrice>> {
  const requests = Array.from(new Map(
    trades.map(trade => {
      const ticker = resolveUnderlyingKey(trade.underlyingTicker);
      return [`${ticker}|${trade.tradeDate}`, { ticker, date: trade.tradeDate }];
    }),
  ).values());
  if (requests.length === 0) return new Map();

  try {
    const { data, error } = await supabase.functions.invoke(
      'fetch-historical-underlying-prices',
      { body: { requests } },
    );
    if (error) throw error;
    const prices = Array.isArray(data?.prices)
      ? data.prices as HistoricalUnderlyingPrice[]
      : [];
    return new Map(prices.map(row => [`${row.ticker}|${row.requested_date}`, row]));
  } catch (error) {
    console.warn('[OptionAttribution] prezzo storico sottostante non disponibile:', error);
    return new Map();
  }
}
