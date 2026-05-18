import { RiskAnalysis, StockRiskDetail, CommodityRiskDetail, NakedPutRiskDetail, LeapCallRiskDetail, StrategyRiskDetail } from './riskCalculator';

export interface CurrencyBreakdown {
  stocks: number;
  bonds: number;
  commodities: number;
  protections: number;  // Long PUT (valore della protezione)
  nakedPuts: number;
  leapCalls: number;
  strategies: number;
}

export interface InstrumentDetail {
  name: string;
  riskEUR: number;
  riskOriginal: number;
  category: 'stocks' | 'bonds' | 'commodities' | 'protections' | 'nakedPuts' | 'leapCalls' | 'strategies';
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
  'USD': 'hsl(217, 91%, 60%)',  // Bright Blue
  'EUR': 'hsl(142, 71%, 45%)',  // Green
  'GBP': 'hsl(270, 67%, 58%)',  // Purple
  'JPY': 'hsl(38, 92%, 50%)',   // Amber/Gold
  'CHF': 'hsl(0, 84%, 60%)',    // Red
  'CAD': 'hsl(189, 94%, 43%)',  // Cyan/Teal
  'AUD': 'hsl(25, 95%, 53%)',   // Orange
  'HKD': 'hsl(340, 82%, 52%)',  // Rose/Pink
  'SEK': 'hsl(200, 80%, 50%)',  // Sky Blue
  'NOK': 'hsl(160, 70%, 40%)',  // Teal Green
  'SGD': 'hsl(280, 60%, 55%)',  // Violet
  'NZD': 'hsl(45, 90%, 50%)',   // Yellow/Gold
  'DKK': 'hsl(10, 78%, 54%)',   // Coral
  'OTHER': 'hsl(300, 50%, 50%)' // Magenta for grouped currencies
};

export function getCurrencyColor(currency: string): string {
  return CURRENCY_COLORS[currency] || CURRENCY_COLORS['OTHER'];
}

function createEmptyBreakdown(): CurrencyBreakdown {
  return {
    stocks: 0,
    bonds: 0,
    commodities: 0,
    protections: 0,
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

// NOTE: ETF detection now uses stock.isETF flag from riskCalculator (based on asset_type)
// The pattern matching was unreliable and has been removed

export interface CurrencyExposureOptions {
  includeBonds?: boolean;        // default: true
  includeProtections?: boolean;  // default: true
  includeNakedPut?: boolean;     // default: true
  includeStrategies?: boolean;   // default: true
  includeLeapCall?: boolean;     // default: true
}

export function calculateCurrencyExposure(
  analysis: RiskAnalysis,
  options: CurrencyExposureOptions = {}
): CurrencyExposure[] {
  const { 
    includeBonds = true, 
    includeProtections = true, 
    includeNakedPut = true, 
    includeStrategies = true, 
    includeLeapCall = true 
  } = options;
  const byCurrency = new Map<string, CurrencyExposure>();
  
  // Aggregate stockDetails by currency (always included)
  // Stocks are valued at GROSS value (no protection deduction)
  for (const stock of analysis.stockDetails) {
    const curr = stock.currency || 'OTHER';
    const exposure = getOrCreateCurrency(byCurrency, curr);
    
    // Synthetic CC/DR-CC entries have stockValue=0; use riskEUR directly.
    const isSynth = !!stock.isSynthetic;
    const grossValueEUR = isSynth
      ? stock.riskEUR
      : stock.stockValue / stock.exchangeRate;
    const grossValueOriginal = isSynth
      ? stock.riskEUR * stock.exchangeRate
      : stock.stockValue;
    
    exposure.breakdown.stocks += grossValueEUR;
    exposure.totalRisk += grossValueEUR;
    exposure.totalRiskOriginal += grossValueOriginal;
    
    // Use the isETF flag from StockRiskDetail (set in riskCalculator based on asset_type)
    const isETF = stock.isETF;
    exposure.instruments.push({
      name: stock.underlying,
      riskEUR: grossValueEUR,
      riskOriginal: grossValueOriginal,
      category: 'stocks',
      details: isSynth ? 'Sintetica CC/DR-CC' : `${stock.stockQuantity} × ${stock.stockPrice.toFixed(2)}`,
      isin: stock.isin,
      isETF
    });
    
    // Add protection as separate derivative entry (if includeProtections is ON and has protection)
    if (includeProtections && stock.hasProtection && stock.protectionContracts > 0 && stock.protectionOptionPrice) {
      // Protection value = contracts × option price × 100 (mark-to-market, fallback avg_cost)
      const protectionValueOriginal = stock.protectionContracts * stock.protectionOptionPrice * 100;
      const protectionValueEUR = protectionValueOriginal / stock.exchangeRate;
      
      exposure.breakdown.protections += protectionValueEUR;
      exposure.totalRisk += protectionValueEUR;
      exposure.totalRiskOriginal += protectionValueOriginal;
      
      exposure.instruments.push({
        name: `${stock.underlying} - Long PUT`,
        riskEUR: protectionValueEUR,
        riskOriginal: protectionValueOriginal,
        category: 'protections',
        details: `PUT ${stock.protectionStrike?.toFixed(0) || '?'} × ${stock.protectionContracts} ctr @ ${stock.protectionOptionPrice.toFixed(2)}`
      });
    }
  }
  
  // Aggregate bondDetails by currency (if includeBonds is true)
  if (includeBonds) {
    for (const bond of analysis.bondDetails) {
      const curr = bond.currency || 'OTHER';
      const exposure = getOrCreateCurrency(byCurrency, curr);
      exposure.breakdown.bonds += bond.riskEUR;
      exposure.totalRisk += bond.riskEUR;
      exposure.totalRiskOriginal += bond.riskOriginal;
      
      exposure.instruments.push({
        name: bond.underlying,
        riskEUR: bond.riskEUR,
        riskOriginal: bond.riskOriginal,
        category: 'bonds',
        details: `${bond.quantity} × ${bond.price.toFixed(2)}`
      });
    }
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
  
  // Aggregate derivative details by currency (each category controlled by its own toggle)
  
  // Aggregate nakedPutDetails by currency (if includeNakedPut is true)
  if (includeNakedPut) {
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
  }
  
  // Aggregate leapCallDetails by currency (if includeLeapCall is true)
  if (includeLeapCall) {
    for (const lc of analysis.leapCallDetails) {
      const curr = lc.currency || 'OTHER';
      const exposure = getOrCreateCurrency(byCurrency, curr);
      exposure.breakdown.leapCalls += lc.riskEUR;
      exposure.totalRisk += lc.riskEUR;
      exposure.totalRiskOriginal += lc.marketValue;
      
      exposure.instruments.push({
        name: lc.underlying,
        riskEUR: lc.riskEUR,
        riskOriginal: lc.marketValue,
        category: 'leapCalls',
        details: `CALL ${lc.strike} × ${lc.contracts} (${lc.expiry})`
      });
    }
  }
  
  // Aggregate strategyDetails by currency (if includeStrategies is true)
  if (includeStrategies) {
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
