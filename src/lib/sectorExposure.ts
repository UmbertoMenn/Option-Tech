import { ETFAllocation } from '@/hooks/useETFAllocations';
import { RiskAnalysis } from './riskCalculator';
import { SectorMapping } from '@/hooks/useSectorMappings';
import { normalizeForMatching, getCanonicalKey, SPECIAL_ALIASES } from './derivativeStrategies';

// Sector colors for charts
export const SECTOR_COLORS: Record<string, string> = {
  'Technology': 'hsl(217, 91%, 60%)',           // Blue
  'Information Technology': 'hsl(217, 91%, 60%)',
  'IT': 'hsl(217, 91%, 60%)',
  'Financials': 'hsl(142, 71%, 45%)',           // Green
  'Financial Services': 'hsl(142, 71%, 45%)',
  'Healthcare': 'hsl(0, 84%, 60%)',             // Red
  'Health Care': 'hsl(0, 84%, 60%)',
  'Consumer Discretionary': 'hsl(38, 92%, 50%)', // Amber
  'Consumer Cyclical': 'hsl(38, 92%, 50%)',
  'Industrials': 'hsl(270, 67%, 58%)',          // Purple
  'Consumer Staples': 'hsl(189, 94%, 43%)',     // Cyan
  'Consumer Defensive': 'hsl(189, 94%, 43%)',
  'Energy': 'hsl(25, 95%, 53%)',                // Orange
  'Materials': 'hsl(84, 60%, 50%)',             // Lime
  'Basic Materials': 'hsl(84, 60%, 50%)',
  'Utilities': 'hsl(262, 83%, 58%)',            // Indigo
  'Real Estate': 'hsl(330, 81%, 60%)',          // Pink
  'Communication Services': 'hsl(168, 76%, 42%)', // Teal
  'Telecommunications': 'hsl(168, 76%, 42%)',
  'Other': 'hsl(215, 14%, 46%)',                // Gray
};

export function getSectorColor(sector: string): string {
  return SECTOR_COLORS[sector] || SECTOR_COLORS['Other'];
}

