import * as XLSX from '@e965/xlsx';

export interface ParsedOrder {
  operation: 'buy' | 'sell';
  symbol: string;
  status: string;
  avgPrice: number;
  quantity: number;
  optionType: 'CALL' | 'PUT' | null;
  orderValue: number; // quantity * avgPrice * 100
  validityDate?: string; // Data Validità in formato DD/MM/YYYY
}

export interface OrderParseResult {
  allOrders: ParsedOrder[];
  filteredOrders: ParsedOrder[];
  totalBuys: number;
  totalSells: number;
  netPremium: number; // Sum with signs (sells positive, buys negative)
  grossPremium: number; // Absolute value of netPremium
  firstOperationDate: string | null; // Earliest validity date
}

// Column name mappings (Italian Excel format)
const COLUMN_MAPPINGS = {
  operation: ['Operazione', 'operazione', 'OPERAZIONE'],
  symbol: ['Simbolo', 'simbolo', 'SIMBOLO'],
  status: ['Stato', 'stato', 'STATO'],
  avgPrice: ['Prz Medio', 'prz medio', 'PRZ MEDIO', 'Prezzo Medio', 'prezzo medio'],
  quantity: ['Qtà Eseguita', 'qta eseguita', 'QTA ESEGUITA', 'Quantità Eseguita', 'quantità eseguita'],
  callPut: ['Call/Put', 'call/put', 'CALL/PUT', 'CallPut', 'callput'],
  validityDate: ['Data Validità', 'data validità', 'DATA VALIDITÀ', 'Data Validita', 'data validita', 'DATA VALIDITA'],
};

function findColumnIndex(headers: string[], possibleNames: string[]): number {
  for (const name of possibleNames) {
    const idx = headers.findIndex(h => h?.toLowerCase().trim() === name.toLowerCase().trim());
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse number from Italian format (comma as decimal separator)
 * Examples: "8,4" -> 8.4, "12,80" -> 12.80, "1.250,50" -> 1250.50
 * Also handles apostrophes (common in Excel exports): "'8,4" -> 8.4
 */
function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Remove whitespace, non-breaking spaces, and leading apostrophes
    let cleaned = value
      .replace(/\s/g, '')
      .replace(/\u00A0/g, '')  // non-breaking space
      .replace(/^'+/, '');     // leading apostrophes
    
    // Italian format uses . as thousands separator and , as decimal
    // Check if string contains both . and , - Italian format
    if (cleaned.includes('.') && cleaned.includes(',')) {
      // Remove thousands separator (.) and replace decimal (,) with .
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',')) {
      // Only comma - treat as decimal separator
      cleaned = cleaned.replace(',', '.');
    }
    // If only dots, assume it's already correct format
    
    const result = parseFloat(cleaned) || 0;
    return result;
  }
  return 0;
}

function normalizeOperation(value: string): 'buy' | 'sell' {
  const lower = value.toLowerCase().trim();
  if (lower === 'vendita' || lower === 'sell' || lower === 'v') {
    return 'sell';
  }
  return 'buy'; // Default to buy for 'Acquisto', 'Buy', 'A', etc.
}

function normalizeOptionType(value: string): 'CALL' | 'PUT' | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  if (upper === 'CALL' || upper === 'C') return 'CALL';
  if (upper === 'PUT' || upper === 'P') return 'PUT';
  return null;
}

/**
 * Extract ticker from option symbol (e.g., "TSLAG6C480" -> "TSLA")
 * Option symbols typically have format: TICKER + DATE_CODE + TYPE + STRIKE
 */
function extractTickerFromSymbol(symbol: string): string {
  if (!symbol) return '';
  
  // Common patterns:
  // TSLAG6C480 -> TSLA (4 chars before date code)
  // NVDAG6C150 -> NVDA
  // GOOGG6C180 -> GOOG
  // MSFTG6C400 -> MSFT
  
  // Look for pattern: letters followed by letter+digit (month code)
  const match = symbol.match(/^([A-Z]{1,5})[A-Z]\d/i);
  if (match) {
    return match[1].toUpperCase();
  }
  
  // Fallback: take first 4 characters if they're all letters
  const prefix = symbol.substring(0, 4);
  if (/^[A-Z]+$/i.test(prefix)) {
    return prefix.toUpperCase();
  }
  
  return symbol.toUpperCase();
}

