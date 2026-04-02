import { Position, AssetType } from '@/types/portfolio';
import { parseExcelNumber, parseExcelDate } from './formatters';

interface ExcelRow {
  [key: string]: string | number | null | undefined;
}

// Short patterns that require word boundary matching (to avoid false positives like "NETFLIX" matching "ETF")
const ETF_WORD_BOUNDARY_PATTERNS = ['ETF', 'UCITS', 'VNG', 'SSG', 'WTR'];

// Longer patterns safe for substring matching
const ETF_SUBSTRING_PATTERNS = [
  // iShares (BlackRock)
  'ISHARES', 'ISHSIII', 'ISHSIV', 'ISHSV', 'ISHSVII',
  // Vanguard
  'VANGUARD',
  // State Street (SPDR)
  'SPDR',
  // Lyxor (Amundi)
  'LYXOR', 'AMUNDI',
  // Xtrackers (DWS)
  'XTRACKERS', 'XTRK',
  // Invesco
  'INVESCO',
  // VanEck
  'VANECK',
  // WisdomTree
  'WISDOMTREE',
  // UBS
  'UBS ETF',
  // HSBC
  'HSBC ETF',
  // Franklin Templeton
  'FRANKLIN'
];

// Index patterns che indicano un ETF quando combinati con ISIN IE/LU
const ETF_INDEX_PATTERNS = ['MSCI', 'FTSE', 'S&P', 'STOXX', 'NASDAQ', 'DOW', 'RUSSELL', 'EURO'];

/**
 * Check if ISIN suggests European ETF domicile
 */
function isLikelyETFByISIN(isin: string | undefined): boolean {
  if (!isin) return false;
  const prefix = isin.substring(0, 2).toUpperCase();
  return prefix === 'IE' || prefix === 'LU';
}

/**
 * Advanced ETF detection based on description and ISIN
 * Uses word boundary for short patterns to avoid false positives (e.g. NETFLIX)
 */
function isETF(description: string, isin?: string): boolean {
  const descUpper = description.toUpperCase();
  
  // Check short patterns with word boundary
  for (const pattern of ETF_WORD_BOUNDARY_PATTERNS) {
    const regex = new RegExp(`\\b${pattern}\\b`);
    if (regex.test(descUpper)) {
      return true;
    }
  }
  
  // Check longer emitter patterns with substring
  for (const pattern of ETF_SUBSTRING_PATTERNS) {
    if (descUpper.includes(pattern)) {
      return true;
    }
  }
  
  // Check ISIN prefix (IE/LU) + description patterns
  if (isLikelyETFByISIN(isin)) {
    if (ETF_INDEX_PATTERNS.some(p => descUpper.includes(p))) {
      return true;
    }
  }
  
  return false;
}