// Mapping of known stock tickers to sectors (GICS sectors)
const STOCK_SECTORS: Record<string, string> = {
  // Technology
  'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'GOOG': 'Technology',
  'META': 'Technology', 'NVDA': 'Technology', 'AVGO': 'Technology', 'CSCO': 'Technology',
  'ORCL': 'Technology', 'ACN': 'Technology', 'ADBE': 'Technology', 'CRM': 'Technology',
  'INTC': 'Technology', 'AMD': 'Technology', 'TXN': 'Technology', 'QCOM': 'Technology',
  'IBM': 'Technology', 'NOW': 'Technology', 'INTU': 'Technology', 'AMAT': 'Technology',
  'MU': 'Technology', 'LRCX': 'Technology', 'ADI': 'Technology', 'KLAC': 'Technology',
  'ASML': 'Technology', 'TSM': 'Technology', 'SAP': 'Technology', 'SNPS': 'Technology',
  'CDNS': 'Technology', 'MRVL': 'Technology', 'NXPI': 'Technology', 'MCHP': 'Technology',
  
  // Financials
  'JPM': 'Financials', 'BAC': 'Financials', 'WFC': 'Financials', 'C': 'Financials',
  'GS': 'Financials', 'MS': 'Financials', 'BLK': 'Financials', 'SCHW': 'Financials',
  'AXP': 'Financials', 'SPGI': 'Financials', 'CB': 'Financials', 'PGR': 'Financials',
  'MMC': 'Financials', 'CME': 'Financials', 'ICE': 'Financials', 'AON': 'Financials',
  'USB': 'Financials', 'PNC': 'Financials', 'TFC': 'Financials', 'COF': 'Financials',
  'V': 'Financials', 'MA': 'Financials', 'PYPL': 'Financials', 'BRK.A': 'Financials',
  'BRK.B': 'Financials', 'AIG': 'Financials', 'MET': 'Financials', 'PRU': 'Financials',
  
  // Healthcare
  'JNJ': 'Healthcare', 'UNH': 'Healthcare', 'LLY': 'Healthcare', 'PFE': 'Healthcare',
  'ABBV': 'Healthcare', 'MRK': 'Healthcare', 'TMO': 'Healthcare', 'ABT': 'Healthcare',
  'DHR': 'Healthcare', 'BMY': 'Healthcare', 'AMGN': 'Healthcare', 'GILD': 'Healthcare',
  'MDT': 'Healthcare', 'ISRG': 'Healthcare', 'SYK': 'Healthcare', 'CVS': 'Healthcare',
  'CI': 'Healthcare', 'ELV': 'Healthcare', 'REGN': 'Healthcare', 'VRTX': 'Healthcare',
  'ZTS': 'Healthcare', 'BDX': 'Healthcare', 'BSX': 'Healthcare', 'HUM': 'Healthcare',
  'NVO': 'Healthcare', 'AZN': 'Healthcare', 'GSK': 'Healthcare', 'SNY': 'Healthcare',
  
  // Consumer Discretionary
  'AMZN': 'Consumer Discretionary', 'TSLA': 'Consumer Discretionary', 'HD': 'Consumer Discretionary',
  'MCD': 'Consumer Discretionary', 'NKE': 'Consumer Discretionary', 'LOW': 'Consumer Discretionary',
  'SBUX': 'Consumer Discretionary', 'TJX': 'Consumer Discretionary', 'BKNG': 'Consumer Discretionary',
  'CMG': 'Consumer Discretionary', 'ORLY': 'Consumer Discretionary', 'MAR': 'Consumer Discretionary',
  'HLT': 'Consumer Discretionary', 'GM': 'Consumer Discretionary', 'F': 'Consumer Discretionary',
  'TM': 'Consumer Discretionary', 'RACE': 'Consumer Discretionary', 'LULU': 'Consumer Discretionary',
  
  // Consumer Staples
  'PG': 'Consumer Staples', 'KO': 'Consumer Staples', 'PEP': 'Consumer Staples',
  'COST': 'Consumer Staples', 'WMT': 'Consumer Staples', 'PM': 'Consumer Staples',
  'MO': 'Consumer Staples', 'MDLZ': 'Consumer Staples', 'CL': 'Consumer Staples',
  'EL': 'Consumer Staples', 'KMB': 'Consumer Staples', 'GIS': 'Consumer Staples',
  'K': 'Consumer Staples', 'HSY': 'Consumer Staples', 'SYY': 'Consumer Staples',
  'KHC': 'Consumer Staples', 'STZ': 'Consumer Staples', 'BUD': 'Consumer Staples',
  
  // Industrials
  'CAT': 'Industrials', 'DE': 'Industrials', 'UNP': 'Industrials', 'HON': 'Industrials',
  'UPS': 'Industrials', 'RTX': 'Industrials', 'BA': 'Industrials', 'LMT': 'Industrials',
  'GE': 'Industrials', 'MMM': 'Industrials', 'EMR': 'Industrials', 'ITW': 'Industrials',
  'ETN': 'Industrials', 'PH': 'Industrials', 'WM': 'Industrials', 'CSX': 'Industrials',
  'NSC': 'Industrials', 'GD': 'Industrials', 'NOC': 'Industrials', 'FDX': 'Industrials',
  
  // Energy
  'XOM': 'Energy', 'CVX': 'Energy', 'COP': 'Energy', 'SLB': 'Energy',
  'EOG': 'Energy', 'MPC': 'Energy', 'PXD': 'Energy', 'VLO': 'Energy',
  'PSX': 'Energy', 'OXY': 'Energy', 'HAL': 'Energy', 'BKR': 'Energy',
  'SHEL': 'Energy', 'BP': 'Energy', 'TTE': 'Energy', 'ENI': 'Energy',
  
  // Materials
  'LIN': 'Materials', 'APD': 'Materials', 'SHW': 'Materials', 'ECL': 'Materials',
  'FCX': 'Materials', 'NEM': 'Materials', 'NUE': 'Materials', 'DOW': 'Materials',
  'DD': 'Materials', 'PPG': 'Materials', 'VMC': 'Materials', 'MLM': 'Materials',
  
  // Utilities
  'NEE': 'Utilities', 'DUK': 'Utilities', 'SO': 'Utilities', 'D': 'Utilities',
  'AEP': 'Utilities', 'EXC': 'Utilities', 'SRE': 'Utilities', 'XEL': 'Utilities',
  'WEC': 'Utilities', 'ED': 'Utilities', 'ES': 'Utilities', 'AWK': 'Utilities',
  
  // Real Estate
  'PLD': 'Real Estate', 'AMT': 'Real Estate', 'EQIX': 'Real Estate', 'CCI': 'Real Estate',
  'PSA': 'Real Estate', 'SPG': 'Real Estate', 'O': 'Real Estate', 'WELL': 'Real Estate',
  'DLR': 'Real Estate', 'AVB': 'Real Estate', 'EQR': 'Real Estate', 'VTR': 'Real Estate',
  
  // Communication Services
  'NFLX': 'Communication Services', 'DIS': 'Communication Services', 'CMCSA': 'Communication Services',
  'VZ': 'Communication Services', 'T': 'Communication Services', 'TMUS': 'Communication Services',
  'CHTR': 'Communication Services', 'EA': 'Communication Services', 'ATVI': 'Communication Services',
  'WBD': 'Communication Services', 'PARA': 'Communication Services', 'OMC': 'Communication Services',
};

