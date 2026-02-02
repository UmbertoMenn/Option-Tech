import { ETFAllocation } from '@/hooks/useETFAllocations';
import { InstrumentDetail, CurrencyExposure } from './currencyExposure';

export interface DecomposedInstrument extends InstrumentDetail {
  decomposedRisk?: Record<string, number>; // Currency -> risk amount in EUR
  originalCurrency?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCurrencyWeights(
  weights: Record<string, number> | undefined | null
): Record<string, number> | null {
  if (!weights) return null;
  const entries = Object.entries(weights)
    .filter(([, v]) => isFiniteNumber(v) && v > 0)
    .map(([k, v]) => [k, v] as const);

  if (entries.length === 0) return null;

  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;

  // Some scrapes can return totals > 100 (or < 100). We normalize to 100 to avoid exploding totals.
  const normalized: Record<string, number> = {};
  for (const [currency, value] of entries) {
    normalized[currency] = (value / sum) * 100;
  }
  return normalized;
}

/**
 * Decomposes an ETF's risk across its underlying currencies based on allocation data
 */
export function decomposeETFByCurrency(
  instrument: InstrumentDetail,
  allocation: ETFAllocation
): Record<string, number> {
  const decomposed: Record<string, number> = {};

  // If risk is zero/invalid, don't decompose.
  if (!isFiniteNumber(instrument.riskEUR) || instrument.riskEUR <= 0) {
    return { OTHER: 0 };
  }
  
  // If hedged, all risk stays in the ETF's base currency (usually EUR)
  if (allocation.isHedged) {
    // For hedged ETFs, the currency risk is neutralized
    decomposed['EUR'] = instrument.riskEUR;
    return decomposed;
  }

  const currencyAllocations = normalizeCurrencyWeights(allocation.currencyAllocations);
  if (!currencyAllocations) return { OTHER: instrument.riskEUR };
  
  // Decompose the risk based on currency weights
  for (const [currency, percentage] of Object.entries(currencyAllocations)) {
    if (!isFiniteNumber(percentage) || percentage <= 0) continue;
    const weight = percentage / 100;
    const amount = instrument.riskEUR * weight;
    if (!isFiniteNumber(amount) || amount <= 0) continue;
    decomposed[currency] = amount;
  }

  // If everything got filtered out, fall back
  if (Object.keys(decomposed).length === 0) {
    return { OTHER: instrument.riskEUR };
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
      if (
        instrument.isETF &&
        instrument.isin &&
        etfAllocations[instrument.isin] &&
        isFiniteNumber(instrument.riskEUR) &&
        instrument.riskEUR > 0
      ) {
        const allocation = etfAllocations[instrument.isin];
        const decomposed = decomposeETFByCurrency(instrument, allocation);
        
        // Add decomposed amounts to each currency
        for (const [currency, riskAmount] of Object.entries(decomposed)) {
          if (!isFiniteNumber(riskAmount) || riskAmount <= 0) continue;
          const entry = getOrCreate(currency);
          entry.totalRisk += riskAmount;
          
          // Pro-rate the original currency amount
          const ratio = instrument.riskEUR > 0 ? riskAmount / instrument.riskEUR : 0;
          const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
          entry.totalRiskOriginal += instrument.riskOriginal * safeRatio;
          
          // Add instrument reference with decomposed info
          entry.instruments.push({
            ...instrument,
            riskEUR: riskAmount,
            riskOriginal: instrument.riskOriginal * safeRatio,
            details: `${instrument.details} [${(safeRatio * 100).toFixed(1)}% di ${instrument.name}]`,
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
      bonds: 0,
      commodities: 0,
      protections: 0,
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
