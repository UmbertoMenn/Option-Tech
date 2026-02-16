import { describe, it, expect } from 'vitest';
import { parseOrdersFromTextData, toIsoDateFromIT, findFirstOperationDate, filterAndCalculateCallPremiums, extractStrikeFromSymbol, ParsedOrder } from '@/lib/orderFileParser';

/**
 * Regression test for Italian decimal format in HTML-based Excel files
 * This test ensures that prices like "8,4" are parsed as 8.4 (not 84)
 */

// Sample HTML table content mimicking the actual OrderStatus export format
const SAMPLE_HTML_XLS = `<table>
<tr>
<td>Operazione</td>
<td>Simbolo</td>
<td>Stato</td>
<td>Prz Medio</td>
<td>Qtà Eseguita</td>
<td>Call/Put</td>
<td>Data Validità</td>
</tr>
<tr>
<td>Vendita</td>
<td>BABAH6C165</td>
<td>Eseguito</td>
<td>8,4</td>
<td>1</td>
<td>CALL</td>
<td>'06/02/2026</td>
</tr>
<tr>
<td>Vendita</td>
<td>BABAM6C180</td>
<td>Eseguito</td>
<td>14,95</td>
<td>1</td>
<td>CALL</td>
<td>'12/11/2025</td>
</tr>
<tr>
<td>Vendita</td>
<td>BABAK6C170</td>
<td>Eseguito</td>
<td>12,80</td>
<td>1</td>
<td>CALL</td>
<td>'15/01/2026</td>
</tr>
<tr>
<td>Acquisto</td>
<td>BABAK6C170</td>
<td>Eseguito</td>
<td>2,12</td>
<td>1</td>
<td>CALL</td>
<td>'10/02/2026</td>
</tr>
</table>`;

