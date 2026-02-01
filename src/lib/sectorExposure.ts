import { ETFAllocation } from '@/hooks/useETFAllocations';
import { RiskAnalysis } from './riskCalculator';
import { SectorMapping } from '@/hooks/useSectorMappings';

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

export interface SectorInstrument {
  name: string;
  riskEUR: number;
  isETF: boolean;
  isFromETFDecomposition: boolean;
  sourceETF?: string;
  percentage?: number;
}

export interface SectorExposure {
  sector: string;
  totalRisk: number;
  percentage: number;
  instruments: SectorInstrument[];
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

// Pattern per riconoscere ETF (sincronizzato con excelParser.ts)
const ETF_PATTERN = /ETF|UCITS|ISHARES|ISHSIII|ISHSIV|ISHSV|ISHSVII|VANGUARD|VNG|SPDR|SSG|LYXOR|AMUNDI|XTRACKERS|XTRK|INVESCO|VANECK|WISDOMTREE|WTR|UBS ETF|HSBC ETF|FRANKLIN/i;

function isETFByName(name: string): boolean {
  return ETF_PATTERN.test(name);
}

function getStockSector(name: string): string {
  // Try to extract ticker from name (often first word in uppercase)
  const tickerMatch = name.match(/^([A-Z]{1,5})(?:\s|$)/);
  if (tickerMatch && STOCK_SECTORS[tickerMatch[1]]) {
    return STOCK_SECTORS[tickerMatch[1]];
  }
  
  // Also check full name for known tickers anywhere
  const upperName = name.toUpperCase();
  for (const [ticker, sector] of Object.entries(STOCK_SECTORS)) {
    if (upperName.includes(ticker) && ticker.length >= 3) {
      return sector;
    }
  }
  
  return 'Other';
}

export interface SectorExposureOptions {
  includeDerivatives?: boolean;
  sectorMappings?: Record<string, SectorMapping>;
}

export function calculateSectorExposure(
  analysis: RiskAnalysis,
  etfAllocations: Record<string, ETFAllocation>,
  options: SectorExposureOptions = {}
): SectorExposure[] {
  const { includeDerivatives = true, sectorMappings = {} } = options;
  const bySector = new Map<string, SectorExposure>();
  
  const getOrCreateSector = (sector: string): SectorExposure => {
    const normalizedSector = normalizeSectorName(sector);
    if (!bySector.has(normalizedSector)) {
      bySector.set(normalizedSector, {
        sector: normalizedSector,
        totalRisk: 0,
        percentage: 0,
        instruments: [],
      });
    }
    return bySector.get(normalizedSector)!;
  };
  
  // Process stocks (including ETFs)
  for (const stock of analysis.stockDetails) {
    const isETF = isETFByName(stock.underlying);
    
    if (isETF && stock.isin && etfAllocations[stock.isin]) {
      // ETF with sector allocation data - decompose by sector
      const allocation = etfAllocations[stock.isin];
      const sectorData = allocation.sectorAllocations || {};
      
      const totalSectorPercentage = Object.values(sectorData).reduce((a, b) => a + b, 0);
      
      if (totalSectorPercentage > 0) {
        for (const [sector, percentage] of Object.entries(sectorData)) {
          if (percentage > 0) {
            const sectorExposure = getOrCreateSector(sector);
            const riskAmount = stock.riskEUR * (percentage / 100);
            
            sectorExposure.totalRisk += riskAmount;
            sectorExposure.instruments.push({
              name: stock.underlying,
              riskEUR: riskAmount,
              isETF: true,
              isFromETFDecomposition: true,
              sourceETF: allocation.name || stock.underlying,
              percentage,
            });
          }
        }
      } else {
        // ETF without sector data - assign to "Other"
        const sectorExposure = getOrCreateSector('Other');
        sectorExposure.totalRisk += stock.riskEUR;
        sectorExposure.instruments.push({
          name: stock.underlying,
          riskEUR: stock.riskEUR,
          isETF: true,
          isFromETFDecomposition: false,
        });
      }
    } else if (isETF) {
      // ETF without allocation data - assign to "Other"
      const sectorExposure = getOrCreateSector('Other');
      sectorExposure.totalRisk += stock.riskEUR;
      sectorExposure.instruments.push({
        name: stock.underlying,
        riskEUR: stock.riskEUR,
        isETF: true,
        isFromETFDecomposition: false,
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
      sectorExposure.totalRisk += stock.riskEUR;
      sectorExposure.instruments.push({
        name: stock.underlying,
        riskEUR: stock.riskEUR,
        isETF: false,
        isFromETFDecomposition: false,
      });
    }
  }
  
  // Process derivatives if enabled
  if (includeDerivatives) {
    // Naked PUTs - assign by underlying sector
    for (const np of analysis.nakedPutDetails) {
      const sector = getStockSector(np.underlying);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += np.riskEUR;
      sectorExposure.instruments.push({
        name: `${np.underlying} (PUT ${np.strike})`,
        riskEUR: np.riskEUR,
        isETF: false,
        isFromETFDecomposition: false,
      });
    }
    
    // Leap CALLs - assign by underlying sector
    for (const lc of analysis.leapCallDetails) {
      const sector = getStockSector(lc.underlying);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += lc.riskEUR;
      sectorExposure.instruments.push({
        name: `${lc.underlying} (LEAP CALL)`,
        riskEUR: lc.riskEUR,
        isETF: false,
        isFromETFDecomposition: false,
      });
    }
    
    // Strategies - assign by underlying sector
    for (const strat of analysis.strategyDetails) {
      const sector = getStockSector(strat.underlying);
      const sectorExposure = getOrCreateSector(sector);
      sectorExposure.totalRisk += strat.maxLossEUR;
      sectorExposure.instruments.push({
        name: `${strat.underlying} (${strat.strategyName})`,
        riskEUR: strat.maxLossEUR,
        isETF: false,
        isFromETFDecomposition: false,
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
    if (!isETFByName(stock.underlying)) {
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
    if (isETFByName(stock.underlying) && stock.isin && etfAllocations[stock.isin]) {
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
