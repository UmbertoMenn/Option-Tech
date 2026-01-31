import { Position, AssetType } from '@/types/portfolio';
import { parseExcelNumber, parseExcelDate } from './formatters';

interface ExcelRow {
  [key: string]: string | number | null | undefined;
}

export async function parsePortfolioExcel(file: File): Promise<{
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[];
  cashValue: number;
  snapshotDate: string | null;
}> {
  // Dynamic import of xlsx library
  const XLSX = await import('xlsx');
  
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
        const result = parsePortfolioData(jsonData);
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

function parsePortfolioData(rows: any[][]): {
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
    } else if (firstCell.includes('TITOLI DI STATO')) {
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
      const value = findColumnValue(row, headerRow, ['VALORIZZAZIONE EUR', 'VALORIZZAZIONE IN DIVISA']);
      if (value) {
        cashValue += parseExcelNumber(value);
      }
      continue;
    }
    
    // Special handling for derivatives - description might be in column 2 (index 2) without ISIN
    if (isDerivativeSection) {
      // Check if this row contains an option (look for OPTION CALL/PUT pattern in any cell)
      const rowStr = row.map(cell => String(cell || '')).join(' ').toUpperCase();
      if (rowStr.includes('OPTION CALL') || rowStr.includes('OPTION PUT')) {
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

function parseDerivativeRow(
  row: any[],
  headers: string[]
): Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'> | null {
  // Find the description - it's usually in column 2 (index 2) for derivatives
  let description = '';
  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] || '').toUpperCase();
    if (cell.includes('OPTION CALL') || cell.includes('OPTION PUT')) {
      description = String(row[i] || '');
      break;
    }
  }
  
  if (!description) return null;
  
  const descUpper = description.toUpperCase();
  
  // Get currency
  const currency = findColumnValue(row, headers, ['DIVISA CODICE', 'DIVISA']) || 'USD';
  
  // Get price values
  const currentPrice = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VALORE', 'PREZZO']));
  const avgCost = parseExcelNumber(findColumnValue(row, headers, ['PREZZO MEDIO CARICO', 'PREZZO CARICO']));
  const marketValue = parseExcelNumber(findColumnValue(row, headers, ['CONTROVALORE EUR', 'CONTROVALORE']));
  const profitLoss = parseExcelNumber(findColumnValue(row, headers, ['GUADAGNO_PERDITA_EUR', 'GUADAGNO PERDITA', 'CONTROVALORE_SCOST_SU_PREZZO']));
  const profitLossPct = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VARIAZ PERC', 'VARIAZIONE %']));
  const weightPct = parseExcelNumber(findColumnValue(row, headers, ['% PATR', 'PESO %']));
  
  // Get quantity - for derivatives it might be in QUANTITA column
  let quantity = parseExcelNumber(findColumnValue(row, headers, ['QUANTITA', 'QUANTITÀ']));
  
  // Parse option type
  let optionType: 'call' | 'put' | undefined;
  if (descUpper.includes('OPTION CALL') || descUpper.includes('CALL')) {
    optionType = 'call';
  } else if (descUpper.includes('OPTION PUT') || descUpper.includes('PUT')) {
    optionType = 'put';
  }
  
  // Parse strike price (e.g., "OPTION CALL 200", "OPTION PUT 125")
  let strikePrice: number | undefined;
  const strikeMatch = descUpper.match(/OPTION\s+(?:CALL|PUT)\s+(\d+(?:\.\d+)?)/);
  if (strikeMatch) {
    strikePrice = parseFloat(strikeMatch[1]);
  }
  
  // Parse expiry (e.g., "DEC/25", "JUN/26", "DEC/27")
  let expiryDate: string | undefined;
  const expiryMatch = descUpper.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(\d{2})/);
  if (expiryMatch) {
    const months: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
    };
    const year = parseInt(expiryMatch[2]) + 2000;
    expiryDate = `${year}-${months[expiryMatch[1]]}-21`; // Third Friday approximation
  }
  
  // Parse underlying (everything before "OPTION")
  let underlying: string | undefined;
  const underlyingMatch = description.match(/^(.+?)\s+OPTION/i);
  if (underlyingMatch) {
    underlying = underlyingMatch[1].trim();
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
  const quantity = parseExcelNumber(findColumnValue(row, headers, ['QUANTITA', 'QUANTITÀ']));
  const currentPrice = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VALORE', 'PREZZO']));
  const avgCost = parseExcelNumber(findColumnValue(row, headers, ['PREZZO MEDIO CARICO', 'PREZZO CARICO']));
  const marketValue = parseExcelNumber(findColumnValue(row, headers, ['CONTROVALORE EUR', 'CONTROVALORE']));
  const profitLoss = parseExcelNumber(findColumnValue(row, headers, ['GUADAGNO_PERDITA_EUR', 'GUADAGNO PERDITA', 'CONTROVALORE_SCOST_SU_PREZZO']));
  const profitLossPct = parseExcelNumber(findColumnValue(row, headers, ['PREZZO VARIAZ PERC', 'VARIAZIONE %']));
  const weightPct = parseExcelNumber(findColumnValue(row, headers, ['% PATR', 'PESO %']));
  
  if (!description && !isin) return null;
  
  // Determine if it's an ETF based on description
  // Use word boundary regex to avoid false positives like "NETFLIX" containing "ETF"
  let finalAssetType = assetType;
  if (assetType === 'stock' && description) {
    const descUpper = description.toUpperCase();
    // Match ETF or UCITS as whole words only, not as substrings
    if (/\bETF\b/.test(descUpper) || /\bUCITS\b/.test(descUpper)) {
      finalAssetType = 'etf';
    }
  }
  
  // Parse derivative specific fields
  let optionType: 'call' | 'put' | undefined;
  let strikePrice: number | undefined;
  let expiryDate: string | undefined;
  let underlying: string | undefined;
  
  if (assetType === 'derivative' && description) {
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
    
    // Parse expiry (e.g., "DEC/25", "JUN/26")
    const expiryMatch = descUpper.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/(\d{2})/);
    if (expiryMatch) {
      const months: Record<string, string> = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
      };
      const year = parseInt(expiryMatch[2]) + 2000;
      expiryDate = `${year}-${months[expiryMatch[1]]}-21`; // Third Friday approximation
    }
    
    // Parse underlying (everything before "OPTION")
    const underlyingMatch = description.match(/^(.+?)\s+OPTION/i);
    if (underlyingMatch) {
      underlying = underlyingMatch[1].trim();
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