// Mapping da nomi aziendali comuni a ticker (per gestire "APPLE INC" -> AAPL)
const COMPANY_NAME_TO_TICKER: Record<string, string> = {
  'APPLE': 'AAPL',
  'NVIDIA': 'NVDA',
  'ALPHABET': 'GOOGL',
  'GOOGLE': 'GOOGL',
  'AMAZON': 'AMZN',
  'MICROSOFT': 'MSFT',
  'META': 'META',
  'TESLA': 'TSLA',
  'INTEL': 'INTC',
  'AMD': 'AMD',
  'ADVANCED MICRO': 'AMD',
  'BROADCOM': 'AVGO',
  'QUALCOMM': 'QCOM',
  'CISCO': 'CSCO',
  'ORACLE': 'ORCL',
  'SALESFORCE': 'CRM',
  'ADOBE': 'ADBE',
  'NETFLIX': 'NFLX',
  'PAYPAL': 'PYPL',
  'VISA': 'V',
  'MASTERCARD': 'MA',
  'JPMORGAN': 'JPM',
  'GOLDMAN': 'GS',
  'BERKSHIRE': 'BRK.B',
  'UNITEDHEALTH': 'UNH',
  'JOHNSON': 'JNJ',
  'PROCTER': 'PG',
  'EXXON': 'XOM',
  'CHEVRON': 'CVX',
  'WALMART': 'WMT',
  'DISNEY': 'DIS',
  'COCA COLA': 'KO',
  'PEPSI': 'PEP',
  'PEPSICO': 'PEP',
  'IREN': 'IREN',
  'MARA': 'MARA',
  'MARATHON': 'MARA',
  'RIOT': 'RIOT',
  'PALANTIR': 'PLTR',
  'COINBASE': 'COIN',
  'MICROSTRATEGY': 'MSTR',
  'COREWEAVE': 'CRWV',
  // Additional mappings for commonly missed stocks
  'APPLIED DIGITAL': 'APLD',
  'APLD': 'APLD',
  'SUPER MICRO': 'SMCI',
  'SUPERMICRO': 'SMCI',
  'SOUNDHOUND': 'SOUN',
  'NUSCALE': 'SMR',
  'RIGETTI': 'RGTI',
  'NEBIUS': 'NBIS',
  'HIMS': 'HIMS',
  'PALO ALTO': 'PANW',
  'PDD': 'PDD',
  'ALIBABA': 'BABA',
};

// Normalize sector names to standard GICS format
function normalizeSectorName(sector: string): string {
  const normalized = sector.trim();
  const mapping: Record<string, string> = {
    'Information Technology': 'Technology',
    'IT': 'Technology',
    'Financial Services': 'Financials',
    'Health Care': 'Healthcare',
    'Consumer Cyclical': 'Consumer Discretionary',
    'Consumer Defensive': 'Consumer Staples',
    'Basic Materials': 'Materials',
    'Telecommunications': 'Communication Services',
  };
  return mapping[normalized] || normalized;
}

export type SectorInstrumentCategory = 'stocks' | 'nakedPuts' | 'leapCalls' | 'strategies';

export interface SectorInstrument {
  name: string;
  riskEUR: number;
  isETF: boolean;
  isFromETFDecomposition: boolean;
  sourceETF?: string;
  percentage?: number;
  category: SectorInstrumentCategory;
}

export interface SectorExposure {
  sector: string;
  totalRisk: number;
  percentage: number;
  instruments: SectorInstrument[];
  breakdown: Record<SectorInstrumentCategory, number>;
}

export interface TopHolding {
  name: string;
  totalExposure: number;
  percentage: number;
  sources: Array<{
    source: string;
    exposure: number;
    isDirectHolding: boolean;
    percentage?: number;
  }>;
}

// Interface for Consolidated Top 10 Holdings
export interface ConsolidatedHolding {
  name: string;
  stockRisk: number;             // Direct stock risk WITHOUT protections (€)
  stockRiskWithProtection: number; // Direct stock risk WITH protections (€)
  nakedPutRisk: number;          // Naked PUT risk (€)
  leapCallRisk: number;          // Leap Call risk - market value (€)
  strategyRisk: number;          // Strategy Max Loss (€)
  totalExposure: number;         // Total with/without protections (calculated based on toggle)
  sources: Array<{
    type: 'stock' | 'nakedPut' | 'leapCall' | 'strategy';
    name: string;
    exposure: number;
    percentage?: number;
  }>;
}

// NOTE: ETF detection now uses stock.isETF flag from riskCalculator (based on asset_type)
// The pattern matching was unreliable and has been removed

function getStockSector(name: string): string {
  // Normalize: remove AZ. prefix common in Italian brokers
  const normalizedName = name.replace(/^AZ\./i, '').trim();
  const upperName = normalizedName.toUpperCase();
  
  // 1. Try direct ticker match (first word in uppercase)
  const tickerMatch = normalizedName.match(/^([A-Z]{1,5})(?:\s|$)/);
  if (tickerMatch && STOCK_SECTORS[tickerMatch[1]]) {
    return STOCK_SECTORS[tickerMatch[1]];
  }
  
  // 2. Try company name to ticker mapping (handles "APPLE INC" -> AAPL)
  for (const [companyName, ticker] of Object.entries(COMPANY_NAME_TO_TICKER)) {
    if (upperName.includes(companyName)) {
      if (STOCK_SECTORS[ticker]) {
        return STOCK_SECTORS[ticker];
      }
    }
  }
  
  // 3. Check full name for known tickers anywhere
  for (const [ticker, sector] of Object.entries(STOCK_SECTORS)) {
    if (upperName.includes(ticker) && ticker.length >= 3) {
      return sector;
    }
  }
  
  return 'Other';
}

