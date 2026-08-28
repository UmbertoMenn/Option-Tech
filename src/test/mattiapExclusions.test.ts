import { describe, expect, it } from 'vitest';
import { isFundOrSicav } from '@/lib/excelParser';
import { parseFlussiCsvText } from '@/lib/flussiCsvParser';
import { getPortfolioParseOptions } from '@/lib/portfolioUpload';

const MATTIA = () => getPortfolioParseOptions('mattia-id', 'MattiaP');

// ============================================================================
// Rilevamento fondi comuni / SICAV
// ============================================================================
describe('isFundOrSicav', () => {
  it('riconosce fondi e SICAV dai marcatori nella descrizione', () => {
    expect(isFundOrSicav('AMUNDI FUNDS EURO EQUITY')).toBe(true);
    expect(isFundOrSicav('BNP PARIBAS FUNDS SICAV CL C')).toBe(true);
    expect(isFundOrSicav('FONDO ANIMA CRESCITA ITALIA')).toBe(true);
    expect(isFundOrSicav('EURIZON COMPARTO OBBLIGAZIONARIO')).toBe(true);
    expect(isFundOrSicav('SCHRODER ISF GLOBAL FUND A ACC')).toBe(true);
    expect(isFundOrSicav('FD.PIMCO GLOBAL BOND')).toBe(true);
    expect(isFundOrSicav('QF.EURIZON AZIONI INTERNAZIONALI')).toBe(true);
  });

  it('non classifica come fondo gli strumenti quotati (ETF/ETC/ETP/ETN)', () => {
    // Guardia critica: giuridicamente sono fondi, ma restano posizioni a sé.
    expect(isFundOrSicav('Amundi S&P World Financials Screened UCITS ETF Acc')).toBe(false);
    expect(isFundOrSicav('ISHARES CORE MSCI WORLD UCITS ETF FUND')).toBe(false);
    expect(isFundOrSicav('ETC-INVESCO PHYSICAL GOLD')).toBe(false);
    expect(isFundOrSicav('WITR ISS X ETP O.E')).toBe(false);
    expect(isFundOrSicav('V.S+P500 U.ETF DLA')).toBe(false);
  });

  it('non classifica come fondo azioni e obbligazioni ordinarie', () => {
    expect(isFundOrSicav('AZ.NVIDIA CORP')).toBe(false);
    expect(isFundOrSicav('OB.BANCO BPM TM EUR 14GIU28 CALL')).toBe(false);
    expect(isFundOrSicav('BTP 01/09/2033 2.45%')).toBe(false);
    expect(isFundOrSicav('')).toBe(false);
  });
});

// ============================================================================
// Configurazione utente
// ============================================================================
describe('opzioni di parsing per mattiap', () => {
  it('attiva esclusione fondi/SICAV e prefisso conto 0624 solo per mattiap', () => {
    const mattia = MATTIA();
    expect(mattia.excludeFundsAndSicav).toBe(true);
    expect(mattia.excludedCashPrefixes).toEqual(['0624']);

    const altro = getPortfolioParseOptions('other-id', 'other');
    expect(altro.excludeFundsAndSicav).toBeUndefined();
    expect(altro.excludedCashPrefixes).toBeUndefined();
  });
});

// ============================================================================
// Flusso titoli: fondi/SICAV fuori dal patrimonio
// ============================================================================
const TITOLI_HEADER =
  'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;CODICE TITOLO;DESCRIZIONE TITOLO;ISIN;DIVISA;' +
  'VALORE NOMINALE;QUANTITA;CONTROVALORE;CAMBIO;PREZZO;RATEO INTERESSI;';