describe('orderFileParser - HTML XLS Italian format', () => {
  describe('parseOrdersFromTextData', () => {
    it('should correctly parse Italian decimal prices (comma as decimal separator)', () => {
      const orders = parseOrdersFromTextData(SAMPLE_HTML_XLS);
      
      expect(orders).toHaveLength(4);
      
      // Check first order: 8,4 should be 8.4 (NOT 84)
      const order1 = orders.find(o => o.symbol === 'BABAH6C165');
      expect(order1).toBeDefined();
      expect(order1!.avgPrice).toBeCloseTo(8.4, 2);
      expect(order1!.orderValue).toBeCloseTo(840, 0); // 1 * 8.4 * 100 = 840
      
      // Check second order: 14,95 should be 14.95 (NOT 1495)
      const order2 = orders.find(o => o.symbol === 'BABAM6C180');
      expect(order2).toBeDefined();
      expect(order2!.avgPrice).toBeCloseTo(14.95, 2);
      expect(order2!.orderValue).toBeCloseTo(1495, 0); // 1 * 14.95 * 100 = 1495
      
      // Check third order: 12,80 should be 12.80 (NOT 1280)
      const order3 = orders.find(o => o.symbol === 'BABAK6C170' && o.operation === 'sell');
      expect(order3).toBeDefined();
      expect(order3!.avgPrice).toBeCloseTo(12.80, 2);
      
      // Check fourth order (buy): 2,12 should be 2.12 (NOT 212)
      const order4 = orders.find(o => o.symbol === 'BABAK6C170' && o.operation === 'buy');
      expect(order4).toBeDefined();
      expect(order4!.avgPrice).toBeCloseTo(2.12, 2);
    });
    
    it('should correctly extract operation type', () => {
      const orders = parseOrdersFromTextData(SAMPLE_HTML_XLS);
      
      const sells = orders.filter(o => o.operation === 'sell');
      const buys = orders.filter(o => o.operation === 'buy');
      
      expect(sells).toHaveLength(3);
      expect(buys).toHaveLength(1);
    });
    
    it('should correctly extract option type', () => {
      const orders = parseOrdersFromTextData(SAMPLE_HTML_XLS);
      
      orders.forEach(order => {
        expect(order.optionType).toBe('CALL');
      });
    });
    
    it('should preserve validity date as raw string', () => {
      const orders = parseOrdersFromTextData(SAMPLE_HTML_XLS);
      
      const order1 = orders.find(o => o.symbol === 'BABAH6C165');
      expect(order1!.validityDate).toBe('06/02/2026');
      
      const order2 = orders.find(o => o.symbol === 'BABAM6C180');
      expect(order2!.validityDate).toBe('12/11/2025');
    });
  });
  
  describe('toIsoDateFromIT', () => {
    it('should convert Italian date format to ISO (DD/MM/YYYY -> YYYY-MM-DD)', () => {
      expect(toIsoDateFromIT('12/11/2025')).toBe('2025-11-12');
      expect(toIsoDateFromIT('06/02/2026')).toBe('2026-02-06');
      expect(toIsoDateFromIT('01/01/2024')).toBe('2024-01-01');
    });
    
    it('should handle leading apostrophes (common in Italian Excel exports)', () => {
      expect(toIsoDateFromIT("'12/11/2025")).toBe('2025-11-12');
      expect(toIsoDateFromIT("'06/02/2026")).toBe('2026-02-06');
      expect(toIsoDateFromIT("''15/03/2025")).toBe('2025-03-15');
    });
    
    it('should handle DD-MM-YYYY format', () => {
      expect(toIsoDateFromIT('12-11-2025')).toBe('2025-11-12');
      expect(toIsoDateFromIT("'06-02-2026")).toBe('2026-02-06');
    });
    
    it('should return null for invalid dates', () => {
      expect(toIsoDateFromIT('')).toBeNull();
      expect(toIsoDateFromIT(null)).toBeNull();
      expect(toIsoDateFromIT(undefined)).toBeNull();
      expect(toIsoDateFromIT('invalid')).toBeNull();
      expect(toIsoDateFromIT('2025-11-12')).toBeNull(); // Wrong format
    });
  });
  
  describe('findFirstOperationDate', () => {
    it('should find the earliest date from a list of Italian format dates', () => {
      const dates = ["'06/02/2026", "'12/11/2025", "'15/01/2026", "'10/02/2026"];
      const earliest = findFirstOperationDate(dates);
      
      expect(earliest).toBe('2025-11-12'); // 12/11/2025 is the earliest
    });
    
    it('should handle mixed valid and invalid dates', () => {
      const dates = ["'06/02/2026", undefined, 'invalid', "'12/11/2025"];
      const earliest = findFirstOperationDate(dates);
      
      expect(earliest).toBe('2025-11-12');
    });
    
    it('should return null for empty or all-invalid dates', () => {
      expect(findFirstOperationDate([])).toBeNull();
      expect(findFirstOperationDate([undefined, 'invalid', ''])).toBeNull();
    });
  });
});

describe('orderFileParser - Sanity check for suspicious prices', () => {
  // This test verifies that the sanity check would catch wrong parsing
  const WRONG_PRICES_HTML = `<table>
<tr><td>Operazione</td><td>Simbolo</td><td>Stato</td><td>Prz Medio</td><td>Qtà Eseguita</td><td>Call/Put</td></tr>
<tr><td>Vendita</td><td>AAPL123</td><td>Eseguito</td><td>84</td><td>1</td><td>CALL</td></tr>
<tr><td>Vendita</td><td>AAPL456</td><td>Eseguito</td><td>1495</td><td>1</td><td>CALL</td></tr>
<tr><td>Vendita</td><td>AAPL789</td><td>Eseguito</td><td>1280</td><td>1</td><td>CALL</td></tr>
</table>`;

  it('should parse explicitly high prices as-is (they are actually high)', () => {
    const orders = parseOrdersFromTextData(WRONG_PRICES_HTML);
    
    // These are intentionally high numbers, so they should be parsed as-is
    expect(orders[0].avgPrice).toBe(84);
    expect(orders[1].avgPrice).toBe(1495);
    expect(orders[2].avgPrice).toBe(1280);
  });
});

