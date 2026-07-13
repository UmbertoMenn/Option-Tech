import { describe, it, expect } from 'vitest';
import { parseFlussiCsvText, detectFlussiCsvType, buildDepositCandidates, pairInternalTransfers, FlussiCashMovement } from '@/lib/flussiCsvParser';
import { readFileSync } from 'fs';
import { join } from 'path';

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

  it('applica le eccezioni per pattern (mid/last) anche ai saldi cash', () => {
    // Aggiunge un conto '52805213452' al CSV di saldo: con mid.length=3,
    // midStart=floor((11-3)/2)=4 → slice(4,7)='521'; ultime 3 cifre='452'.
    const csvWithSilvia = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
      "01/07/2026;'03211;'A9H00015278;EUR;+;0,01;IT17G03211010010A9H00015278",
      "01/07/2026;'03211;'52225971282;EUR;+;81729,04;IT61N0321101600052225971282",
      "01/07/2026;'03211;'52805213452;EUR;+;50000,00;IT00X0321101600052805213452",
      "01/07/2026;'03211;'B0H00099999;EUR;+;12345,67;IT00X0321101600B0H00099999",
    ].join('\r\n');
    const res = parseFlussiCsvText(csvWithSilvia, {
      excludedCashPatterns: [{ mid: '521', last: '452' }],
    });
    // Il conto 52805213452 deve essere escluso dalla liquidità portafoglio
    expect(res.cashAccounts.some(a => a.accountId === '52805213452')).toBe(false);
    // Gli altri conti ordinari/vincolati restano inclusi
    expect(res.cashValue).toBeCloseTo(81729.04 + 0.01, 2);
    // Il conto GP (B0) non è toccato dall'esclusione cash
    expect(res.gpCashAccounts).toHaveLength(1);
    expect(res.gpCashAccounts[0].value).toBeCloseTo(12345.67, 2);
  });

  it('applica le eccezioni per solo suffisso (last, senza mid): esclude SOLO il conto che finisce per 452', () => {
    const csvWithSilvia = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
      "01/07/2026;'03211;'A9H00015278;EUR;+;0,01;IT17G03211010010A9H00015278",
      "01/07/2026;'03211;'52225971282;EUR;+;81729,04;IT61N0321101600052225971282",
      "01/07/2026;'03211;'52805213452;EUR;+;50000,00;IT00X0321101600052805213452",
      "01/07/2026;'03211;'B0H00099999;EUR;+;12345,67;IT00X0321101600B0H00099999",
    ].join('\r\n');
    const res = parseFlussiCsvText(csvWithSilvia, {
      excludedCashPatterns: [{ last: '452' }],
    });
    // Il conto che finisce per 452 è escluso dalla liquidità del portafoglio
    expect(res.cashAccounts.some(a => a.accountId === '52805213452')).toBe(false);
    // Tutti gli altri conti restano inclusi
    expect(res.cashValue).toBeCloseTo(81729.04 + 0.01, 2);
    expect(res.gpCashAccounts).toHaveLength(1);
  });

  it('per silvias somma anche i conti B0 ed esclude solo il suffisso 452', () => {
    const csv = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
      "01/07/2026;'03211;'52225971282;EUR;+;77844,00;IT61",
      "01/07/2026;'03211;'B0H00099999;EUR;+;2704,00;IT00",
      "01/07/2026;'03211;'52805213452;EUR;+;50000,00;IT00",
    ].join('\r\n');
    const res = parseFlussiCsvText(csv, {
      excludedCashPatterns: [{ last: '452' }],
      includeGpCashInCash: true,
    });

    expect(res.cashValue).toBeCloseTo(80548, 2);
    expect(res.cashAccounts).toHaveLength(2);
    expect(res.gpCashAccounts).toHaveLength(0);
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

  it('esclude BION ON dalle posizioni e dalle holdings GP quando configurato', () => {
    const csv = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;',
      "01/07/2026;'03211;'02225971281;'010605;BION ON;US09075V1026;USD;0,0;10,0;2704,0;1,0;270,4;0,0;",
      "01/07/2026;'03211;'08H00012345;'010605; BION   ON ;US09075V1026;USD;0,0;10,0;2704,0;1,0;270,4;0,0;",
      "01/07/2026;'03211;'02225971281;'010696;APPLE INC;US0378331005;USD;0,0;10,0;2000,0;1,0;200,0;0,0;",
    ].join('\r\n');
    const res = parseFlussiCsvText(csv, {
      excludedPositionDescriptions: ['BION ON'],
    });

    expect(res.positions.map(position => position.description)).toEqual(['APPLE INC']);
    expect(res.gpHoldings).toHaveLength(0);
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

  it('parsa il descrittore opzione [TICKER][MM/YY][C|P][STRIKE] con scadenza reale (terzo venerdì)', () => {
    const res = parseFlussiCsvText(TITOLI_CSV);
    const aaplCall = res.positions.find(p => p.underlying === 'AAPL')!;
    expect(aaplCall.option_type).toBe('call');
    expect(aaplCall.strike_price).toBe(300);
    // Dicembre 2027: terzo venerdì reale = 17 (non 21, nessuna festività USA vicina)
    expect(aaplCall.expiry_date).toBe('2027-12-17');
    expect(aaplCall.quantity).toBe(-3); // contratti con segno
    expect(aaplCall.current_price).toBeCloseTo(44.55, 2);
    // market value = |contratti| * 100 * premio / cambio
    expect(aaplCall.market_value).toBeCloseTo((3 * 100 * 44.55) / 1.1383, 2);

    const uber = res.positions.find(p => p.underlying === 'UBER')!;
    expect(uber.strike_price).toBeCloseTo(82.5, 2); // strike decimale
    // Agosto 2026: terzo venerdì reale = 21 (nessuna collisione con festività)
    expect(uber.expiry_date).toBe('2026-08-21');

    const nvdaPut = res.positions.find(p => p.underlying === 'NVDA')!;
    expect(nvdaPut.option_type).toBe('put');
    expect(nvdaPut.quantity).toBe(9); // comprata
    // Stesso mese/anno di AAPL -> stessa scadenza reale
    expect(nvdaPut.expiry_date).toBe('2027-12-17');
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

  it('le esclusioni cash pattern non impattano le holdings titoli né le holdings GP', () => {
    // Anche se il conto titoli '02225971281' non corrisponde al pattern 452,
    // questo test documenta che excludedCashPatterns non ha effetto sui titoli.
    // Il conto GP '08H00012345' è su un deposito separato e deve restare.
    const res = parseFlussiCsvText(TITOLI_CSV, {
      excludedCashPatterns: [{ mid: '521', last: '452' }],
    });
    // Tutti i titoli del portafoglio restano invariati
    expect(res.positions).toHaveLength(7);
    // Le holdings GP restano invariate
    expect(res.gpHoldings).toHaveLength(1);
    expect(res.gpHoldings[0].description).toBe('MICROSOFT INC.');
  });

  // ---- Caso reale segnalato: CONTROVALORE in valuta, da dividere per CAMBIO ----

  it('USD ordinario: CONTROVALORE / CAMBIO produce il valore in EUR (es. 63244 / 1,143 ≈ 55.331,58)', () => {
    const TITOLI_HEADER =
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
      'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';
    const csv = [
      TITOLI_HEADER,
      "01/07/2026;'03211;'02225971281;'010605;NVIDIA CORP;US67066G1040;USD;0,0;100,0;63244,0;1,143;632,44;0,0;",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    const pos = res.positions[0];
    // 63244 / 1,143 ≈ 55.331,58 EUR — NON 63.244 EUR
    expect(pos.market_value).toBeCloseTo(63244 / 1.143, 2);
    expect(pos.currency).toBe('USD');
    expect(pos.exchange_rate).toBeCloseTo(1.143, 4);
  });

  it('USD posizione GP (conto 08…): CONTROVALORE / CAMBIO', () => {
    const TITOLI_HEADER =
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
      'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';
    const csv = [
      TITOLI_HEADER,
      "01/07/2026;'03211;'08H00099999;'010696;ALPHABET INC;US02079K3059;USD;0,0;50,0;63244,0;1,143;1264,88;0,0;",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    expect(res.gpHoldings).toHaveLength(1);
    const gp = res.gpHoldings[0];
    expect(gp.market_value).toBeCloseTo(63244 / 1.143, 2);
    expect(gp.currency).toBe('USD');
    expect(gp.exchange_rate).toBeCloseTo(1.143, 4);
    // La posizione GP non finisce nel portafoglio ordinario
    expect(res.positions).toHaveLength(0);
  });

  it('EUR con cambio=1: nessuna variazione, market_value = controvalore', () => {
    const TITOLI_HEADER =
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
      'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';
    const csv = [
      TITOLI_HEADER,
      "01/07/2026;'03211;'02225971281;'506881;ETF-VANGUARD FTSE ALL-WORLD;IE00B3RBWM25;EUR;0,0;200,0;50000,0;1,0;250,00;0,0;",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    const pos = res.positions[0];
    // cambio=1 → nessuna conversione, il market_value eguaglia il controvalore
    expect(pos.market_value).toBeCloseTo(50000.0, 2);
  });

  it('cambio invalido (0 o non positivo): fallback a 1, market_value = controvalore', () => {
    const TITOLI_HEADER =
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
      'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';
    const csv = [
      TITOLI_HEADER,
      // cambio=0: deve usare fallback 1, non generare divisione per zero
      "01/07/2026;'03211;'02225971281;'010605;TESLA INC;US88160R1014;USD;0,0;50,0;12500,0;0,0;250,00;0,0;",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    const pos = res.positions[0];
    // cambio=0 → fallback 1: market_value = controvalore / 1
    expect(pos.market_value).toBeCloseTo(12500.0, 2);
  });

  it('bond in valuta estera: (controvalore + rateo) / cambio', () => {
    const TITOLI_HEADER =
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
      'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';
    const csv = [
      TITOLI_HEADER,
      // Bond USA: nominale=50000, qty=0 (→ isBond), controvalore=49000 USD, rateo=300 USD, cambio=1,143
      "01/07/2026;'03211;'02225971281;'001234;US TREASURY 3%;US1234567890;USD;50000,0;0,0;49000,0;1,143;98,00;300,0;",
    ].join('\n');
    const res = parseFlussiCsvText(csv);
    const bond = res.positions[0];
    expect(bond.asset_type).toBe('bond');
    expect(bond.quantity).toBe(50000); // nominale come quantità
    // (controvalore + rateo) / cambio = (49000 + 300) / 1,143
    expect(bond.market_value).toBeCloseTo((49000 + 300) / 1.143, 2);
  });
});

// ============================================================================
// File Movimenti Cash (FlussoMovContiCash) — versamenti/prelievi automatici
// ============================================================================
const MOV_HEADER =
  'DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;DATA CONTABILE;DATA VALUTA;ANNO;' +
  'NUMERO CONTO;NUMERO OPERAZIONE;DESCRIZIONE OPERAZIONE;SEGNO;IMPORTO ORIGINARIO;' +
  'DIVISA IMPORTO ORIGINARIO;IMPORTO MOVIMENTO CONTO;DIVISA IMPORTO;CODICE CAUSALE;' +
  'DESCRIZIONE CAUSALE;IBAN;';

const MOV_CASH_CSV = [
  MOV_HEADER,
  // Bonifico in entrata (versamento)
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'52805213452;'26000167999001;" +
    "BONIFICO A VOSTRO FAVORE - MARIO ROSSI;+;15000,0;EUR;15000,0;EUR;00001200;BONIFICO IN VOSTRO FAVORE;IT39W0321101600052805213452",
  // Bonifico in uscita (prelievo)
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'52805213452;'26000167999002;" +
    "VOSTRA DISPOSIZIONE DI BONIFICO - VERSO IT60X0542811101000000123456;-;-5000,0;EUR;-5000,0;EUR;00001210;BONIFICO DISPOSTO;IT39W0321101600052805213452",
  // Giroconto interno (stesso giorno del bonifico in entrata, stesso conto -> deve nettare insieme)
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'52805213452;'26000167999003;" +
    "GIROCONTO A VOSTRO FAVORE;+;2500,0;EUR;2500,0;EUR;00001300;GIROCONTO;IT39W0321101600052805213452",
  // Commissione SUL bonifico (non un movimento di capitale: deve essere ignorata)
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'52805213452;'26000167999004;" +
    "COMMISSIONI PER BONIFICO ESTERO;-;-15,0;EUR;-15,0;EUR;00001220;ADDEBITO PER COMMISSIONI SU BONIFICO;IT39W0321101600052805213452",
  // Operazione ordinaria, non un movimento di capitale
  "07/07/2026;07/07/2026;'03211;05/07/2026;05/07/2026;2026;'52805213452;'26000167999005;" +
    "ACQUISTO TRAMITE POS - POS 0207 ESSELUNGA;-;-42,3;EUR;-42,3;EUR;20000007;ACQUISTO TRAMITE POS;IT39W0321101600052805213452",
  // Bonifico su un secondo conto/giorno diverso
  "07/07/2026;07/07/2026;'03211;05/07/2026;03/07/2026;2026;'52225971282;'26000167999006;" +
    "BONIFICO A VOSTRO FAVORE - GIROCONTO DA ALTRO ISTITUTO;+;8000,0;EUR;8000,0;EUR;00001200;BONIFICO IN VOSTRO FAVORE;IT61N0321101600052225971282",
].join('\r\n');

describe('detectFlussiCsvType — file Movimenti Cash', () => {
  it('riconosce il file movimenti cash', () => {
    expect(detectFlussiCsvType(MOV_CASH_CSV)).toBe('mov_cash');
  });
});

describe('parseFlussiCsvText — file Movimenti Cash', () => {
  it('individua bonifici e giroconti, ignorando le altre operazioni', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    // 4 movimenti di capitale: bonifico +15000, bonifico -5000, giroconto +2500, bonifico +8000
    expect(res.cashMovements).toHaveLength(4);

    const kinds = res.cashMovements.map(m => m.kind);
    expect(kinds.filter(k => k === 'bonifico')).toHaveLength(3);
    expect(kinds.filter(k => k === 'giroconto')).toHaveLength(1);
  });

  it('usa il segno di IMPORTO MOVIMENTO CONTO per distinguere entrata/uscita', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    const entrata = res.cashMovements.find(m => m.operationId === '26000167999001');
    const uscita = res.cashMovements.find(m => m.operationId === '26000167999002');
    expect(entrata?.amount).toBeCloseTo(15000, 2);
    expect(uscita?.amount).toBeCloseTo(-5000, 2);
  });

  it('usa la data valuta come data del movimento', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    const m = res.cashMovements.find(m => m.operationId === '26000167999006');
    expect(m?.movementDate).toBe('2026-07-03'); // data valuta, non data contabile (05/07)
  });

  it('esclude commissioni/spese relative a un bonifico (non sono il movimento di capitale)', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    expect(res.cashMovements.some(m => m.operationId === '26000167999004')).toBe(false);
  });

  it('ignora operazioni ordinarie (POS, commissioni, canoni) — nessun falso positivo', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    expect(res.cashMovements.some(m => m.operationId === '26000167999005')).toBe(false);
  });

  it('applica le eccezioni sui conti cliente (silvias/maurog) anche ai movimenti', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV, { excludedCashAccounts: ['52805213452'] });
    // Restano solo i movimenti del secondo conto, non escluso
    expect(res.cashMovements).toHaveLength(1);
    expect(res.cashMovements[0].accountId).toBe('52225971282');
  });

  it('applica le eccezioni per pattern (mid/last) anche ai movimenti', () => {
    // accountId '52805213452' (11 cifre): con mid.length=3, midStart=floor((11-3)/2)=4
    // → slice(4,7) = '521'; ultime 3 cifre = '452'.
    const res = parseFlussiCsvText(MOV_CASH_CSV, {
      excludedCashPatterns: [{ mid: '521', last: '452' }],
    });
    expect(res.cashMovements.every(m => m.accountId !== '52805213452')).toBe(true);
  });

  it('applica le eccezioni per solo suffisso (last) anche ai movimenti', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV, {
      excludedCashPatterns: [{ last: '452' }],
    });
    expect(res.cashMovements.every(m => m.accountId !== '52805213452')).toBe(true);
    // Il conto non escluso resta
    expect(res.cashMovements.some(m => m.accountId === '52225971282')).toBe(true);
  });

  it('nessun falso positivo su un estratto conto reale privo di bonifici/giroconti', () => {
    const realCsv = readFileSync(
      join(__dirname, 'fixtures/FlussoMovContiCash_sample.csv'),
      'utf-8'
    );
    expect(detectFlussiCsvType(realCsv)).toBe('mov_cash');
    const res = parseFlussiCsvText(realCsv);
    // Il file reale contiene solo commissioni, canoni e acquisti POS
    expect(res.cashMovements).toHaveLength(0);
  });
});

