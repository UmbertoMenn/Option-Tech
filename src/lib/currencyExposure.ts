import { RiskAnalysis, StockRiskDetail, CommodityRiskDetail, NakedPutRiskDetail, LeapCallRiskDetail, StrategyRiskDetail } from './riskCalculator';

export interface CurrencyBreakdown {
  stocks: number;
  commodities: number;
  nakedPuts: number;
  leapCalls: number;
  strategies: number;
}

export interface InstrumentDetail {
  name: string;
  riskEUR: number;
  riskOriginal: number;
  category: 'stocks' | 'commodities' | 'nakedPuts' | 'leapCalls' | 'strategies';
  details: string;
  isin?: string;
  isETF?: boolean;
}

export interface CurrencyExposure {
  currency: string;
  totalRisk: number;         // In EUR
  totalRiskOriginal: number; // In original currency
  percentage: number;
  breakdown: CurrencyBreakdown;
  instruments: InstrumentDetail[];
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
      totalRiskOriginal: 0,
      percentage: 0,
      breakdown: createEmptyBreakdown(),
      instruments: []
    });
  }
  return map.get(currency)!;
}

// Pattern per riconoscere ETF dai principali emittenti (sincronizzato con excelParser.ts)
const ETF_ISSUER_PATTERNS = [
  'ETF', 'UCITS',
  'ISHARES', 'ISHSIII', 'ISHSIV', 'ISHSV', 'ISHSVII',
  'VANGUARD', 'VNG',
  'SPDR', 'SSG',
  'LYXOR', 'AMUNDI',
  'XTRACKERS', 'XTRK',
  'INVESCO',
  'VANECK',
  'WISDOMTREE', 'WTR',
  'UBS ETF',
  'HSBC ETF',
  'FRANKLIN'
];

function isETFByDescription(description: string): boolean {
  const upperDesc = description.toUpperCase();
  return ETF_ISSUER_PATTERNS.some(kw => upperDesc.includes(kw));
}

export function calculateCurrencyExposure(analysis: RiskAnalysis): CurrencyExposure[] {
  const byCurrency = new Map<string, CurrencyExposure>();
  
  // Aggregate stockDetails by currency
  for (const stock of analysis.stockDetails) {
    const curr = stock.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.stocks += stock.riskEUR;
    exposure.totalRisk += stock.riskEUR;
    exposure.totalRiskOriginal += stock.riskOriginal;
    
    const isETF = isETFByDescription(stock.underlying);
    exposure.instruments.push({
      name: stock.underlying,
      riskEUR: stock.riskEUR,
      riskOriginal: stock.riskOriginal,
      category: 'stocks',
      details: stock.hasProtection 
        ? `${stock.stockQuantity} × ${stock.stockPrice.toFixed(2)} (protetto a ${stock.protectionStrike})`
        : `${stock.stockQuantity} × ${stock.stockPrice.toFixed(2)}`,
      isin: stock.isin,
      isETF
    });
  }
  
  // Aggregate commodityDetails by currency
  for (const commodity of analysis.commodityDetails) {
    const curr = commodity.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.commodities += commodity.riskEUR;
    exposure.totalRisk += commodity.riskEUR;
    exposure.totalRiskOriginal += commodity.riskOriginal;
    
    exposure.instruments.push({
      name: commodity.underlying,
      riskEUR: commodity.riskEUR,
      riskOriginal: commodity.riskOriginal,
      category: 'commodities',
      details: `${commodity.quantity} × ${commodity.price.toFixed(2)}`
    });
  }
  
  // Aggregate nakedPutDetails by currency
  for (const np of analysis.nakedPutDetails) {
    const curr = np.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.nakedPuts += np.riskEUR;
    exposure.totalRisk += np.riskEUR;
    exposure.totalRiskOriginal += np.riskOriginal;
    
    exposure.instruments.push({
      name: np.underlying,
      riskEUR: np.riskEUR,
      riskOriginal: np.riskOriginal,
      category: 'nakedPuts',
      details: `PUT ${np.strike} × ${np.contracts} (${np.expiry})`
    });
  }
  
  // Aggregate leapCallDetails by currency
  for (const lc of analysis.leapCallDetails) {
    const curr = lc.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.leapCalls += lc.riskEUR;
    exposure.totalRisk += lc.riskEUR;
    exposure.totalRiskOriginal += lc.premiumPaid;
    
    exposure.instruments.push({
      name: lc.underlying,
      riskEUR: lc.riskEUR,
      riskOriginal: lc.premiumPaid,
      category: 'leapCalls',
      details: `CALL ${lc.strike} × ${lc.contracts} (${lc.expiry})`
    });
  }
  
  // Aggregate strategyDetails by currency
  for (const strat of analysis.strategyDetails) {
    const curr = strat.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    exposure.breakdown.strategies += strat.maxLossEUR;
    exposure.totalRisk += strat.maxLossEUR;
    exposure.totalRiskOriginal += strat.maxLoss;
    
    exposure.instruments.push({
      name: `${strat.underlying} - ${strat.strategyName}`,
      riskEUR: strat.maxLossEUR,
      riskOriginal: strat.maxLoss,
      category: 'strategies',
      details: strat.calculation
    });
  }
  
  // Sort instruments by riskEUR desc within each currency
  for (const exposure of byCurrency.values()) {
    exposure.instruments.sort((a, b) => b.riskEUR - a.riskEUR);
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