// Get sector with dynamic mapping support for derivatives
function getStockSectorWithMapping(
  name: string, 
  sectorMappings: Record<string, SectorMapping>,
  isin?: string
): string {
  // 1. Try by ISIN from dynamic mapping
  if (isin && sectorMappings[isin]?.sector) {
    return normalizeSectorName(sectorMappings[isin].sector);
  }
  
  // Normalize name: remove AZ. prefix common in Italian brokers
  const normalizedName = name.replace(/^AZ\./i, '').trim();
  const upperName = normalizedName.toUpperCase();
  
  // 2. Try by name key (for derivatives) - try both original and normalized
  if (sectorMappings[`name:${upperName}`]?.sector) {
    return normalizeSectorName(sectorMappings[`name:${upperName}`].sector);
  }
  const originalUpperName = name.toUpperCase();
  if (originalUpperName !== upperName && sectorMappings[`name:${originalUpperName}`]?.sector) {
    return normalizeSectorName(sectorMappings[`name:${originalUpperName}`].sector);
  }
  
  // 3. Try to find by ticker in sectorMappings
  for (const [key, mapping] of Object.entries(sectorMappings)) {
    if (key.startsWith('ticker:') && mapping.ticker && upperName.includes(mapping.ticker.toUpperCase())) {
      return normalizeSectorName(mapping.sector);
    }
    // Also match ISIN entries by ticker
    if (!key.startsWith('ticker:') && !key.startsWith('name:') && mapping.ticker) {
      if (upperName.includes(mapping.ticker.toUpperCase()) && mapping.ticker.length >= 2) {
        return normalizeSectorName(mapping.sector);
      }
    }
  }
  
  // 4. Fallback to static mapping (which now handles AZ. normalization internally)
  return getStockSector(name);
}

export interface SectorExposureOptions {
  includeNakedPut?: boolean;     // default: true
  includeStrategies?: boolean;   // default: true
  includeLeapCall?: boolean;     // default: true
  sectorMappings?: Record<string, SectorMapping>;
}