describe('orderFileParser - LEAP Call filtering', () => {
  // Helper to create a minimal ParsedOrder for testing
  const createOrder = (symbol: string, operation: 'buy' | 'sell', avgPrice: number = 10): ParsedOrder => ({
    symbol,
    operation,
    status: 'Eseguito',
    avgPrice,
    quantity: 1,
    optionType: 'CALL',
    orderValue: avgPrice * 100,
    validityDate: '01/01/2025',
  });

  describe('extractStrikeFromSymbol', () => {
    it('should extract strike from standard option symbols', () => {
      expect(extractStrikeFromSymbol('BABAH6C165')).toBe(165);
      expect(extractStrikeFromSymbol('TSLAG6P350')).toBe(350);
      expect(extractStrikeFromSymbol('NVDAG6C150')).toBe(150);
      expect(extractStrikeFromSymbol('GOOGG6C180')).toBe(180);
    });

    it('should return null for symbols without strike', () => {
      expect(extractStrikeFromSymbol('BABA')).toBeNull();
      expect(extractStrikeFromSymbol('')).toBeNull();
      expect(extractStrikeFromSymbol('ABC')).toBeNull();
    });
  });

  describe('filterAndCalculateCallPremiums - LEAP filtering', () => {
    it('should exclude buy-only CALL', () => {
      const orders: ParsedOrder[] = [
        createOrder('BABAG6C150', 'buy', 14.95),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA');
      expect(result.filteredOrders).toHaveLength(0);
    });

    it('should keep CALL with sell operation (Covered Call)', () => {
      // Even high strike, if it's sold it's a Covered Call
      const orders: ParsedOrder[] = [
        createOrder('BABAH6C165', 'sell', 8.4),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      expect(result.filteredOrders).toHaveLength(1);
    });

    it('should keep buy if same symbol has a sell (rolling)', () => {
      // Both buy and sell of same symbol = rolling, keep both
      const orders: ParsedOrder[] = [
        createOrder('BABAH6C165', 'sell', 8.4),
        createOrder('BABAH6C165', 'buy', 2.12),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      expect(result.filteredOrders).toHaveLength(2);
    });

    it('should exclude buy-only CALL even with near-money strike', () => {
      // Any buy-only CALL is excluded regardless of strike
      const orders: ParsedOrder[] = [
        createOrder('BABAM6C105', 'buy', 5.0),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      expect(result.filteredOrders).toHaveLength(0);
    });

    it('should filter multiple LEAPs while keeping valid Covered Calls', () => {
      // Mixed scenario: 2 LEAPs (buy-only high strike) + 1 Covered Call
      const orders: ParsedOrder[] = [
        createOrder('BABAH6C165', 'sell', 8.4),   // Covered Call → keep
        createOrder('BABAG6C150', 'buy', 14.95),  // LEAP (150 > 100*1.3) → exclude
        createOrder('BABAJ6C180', 'buy', 20.0),   // LEAP (180 > 100*1.3) → exclude
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      expect(result.filteredOrders).toHaveLength(1);
      expect(result.filteredOrders[0].symbol).toBe('BABAH6C165');
    });

    it('should exclude buy-only CALL even without underlyingPrice', () => {
      const orders: ParsedOrder[] = [
        createOrder('BABAG6C150', 'buy', 14.95),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA');
      expect(result.filteredOrders).toHaveLength(0);
    });

    it('should exclude buy-only CALL at any threshold', () => {
      // Buy-only → excluded regardless of strike distance
      const orders: ParsedOrder[] = [
        createOrder('BABAM6C130', 'buy', 8.0),
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      expect(result.filteredOrders).toHaveLength(0);
    });

    it('should correctly calculate metrics after LEAP filtering', () => {
      const orders: ParsedOrder[] = [
        createOrder('BABAH6C165', 'sell', 8.4),   // Keep
        createOrder('BABAG6C150', 'buy', 14.95),  // LEAP → exclude
      ];
      const result = filterAndCalculateCallPremiums(orders, 'BABA', 100);
      
      expect(result.totalSells).toBe(1);
      expect(result.totalBuys).toBe(0);
      expect(result.netPremium).toBeCloseTo(840, 0); // Only the sell counts
    });
  });
});