describe('buildDepositCandidates', () => {
  it('aggrega (netta) i movimenti dello stesso giorno in un unico candidato versamento/prelievo', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    const candidates = buildDepositCandidates(res.cashMovements);

    // Due date distinte: 2026-07-06 (bonifico +15000, bonifico -5000, giroconto +2500) e 2026-07-03 (+8000)
    expect(candidates).toHaveLength(2);

    const day1 = candidates.find(c => c.deposit_date === '2026-07-06')!;
    expect(day1.amount).toBeCloseTo(15000 - 5000 + 2500, 2);
    expect(day1.sourceMovements).toHaveLength(3);

    const day2 = candidates.find(c => c.deposit_date === '2026-07-03')!;
    expect(day2.amount).toBeCloseTo(8000, 2);
    expect(day2.sourceMovements).toHaveLength(1);
  });

  it('ordina i candidati per data crescente', () => {
    const res = parseFlussiCsvText(MOV_CASH_CSV);
    const candidates = buildDepositCandidates(res.cashMovements);
    const dates = candidates.map(c => c.deposit_date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ============================================================================
// File Movimenti Titoli (FlussoMovContiTitoli) — operazioni in derivati
// ============================================================================
import { decodeOptionDescriptor } from '@/lib/flussiCsvParser';

describe('decodeOptionDescriptor', () => {
  it("decodifica l'esempio dato: NVDAV7P200 = put NVDA strike 200 scadenza ottobre 2027", () => {
    const d = decodeOptionDescriptor('NVDAV7P200', '2026-07-02')!;
    expect(d.underlyingTicker).toBe('NVDA');
    expect(d.optionType).toBe('put');
    expect(d.strike).toBe(200);
    expect(d.month).toBe(10);
    expect(d.year).toBe(2027);
    expect(d.expiryDate).toBe('2027-10-15'); // terzo venerdì ottobre 2027
  });

  it('decodifica tutti i codici mese', () => {
    const months: Record<string, number> = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };
    for (const [code, month] of Object.entries(months)) {
      const d = decodeOptionDescriptor(`AAPL${code}7C300`, '2026-07-02')!;
      expect(d.month).toBe(month);
      expect(d.year).toBe(2027);
    }
  });

  it('gestisce ticker che terminano con lettere-mese (parsing ancorato da destra)', () => {
    // IREN termina con N (=luglio): il parse corretto è IREN + F8 + C + 80
    const d = decodeOptionDescriptor('IRENF8C80', '2026-07-02')!;
    expect(d.underlyingTicker).toBe('IREN');
    expect(d.month).toBe(1);
    expect(d.year).toBe(2028);
    expect(d.optionType).toBe('call');
    expect(d.strike).toBe(80);
  });

  it('risolve la cifra anno rispetto alla data operazione (decennio successivo se già scaduta)', () => {
    // Operazione a dicembre 2026, opzione F6 (gennaio, cifra 6): gen 2026 è passato → 2036
    const d = decodeOptionDescriptor('AAPLF6C300', '2026-12-01')!;
    expect(d.year).toBe(2036);
    // Stessa opzione negoziata a gennaio 2026 → 2026
    const d2 = decodeOptionDescriptor('AAPLF6C300', '2026-01-05')!;
    expect(d2.year).toBe(2026);
  });

  it('supporta strike decimali', () => {
    const d = decodeOptionDescriptor('FQ6P12,5', '2026-07-02')!;
    expect(d.underlyingTicker).toBe('F');
    expect(d.strike).toBe(12.5);
  });

  it('ritorna null per descrittori non-opzione', () => {
    expect(decodeOptionDescriptor('NVIDIA CORP', '2026-07-02')).toBeNull();
    expect(decodeOptionDescriptor('', '2026-07-02')).toBeNull();
  });
});

describe('parseFlussiCsvText — file Movimenti Titoli', () => {
  it('riconosce il tipo e parsa il file reale: 10 operazioni opzioni, dividendo escluso', () => {
    const realCsv = readFileSync(
      join(__dirname, 'fixtures/FlussoMovContiTitoli_sample.csv'),
      'utf-8'
    );
    expect(detectFlussiCsvType(realCsv)).toBe('mov_titoli');
    const res = parseFlussiCsvText(realCsv);
    expect(res.titoliOptionTrades).toHaveLength(10); // 11 righe − 1 DIV NVIDIA

    const mu900 = res.titoliOptionTrades.find(t => t.descriptor === 'MUQ6P900')!;
    expect(mu900.side).toBe('ACQ');
    expect(mu900.underlyingTicker).toBe('MU');
    expect(mu900.optionType).toBe('put');
    expect(mu900.strike).toBe(900);
    expect(mu900.expiryDate).toBe('2026-08-21'); // terzo venerdì agosto 2026
    expect(mu900.contracts).toBe(1);
    expect(mu900.pricePerShare).toBe(94);
    expect(mu900.currency).toBe('USD');
    expect(mu900.tradeDate).toBe('2026-07-02'); // DATA OPERAZIONE

    const iren = res.titoliOptionTrades.find(t => t.descriptor === 'IRENF8C80')!;
    expect(iren.side).toBe('ACQ');
    expect(iren.contracts).toBe(2);
    expect(iren.expiryDate).toBe('2028-01-21'); // terzo venerdì gennaio 2028
  });

  it('applica le eccezioni conto cliente anche ai movimenti titoli', () => {
    const realCsv = readFileSync(
      join(__dirname, 'fixtures/FlussoMovContiTitoli_sample.csv'),
      'utf-8'
    );
    const res = parseFlussiCsvText(realCsv, { excludedCashAccounts: ['02278918441'] });
    expect(res.titoliOptionTrades).toHaveLength(0);
  });
});

describe('pairInternalTransfers — giroconti interni cash ↔ GP', () => {
  const mov = (partial: Partial<FlussiCashMovement> & { accountId: string; movementDate: string; amount: number; kind: 'bonifico' | 'giroconto' }): FlussiCashMovement => ({
    isGP: partial.accountId.toUpperCase().startsWith('B0'),
    restricted: false,
    accountingDate: partial.movementDate,
    currency: 'EUR',
    operationId: '',
    description: partial.kind.toUpperCase(),
    causaleCode: '',
    causaleDescription: '',
    ...partial,
  });

  it('esclude la coppia giroconto uscita cash / entrata GP, stessa data e importo', () => {
    const movements = [
      mov({ accountId: 'A1234', movementDate: '2026-07-06', amount: -1000, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-06', amount: 1000, kind: 'giroconto' }),
      mov({ accountId: 'A1234', movementDate: '2026-07-06', amount: -500, kind: 'bonifico' }),
    ];
    const { external, internalPairs } = pairInternalTransfers(movements);
    expect(internalPairs).toHaveLength(1);
    expect(external).toHaveLength(1);
    expect(external[0].amount).toBe(-500);

    // Lo scenario segnalato: prima veniva registrato un netto sbagliato che
    // mescolava il travaso interno; ora il candidato del giorno è solo il
    // prelievo reale.
    const candidates = buildDepositCandidates(movements);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].amount).toBeCloseTo(-500, 2);
  });

  it('appaia gambe con data valuta diversa entro 5 giorni', () => {
    const movements = [
      mov({ accountId: 'A1234', movementDate: '2026-07-06', amount: -2500, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-08', amount: 2500, kind: 'giroconto' }),
    ];
    const { external, internalPairs } = pairInternalTransfers(movements);
    expect(internalPairs).toHaveLength(1);
    expect(external).toHaveLength(0);
    expect(buildDepositCandidates(movements)).toHaveLength(0);
  });

  it('NON appaia oltre i 5 giorni, importi diversi o stesso conto', () => {
    const movements = [
      mov({ accountId: 'A1234', movementDate: '2026-07-01', amount: -1000, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-20', amount: 1000, kind: 'giroconto' }), // troppo lontano
      mov({ accountId: 'A1234', movementDate: '2026-07-01', amount: -300, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-01', amount: 350, kind: 'giroconto' }),  // importo diverso
      mov({ accountId: 'A1234', movementDate: '2026-07-02', amount: -700, kind: 'giroconto' }),
      mov({ accountId: 'A1234', movementDate: '2026-07-02', amount: 700, kind: 'giroconto' }),  // stesso conto
    ];
    const { internalPairs } = pairInternalTransfers(movements);
    expect(internalPairs).toHaveLength(0);
  });

  it('i BONIFICI non vengono mai appaiati (anche se speculari): un bonifico esterno verso la GP è un versamento', () => {
    const movements = [
      mov({ accountId: 'A1234', movementDate: '2026-07-06', amount: -1000, kind: 'bonifico' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-06', amount: 1000, kind: 'bonifico' }),
    ];
    const { external, internalPairs } = pairInternalTransfers(movements);
    expect(internalPairs).toHaveLength(0);
    expect(external).toHaveLength(2);
  });

  it('con due candidati positivi preferisce quello a data valuta identica', () => {
    const movements = [
      mov({ accountId: 'A1234', movementDate: '2026-07-06', amount: -1000, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-08', amount: 1000, kind: 'giroconto' }),
      mov({ accountId: 'B0999', movementDate: '2026-07-06', amount: 1000, kind: 'giroconto' }),
    ];
    const { external, internalPairs } = pairInternalTransfers(movements);
    expect(internalPairs).toHaveLength(1);
    expect(internalPairs[0][1].movementDate).toBe('2026-07-06');
    expect(external).toHaveLength(1);
    expect(external[0].movementDate).toBe('2026-07-08');
  });
});