const TITOLI_CON_FONDI = [
  TITOLI_HEADER,
  "01/07/2026;'03211;'02225971281;'010605;AZ.APPLE INC;US0378331005;USD;0,0;300,0;86808,0;1,1383;289,36;0,0;",
  "01/07/2026;'03211;'02225971281;'506881;ETF-ISH MSCI TAIWAN;IE00B0M63623;EUR;0,0;180,0;32064,37;1,0;178,135385;0,0;",
  "01/07/2026;'03211;'02225971281;'700111;AMUNDI FUNDS EURO EQUITY;LU1883854066;EUR;0,0;500,0;50000,0;1,0;100,0;0,0;",
  "01/07/2026;'03211;'02225971281;'700222;FONDO ANIMA CRESCITA ITALIA;IT0004999999;EUR;0,0;100,0;12000,0;1,0;120,0;0,0;",
  // Fondo su deposito GP (08...) → non deve finire nemmeno negli holdings GP
  "01/07/2026;'03211;'08H00012345;'700333;EURIZON SICAV BOND CLASSE R;LU0123456789;EUR;0,0;200,0;20000,0;1,0;100,0;0,0;",
  "01/07/2026;'03211;'08H00012345;'010696;MICROSOFT INC.;US5949181045;USD;0,0;100,0;37302,0;1,1383;373,02;0,0;",
].join('\r\n');

describe('flusso titoli — fondi e SICAV', () => {
  it('esclude fondi e SICAV dalle posizioni ma mantiene azioni ed ETF', () => {
    const res = parseFlussiCsvText(TITOLI_CON_FONDI, MATTIA());
    expect(res.positions.map(p => p.description)).toEqual([
      'AZ.APPLE INC',
      'ETF-ISH MSCI TAIWAN',
    ]);
    expect(res.positions.find(p => p.description === 'ETF-ISH MSCI TAIWAN')?.asset_type).toBe('etf');
  });

  it('esclude i fondi anche dagli holdings della Gestione Patrimoniale', () => {
    const res = parseFlussiCsvText(TITOLI_CON_FONDI, MATTIA());
    expect(res.gpHoldings.map(h => h.description)).toEqual(['MICROSOFT INC.']);
    // La sorgente GP resta segnalata: il refresh GP deve comunque scattare.
    expect(res.gpSnapshotPresent).toBe(true);
  });

  it('proof-of-bug: senza la regola mattiap i fondi rientrano nel patrimonio', () => {
    const res = parseFlussiCsvText(TITOLI_CON_FONDI, getPortfolioParseOptions('other-id', 'other'));
    expect(res.positions).toHaveLength(4);
    expect(res.gpHoldings).toHaveLength(2);
  });
});

// ============================================================================
// Liquidità del conto "0624..."
// ============================================================================
const CASH_CON_0624 = [
  'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
  "01/07/2026;'03211;'52225971282;EUR;+;81729,04;IT61N0321101600052225971282",
  "01/07/2026;'03211;'06240012345;EUR;+;40000,0;IT00A032110160006240012345",
  "01/07/2026;'03211;'0624998877;EUR;+;5000,0;IT00B03211016000624998877",
].join('\r\n');

describe('liquidità conto 0624 (mattiap)', () => {
  it('esclude dai saldi i conti che iniziano per 0624', () => {
    const res = parseFlussiCsvText(CASH_CON_0624, MATTIA());
    expect(res.cashAccounts.map(a => a.accountId)).toEqual(['52225971282']);
    expect(res.cashValue).toBeCloseTo(81729.04, 2);
  });

  it('proof-of-bug: senza la regola mattiap la liquidità 0624 entra nel totale', () => {
    const res = parseFlussiCsvText(CASH_CON_0624, getPortfolioParseOptions('other-id', 'other'));
    expect(res.cashAccounts).toHaveLength(3);
    expect(res.cashValue).toBeCloseTo(126729.04, 2);
  });

  it('non esclude un conto che contiene 0624 senza iniziare per 0624', () => {
    const csv = [
      'DATA RIFERIMENTO;CODICE ABI;NUMERO CONTO;DIVISA;SEGNO;SALDO EURO;IBAN;',
      "01/07/2026;'03211;'52062412345;EUR;+;1000,0;IT00C032110160052062412345",
    ].join('\r\n');
    const res = parseFlussiCsvText(csv, MATTIA());
    expect(res.cashAccounts.map(a => a.accountId)).toEqual(['52062412345']);
  });
});

