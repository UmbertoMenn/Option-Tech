import * as XLSX from 'xlsx';

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
 */
function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Remove whitespace
    let cleaned = value.replace(/\s/g, '');
    
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
    
    return parseFloat(cleaned) || 0;
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
 */
function parseDateIT(value: string): string | null {
  if (!value) return null;
  
  const cleaned = value.trim();
  
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
 * Find the earliest date from a list of ISO date strings
 */
function findEarliestDate(dates: (string | null)[]): string | null {
  const validDates = dates.filter((d): d is string => d !== null);
  if (validDates.length === 0) return null;
  
  return validDates.sort()[0]; // ISO dates sort correctly as strings
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
        
        // Check if this is an HTML file (common for old Excel exports)
        const isHtmlFile = textData.trim().toLowerCase().startsWith('<html') || 
                          textData.trim().toLowerCase().startsWith('<!doctype') ||
                          textData.includes('xmlns:x="urn:schemas-microsoft-com:office:excel"');
        
        let rawData: any[][] = [];
        
        if (isHtmlFile) {
          console.log('Detected HTML-based Excel file, parsing as HTML...');
          
          // Try to extract table data directly from HTML
          rawData = parseHtmlTable(textData);
          
          // If no data from HTML parsing, try xlsx library anyway
          if (rawData.length < 2) {
            console.log('HTML parsing yielded no data, trying xlsx library...');
            try {
              const workbook = XLSX.read(textData, { type: 'string' });
              for (const name of workbook.SheetNames) {
                const ws = workbook.Sheets[name];
                const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
                if (sheetData.length > rawData.length) {
                  rawData = sheetData;
                }
              }
            } catch (xlsxErr) {
              console.warn('XLSX parsing also failed:', xlsxErr);
            }
          }
        } else {
          // Standard Excel binary format
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
          for (const name of workbook.SheetNames) {
            const ws = workbook.Sheets[name];
            const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            if (sheetData.length > rawData.length) {
              rawData = sheetData;
            }
          }
        }
        
        if (rawData.length < 2) {
          console.warn('No data found in file. This may be a frameset HTML file that references external sheets.');
          reject(new Error('Nessun dato trovato. Se il file è in formato "Pagina Web", salvalo come "Cartella di lavoro Excel (.xlsx)" e riprova.'));
          return;
        }
        
        console.log(`Found ${rawData.length} rows in file`);
        console.log('First row (headers):', rawData[0]);
        
        // First row is headers - handle potential empty cells
        const headers = rawData[0].map(h => String(h || '').trim());
        
        console.log('Excel headers found:', headers);
        
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
        
        console.log('Column indices:', colIndices);
        
        // Validate required columns
        if (colIndices.operation === -1 || colIndices.symbol === -1 || 
            colIndices.status === -1 || colIndices.avgPrice === -1 || 
            colIndices.quantity === -1) {
          console.error('Missing required columns:', colIndices);
          console.error('Available headers:', headers);
          reject(new Error(`File non valido: colonne richieste non trovate. Headers: ${headers.join(', ')}`));
          return;
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
        
        console.log(`Parsed ${orders.length} orders from Excel`);
        resolve(orders);
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        reject(new Error('Errore durante la lettura del file'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Errore durante la lettura del file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Filter orders for a specific ticker's CALL options and calculate premiums
 */
export function filterAndCalculateCallPremiums(
  orders: ParsedOrder[],
  ticker: string
): OrderParseResult {
  // Filter for executed CALL orders matching the ticker
  const filteredOrders = orders.filter(order => {
    const isExecuted = order.status.toLowerCase() === 'eseguito';
    const isCall = order.optionType === 'CALL';
    const matchesTicker = symbolMatchesTicker(order.symbol, ticker);
    
    return isExecuted && isCall && matchesTicker;
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
  
  // Find earliest operation date from filtered orders
  const dates = filteredOrders.map(o => o.validityDate ? parseDateIT(o.validityDate) : null);
  const firstOperationDate = findEarliestDate(dates);
  
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
  
  // Calculate annualized yield
  let annualizedYieldPct = 0;
  if (parseResult.firstOperationDate && yieldPct > 0) {
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
