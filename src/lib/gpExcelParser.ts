/**
 * Parser for Gestioni Patrimoniali (GP) Excel files.
 * Recognizes sections: "Liquidità", "-> Azioni", "-> Obbligazioni"
 * Extracts individual holdings with asset_type, market_value, currency, etc.
 */
import * as XLSX from '@e965/xlsx';

export interface GPHolding {
  asset_type: 'stock' | 'bond' | 'cash';
  description: string;
  quantity: number;
  market_value: number;
  price: number | null;
  currency: string;
  exchange_rate: number;
  weight_pct: number | null;
  ticker_code: string | null;
  price_date: string | null; // YYYY-MM-DD
}

export interface GPParseResult {
  holdings: GPHolding[];
  cashValue: number;
  totalValue: number;
}

function parseItalianNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  // Handle Italian format: 1.234,56 → 1234.56
  const cleaned = str.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseDate(val: any): string | null {
  if (!val) return null;
  const str = String(val).trim();
  // Format: DD/MM/YYYY
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  return null;
}

/**
 * Detect if a row is a header row (contains "Cod. Tit." or similar)
 */
function isHeaderRow(row: any[]): boolean {
  const first = String(row[0] || '').trim().toLowerCase();
  return first === 'cod. tit.' || first === 'cod.tit.';
}

/**
 * Detect if a row is a totals row
 */
function isTotalRow(row: any[]): boolean {
  const first = String(row[0] || '').trim().toLowerCase();
  return first.startsWith('totale');
}

/**
 * Detect section type from section header row
 */
function detectSection(row: any[]): 'cash' | 'stock' | 'bond' | null {
  const text = row.map(c => String(c || '').trim().toLowerCase()).join(' ');
  if (text.includes('liquidit')) return 'cash';
  if (text.includes('-> azioni') || text.includes('azioni')) return 'stock';
  if (text.includes('-> obbligazioni') || text.includes('obbligazioni')) return 'bond';
  return null;
}

/**
 * Detect currency from section header (e.g., "Euro -> Azioni", "USD -> Azioni")
 */
function detectCurrencyFromSection(row: any[]): string {
  const text = row.map(c => String(c || '').trim()).join(' ');
  if (/USD\s*->/i.test(text)) return 'USD';
  if (/GBP\s*->/i.test(text)) return 'GBP';
  if (/CHF\s*->/i.test(text)) return 'CHF';
  if (/JPY\s*->/i.test(text)) return 'JPY';
  // "Liquidità" or "Euro -> ..." defaults to EUR
  return 'EUR';
}

export function parseGPExcel(file: File): Promise<GPParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error('File vuoto');

        // Check if .xls is actually HTML-based (same logic as excelParser)
        let workbook: XLSX.WorkBook;
        const arrayBuffer = data as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer.slice(0, 20));
        const header = String.fromCharCode(...bytes);
        
        if (header.startsWith('<') || header.startsWith('\r\n<') || header.startsWith('\n<')) {
          const textDecoder = new TextDecoder('utf-8');
          const htmlContent = textDecoder.decode(arrayBuffer);
          workbook = XLSX.read(htmlContent, { type: 'string', raw: true });
        } else {
          workbook = XLSX.read(arrayBuffer, { type: 'array' });
        }

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('Foglio non trovato');

        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
        
        const holdings: GPHolding[] = [];
        let cashValue = 0;
        let totalValue = 0;
        let currentSection: 'cash' | 'stock' | 'bond' | null = null;
        let currentCurrency = 'EUR';
        let inDataRows = false; // true after seeing header row

        for (const row of rows) {
          if (!row || row.length === 0) continue;
          
          const firstCell = String(row[0] || '').trim();
          if (!firstCell) continue;

          // Check for section header
          const section = detectSection(row);
          if (section !== null) {
            currentSection = section;
            currentCurrency = detectCurrencyFromSection(row);
            inDataRows = false;
            continue;
          }

          // Check for column header row
          if (isHeaderRow(row)) {
            inDataRows = true;
            continue;
          }

          // Check for total row
          if (isTotalRow(row)) {
            inDataRows = false;
            continue;
          }

          // Skip if not in data rows or no section detected
          if (!inDataRows || !currentSection) continue;

          // Parse data row
          // Columns: Cod. Tit. | Descrizione | Quantita | Controvalore | % Patr. | Quotazione | Data quotaz. | Cambio | ...
          const tickerCode = String(row[0] || '').trim() || null;
          const description = String(row[1] || '').trim();
          if (!description) continue;

          const quantity = parseItalianNumber(row[2]);
          const marketValue = parseItalianNumber(row[3]);
          const weightPct = parseItalianNumber(row[4]) || null;
          const price = parseItalianNumber(row[5]) || null;
          const priceDate = parseDate(row[6]);
          const exchangeRate = parseItalianNumber(row[7]) || 1;

          if (marketValue === 0 && quantity === 0) continue;

          if (currentSection === 'cash') {
            cashValue += marketValue;
          }

          totalValue += marketValue;

          holdings.push({
            asset_type: currentSection,
            description,
            quantity,
            market_value: marketValue,
            price,
            currency: currentCurrency,
            exchange_rate: exchangeRate,
            weight_pct: weightPct,
            ticker_code: tickerCode,
            price_date: priceDate,
          });
        }

        console.log('[GPParser] Parsed result:', {
          holdingsCount: holdings.length,
          cashValue,
          totalValue,
          byType: {
            stock: holdings.filter(h => h.asset_type === 'stock').length,
            bond: holdings.filter(h => h.asset_type === 'bond').length,
            cash: holdings.filter(h => h.asset_type === 'cash').length,
          }
        });

        resolve({ holdings, cashValue, totalValue });
      } catch (err) {
        console.error('[GPParser] Error:', err);
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Errore lettura file'));
    reader.readAsArrayBuffer(file);
  });
}