/**
 * Check if a symbol matches the target ticker
 */
export function symbolMatchesTicker(symbol: string, ticker: string): boolean {
  if (!symbol || !ticker) return false;
  
  const extractedTicker = extractTickerFromSymbol(symbol);
  return extractedTicker.toUpperCase() === ticker.toUpperCase();
}

/**
 * Try to parse HTML table from text content
 */
function parseHtmlTable(htmlContent: string): any[][] {
  const rows: any[][] = [];
  
  // Find all table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  
  let rowMatch;
  while ((rowMatch = rowRegex.exec(htmlContent)) !== null) {
    const rowContent = rowMatch[1];
    const cells: any[] = [];
    
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      // Clean HTML tags and decode entities
      let cellValue = cellMatch[1]
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/^'+/, '') // Remove leading apostrophes (common in Italian Excel)
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      
      cells.push(cellValue);
    }
    
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  
  return rows;
}

/**
 * Parse date from Italian format (DD/MM/YYYY or DD-MM-YYYY)
 * Returns ISO date string or null
 * Exported so UI can reuse the same logic when recalculating after row removal
 */
export function toIsoDateFromIT(value: string | undefined | null): string | null {
  if (!value) return null;
  
  // Remove leading apostrophes (common in Italian Excel exports) and trim
  const cleaned = value.trim().replace(/^'+/, '');
  
  // Try DD/MM/YYYY or DD-MM-YYYY
  const match = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Find the earliest date from a list of validity date strings (Italian format)
 * Exported so UI can reuse the same logic when recalculating after row removal
 */
export function findFirstOperationDate(validityDates: (string | undefined)[]): string | null {
  const isoDates = validityDates
    .map(d => toIsoDateFromIT(d))
    .filter((d): d is string => d !== null);
  
  if (isoDates.length === 0) return null;
  return isoDates.sort()[0]; // ISO dates sort correctly as strings
}

/**
 * Find the most recent date from a list of validity date strings (Italian format)
 * Used for showing "Data ultima operazione" in the UI
 */
export function findLastOperationDate(validityDates: (string | undefined)[]): string | null {
  const isoDates = validityDates
    .map(d => toIsoDateFromIT(d))
    .filter((d): d is string => d !== null);
  
  if (isoDates.length === 0) return null;
  return isoDates.sort().reverse()[0]; // Most recent date
}

/**
 * Generate a unique key for an order for deduplication purposes
 * Used when merging orders from multiple Excel files
 */
export function orderKey(o: ParsedOrder): string {
  return `${o.symbol}|${o.operation}|${o.avgPrice}|${o.quantity}|${o.validityDate || ''}`;
}

/**
 * Merge new orders with existing ones, avoiding duplicates
 */
export function mergeOrders(existingOrders: ParsedOrder[], newOrders: ParsedOrder[]): ParsedOrder[] {
  const merged = [...existingOrders];
  const existingKeys = new Set(existingOrders.map(orderKey));
  
  for (const newOrder of newOrders) {
    if (!existingKeys.has(orderKey(newOrder))) {
      merged.push(newOrder);
    }
  }
  
  return merged;
}

/**
 * Check if the content appears to be HTML (table-based Excel export)
 * Extended detection to catch files starting with <table> or containing HTML tags
 */
function isHtmlContent(textData: string): boolean {
  const trimmed = textData.trim().toLowerCase();
  
  // Direct HTML document indicators
  if (trimmed.startsWith('<html') || trimmed.startsWith('<!doctype')) {
    return true;
  }
  
  // Table-only HTML (common Italian broker export format)
  if (trimmed.startsWith('<table')) {
    return true;
  }
  
  // Frameset HTML (old Excel web exports)
  if (trimmed.startsWith('<frameset') || textData.includes('<frameset')) {
    return true;
  }
  
  // Microsoft Office Excel namespace
  if (textData.includes('xmlns:x="urn:schemas-microsoft-com:office:excel"')) {
    return true;
  }
  
  // Contains typical HTML table structure tags
  if (textData.includes('<table') && textData.includes('<tr') && textData.includes('<td')) {
    return true;
  }
  
  return false;
}

/**
 * Check if parsed prices look suspicious (likely wrong decimal parsing)
 * Returns true if prices seem implausibly high for options
 */
function hasSuspiciousPrices(orders: ParsedOrder[]): boolean {
  if (orders.length === 0) return false;
  
  // Count how many prices are suspiciously high (>= 500 for options is very unusual)
  const suspiciousCount = orders.filter(o => o.avgPrice >= 500).length;
  
  // If more than 30% of prices are suspicious, likely parsing error
  return suspiciousCount > orders.length * 0.3;
}

/**
 * Parse orders from raw text data (pure function for testing)
 * This is the core parsing logic without FileReader
 */
export function parseOrdersFromTextData(textData: string): ParsedOrder[] {
  let rawData: any[][] = [];
  const shouldParseAsHtml = isHtmlContent(textData);
  
  if (shouldParseAsHtml) {
    if (import.meta.env.DEV) {
      console.log('[orderFileParser] Detected HTML-based Excel, parsing as HTML table');
    }
    rawData = parseHtmlTable(textData);
    
    // If HTML parsing didn't yield enough data, try xlsx as fallback
    if (rawData.length < 2) {
      if (import.meta.env.DEV) {
        console.log('[orderFileParser] HTML parsing yielded insufficient data, trying xlsx fallback');
      }
      try {
        const workbook = XLSX.read(textData, { type: 'string' });
        for (const name of workbook.SheetNames) {
          const ws = workbook.Sheets[name];
          const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as any[][];
          if (sheetData.length > rawData.length) {
            rawData = sheetData;
          }
        }
      } catch (xlsxErr) {
        if (import.meta.env.DEV) {
          console.warn('[orderFileParser] XLSX fallback also failed:', xlsxErr);
        }
      }
    }
  } else {
    // Try standard xlsx parsing with raw: false to preserve string formatting
    try {
      const workbook = XLSX.read(textData, { type: 'string' });
      for (const name of workbook.SheetNames) {
        const ws = workbook.Sheets[name];
        const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as any[][];
        if (sheetData.length > rawData.length) {
          rawData = sheetData;
        }
      }
    } catch {
      // If string parsing fails, the caller should try binary
      throw new Error('PARSE_AS_BINARY');
    }
  }
  
  return parseOrdersFromRawData(rawData, textData);
}

/**
 * Parse orders from raw 2D array data
 */
function parseOrdersFromRawData(rawData: any[][], originalTextData?: string): ParsedOrder[] {
  if (rawData.length < 2) {
    throw new Error('Nessun dato trovato nel file');
  }
  
  // First row is headers - handle potential empty cells and apostrophes
  const headers = rawData[0].map(h => String(h || '').trim().replace(/^'+/, ''));
  
  if (import.meta.env.DEV) {
    console.log('[orderFileParser] Headers found:', headers);
  }
  
  // Find column indices
  const colIndices = {
    operation: findColumnIndex(headers, COLUMN_MAPPINGS.operation),
    symbol: findColumnIndex(headers, COLUMN_MAPPINGS.symbol),
    status: findColumnIndex(headers, COLUMN_MAPPINGS.status),
    avgPrice: findColumnIndex(headers, COLUMN_MAPPINGS.avgPrice),
    quantity: findColumnIndex(headers, COLUMN_MAPPINGS.quantity),
    callPut: findColumnIndex(headers, COLUMN_MAPPINGS.callPut),
    validityDate: findColumnIndex(headers, COLUMN_MAPPINGS.validityDate),
  };
  
  // Validate required columns
  if (colIndices.operation === -1 || colIndices.symbol === -1 || 
      colIndices.status === -1 || colIndices.avgPrice === -1 || 
      colIndices.quantity === -1) {
    throw new Error(`File non valido: colonne richieste non trovate. Headers: ${headers.join(', ')}`);
  }
  
  const orders: ParsedOrder[] = [];
  
  // Parse data rows (skip header)
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    const status = String(row[colIndices.status] || '').trim();
    const operation = normalizeOperation(String(row[colIndices.operation] || ''));
    const symbol = String(row[colIndices.symbol] || '').replace(/'/g, '').trim();
    const avgPrice = parseNumber(row[colIndices.avgPrice]);
    const quantity = parseNumber(row[colIndices.quantity]);
    const optionType = colIndices.callPut !== -1 
      ? normalizeOptionType(String(row[colIndices.callPut] || ''))
      : null;
    const validityDateRaw = colIndices.validityDate !== -1
      ? String(row[colIndices.validityDate] || '').trim()
      : undefined;
    
    // Skip rows with no symbol or quantity
    if (!symbol || quantity === 0) continue;
    
    // Calculate order value (quantity * avgPrice * 100 for options)
    const orderValue = quantity * avgPrice * 100;
    
    orders.push({
      operation,
      symbol,
      status,
      avgPrice,
      quantity,
      optionType,
      orderValue,
      validityDate: validityDateRaw,
    });
  }
  
  // SANITY CHECK: If prices look suspicious and we have HTML content, re-parse as HTML
  if (hasSuspiciousPrices(orders) && originalTextData && isHtmlContent(originalTextData)) {
    if (import.meta.env.DEV) {
      console.warn('[orderFileParser] Suspicious prices detected, re-parsing as HTML table');
    }
    const htmlData = parseHtmlTable(originalTextData);
    if (htmlData.length >= 2) {
      const reprocessed = parseOrdersFromRawData(htmlData);
      // Only use reprocessed if it has valid data and better prices
      if (reprocessed.length > 0 && !hasSuspiciousPrices(reprocessed)) {
        return reprocessed;
      }
    }
  }
  
  if (import.meta.env.DEV) {
    console.log(`[orderFileParser] Parsed ${orders.length} orders`);
  }
  
  return orders;
}

/**
 * Parse Excel file (XLS/XLSX) and extract order data
 */
export async function parseOrderFile(file: File): Promise<ParsedOrder[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const textData = new TextDecoder().decode(data as ArrayBuffer);
        
        // Try text-based parsing first (handles HTML and string-based xlsx)
        try {
          const orders = parseOrdersFromTextData(textData);
          resolve(orders);
          return;
        } catch (textErr) {
          // If it needs binary parsing, continue below
          if (textErr instanceof Error && textErr.message !== 'PARSE_AS_BINARY') {
            reject(textErr);
            return;
          }
        }
        
        // Standard Excel binary format fallback
        let workbook;
        try {
          workbook = XLSX.read(data, { type: 'array' });
        } catch {
          try {
            workbook = XLSX.read(data, { type: 'binary' });
          } catch (err) {
            console.error('Failed to parse as binary Excel:', err);
            reject(new Error('Formato file non supportato. Usa .xlsx o esporta come "Cartella di lavoro Excel".'));
            return;
          }
        }
        
        // Get best sheet with most data
        let rawData: any[][] = [];
        for (const name of workbook.SheetNames) {
          const ws = workbook.Sheets[name];
          // Use raw: false to get formatted strings instead of coerced numbers
          const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as any[][];
          if (sheetData.length > rawData.length) {
            rawData = sheetData;
          }
        }
        
        const orders = parseOrdersFromRawData(rawData, textData);
        resolve(orders);
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        reject(error instanceof Error ? error : new Error('Errore durante la lettura del file'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Errore durante la lettura del file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract strike price from option symbol
 * BABAH6C165 → 165
 * TSLAG6P350 → 350
 */
export function extractStrikeFromSymbol(symbol: string): number | null {
  const match = symbol.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Filter orders for a specific ticker's CALL options and calculate premiums
 * Optionally filters out LEAP calls (buy-only with high strike)
 */
export function filterAndCalculateCallPremiums(
  orders: ParsedOrder[],
  ticker: string,
  underlyingPrice?: number
): OrderParseResult {
  // Step 1: Filter for executed CALL orders matching the ticker
  const baseFiltered = orders.filter(order => {
    const isExecuted = order.status.toLowerCase() === 'eseguito';
    const isCall = order.optionType === 'CALL';
    const matchesTicker = symbolMatchesTicker(order.symbol, ticker);
    return isExecuted && isCall && matchesTicker;
  });
  
  // Step 2: Identify symbols that have at least one sell (Covered Call or rolling)
  const symbolsWithSells = new Set<string>();
  for (const order of baseFiltered) {
    if (order.operation === 'sell') {
      symbolsWithSells.add(order.symbol);
    }
  }
  
  // Step 3: Filter out buy-only CALLs (LEAP / Long Call)
  // Any CALL symbol without at least one sell operation is excluded
  const filteredOrders = baseFiltered.filter(order => {
    // If the symbol has at least one sell → keep everything (Covered Call or rolling)
    if (symbolsWithSells.has(order.symbol)) {
      return true;
    }
    // Only buys for this symbol → exclude (LEAP or Long Call)
    if (import.meta.env.DEV) {
      console.log(`[LEAP filter] Excluded buy-only CALL ${order.symbol}`);
    }
    return false;
  });
  
  let totalBuys = 0;
  let totalSells = 0;
  let netPremium = 0;
  
  filteredOrders.forEach(order => {
    if (order.operation === 'sell') {
      totalSells++;
      netPremium += order.orderValue; // Positive for sells
    } else {
      totalBuys++;
      netPremium -= order.orderValue; // Negative for buys
    }
  });
  
  // Find earliest operation date from filtered orders using the unified utility
  const firstOperationDate = findFirstOperationDate(filteredOrders.map(o => o.validityDate));
  
  return {
    allOrders: orders,
    filteredOrders,
    totalBuys,
    totalSells,
    netPremium,
    grossPremium: Math.abs(netPremium),
    firstOperationDate,
  };
}

/**
 * Calculate premium metrics
 */
export interface PremiumMetrics {
  ordersFound: number;
  buys: number;
  sells: number;
  grossPremium: number;
  commissions: number;
  netPremium: number;
  grossPerShare: number; // grossPremium / (contracts * 100)
  netPerShare: number;   // netPremium / (contracts * 100)
  firstOperationDate: string | null;
  yieldPct: number;           // netPerShare / underlyingPrice * 100
  annualizedYieldPct: number; // yieldPct * (365 / days)
}

export function calculatePremiumMetrics(
  parseResult: OrderParseResult,
  transactionCost: number,
  contractsInPortfolio: number,
  underlyingPrice: number = 0
): PremiumMetrics {
  const ordersFound = parseResult.filteredOrders.length;
  const commissions = ordersFound * transactionCost;
  const netPremium = parseResult.grossPremium - commissions;
  
  const totalShares = contractsInPortfolio * 100;
  const grossPerShare = totalShares > 0 ? parseResult.grossPremium / totalShares : 0;
  const netPerShare = totalShares > 0 ? netPremium / totalShares : 0;
  
  // Calculate yield %
  const yieldPct = underlyingPrice > 0 ? (netPerShare / underlyingPrice) * 100 : 0;
  
  // Calculate annualized yield (regardless of yieldPct sign)
  let annualizedYieldPct = 0;
  if (parseResult.firstOperationDate) {
    const firstDate = new Date(parseResult.firstOperationDate);
    const today = new Date();
    const diffTime = today.getTime() - firstDate.getTime();
    const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    annualizedYieldPct = yieldPct * (365 / diffDays);
  }
  
  return {
    ordersFound,
    buys: parseResult.totalBuys,
    sells: parseResult.totalSells,
    grossPremium: parseResult.grossPremium,
    commissions,
    netPremium,
    grossPerShare,
    netPerShare,
    firstOperationDate: parseResult.firstOperationDate,
    yieldPct,
    annualizedYieldPct,
  };
}