export async function parsePortfolioExcel(file: File, options?: { excludedCashAccounts?: string[]; excludedCashPatterns?: { mid: string; last: string }[] }): Promise<{
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[];
  cashValue: number;
  snapshotDate: string | null;
}> {
  // Dynamic import of xlsx library (using @e965/xlsx for security patches)
  const XLSX = await import('@e965/xlsx');
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        const snapshotDate = extractSnapshotDate(jsonData);
        const result = parsePortfolioData(jsonData, options);
        resolve({ ...result, snapshotDate });
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Errore lettura file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract the snapshot date from the first rows of the Excel file
 * Priority: Cell C4 first, then scan first 10 rows for date patterns
 */
function extractSnapshotDate(rows: any[][]): string | null {
  // PRIORITY: Check cell C4 specifically (row index 3, column index 2)
  if (rows.length > 3 && rows[3] && rows[3][2] !== undefined && rows[3][2] !== null) {
    const cellC4 = rows[3][2];
    console.log('[ExcelParser] Cell C4 value:', cellC4, 'type:', typeof cellC4);
    
    // Excel date serial number
    if (typeof cellC4 === 'number' && cellC4 > 40000 && cellC4 < 50000) {
      const date = new Date((cellC4 - 25569) * 86400 * 1000);
      console.log('[ExcelParser] C4 parsed as Excel serial date:', date.toISOString().split('T')[0]);
      return date.toISOString().split('T')[0];
    }
    
    // String date pattern
    if (typeof cellC4 === 'string') {
      const dateMatch = cellC4.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
      if (dateMatch) {
        const parsed = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        console.log('[ExcelParser] C4 parsed as string date:', parsed);
        return parsed;
      }
    }
  }
  
  // Fallback: Check first 10 rows for date patterns
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    
    for (let j = 0; j < row.length; j++) {
      const cell = row[j];
      if (cell === null || cell === undefined) continue;
      
      // Check for Excel date serial number (40000-50000 range = ~2009-2036)
      if (typeof cell === 'number' && cell > 40000 && cell < 50000) {
        const date = new Date((cell - 25569) * 86400 * 1000);
        console.log(`[ExcelParser] Found Excel serial date at row ${i}, col ${j}:`, date.toISOString().split('T')[0]);
        return date.toISOString().split('T')[0];
      }
      
      // Check for string patterns
      if (typeof cell === 'string') {
        const cellStr = cell.toUpperCase();
        
        // Pattern: "POSIZIONE AL DD/MM/YYYY" or "POSIZIONE AL DD-MM-YYYY"
        const posizioneMatch = cellStr.match(/POSIZIONE\s+AL\s+(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
        if (posizioneMatch) {
          const parsed = `${posizioneMatch[3]}-${posizioneMatch[2]}-${posizioneMatch[1]}`;
          console.log(`[ExcelParser] Found POSIZIONE AL pattern at row ${i}:`, parsed);
          return parsed;
        }
        
        // Pattern: "DATA: DD/MM/YYYY" or "DATA DD/MM/YYYY"
        const dataMatch = cellStr.match(/DATA[:\s]+(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
        if (dataMatch) {
          const parsed = `${dataMatch[3]}-${dataMatch[2]}-${dataMatch[1]}`;
          console.log(`[ExcelParser] Found DATA pattern at row ${i}:`, parsed);
          return parsed;
        }
        
        // Pattern: standalone date DD/MM/YYYY (more permissive, at start of cell)
        const standaloneDateMatch = cell.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
        if (standaloneDateMatch) {
          const parsed = `${standaloneDateMatch[3]}-${standaloneDateMatch[2]}-${standaloneDateMatch[1]}`;
          console.log(`[ExcelParser] Found standalone date at row ${i}:`, parsed);
          return parsed;
        }
      }
    }
  }
  
  console.log('[ExcelParser] No date found in Excel file');
  return null;
}

function parsePortfolioData(rows: any[][], options?: { excludedCashAccounts?: string[]; excludedCashPatterns?: { mid: string; last: string }[] }): {
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[];
  cashValue: number;
} {
  const positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[] = [];
  let cashValue = 0;
  let currentSection: AssetType | null = null;
  let headerRow: string[] = [];
  let isDerivativeSection = false;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const firstCell = String(row[0] || '').toUpperCase();
    const secondCell = String(row[1] || '').toUpperCase();
    const thirdCell = String(row[2] || '').toUpperCase();
    
    // Detect section headers
    if (firstCell.includes('LIQUIDIT')) {
      currentSection = 'cash';
      isDerivativeSection = false;
      continue;
    } else if (firstCell.includes('TITOLI DI STATO') || firstCell.includes('OBBLIGAZIONI')) {
      // Both "TITOLI DI STATO" and "OBBLIGAZIONI" are bond sections
      currentSection = 'bond';
      isDerivativeSection = false;
      continue;
    } else if (firstCell.includes('AZIONI ED ETF') || firstCell.includes('AZIONI E ETF')) {
      currentSection = 'stock';
      isDerivativeSection = false;
      continue;
    } else if (firstCell.includes('DERIVATI')) {
      currentSection = 'derivative';
      isDerivativeSection = true;
      continue;
    } else if (firstCell.includes('ALTRO') || firstCell.includes('MATERIE PRIME') || firstCell.includes('COMMODIT')) {
      currentSection = 'commodity';
      isDerivativeSection = false;
      continue;
    } else if (firstCell.includes('NON VALORIZZABIL')) {
      currentSection = null;
      isDerivativeSection = false;
      console.log('[ExcelParser] Detected "TITOLI NON VALORIZZABILI" section — skipping all rows');
      continue;
    }
    
    // Detect header row
    if (firstCell.includes('CODICE_VALORE') || firstCell.includes('ISIN') || firstCell === 'CONTO') {
      headerRow = row.map(cell => String(cell || '').toUpperCase());
      continue;
    }
    
    // Skip totals and empty rows
    if (firstCell.includes('TOTALE') || !currentSection) {
      continue;
    }
    
    // Parse data row based on section
    if (currentSection === 'cash') {
      // Check if this account should be excluded
      const accountId = String(row[0] || '').trim();
      const isExcludedByList = options?.excludedCashAccounts?.some(acc => accountId.includes(acc));
      const isExcludedByPattern = options?.excludedCashPatterns?.some(p => {
        const midStart = Math.floor((accountId.length - p.mid.length) / 2);
        const mid = accountId.slice(midStart, midStart + p.mid.length);
        return mid === p.mid && accountId.endsWith(p.last);
      });
      if (isExcludedByList || isExcludedByPattern) {
        console.log(`[ExcelParser] Excluding cash account`);
        continue;
      }
      const value = findColumnValue(row, headerRow, ['VALORIZZAZIONE EUR', 'VALORIZZAZIONE IN DIVISA']);
      if (value) {
        cashValue += parseExcelNumber(value);
      }
      continue;
    }
    
    // Special handling for derivatives - description might be in column 2 (index 2) without ISIN
    if (isDerivativeSection) {
      // Check if this row contains an option (look for OPTION CALL/PUT or EUREX/IDEM pattern in any cell)
      const rowStr = row.map(cell => String(cell || '')).join(' ').toUpperCase();
      if (rowStr.includes('OPTION CALL') || rowStr.includes('OPTION PUT') ||
          rowStr.includes('EUREX,') || rowStr.includes('IDEM,')) {
        const position = parseDerivativeRow(row, headerRow);
        if (position && position.description) {
          positions.push(position);
        }
        continue;
      }
    }
    
    // Parse regular position data
    const position = parsePositionRow(row, headerRow, currentSection);
    if (position && position.description) {
      positions.push(position);
    }
  }
  
  return { positions, cashValue };
}

// Parse EUREX/IDEM expiry format like "MAR26", "DEC25", "JUN27"
function parseEurexExpiry(expiryStr: string): string | undefined {
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
  };
  const match = expiryStr.trim().toUpperCase().match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/);
  if (match && months[match[1]]) {
    const year = parseInt(match[2]) + 2000;
    return `${year}-${months[match[1]]}-20`; // Third Friday approximation
  }
  return undefined;
}

// Parse DD/MM/YYYY date format
function parseDDMMYYYY(str: string): string | undefined {
  const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  return undefined;
}

// Clean underlying name by removing suffixes like " - Stock", " - STOCK"
function cleanUnderlying(underlying: string): string {
  return underlying
    .replace(/\s*-\s*Stock\b/i, '')
    .replace(/\s*-\s*Azione\b/i, '')
    .trim();
}

// Try to parse a EUREX/IDEM comma-separated description
// Format: "EUREX, SAP, MAR26, 182, CALL, PHYSICAL, AMER, SINGLE STOCK OPTIONS"
// or:     "IDEM, FERRARI, JUN26, 300, PUT, ..."
function parseEurexIdemDescription(description: string): {
  underlying: string;
  optionType: 'call' | 'put' | undefined;
  strikePrice: number | undefined;
  expiryDate: string | undefined;
} | null {
  const parts = description.split(',').map(p => p.trim());
  if (parts.length < 5) return null;
  
  const exchange = parts[0].toUpperCase();
  if (exchange !== 'EUREX' && exchange !== 'IDEM') return null;
  
  const underlying = parts[1].trim();
  const expiryDate = parseEurexExpiry(parts[2]);
  const strikePrice = parseFloat(parts[3]);
  const optionTypeStr = parts[4].toUpperCase().trim();
  
  let optionType: 'call' | 'put' | undefined;
  if (optionTypeStr === 'CALL') optionType = 'call';
  else if (optionTypeStr === 'PUT') optionType = 'put';
  
  return {
    underlying,
    optionType,
    strikePrice: isNaN(strikePrice) ? undefined : strikePrice,
    expiryDate,
  };
}

function parseDerivativeRow(
  row: any[],
  headers: string[]
): Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'> | null {
  // Find the description - check for EUREX/IDEM format first, then US-style OPTION CALL/PUT
  let description = '';
  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] || '').toUpperCase();
    if (cell.includes('OPTION CALL') || cell.includes('OPTION PUT') ||
        cell.startsWith('EUREX,') || cell.startsWith('IDEM,')) {
      description = String(row[i] || '');
      break;
    }
  }
  
  if (!description) return null;
  
  const descUpper = description.toUpperCase();
  
  // Get currency and exchange rate
  const currency = findColumnValue(row, headers, ['DIVISA CODICE', 'DIVISA']) || 'USD';
  const exchangeRate = parseExcelNumber(findColumnValue(row, headers, ['CAMBIO ULTIMO', 'CAMBIO', 'TASSO CAMBIO']));
  
  // Get price values
  const currentPrice = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VALORE', 'PREZZO']));
  const avgCost = parseExcelNumber(findColumnValue(row, headers, ['PREZZO MEDIO CARICO', 'PREZZO CARICO']));
  const marketValue = parseExcelNumber(findColumnValue(row, headers, ['CONTROVALORE EUR', 'CONTROVALORE']));
  const profitLoss = parseExcelNumber(findColumnValue(row, headers, ['GUADAGNO_PERDITA_EUR', 'GUADAGNO PERDITA', 'CONTROVALORE_SCOST_SU_PREZZO']));
  const profitLossPct = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VARIAZ PERC', 'VARIAZIONE %']));
  const weightPct = parseExcelNumber(findColumnValue(row, headers, ['% PATR', 'PESO %']));
  
  // Get quantity
  let quantity = parseExcelNumber(findColumnValue(row, headers, ['QUANTITA', 'QUANTITÀ']));
  
  let optionType: 'call' | 'put' | undefined;
  let strikePrice: number | undefined;
  let expiryDate: string | undefined;
  let underlying: string | undefined;
  
  // Try EUREX/IDEM comma-separated format first
  const eurexParsed = parseEurexIdemDescription(description);
  if (eurexParsed) {
    optionType = eurexParsed.optionType;
    strikePrice = eurexParsed.strikePrice;
    expiryDate = eurexParsed.expiryDate;
    underlying = eurexParsed.underlying;
    console.log(`[ExcelParser] EUREX/IDEM parsed: underlying="${underlying}", strike=${strikePrice}, expiry=${expiryDate}, type=${optionType}`);
  } else {
    // US-style: "NVIDIA CORP OPTION CALL 200 DEC/25"
    if (descUpper.includes('OPTION CALL') || descUpper.includes('CALL')) {
      optionType = 'call';
    } else if (descUpper.includes('OPTION PUT') || descUpper.includes('PUT')) {
      optionType = 'put';
    }
    
    // Parse strike price
    const strikeMatch = descUpper.match(/OPTION\s+(?:CALL|PUT)\s+(\d+(?:\.\d+)?)/);
    if (strikeMatch) {
      strikePrice = parseFloat(strikeMatch[1]);
    }
    
    // Parse expiry - try MMM/YY first, then DD/MM/YYYY
    const expiryMatch = descUpper.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(\d{2})/);
    if (expiryMatch) {
      const months: Record<string, string> = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
      };
      const year = parseInt(expiryMatch[2]) + 2000;
      expiryDate = `${year}-${months[expiryMatch[1]]}-21`;
    } else {
      // Try DD/MM/YYYY format (e.g., "20/03/2026")
      expiryDate = parseDDMMYYYY(description);
    }
    
    // Parse underlying (everything before "OPTION")
    const underlyingMatch = description.match(/^(.+?)\s+OPTION/i);
    if (underlyingMatch) {
      underlying = cleanUnderlying(underlyingMatch[1].trim());
    }
  }
  
  return {
    isin: undefined,
    ticker: undefined,
    description: description,
    asset_type: 'derivative',
    currency: String(currency),
    quantity: quantity,
    current_price: currentPrice || undefined,
    avg_cost: avgCost || undefined,
    market_value: Math.abs(marketValue) || undefined,
    profit_loss: profitLoss || undefined,
    profit_loss_pct: profitLossPct || undefined,
    weight_pct: Math.abs(weightPct) || undefined,
    option_type: optionType,
    strike_price: strikePrice,
    expiry_date: expiryDate,
    underlying,
    exchange_rate: exchangeRate || undefined,
    snapshot_price: currentPrice || undefined,
    snapshot_market_value: Math.abs(marketValue) || undefined,
  };
}

