import { describe, it, expect } from 'vitest';
import { parseFlussiCsvText, detectFlussiCsvType } from '@/lib/flussiCsvParser';

const CASH_CSV = [
  'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
  "01/07/2026;'03211;'A9H00015278;EUR;+;0,01;IT17G03211010010A9H00015278",
  "01/07/2026;'03211;'52225971282;EUR;+;81729,04;IT61N0321101600052225971282",
  "01/07/2026;'03211;'B0H00099999;EUR;+;12345,67;IT00X0321101600B0H00099999",
].join('\r\n');

const TITOLI_CSV = [
  'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;',
  "01/07/2026;'03211;'02225971281;'010605;APPLE INC;US0378331005;USD;0,0;300,0;86808,0;1,1383;289,36;0,0;",
  "01/07/2026;'03211;'02225971281;'600672;BTP 01/02/2028 2%;IT0005323032;EUR;96000,0;0,0;95061,85;1,0;99,022765;795,58;",
  "01/07/2026;'03211;'02225971281;'506881;ETF-ISH MSCI TAIWAN;IE00B0M63623;EUR;0,0;180,0;32064,37;1,0;178,135385;0,0;",
  "01/07/2026;'03211;'02225971281;'607553;ETC-INVESCO PHYSICAL;IE00B579F325;EUR;0,0;85,0;28883,72;1,0;339,808435;0,0;",
  "01/07/2026;'03211;'02225971281;'ND;;[AAPL][12/27][C][300];USD;-3,0;0,0;0,0;1,1383;44,55;0,0;",
  "01/07/2026;'03211;'02225971281;'ND;;[UBER][08/26][C][82.5];USD;-2,0;0,0;0,0;1,1383;1,44;0,0;",
  "01/07/2026;'03211;'02225971281;'ND;;[NVDA][12/27][P][90];USD;9,0;0,0;0,0;1,1383;2,48;0,0;",
  "01/07/2026;'03211;'08H00012345;'010696;MICROSOFT INC.;US5949181045;USD;0,0;100,0;37302,0;1,1383;373,02;0,0;",
].join('\r\n');

describe('detectFlussiCsvType', () => {
  it('riconosce il file cash', () => {
    expect(detectFlussiCsvType(CASH_CSV)).toBe('cash');
  });
  it('riconosce il file titoli', () => {
    expect(detectFlussiCsvType(TITOLI_CSV)).toBe('titoli');
  });
  it('ritorna null per contenuti non riconosciuti', () => {
    expect(detectFlussiCsvType('foo;bar\n1;2')).toBeNull();
  });
});

describe('parseFlussiCsvText — file cash', () => {
  it('classifica conti ordinari, vincolati (A9) e GP (B0)', () => {
    const res = parseFlussiCsvText(CASH_CSV);
    expect(res.snapshotDate).toBe('2026-07-01');

    // GP (B0) esclusa dalla liquidità del portafoglio
    expect(res.cashAccounts).toHaveLength(2);
    expect(res.gpCashAccounts).toHaveLength(1);
    expect(res.gpCashAccounts[0].value).toBeCloseTo(12345.67, 2);

    // Liquidità totale = ordinaria + vincolata
    expect(res.cashValue).toBeCloseTo(81729.04 + 0.01, 2);
    // Vincolata (A9) tracciata separatamente
    expect(res.restrictedCashValue).toBeCloseTo(0.01, 2);
    const restricted = res.cashAccounts.find(a => a.restricted);
    expect(restricted?.accountId.startsWith('A9')).toBe(true);
  });

  it('applica le esclusioni configurate', () => {
    const res = parseFlussiCsvText(CASH_CSV, { excludedCashAccounts: ['52225971282'] });
    expect(res.cashValue).toBeCloseTo(0.01, 2);
  });

  it('applica il segno negativo', () => {
    const csv = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
      "01/07/2026;'03211;'52225971282;EUR;-;100,50;IT61",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    expect(res.cashValue).toBeCloseTo(-100.5, 2);
  });
});

describe('parseFlussiCsvText — file titoli', () => {
  it('classifica azioni, obbligazioni, ETF, ETC e derivati', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    const byType = (t: string) => res.positions.filter(p => p.asset_type === t);

    expect(byType('stock')).toHaveLength(1);
    expect(byType('bond')).toHaveLength(1);
    expect(byType('etf')).toHaveLength(1);
    expect(byType('commodity')).toHaveLength(1);
    expect(byType('derivative')).toHaveLength(3);
  });

  it('converte i controvalori in EUR con il cambio', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    const aapl = res.positions.find(p => p.description === 'APPLE INC')!;
    expect(aapl.market_value).toBeCloseTo(86808 / 1.1383, 2);
    expect(aapl.quantity).toBe(300);
    expect(aapl.current_price).toBeCloseTo(289.36, 2);
    expect(aapl.isin).toBe('US0378331005');
  });

  it('per i bond usa il nominale come quantità e include il rateo', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    const btp = res.positions.find(p => p.asset_type === 'bond')!;
    expect(btp.quantity).toBe(96000);
    expect(btp.market_value).toBeCloseTo(95061.85 + 795.58, 2);
  });

  it('parsa il descrittore opzione [TICKER][MM/YY][C|P][STRIKE]', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    const aaplCall = res.positions.find(p => p.underlying === 'AAPL')!;
    expect(aaplCall.option_type).toBe('call');
    expect(aaplCall.strike_price).toBe(300);
    expect(aaplCall.expiry_date).toBe('2027-12-21');
    expect(aaplCall.quantity).toBe(-3); // contratti con segno
    expect(aaplCall.current_price).toBeCloseTo(44.55, 2);
    // market value = |contratti| * 100 * premio / cambio
    expect(aaplCall.market_value).toBeCloseTo((3 * 100 * 44.55) / 1.1383, 2);

    const uber = res.positions.find(p => p.underlying === 'UBER')!;
    expect(uber.strike_price).toBeCloseTo(82.5, 2); // strike decimale

    const nvdaPut = res.positions.find(p => p.underlying === 'NVDA')!;
    expect(nvdaPut.option_type).toBe('put');
    expect(nvdaPut.quantity).toBe(9); // comprata
  });

  it('smista i depositi "08..." nelle holdings GP', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    expect(res.gpHoldings).toHaveLength(1);
    const msft = res.gpHoldings[0];
    expect(msft.description).toBe('MICROSOFT INC.');
    expect(msft.asset_type).toBe('stock');
    expect(msft.market_value).toBeCloseTo(37302 / 1.1383, 2);
    expect(msft.ticker_code).toBe('010696');
    // Nessuna posizione GP finisce tra le posizioni di portafoglio
    expect(res.positions.some(p => p.description === 'MICROSOFT INC.')).toBe(false);
  });
});
