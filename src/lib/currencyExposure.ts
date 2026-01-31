import { RiskAnalysis } from './riskCalculator';

export interface CurrencyBreakdown {
  stocks: number;
  commodities: number;
  nakedPuts: number;
  leapCalls: number;
  strategies: number;
}

export interface CurrencyExposure {
  currency: string;
  totalRisk: number;         // In EUR
  percentage: number;
  breakdown: CurrencyBreakdown;
}

export const CURRENCY_COLORS: Record<string, string> = {
  'USD': 'hsl(217, 91%, 60%)',  // Blue
  'EUR': 'hsl(142, 71%, 45%)',  // Green
  'GBP': 'hsl(270, 67%, 58%)',  // Purple
  'JPY': 'hsl(38, 92%, 50%)',   // Amber
  'CHF': 'hsl(0, 84%, 60%)',    // Red
  'CAD': 'hsl(189, 94%, 43%)',  // Cyan
  'AUD': 'hsl(25, 95%, 53%)',   // Orange
  'OTHER': 'hsl(215, 14%, 46%)' // Gray
};

export function getCurrencyColor(currency: string): string {
  return CURRENCY_COLORS[currency] || CURRENCY_COLORS['OTHER'];
}

function createEmptyBreakdown(): CurrencyBreakdown {
  return {
    stocks: 0,
    commodities: 0,
    nakedPuts: 0,
    leapCalls: 0,
    strategies: 0
  };
}

function getOrCreateCurrency(
  map: Map<string, CurrencyExposure>,
  currency: string
): CurrencyExposure {
  if (!map.has(currency)) {
    map.set(currency, {
      currency,
      totalRisk: 0,
      percentage: 0,
      breakdown: createEmptyBreakdown()
    });
  }
  return map.get(currency)!;
}

export function calculateCurrencyExposure(analysis: RiskAnalysis): CurrencyExposure[] {
  const byCurrency = new Map<string, CurrencyExposure>();
  
  // Aggregate stockDetails by currency
  for (const stock of analysis.stockDetails) {
    const curr = stock.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.stocks += stock.riskEUR;
    exposure.totalRisk += stock.riskEUR;
  }
  
  // Aggregate commodityDetails by currency
  for (const commodity of analysis.commodityDetails) {
    const curr = commodity.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.commodities += commodity.riskEUR;
    exposure.totalRisk += commodity.riskEUR;
  }
  
  // Aggregate nakedPutDetails by currency
  for (const np of analysis.nakedPutDetails) {
    const curr = np.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.nakedPuts += np.riskEUR;
    exposure.totalRisk += np.riskEUR;
  }
  
  // Aggregate leapCallDetails by currency
  for (const lc of analysis.leapCallDetails) {
    const curr = lc.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.leapCalls += lc.riskEUR;
    exposure.totalRisk += lc.riskEUR;
  }
  
  // Aggregate strategyDetails by currency
  for (const strat of analysis.strategyDetails) {
    const curr = strat.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.strategies += strat.maxLossEUR;
    exposure.totalRisk += strat.maxLossEUR;
  }
  
  // Calculate percentages
  const total = analysis.grandTotal;
  
  return Array.from(byCurrency.values())
    .map(c => ({
      ...c,
      percentage: total > 0 ? (c.totalRisk / total) * 100 : 0
    }))
    .sort((a, b) => b.totalRisk - a.totalRisk);
}