function parsePositionRow(
  row: any[],
  headers: string[],
  assetType: AssetType
): Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'> | null {
  const isin = findColumnValue(row, headers, ['ISIN']);
  const description = findColumnValue(row, headers, ['DESCRIZIONE ESTESA', 'DESCRIZIONE']);
  const currency = findColumnValue(row, headers, ['DIVISA CODICE', 'DIVISA']) || 'EUR';
  const exchangeRate = parseExcelNumber(findColumnValue(row, headers, ['CAMBIO ULTIMO', 'CAMBIO', 'TASSO CAMBIO']));
  const quantity = parseExcelNumber(findColumnValue(row, headers, ['QUANTITA', 'QUANTITÀ']));
  const currentPrice = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VALORE', 'PREZZO']));
  const avgCost = parseExcelNumber(findColumnValue(row, headers, ['PREZZO MEDIO CARICO', 'PREZZO CARICO']));
  const marketValue = parseExcelNumber(findColumnValue(row, headers, ['CONTROVALORE EUR', 'CONTROVALORE']));
  const profitLoss = parseExcelNumber(findColumnValue(row, headers, ['GUADAGNO_PERDITA_EUR', 'GUADAGNO PERDITA', 'CONTROVALORE_SCOST_SU_PREZZO']));
  const profitLossPct = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VARIAZ PERC', 'VARIAZIONE %']));
  const weightPct = parseExcelNumber(findColumnValue(row, headers, ['% PATR', 'PESO %']));
  
  if (!description && !isin) return null;
  
  // Determine the correct asset type based on description
  // Priority: bond > etf > stock
  let finalAssetType = assetType;
  if (assetType === 'stock' && description) {
    const descUpper = description.toUpperCase();
    
    // Check if it's a bond (obbligazione) based on prefix or keywords
    // "OB." prefix indicates bond, also check for common bond keywords
    if (descUpper.startsWith('OB.') || 
        descUpper.startsWith('OBB.') ||
        /\bOBBLIGAZION[EI]\b/.test(descUpper) ||
        /\bBOND\b/.test(descUpper) ||
        /\b\d+[.,]\d+%\s/.test(descUpper)) { // Pattern like "0.125%" indicates a bond coupon
      finalAssetType = 'bond';
    }
    // Use advanced ETF detection
    else if (isETF(description, isin || undefined)) {
      finalAssetType = 'etf';
    }
  }
  
  // Parse derivative specific fields
  let optionType: 'call' | 'put' | undefined;
  let strikePrice: number | undefined;
  let expiryDate: string | undefined;
  let underlying: string | undefined;
  
  if (assetType === 'derivative' && description) {
    // Try EUREX/IDEM comma-separated format first
    const eurexParsed = parseEurexIdemDescription(description);
    if (eurexParsed) {
      optionType = eurexParsed.optionType;
      strikePrice = eurexParsed.strikePrice;
      expiryDate = eurexParsed.expiryDate;
      underlying = eurexParsed.underlying;
    } else {
      const descUpper = description.toUpperCase();
      
      // Parse option type
      if (descUpper.includes('CALL')) {
        optionType = 'call';
      } else if (descUpper.includes('PUT')) {
        optionType = 'put';
      }
      
      // Parse strike price (e.g., "OPTION CALL 200")
      const strikeMatch = descUpper.match(/(?:CALL|PUT)\s+(\d+(?:\.\d+)?)/);
      if (strikeMatch) {
        strikePrice = parseFloat(strikeMatch[1]);
      }
      
      // Parse expiry - try MMM/YY first, then DD/MM/YYYY
      const expiryMatch = descUpper.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(\d{2})/);
      if (expiryMatch) {
        const months: Record<string, string> = {
          JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
          JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
        };
        const year = parseInt(expiryMatch[2]) + 2000;
        expiryDate = `${year}-${months[expiryMatch[1]]}-21`;
      } else {
        expiryDate = parseDDMMYYYY(description);
      }
      
      // Parse underlying (everything before "OPTION")
      const underlyingMatch = description.match(/^(.+?)\s+OPTION/i);
      if (underlyingMatch) {
        underlying = cleanUnderlying(underlyingMatch[1].trim());
      }
    }
  }
  
  return {
    isin: isin || undefined,
    ticker: undefined,
    description: description || 'Posizione senza descrizione',
    asset_type: finalAssetType,
    currency: String(currency),
    quantity,
    current_price: currentPrice || undefined,
    avg_cost: avgCost || undefined,
    market_value: Math.abs(marketValue) || undefined,
    profit_loss: profitLoss || undefined,
    profit_loss_pct: profitLossPct || undefined,
    weight_pct: weightPct || undefined,
    option_type: optionType,
    strike_price: strikePrice,
    expiry_date: expiryDate,
    underlying,
    exchange_rate: exchangeRate || undefined,
    snapshot_price: currentPrice || undefined,
    snapshot_market_value: Math.abs(marketValue) || undefined,
  };
}

function findColumnValue(row: any[], headers: string[], possibleNames: string[]): string | null {
  for (const name of possibleNames) {
    const index = headers.findIndex(h => h && h.includes(name));
    if (index !== -1 && row[index] !== undefined && row[index] !== null && row[index] !== '') {
      return String(row[index]);
    }
  }
  
  // Fallback: check for common positions
  // ISIN is usually at index 1
  // Description at index 2
  // etc.
  return null;
}