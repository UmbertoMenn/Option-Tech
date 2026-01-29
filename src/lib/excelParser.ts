import { Position, AssetType } from '@/types/portfolio';
import { parseExcelNumber, parseExcelDate } from './formatters';

interface ExcelRow {
  [key: string]: string | number | null | undefined;
}

export async function parsePortfolioExcel(file: File): Promise<{
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[];
  cashValue: number;
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
        
        const result = parsePortfolioData(jsonData);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Errore lettura file'));
    reader.readAsArrayBuffer(file);
  });
}

function parsePortfolioData(rows: any[][]): {
  positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[];
  cashValue: number;
} {
  const positions: Omit<Position, 'id' | 'portfolio_id' | 'created_at' | 'updated_at'>[] = [];
  let cashValue = 0;
  let currentSection: AssetType | null = null;
  let headerRow: string[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const firstCell = String(row[0] || '').toUpperCase();
    
    // Detect section headers
    if (firstCell.includes('LIQUIDIT')) {
      currentSection = 'cash';
      continue;
    } else if (firstCell.includes('TITOLI DI STATO')) {
      currentSection = 'bond';
      continue;
    } else if (firstCell.includes('AZIONI ED ETF') || firstCell.includes('AZIONI E ETF')) {
      currentSection = 'stock';
      continue;
    } else if (firstCell.includes('DERIVATI')) {
      currentSection = 'derivative';
      continue;
    } else if (firstCell.includes('ALTRO') || firstCell.includes('MATERIE PRIME') || firstCell.includes('COMMODIT')) {
      currentSection = 'commodity';
      continue;
    }
    
    // Detect header row
    if (firstCell.includes('CODICE_VALORE') || firstCell.includes('ISIN') || firstCell === 'CONTO') {
      headerRow = row.map(cell => String(cell || '').toUpperCase());
      continue;
    }
    
    // Skip totals and empty rows
    if (firstCell.includes('TOTALE') || firstCell === '' || !currentSection) {
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
    
    // Parse position data
    const position = parsePositionRow(row, headerRow, currentSection);
    if (position && position.description) {
      positions.push(position);
    }
  }
  
  return { positions, cashValue };
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
  let finalAssetType = assetType;
  if (assetType === 'stock' && description) {
    const descUpper = description.toUpperCase();
    if (descUpper.includes('ETF') || descUpper.includes('UCITS')) {
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