const MOV_CASH_HEADER =
  'DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;DATA CONTABILE;DATA VALUTA;ANNO;' +
  'NUMERO CONTO;NUMERO OPERAZIONE;DESCRIZIONE OPERAZIONE;SEGNO;IMPORTO ORIGINARIO;' +
  'DIVISA IMPORTO ORIGINARIO;IMPORTO MOVIMENTO CONTO;DIVISA IMPORTO;CODICE CAUSALE;' +
  'DESCRIZIONE CAUSALE;IBAN;';

const MOV_CASH_CON_0624 = [
  MOV_CASH_HEADER,
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'52225971282;'26000167999001;" +
    'BONIFICO A VOSTRO FAVORE - MARIO ROSSI;+;15000,0;EUR;15000,0;EUR;00001200;BONIFICO IN VOSTRO FAVORE;IT61N0321101600052225971282',
  "07/07/2026;07/07/2026;'03211;06/07/2026;06/07/2026;2026;'06240012345;'26000167999002;" +
    'BONIFICO A VOSTRO FAVORE - MARIO ROSSI;+;9000,0;EUR;9000,0;EUR;00001200;BONIFICO IN VOSTRO FAVORE;IT00A032110160006240012345',
].join('\r\n');

describe('movimenti cash conto 0624 (mattiap)', () => {
  it('ignora i versamenti/prelievi del conto escluso, per non falsare il TWR', () => {
    const res = parseFlussiCsvText(MOV_CASH_CON_0624, MATTIA());
    expect(res.cashMovements.map(m => m.accountId)).toEqual(['52225971282']);
  });

  it('proof-of-bug: senza la regola mattiap il movimento 0624 verrebbe conteggiato', () => {
    const res = parseFlussiCsvText(MOV_CASH_CON_0624, getPortfolioParseOptions('other-id', 'other'));
    expect(res.cashMovements).toHaveLength(2);
  });
});

// ============================================================================
// I movimenti TITOLI del conto 0624 restano validi: l'esclusione è solo cash
// ============================================================================
const MOV_TITOLI_CON_0624 = [
  'DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;NUMERO CONTO;CODICE ISIN;DESC TITOLO;' +
    'DATA CONTABILE;DATA VALUTA;DATA OPERAZIONE;DATA REGISTRAZIONE;CAUSALE;QUANTITA;PREZZO SECCO;' +
    'DIVISA DEL TITOLO;LORDO EMITTENTE;PERC RITENUTA ESTERA;CAMBIO;RATEO;BOLLI;COMMISSIONI;' +
    'COMMISSIONI VALUTARIE;RITENUTE O CREDITO DI IMPOSTA;CONTROVALORE LORDO IN DIVISA DEL TITOLO;' +
    'CONTROVALORE LORDO IN EURO;CONTROVALORE NETTO IN DIVISA DEL CONTO;SPESE;ALTRI ONERI;IMPOSTE;IMPOSTE SGR',
  "04/07/2026;04/07/2026;'03211;'06240012345;;IRENF8C80;06/07/2026;06/07/2026;02/07/2026;" +
    '03/07/2026;ACQ;2;13,15;USD;80;0;1,1442;0;0;17,48;0;0;2630;2298,55;2316,03;0;0;0;0',
].join('\r\n');

describe('movimenti titoli conto 0624 (mattiap)', () => {
  it('mantiene le operazioni su titoli: la regola 0624 tocca solo la liquidità', () => {
    const res = parseFlussiCsvText(MOV_TITOLI_CON_0624, MATTIA());
    expect(res.titoliOptionTrades).toHaveLength(1);
    expect(res.titoliOptionTrades[0].contracts).toBe(2);
  });
});