export function calculateSectorExposure(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: SectorExposureOptions = {}
): SectorExposure[] {
  const { 
    includeNakedPut = true, 
    includeStrategies = true, 
    includeLeapCall = true, 
    sectorMappings = {} 
  } = options;
  const bySector = new Map<string, SectorExposure>();
  
  const getOrCreateSector = (sector: string): SectorExposure => {
    const normalizedSector = normalizeSectorName(sector);
    if (!bySector.has(normalizedSector)) {
      bySector.set(normalizedSector, {
        sector: normalizedSector,
        totalRisk: 0,
        percentage: 0,
        instruments: [],
        breakdown: { stocks: 0, nakedPuts: 0, leapCalls: 0, strategies: 0 },
      });
    }
    return bySector.get(normalizedSector)!;
  };
  
  // Helper to check for EUROFOREX instruments (excluded from sector analysis)
  const isEuroforex = (name: string) => name?.toUpperCase().includes('EUROFOREX') || false;
  
  // Process stocks (including ETFs)
  // NOTE: For sector analysis, stocks are ALWAYS valued at gross value (before protections)
  for (const stock of analysis.stockDetails) {
    // Skip EUROFOREX instruments
    if (isEuroforex(stock.underlying)) {
      continue;
    }
    
    // Use the isETF flag from StockRiskDetail (set in riskCalculator based on asset_type)
    const isETF = stock.isETF;
    // Use gross value (stockValue / exchangeRate) instead of riskEUR (which is net of protections)
    const grossValueEUR = stock.stockValue / stock.exchangeRate;
    
    if (isETF && stock.isin && etfAllocations[stock.isin]) {
      // ETF with sector allocation data - decompose by sector
      const allocation = etfAllocations[stock.isin];
      const sectorData = allocation.sectorAllocations || {};
      
      const totalSectorPercentage = Object.values(sectorData).reduce((a, b) => a + b, 0);
      
      if (totalSectorPercentage > 0) {
        // ETF with sector data - decompose by sector
        for (const [sector, percentage] of Object.entries(sectorData)) {
          if (percentage > 0) {
            const sectorExposure = getOrCreateSector(sector);
            const riskAmount = grossValueEUR * (percentage / 100);
            
            sectorExposure.totalRisk += riskAmount;
            sectorExposure.breakdown.stocks += riskAmount;
            sectorExposure.instruments.push({
              name: stock.underlying,
              riskEUR: riskAmount,
              isETF: true,
              isFromETFDecomposition: true,
              sourceETF: allocation.name || stock.underlying,
              percentage,
              category: 'stocks',
            });
          }
        }
        continue; // FIX: Exit after decomposition to avoid duplication
      } else {
        // ETF without sector data - assign to "Other"
        const sectorExposure = getOrCreateSector('Other');
        sectorExposure.totalRisk += grossValueEUR;
        sectorExposure.breakdown.stocks += grossValueEUR;
        sectorExposure.instruments.push({
          name: stock.underlying,
          riskEUR: grossValueEUR,
          isETF: true,
          isFromETFDecomposition: false,
          category: 'stocks',
        });
        continue; // FIX: Exit after assignment to Other
      }
    } else if (isETF) {
      // ETF without allocation data - assign to "Other"
      const sectorExposure = getOrCreateSector('Other');
      sectorExposure.totalRisk += grossValueEUR;
      sectorExposure.breakdown.stocks += grossValueEUR;
      sectorExposure.instruments.push({
        name: stock.underlying,
        riskEUR: grossValueEUR,
        isETF: true,
        isFromETFDecomposition: false,
        category: 'stocks',
      });
    } else {
      // Single stock - assign sector based on dynamic mapping first, then fallback
      let sector: string;
      
      // 1. Try dynamic mapping from database (by ISIN)
      if (stock.isin && sectorMappings[stock.isin]?.sector) {
        sector = normalizeSectorName(sectorMappings[stock.isin].sector);
      } else {
        // 2. Fallback to static ticker mapping
        sector = getStockSector(stock.underlying);
      }
      
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += grossValueEUR;
      sectorExposure.breakdown.stocks += grossValueEUR;
      sectorExposure.instruments.push({
        name: stock.underlying,
        riskEUR: grossValueEUR,
        isETF: false,
        isFromETFDecomposition: false,
        category: 'stocks',
      });
    }
  }
  
  // Process derivatives with granular toggles - USES DYNAMIC MAPPINGS + EUROFOREX FILTER
  
  // Naked PUTs - assign by underlying sector using dynamic mappings
  if (includeNakedPut) {
    for (const np of analysis.nakedPutDetails) {
      // Skip EUROFOREX instruments
      if (isEuroforex(np.underlying)) continue;
      
      const sector = getStockSectorWithMapping(np.underlying, sectorMappings);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += np.riskEUR;
      sectorExposure.breakdown.nakedPuts += np.riskEUR;
      sectorExposure.instruments.push({
        name: `${np.underlying} (PUT ${np.strike})`,
        riskEUR: np.riskEUR,
        isETF: false,
        isFromETFDecomposition: false,
        category: 'nakedPuts',
      });
    }
  }
  
  // Leap CALLs - assign by underlying sector using dynamic mappings
  if (includeLeapCall) {
    for (const lc of analysis.leapCallDetails) {
      // Skip EUROFOREX instruments
      if (isEuroforex(lc.underlying)) continue;
      
      const sector = getStockSectorWithMapping(lc.underlying, sectorMappings);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += lc.riskEUR;
      sectorExposure.breakdown.leapCalls += lc.riskEUR;
      sectorExposure.instruments.push({
        name: `${lc.underlying} (LEAP CALL)`,
        riskEUR: lc.riskEUR,
        isETF: false,
        isFromETFDecomposition: false,
        category: 'leapCalls',
      });
    }
  }
  
  // Strategies - assign by underlying sector using dynamic mappings
  if (includeStrategies) {
    for (const strat of analysis.strategyDetails) {
      // Skip EUROFOREX instruments
      if (isEuroforex(strat.underlying)) continue;
      
      const sector = getStockSectorWithMapping(strat.underlying, sectorMappings);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += strat.maxLossEUR;
      sectorExposure.breakdown.strategies += strat.maxLossEUR;
      sectorExposure.instruments.push({
        name: `${strat.underlying} (${strat.strategyName})`,
        riskEUR: strat.maxLossEUR,
        isETF: false,
        isFromETFDecomposition: false,
        category: 'strategies',
      });
    }
  }
  
  // Calculate percentages and sort
  let grandTotal = 0;
  for (const exposure of bySector.values()) {
    grandTotal += exposure.totalRisk;
    // Sort instruments by risk
    exposure.instruments.sort((a, b) => b.riskEUR - a.riskEUR);
  }
  
  const result = Array.from(bySector.values())
    .map(exp => ({
      ...exp,
      percentage: grandTotal > 0 ? (exp.totalRisk / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalRisk - a.totalRisk);
  
  return result;
}

export function calculateTopHoldings(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  limit: number = 20
): TopHolding[] {
  const holdingsMap = new Map<string, TopHolding>();
  
  const getOrCreateHolding = (name: string): TopHolding => {
    const normalizedName = name.trim();
    if (!holdingsMap.has(normalizedName)) {
      holdingsMap.set(normalizedName, {
        name: normalizedName,
        totalExposure: 0,
        percentage: 0,
        sources: [],
      });
    }
    return holdingsMap.get(normalizedName)!;
  };
  
  // Add direct stock holdings
  for (const stock of analysis.stockDetails) {
    if (!stock.isETF) {
      const holding = getOrCreateHolding(stock.underlying);
      holding.totalExposure += stock.riskEUR;
      holding.sources.push({
        source: 'Diretto',
        exposure: stock.riskEUR,
        isDirectHolding: true,
      });
    }
  }
  
  // Add holdings from ETF decomposition
  for (const stock of analysis.stockDetails) {
    if (stock.isETF && stock.isin && etfAllocations[stock.isin]) {
      const allocation = etfAllocations[stock.isin];
      const topHoldings = allocation.topHoldings || [];
      
      for (const etfHolding of topHoldings) {
        if (etfHolding.percentage > 0) {
          const exposure = stock.riskEUR * (etfHolding.percentage / 100);
          const holding = getOrCreateHolding(etfHolding.name);
          holding.totalExposure += exposure;
          holding.sources.push({
            source: allocation.name || stock.underlying,
            exposure,
            isDirectHolding: false,
            percentage: etfHolding.percentage,
          });
        }
      }
    }
  }
  
  // Calculate percentages and sort
  let grandTotal = 0;
  for (const holding of holdingsMap.values()) {
    grandTotal += holding.totalExposure;
    // Sort sources by exposure
    holding.sources.sort((a, b) => b.exposure - a.exposure);
  }
  
  const result = Array.from(holdingsMap.values())
    .map(h => ({
      ...h,
      percentage: grandTotal > 0 ? (h.totalExposure / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalExposure - a.totalExposure)
    .slice(0, limit);
  
  return result;
}

/**
 * Corporate stopwords that cause false matches between different companies.
 * These are removed during key generation to prevent "ALIBABA GROUP HOLDING"
 * from matching "CK HUTCHISON HOLDINGS" just because they share "HOLDING".
 */
const CORPORATE_STOPWORDS = new Set([
  'GROUP', 'HOLDING', 'HOLDINGS', 'COMPANY', 'COMPANIES', 'CO', 'CORP', 'CORPORATION',
  'LIMITED', 'LTD', 'INC', 'INCORPORATED', 'PLC', 'AG', 'SA', 'SPA', 'NV', 'BV',
  'SE', 'GMBH', 'LLC', 'LP', 'LLP', 'ADR', 'ADS', 'CLASS', 'CL', 'SHS', 'SHARES',
  'COMMON', 'ORDINARY', 'PREFERRED', 'PREF', 'ORD', 'THE', 'OF', 'AND', '&'
]);

/**
 * Normalizes holding names for matching across different sources
 * Handles variations like "NVIDIA Corp" vs "NVDA" vs "NVIDIA CORP"
 */
export function normalizeHoldingName(name: string): string {
  // Rimuovi prefisso "AZ." comune nelle descrizioni stock italiane
  let normalized = name.replace(/^AZ\./i, '').trim();
  return normalizeForMatching(normalized);
}

/**
 * Generates a distinctive canonical key for a holding name by:
 * 1. Normalizing the name
 * 2. Tokenizing
 * 3. Removing corporate stopwords
 * 4. Keeping only significant tokens (length >= 3, not pure numbers)
 * 5. Sorting for consistency
 * 
 * Returns null if no significant tokens remain (requires exact match only)
 */
export function getHoldingKey(name: string): string | null {
  // First check canonical aliases (e.g., ALPHABET -> GOOGLE)
  const canonical = getCanonicalKey(name);
  if (canonical) {
    return `CANONICAL:${canonical}`;
  }
  
  const normalized = normalizeHoldingName(name);
  const tokens = normalized.toUpperCase().split(/\s+/);
  
  // Filter out stopwords and insignificant tokens
  const significantTokens = tokens.filter(token => {
    // Skip short tokens
    if (token.length < 3) return false;
    // Skip pure numbers
    if (/^\d+$/.test(token)) return false;
    // Skip stopwords
    if (CORPORATE_STOPWORDS.has(token)) return false;
    return true;
  });
  
  // If no significant tokens remain, return null (exact match only)
  if (significantTokens.length === 0) {
    return null;
  }
  
  // Sort for consistency and join
  return significantTokens.sort().join('|');
}

/**
 * Checks if two holding names represent the same company using the new key-based approach.
 * This is more conservative than the old approach to prevent false merges.
 */
export function isSameHolding(name1: string, name2: string): boolean {
  const norm1 = normalizeHoldingName(name1);
  const norm2 = normalizeHoldingName(name2);
  
  // Direct exact match after normalization
  if (norm1 === norm2) return true;
  
  // Get holding keys
  const key1 = getHoldingKey(name1);
  const key2 = getHoldingKey(name2);
  
  // If either has no key (no significant tokens), require exact match
  if (!key1 || !key2) {
    return norm1 === norm2;
  }
  
  // Check canonical keys first
  if (key1.startsWith('CANONICAL:') && key2.startsWith('CANONICAL:')) {
    return key1 === key2;
  }
  
  // If one is canonical and other isn't, check if tokens match
  if (key1.startsWith('CANONICAL:') || key2.startsWith('CANONICAL:')) {
    const canonicalKey = key1.startsWith('CANONICAL:') ? key1 : key2;
    const otherName = key1.startsWith('CANONICAL:') ? name2 : name1;
    const canonicalName = canonicalKey.replace('CANONICAL:', '');
    const otherNorm = normalizeHoldingName(otherName).toUpperCase();
    return otherNorm.includes(canonicalName.toUpperCase());
  }
  
  // Parse token keys
  const tokens1 = key1.split('|');
  const tokens2 = key2.split('|');
  
  // Single token case: require exact token match
  if (tokens1.length === 1 || tokens2.length === 1) {
    const singleToken = tokens1.length === 1 ? tokens1[0] : tokens2[0];
    const otherTokens = tokens1.length === 1 ? tokens2 : tokens1;
    // Single token must exactly match one of the other tokens
    return otherTokens.includes(singleToken);
  }
  
  // Multi-token case: require high overlap (Jaccard >= 0.6)
  // OR all tokens from shorter set are in longer set
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection = tokens1.filter(t => set2.has(t));
  const union = new Set([...tokens1, ...tokens2]);
  const jaccard = intersection.length / union.size;
  
  // High overlap
  if (jaccard >= 0.6) return true;
  
  // All tokens from shorter contained in longer
  const shorter = tokens1.length <= tokens2.length ? tokens1 : tokens2;
  const longer = tokens1.length <= tokens2.length ? set2 : set1;
  const allContained = shorter.every(t => longer.has(t));
  
  return allContained && shorter.length >= 1;
}

export interface ConsolidatedTopHoldingsOptions {
  includeProtections: boolean;
  includeNakedPut?: boolean;
  includeStrategies?: boolean;
  includeLeapCall?: boolean;
}

// Extended interface to include source details for breakdown
export interface ConsolidatedHoldingWithDetails extends ConsolidatedHolding {
  nakedPutDetails: Array<{
    strike: number;
    contracts: number;
    riskEUR: number;
    expiry: string;
  }>;
  leapCallDetails: Array<{
    strike: number;
    contracts: number;
    avgCost: number;
    marketPrice: number;
    marketValue: number;
    expiry: string;
  }>;
  stockDetails: Array<{
    quantity: number;
    price: number;
    currency: string;
    value: number;
    valueWithProtection: number;
    // Protection info
    protectionContracts: number;
    protectionStrike: number | null;
    hasProtection: boolean;
  }>;
  strategyDetails: Array<{
    strategyName: string;
    maxLossEUR: number;
    hasUnlimitedRisk: boolean;
  }>;
}

/**
 * Calculates consolidated top holdings aggregating exposure from:
 * 1. ETF holdings (top 10 from each ETF, weighted by ETF value)
 * 2. Direct stock positions (with or without protection based on toggle)
 * 3. Naked PUT positions
 * 
 * Uses key-based Map for deterministic, stable aggregation (no more O(N²) scan).
 */
export function calculateConsolidatedTopHoldings(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: ConsolidatedTopHoldingsOptions,
  limit: number = 100 // Show all holdings by default
): ConsolidatedHoldingWithDetails[] {
  // Key-based map for stable aggregation
  const holdingsByKey = new Map<string, ConsolidatedHoldingWithDetails>();
  // Fallback map for names without distinctive keys (exact match only)
  const holdingsByExactName = new Map<string, ConsolidatedHoldingWithDetails>();
  
  // Pattern per riconoscere ETF
  const ETF_PATTERN = /ETF|UCITS|ISHARES|ISHSIII|ISHSIV|ISHSV|ISHSVII|VANGUARD|VNG|SPDR|SSG|LYXOR|AMUNDI|XTRACKERS|XTRK|INVESCO|VANECK|WISDOMTREE|WTR|UBS ETF|HSBC ETF|FRANKLIN/i;
  
  const formatExpiry = (expiry: string) => {
    if (!expiry) return '-';
    const date = new Date(expiry);
    const month = date.toLocaleDateString('it-IT', { month: 'short' }).toUpperCase();
    const year = date.getFullYear().toString().slice(-2);
    return `${month}/${year}`;
  };
  
  const createHolding = (name: string): ConsolidatedHoldingWithDetails => ({
    name: name.trim(),
    stockRisk: 0,
    stockRiskWithProtection: 0,
    nakedPutRisk: 0,
    leapCallRisk: 0,
    strategyRisk: 0,
    totalExposure: 0,
    sources: [],
    nakedPutDetails: [],
    leapCallDetails: [],
    stockDetails: [],
    strategyDetails: [],
  });
  
  const getOrCreateHolding = (name: string): ConsolidatedHoldingWithDetails => {
    const key = getHoldingKey(name);
    const cleanName = name.trim();
    
    if (key) {
      // Use key-based lookup
      if (holdingsByKey.has(key)) {
        const existing = holdingsByKey.get(key)!;
        // Prefer shorter/cleaner name or direct stock name (without AZ. prefix)
        const existingHasAZ = existing.name.startsWith('AZ.');
        const newHasAZ = cleanName.startsWith('AZ.');
        if (existingHasAZ && !newHasAZ) {
          existing.name = cleanName;
        } else if (cleanName.length < existing.name.length && !newHasAZ) {
          existing.name = cleanName;
        }
        return existing;
      }
      
      const holding = createHolding(cleanName);
      holdingsByKey.set(key, holding);
      return holding;
    } else {
      // No distinctive key - use exact normalized name
      const normalizedName = normalizeHoldingName(name);
      if (holdingsByExactName.has(normalizedName)) {
        return holdingsByExactName.get(normalizedName)!;
      }
      
      const holding = createHolding(cleanName);
      holdingsByExactName.set(normalizedName, holding);
      return holding;
    }
  };
  
  // 1. Add direct stock risk (skip ETFs)
  for (const stock of analysis.stockDetails) {
    const isETF = ETF_PATTERN.test(stock.underlying);
    
    if (!isETF) {
      const holding = getOrCreateHolding(stock.underlying);
      
      // stockValue is full value, riskEUR is value with protections
      const stockValueEUR = stock.stockValue / stock.exchangeRate;
      holding.stockRisk += stockValueEUR;
      holding.stockRiskWithProtection += stock.riskEUR;
      
      holding.sources.push({
        type: 'stock',
        name: 'Diretto',
        exposure: options.includeProtections ? stock.riskEUR : stockValueEUR,
      });
      holding.stockDetails.push({
        quantity: stock.stockQuantity,
        price: stock.stockPrice,
        currency: stock.currency,
        value: stockValueEUR,
        valueWithProtection: stock.riskEUR,
        // Protection info from StockRiskDetail
        protectionContracts: stock.protectionContracts || 0,
        protectionStrike: stock.protectionStrike ?? null,
        hasProtection: stock.hasProtection || false,
      });
    }
  }
  
  // 3. Add Naked PUT risk
  for (const np of analysis.nakedPutDetails) {
    const holding = getOrCreateHolding(np.underlying);
    
    holding.nakedPutRisk += np.riskEUR;
    holding.sources.push({
      type: 'nakedPut',
      name: `PUT ${np.strike}`,
      exposure: np.riskEUR,
    });
    holding.nakedPutDetails.push({
      strike: np.strike,
      contracts: np.contracts,
      riskEUR: np.riskEUR,
      expiry: np.expiry,
    });
  }
  
  // 4. Add Leap Call risk (market value)
  for (const lc of analysis.leapCallDetails) {
    const holding = getOrCreateHolding(lc.underlying);
    
    holding.leapCallRisk += lc.riskEUR;
    holding.sources.push({
      type: 'leapCall',
      name: `LEAP ${lc.strike} ${formatExpiry(lc.expiry)}`,
      exposure: lc.riskEUR,
    });
    holding.leapCallDetails.push({
      strike: lc.strike,
      contracts: lc.contracts,
      avgCost: lc.avgCost,
      marketPrice: lc.marketPrice,
      marketValue: lc.riskEUR,
      expiry: lc.expiry,
    });
  }
  
  // 5. Add Strategy Max Loss
  for (const strat of analysis.strategyDetails) {
    const holding = getOrCreateHolding(strat.underlying);
    
    holding.strategyRisk += strat.maxLossEUR;
    holding.sources.push({
      type: 'strategy',
      name: strat.strategyName,
      exposure: strat.maxLossEUR,
    });
    holding.strategyDetails.push({
      strategyName: strat.strategyName,
      maxLossEUR: strat.maxLossEUR,
      hasUnlimitedRisk: strat.hasUnlimitedRisk,
    });
  }
  
  // Combine both maps
  const allHoldings = [...holdingsByKey.values(), ...holdingsByExactName.values()];
  
  // Calculate total exposure based on toggles
  const { 
    includeNakedPut = true, 
    includeStrategies = true, 
    includeLeapCall = true 
  } = options;
  
  for (const holding of allHoldings) {
    const stockPart = options.includeProtections 
      ? holding.stockRiskWithProtection 
      : holding.stockRisk;
    
    holding.totalExposure = stockPart + 
      (includeNakedPut ? holding.nakedPutRisk : 0) + 
      (includeLeapCall ? holding.leapCallRisk : 0) + 
      (includeStrategies ? holding.strategyRisk : 0);
    
    // Sort sources by exposure
    holding.sources.sort((a, b) => b.exposure - a.exposure);
  }
  
  // Sort by total exposure and take top N
  const result = allHoldings
    .filter(h => h.totalExposure > 0)
    .sort((a, b) => b.totalExposure - a.totalExposure)
    .slice(0, limit);
  
  return result;
}
