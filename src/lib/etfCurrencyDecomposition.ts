import { ETFAllocation } from '@/hooks/useETFAllocations';
import { InstrumentDetail, CurrencyExposure } from './currencyExposure';

export interface DecomposedInstrument extends InstrumentDetail {
  decomposedRisk?: Record<string, number>; // Currency -> risk amount in EUR
  originalCurrency?: string;
}

/**
 * Decomposes an ETF's risk across its underlying currencies based on allocation data
 */
export function decomposeETFByCurrency(
  instrument: InstrumentDetail,
  allocation: ETFAllocation
): Record<string, number> {
  const decomposed: Record<string, number> = {};
  
  // If hedged, all risk stays in the ETF's base currency (usually EUR)
  if (allocation.isHedged) {
    // For hedged ETFs, the currency risk is neutralized
    decomposed['EUR'] = instrument.riskEUR;
    return decomposed;
  }
  
  const currencyAllocations = allocation.currencyAllocations;
  
  // If no currency allocations found, return original
  if (!currencyAllocations || Object.keys(currencyAllocations).length === 0) {
    return { 'OTHER': instrument.riskEUR };
  }
  
  // Decompose the risk based on currency weights
  for (const [currency, percentage] of Object.entries(currencyAllocations)) {
    const weight = percentage / 100;
    decomposed[currency] = instrument.riskEUR * weight;
  }
  
  return decomposed;
}

/**
 * Takes the original currency exposure and ETF allocations,
 * and returns a new currency exposure with ETFs decomposed
 */
export function applyETFDecomposition(
  originalExposures: CurrencyExposure[],
  etfAllocations: Record<string, ETFAllocation>
): CurrencyExposure[] {
  // Build a map to accumulate new currency exposures
  const newExposureMap = new Map<string, {
    totalRisk: number;
    totalRiskOriginal: number;
    instruments: InstrumentDetail[];
  }>();
  
  // Helper to get or create currency entry
  const getOrCreate = (currency: string) => {
    if (!newExposureMap.has(currency)) {
      newExposureMap.set(currency, {
        totalRisk: 0,
        totalRiskOriginal: 0,
        instruments: [],
      });
    }
    return newExposureMap.get(currency)!;
  };
  
  for (const exposure of originalExposures) {
    for (const instrument of exposure.instruments) {
      // Check if this is an ETF with allocation data
      if (instrument.isETF && instrument.isin && etfAllocations[instrument.isin]) {
        const allocation = etfAllocations[instrument.isin];
        const decomposed = decomposeETFByCurrency(instrument, allocation);
        
        // Add decomposed amounts to each currency
        for (const [currency, riskAmount] of Object.entries(decomposed)) {
          const entry = getOrCreate(currency);
          entry.totalRisk += riskAmount;
          
          // Pro-rate the original currency amount
          const ratio = riskAmount / instrument.riskEUR;
          entry.totalRiskOriginal += instrument.riskOriginal * ratio;
          
          // Add instrument reference with decomposed info
          entry.instruments.push({
            ...instrument,
            riskEUR: riskAmount,
            riskOriginal: instrument.riskOriginal * ratio,
            details: `${instrument.details} [${(ratio * 100).toFixed(1)}% di ${instrument.name}]`,
          });
        }
      } else {
        // Non-ETF or no allocation data - keep as is
        const entry = getOrCreate(exposure.currency);
        entry.totalRisk += instrument.riskEUR;
        entry.totalRiskOriginal += instrument.riskOriginal;
        entry.instruments.push(instrument);
      }
    }
  }
  
  // Calculate grand total for percentages
  let grandTotal = 0;
  for (const entry of newExposureMap.values()) {
    grandTotal += entry.totalRisk;
  }
  
  // Convert to CurrencyExposure array
  const result: CurrencyExposure[] = [];
  for (const [currency, entry] of newExposureMap) {
    // Aggregate breakdown by category
    const breakdown = {
      stocks: 0,
      commodities: 0,
      nakedPuts: 0,
      leapCalls: 0,
      strategies: 0,
    };
    
    for (const inst of entry.instruments) {
      breakdown[inst.category] += inst.riskEUR;
    }
    
    // Sort instruments by risk
    entry.instruments.sort((a, b) => b.riskEUR - a.riskEUR);
    
    result.push({
      currency,
      totalRisk: entry.totalRisk,
      totalRiskOriginal: entry.totalRiskOriginal,
      percentage: grandTotal > 0 ? (entry.totalRisk / grandTotal) * 100 : 0,
      breakdown,
      instruments: entry.instruments,
    });
  }
  
  // Sort by total risk descending
  result.sort((a, b) => b.totalRisk - a.totalRisk);
  
  return result;
}
