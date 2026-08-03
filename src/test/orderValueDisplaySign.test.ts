import { describe, it, expect } from 'vitest';
import { getSignedOrderValue, buildAssignmentOrder, type ParsedOrder } from '@/lib/orderFileParser';

/**
 * Regressione: 2026-08-03.
 *
 * Nella tabella "Operazioni" della calcolatrice premi, la colonna "Valore"
 * decideva colore e segno con `order.orderValue >= 0`. Ma `orderValue` e' per
 * costruzione una magnitudine sempre positiva (quantity * avgPrice * 100): il
 * segno di acquisto/vendita non e' mai memorizzato li', viene applicato solo
 * nei totali (netPremium += per le vendite, -= per gli acquisti). Risultato:
 * ogni riga di acquisto appariva in verde con "+" invece che in rosso con "-".
 *
 * `getSignedOrderValue` centralizza il segno corretto per la visualizzazione.
 */

function makeOrder(overrides: Partial<ParsedOrder>): ParsedOrder {
  return {
    operation: 'sell',
    symbol: 'BABAH6C165',
    status: 'Eseguito',
    avgPrice: 8.4,
    quantity: 1,
    optionType: 'CALL',
    orderValue: 840,
    ...overrides,
  };
}

describe('getSignedOrderValue', () => {
  it("prova del bug: orderValue di un acquisto e' sempre positivo di suo", () => {
    const buy = makeOrder({ operation: 'buy', orderValue: 212 });
    // Il campo grezzo non porta il segno: usarlo direttamente e' il bug.
    expect(buy.orderValue).toBeGreaterThan(0);
    // La funzione di visualizzazione deve invece restituire un valore negativo.
    expect(getSignedOrderValue(buy)).toBe(-212);
  });

  it('un acquisto normale viene mostrato negativo', () => {
    const buy = makeOrder({ operation: 'buy', orderValue: 500 });
    expect(getSignedOrderValue(buy)).toBe(-500);
  });

  it('una vendita normale viene mostrata positiva', () => {
    const sell = makeOrder({ operation: 'sell', orderValue: 840 });
    expect(getSignedOrderValue(sell)).toBe(840);
  });

  it("e' indifferente al segno gia' presente nel campo grezzo (sempre magnitudine)", () => {
    // orderValue non dovrebbe mai arrivare negativo per un ordine normale, ma
    // la funzione deve comunque restituire il segno corretto in base
    // all'operazione, non al segno di input.
    const buy = makeOrder({ operation: 'buy', orderValue: -300 });
    expect(getSignedOrderValue(buy)).toBe(-300);
    const sell = makeOrder({ operation: 'sell', orderValue: -300 });
    expect(getSignedOrderValue(sell)).toBe(300);
  });

  it('una riga di assegnazione mantiene il proprio segno naturale (guadagno/perdita)', () => {
    const stockSell: ParsedOrder = makeOrder({
      operation: 'sell',
      isStockTrade: true,
      symbol: 'BABA',
      avgPrice: 150,
      quantity: 100,
      orderValue: 15000,
      optionType: null,
    });

    // Assegnazione in perdita: prezzo di vendita del sottostante < strike del PUT.
    const lossAssignment = buildAssignmentOrder(stockSell, 160);
    expect(lossAssignment.orderValue).toBeLessThan(0);
    expect(getSignedOrderValue(lossAssignment)).toBe(lossAssignment.orderValue);

    // Assegnazione in guadagno: prezzo di vendita del sottostante > strike del PUT.
    const gainAssignment = buildAssignmentOrder(stockSell, 140);
    expect(gainAssignment.orderValue).toBeGreaterThan(0);
    expect(getSignedOrderValue(gainAssignment)).toBe(gainAssignment.orderValue);
  });
});
