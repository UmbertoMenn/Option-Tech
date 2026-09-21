import { describe, expect, it } from 'vitest';
import { classifyCashKind, parseMovementFile } from '@/lib/movementLedger';
import {
  StoredMovementRow,
  buildMovementAttributionInputs,
  buildMovementCoverage,
  mergeLegacyTrades,
  movementPeriodWarnings,
  periodCoverage,
} from '@/lib/movementAttribution';
import { calculatePerformanceAttribution, AttributionTradeRow } from '@/lib/performanceAttribution';
import { getPortfolioParseOptions } from '@/lib/portfolioUpload';
import { FullSnapshot } from '@/lib/fullSnapshot';
import { HistoricalDataEntry } from '@/types/historicalData';
import { Position } from '@/types/portfolio';

const CASH_HEADER = 'DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;DATA CONTABILE;DATA VALUTA;ANNO;NUMERO CONTO;NUMERO OPERAZIONE;DESCRIZIONE OPERAZIONE;SEGNO;IMPORTO ORIGINARIO;DIVISA IMPORTO ORIGINARIO;IMPORTO MOVIMENTO CONTO;DIVISA IMPORTO;CODICE CAUSALE;DESCRIZIONE CAUSALE;IBAN';
const TIT_HEADER = 'DATA INIZIO PERIODO;DATA FINE PERIODO;COD ABI;NUMERO CONTO;CODICE ISIN;DESC TITOLO;DATA CONTABILE;DATA VALUTA;DATA OPERAZIONE;DATA REGISTRAZIONE;CAUSALE;QUANTITA;PREZZO SECCO;DIVISA DEL TITOLO;LORDO EMITTENTE;PERC RITENUTA ESTERA;CAMBIO;RATEO;BOLLI;COMMISSIONI;COMMISSIONI VALUTARIE;RITENUTE O CREDITO DI IMPOSTA;CONTROVALORE LORDO IN DIVISA DEL TITOLO;CONTROVALORE LORDO IN EURO;CONTROVALORE NETTO IN DIVISA DEL CONTO;SPESE;ALTRI ONERI;IMPOSTE;IMPOSTE SGR;';

function cashLine(account: string, date: string, op: string, description: string, amount: string, code: string, causale: string): string {
  const sign = amount.startsWith('-') ? '-' : '+';
  return `01/08/2026;31/08/2026;'03211;${date};${date};2026;'${account};'${op};${description};${sign};${amount};EUR;${amount};EUR;${code};${causale};IT00`;
}

function titLine(fields: {
  account: string; isin?: string; desc: string; contabile: string; op: string; causale: string;
  qty: string; price: string; ccy?: string; fx: string; comm?: string; fxComm?: string; rit?: string;
  grossLocal: string; grossEur: string; net: string; altri?: string; imposte?: string;
}): string {
  const f = fields;
  return [
    '01/08/2026', '31/08/2026', "'03211", `'${f.account}`, f.isin ?? '', f.desc, f.contabile, f.contabile, f.op, f.op,
    f.causale, f.qty, f.price, f.ccy ?? 'USD', '0,0', '0,0', f.fx, '0,0', '0,0', f.comm ?? '0,0', f.fxComm ?? '0,0',
    f.rit ?? '0,0', f.grossLocal, f.grossEur, f.net, '0,0', f.altri ?? '0,0', f.imposte ?? '0,0', '0,0', '',
  ].join(';');
}

const CASH_CSV = [
  CASH_HEADER,
  cashLine('52805213452', '03/08/2026', '1', 'ACQUISTO TRAMITE POS - POS 0108 SUPERMERCATO', '-50', '20000007', 'ACQUISTO TRAMITE POS'),
  cashLine('B0805213453', '06/08/2026', '2', 'DIVIDENDI - US46625H1005 - JPMORGAN CHASE & CO', '134,78', '71000023', 'DIVIDENDI'),
  cashLine('52805213453', '21/08/2026', '3', 'ESERCIZIO OPZIONI - WESTERN DIGITAL CORP', '-47085,01', '71000030', 'ESERCIZIO OPZIONI'),
  cashLine('52805213453', '25/08/2026', '4', 'ADDEBITO PER IMPOSTA CAPITAL GAIN - CAPITAL GAIN AGO. 26', '-630,52', '00005064', 'ADDEBITO PER IMPOSTA CAPITAL GAIN'),
  cashLine('52805213453', '28/07/2026', '5', 'ADDEBITO PER RECUPERO BOLLI - 0602805213452 MAG-GIU 2026', '-1483,3', '00005027', 'ADDEBITO PER RECUPERO BOLLI'),
  cashLine('52805213453', '26/08/2026', '6', 'ACCREDITO PER COMMISSIONI / VARIAZIONE GIORNALIERA DERIVATI - VARIAZ.GIORN.DERIVATI', '8787,49', '76000008', 'ACCREDITO PER COMMISSIONI / VARIAZIONE GIORNALIERA DERIVATI'),
  cashLine('52805213453', '25/08/2026', '7', 'ADDEBITO PER COMMISSIONI SU DERIVATI - TOT. COMMISS. DERIVATI', '-34,28', '76000005', 'ADDEBITO PER COMMISSIONI SU DERIVATI'),
  cashLine('52805213453', '03/08/2026', '8', 'ACQUISTO TITOLI - META PLATFORMS INC', '-20197,75', '71000019', 'ACQUISTO TITOLI'),
].join('\r\n');

const TIT_CSV = [
  TIT_HEADER,
  titLine({ account: '02805213452', isin: 'US9581021055', desc: 'WESTERN DIGITAL CORP', contabile: '21/08/2026', op: '20/08/2026', causale: 'ACQ', qty: '100,0', price: '550,0', fx: '1,1681', grossLocal: '55000,0', grossEur: '47085,01', net: '47085,01' }),
  titLine({ account: '02805213452', isin: 'US9581021055', desc: 'WESTERN DIGITAL CORP', contabile: '24/08/2026', op: '21/08/2026', causale: 'VEN', qty: '100,0', price: '461,3005', fx: '1,167', comm: '8,57', altri: '8,57', grossLocal: '46130,05', grossEur: '39528,75', net: '39511,61' }),
  titLine({ account: '02805213452', desc: 'WDCQ6P550', contabile: '21/08/2026', op: '20/08/2026', causale: 'EPV', qty: '1,0', price: '0,0', fx: '1,1347991', grossLocal: '6190,0', grossEur: '5454,71', net: '0,0' }),
  titLine({ account: '02805213452', desc: 'MUQ6P780', contabile: '24/08/2026', op: '21/08/2026', causale: 'APV', qty: '1,0', price: '0,0', fx: '1,1409991', grossLocal: '0,0', grossEur: '0,0', net: '0,0' }),
  titLine({ account: '02805213452', desc: 'WDCU6P550', contabile: '24/08/2026', op: '21/08/2026', causale: 'VEN', qty: '1,0', price: '97,0', fx: '1,167', comm: '8,57', grossLocal: '9700,0', grossEur: '8311,91', net: '8303,34' }),
  titLine({ account: '02805213452', desc: 'UBERU6C82.5', contabile: '24/08/2026', op: '21/08/2026', causale: 'VEN', qty: '3,0', price: '1,85', fx: '1,167', comm: '25,71', grossLocal: '555,0', grossEur: '475,58', net: '449,87' }),
  titLine({ account: '02805213452', isin: 'IT0005634792', desc: 'BTP PIU 33 OPZ.PUT', contabile: '25/08/2026', op: '25/08/2026', causale: 'CED', qty: '230000,0', price: '0,7125', ccy: 'EUR', fx: '1,0', rit: '204,84', imposte: '204,84', grossLocal: '1638,75', grossEur: '1638,75', net: '1433,91' }),
  titLine({ account: '02805213452', isin: 'US0378331005', desc: 'APPLE INC', contabile: '20/08/2026', op: '07/08/2026', causale: 'DIV', qty: '200,0', price: '0,2295', fx: '1,1604', comm: '1,81', fxComm: '0,5', rit: '10,29', imposte: '10,29', grossLocal: '45,9', grossEur: '39,56', net: '26,96' }),
  titLine({ account: '08805213453', isin: 'US46625H1005', desc: 'JPMORGAN CHASE & CO', contabile: '06/08/2026', op: '03/07/2026', causale: 'DIV', qty: '122,0', price: '1,275', fx: '1,1541', comm: '9,46', fxComm: '0,61', grossLocal: '155,55', grossEur: '134,78', net: '124,71' }),
].join('\r\n');

const silvias = getPortfolioParseOptions('silvia-id', 'silvias');

function stored(rows: ReturnType<typeof parseMovementFile>['rows'], extra: Partial<StoredMovementRow> = {}): StoredMovementRow[] {
  return rows.map(row => ({
    ...row,
    underlyingKey: row.underlyingTicker ?? null,
    underlyingPrice: null,
    intrinsicPerShare: null,
    timeValuePerShare: null,
    attributionPriceSource: null,
    manualTimeValuePerShare: null,
    ...extra,
  }));
}

describe('parseMovementFile — perimetro silvias', () => {
  it('flusso cash: solo il conto che inizia per 52 e finisce per 53', () => {
    const res = parseMovementFile(CASH_CSV, silvias);
    expect(res.source).toBe('cash');
    expect(new Set(res.rows.map(r => r.accountId))).toEqual(new Set(['52805213453']));
    // 52...452 (spese personali) e B0...453 (liquidità GP) fuori perimetro
    expect(res.excludedByAccountRule).toBe(2);
  });

  it('regressione: la regola 452 del cash non scarta il dossier titoli 02...452', () => {
    const res = parseMovementFile(TIT_CSV, silvias);
    expect(res.source).toBe('titoli');
    expect(res.excludedByAccountRule).toBe(0);
    expect(res.rows.filter(r => r.accountId === '02805213452')).toHaveLength(8);
    // Il deposito GP 08... resta nel ledger ma come interno alla gestione
    expect(res.rows.find(r => r.accountId === '08805213453')?.scope).toBe('gp');
  });
});

describe('parseMovementFile — classificazione e quadratura', () => {
  it('classifica le righe cash e segna quelle già rappresentate nei movimenti titoli', () => {
    const res = parseMovementFile(CASH_CSV, silvias);
    const kindOf = (fragment: string) => res.rows.find(r => r.description.includes(fragment))?.kind;
    expect(kindOf('CAPITAL GAIN')).toBe('capital_gain_tax');
    expect(kindOf('RECUPERO BOLLI')).toBe('bolli');
    expect(kindOf('ESERCIZIO OPZIONI')).toBe('covered_by_titoli');
    expect(kindOf('VARIAZ.GIORN')).toBe('covered_by_titoli');
    expect(kindOf('TOT. COMMISS')).toBe('covered_by_titoli');
    expect(classifyCashKind('', 'BONIFICO A VOSTRO FAVORE DA ROSSI', '', 1000)).toBe('external_transfer');
    expect(classifyCashKind('00005119', 'ADDEBITO PER CANONI SERVIZI DI TRADING ON LINE - CANONE BORSE', '', -4)).toBe('fee');
  });

  it('ricostruisce costi e imposte dei movimenti titoli quadrando con il netto banca', () => {
    const res = parseMovementFile(TIT_CSV, silvias);
    const sale = res.rows.find(r => r.isin === 'US9581021055' && r.kind === 'sell')!;
    expect(sale.commissionEur).toBeCloseTo(17.14, 2); // commissioni + altri oneri
    expect(sale.netEur).toBeCloseTo(39511.61, 2);
    expect(sale.unexplainedChargeEur).toBe(0);
    expect(sale.effectiveDate).toBe('2026-08-21'); // data operazione

    const coupon = res.rows.find(r => r.kind === 'coupon')!;
    // RITENUTE e IMPOSTE riportano lo stesso importo: contato una volta sola
    expect(coupon.taxEur).toBeCloseTo(204.84, 2);
    expect(coupon.unexplainedChargeEur).toBe(0);
    expect(coupon.effectiveDate).toBe('2026-08-25'); // data contabile

    const dividend = res.rows.find(r => r.kind === 'dividend' && r.scope === 'portfolio')!;
    expect(dividend.commissionEur + dividend.fxCommissionEur + dividend.taxEur).toBeCloseTo(12.6, 2);
    expect(dividend.unexplainedChargeEur).toBe(0);

    const exercise = res.rows.find(r => r.kind === 'option_exercise')!;
    expect(exercise).toMatchObject({ positionSide: 'short', optionType: 'put', strike: 550, underlyingTicker: 'WDC', netEur: 0 });
    expect(res.rows.find(r => r.kind === 'option_expiry')?.descriptor).toBe('MUQ6P780');
    expect(res.rows.find(r => r.descriptor === 'UBERU6C82.5')?.strike).toBe(82.5);
  });

  it('chiavi naturali stabili e uniche: ricaricare lo stesso file non duplica', () => {
    const first = parseMovementFile(TIT_CSV, silvias).rows.map(r => r.rowKey);
    const second = parseMovementFile(TIT_CSV, silvias).rows.map(r => r.rowKey);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);

    const duplicated = parseMovementFile(`${TIT_CSV}\r\n${TIT_CSV.split('\r\n')[5]}`, silvias).rows.map(r => r.rowKey);
    expect(new Set(duplicated).size).toBe(duplicated.length); // eseguito identico: occorrenza distinta
  });
});

function snapshot(date: string, cash: number, positions: Partial<Position>[] = []): FullSnapshot {
  return {
    portfolio_id: 'pf1',
    snapshot_date: date,
    positions: positions.map((p, i) => ({
      id: `${date}-${i}`, portfolio_id: 'pf1', isin: null, ticker: null, description: '', asset_type: 'stock',
      currency: 'EUR', exchange_rate: 1, quantity: 0, current_price: null, avg_cost: null, market_value: null,
      profit_loss: null, profit_loss_pct: null, weight_pct: null, option_type: null, strike_price: null,
      expiry_date: null, underlying: null, snapshot_price: null, snapshot_market_value: null, created_at: '', updated_at: '',
      ...p,
    } as Position)),
    strategy_configurations: [],
    derivative_overrides: [],
    gp_holdings: [],
    cash_value: cash,
    gp_total_value: null,
  };
}

function historical(date: string, netting: number, spots: Record<string, number> = {}): HistoricalDataEntry {
  return {
    id: date, portfolio_id: 'pf1', snapshot_date: date, total_value: netting, netting_total: netting,
    netting_ex_cc: netting, netting_ex_cc_np: netting, netting_intrinsic_b: netting, deposits: 0,
    average_balance: 0, equity_exposure_pct: 0, usd_exposure_pct: 0, snapshot_underlying_prices: spots,
    created_at: '', updated_at: '',
  };
}

const amountOf = (result: ReturnType<typeof calculatePerformanceAttribution>, category: string) =>
  result.items.find(item => item.category === category)?.amount ?? 0;

describe('buildMovementAttributionInputs', () => {
  const rows = [
    ...stored(parseMovementFile(CASH_CSV, silvias).rows),
    ...stored(parseMovementFile(TIT_CSV, silvias).rows),
  ];
  const uploads = [
    { source: 'cash' as const, periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    { source: 'titoli' as const, periodStart: '2026-08-01', periodEnd: '2026-08-31' },
  ];
  const snaps = [snapshot('2026-08-03', 0, [{ description: 'META PLATFORMS INC', isin: 'US30303M1027', asset_type: 'stock' }])];
  const inputs = buildMovementAttributionInputs({ rows, uploads, snapshots: snaps });

  it('appaia l’esercizio della put con l’acquisto a strike e lo trasforma in assegnazione', () => {
    const asg = inputs.trades.filter(t => t.side === 'ASG');
    expect(asg).toHaveLength(1);
    expect(asg[0]).toMatchObject({ basis_key: 'US9581021055', quantity: 100, price: 550, option_type: 'put', asset_type: 'stock', position_side: 'short' });
    // L'acquisto a strike non è contato una seconda volta come ACQ
    expect(inputs.trades.some(t => t.basis_key === 'US9581021055' && t.side === 'ACQ')).toBe(false);
    // Il titolo mai presente negli snapshot è classificato azione dal controvalore
    expect(inputs.trades.find(t => t.basis_key === 'US9581021055' && t.side === 'VEN')?.asset_type).toBe('stock');
  });

  it('separa proventi lordi, commissioni, ritenute, bolli e imposta capital gain', () => {
    const total = (category: string, kind: string) => inputs.cashEvents
      .filter(e => e.category === category && e.kind === kind)
      .reduce((s, e) => s + e.amount, 0);
    expect(total('bond', 'income')).toBeCloseTo(1638.75, 2);
    expect(total('stock', 'income')).toBeCloseTo(39.56, 2);
    expect(total('capital_gain_tax', 'cost')).toBeCloseTo(630.52, 2);
    expect(total('taxes', 'cost')).toBeCloseTo(1483.3 + 204.84 + 10.29, 2);
    // opzioni 8,57 + 25,71; vendita WDC 17,14; spese/valutarie dividendo 2,31
    expect(total('fees', 'cost')).toBeCloseTo(8.57 + 25.71 + 17.14 + 2.31, 2);
    // Il dividendo GP (deposito 08...) non genera flussi né costi del portafoglio
    expect(inputs.gpInternal).toHaveLength(1);
  });

  it('riconosce le righe cash già coperte dai titoli e ricostruisce le orfane', () => {
    // Premi netti (8.787,49) e commissioni (34,28) del 21/08 coperti dai movimenti titoli
    expect(inputs.orphanOptionPremiums).toHaveLength(0);
    expect(inputs.cashEvents.some(e => e.date === '2026-08-25' && e.category === 'fees')).toBe(false);
    // Acquisto META solo in cash (movimento titoli nel file del mese precedente)
    const meta = inputs.trades.find(t => t.kind === 'movement_cash_fallback');
    expect(meta).toMatchObject({ basis_key: 'US30303M1027', side: 'ACQ', asset_type: 'stock', trade_date: '2026-08-03', gross_eur: 20197.75 });
    expect(inputs.orphanCash).toHaveLength(1);
  });

  it('il ledger storico nelle finestre coperte viene sostituito dai movimenti', () => {
    const legacy: AttributionTradeRow[] = [
      { basis_key: 'US9581021055', trade_date: '2026-08-21', side: 'ASG', quantity: 100, price: 550 },
      { basis_key: 'US0000000001', trade_date: '2026-07-17', side: 'ASG', quantity: 100, price: 120 },
    ];
    const merged = mergeLegacyTrades([], legacy, inputs.titoliWindows);
    expect(merged.map(t => t.trade_date)).toEqual(['2026-07-17']);
  });

  it('copertura del periodo e avvisi', () => {
    expect(periodCoverage(inputs.titoliWindows, '2026-07-31', '2026-08-27')).toBe('full');
    expect(periodCoverage(inputs.titoliWindows, '2026-07-24', '2026-08-27')).toBe('partial');
    expect(periodCoverage(inputs.titoliWindows, '2026-06-01', '2026-06-30')).toBe('none');
    const warnings = movementPeriodWarnings(inputs, '2026-07-31', '2026-08-27', 0);
    expect(warnings.some(w => w.includes('senza il movimento titoli'))).toBe(true);
  });
});

describe('calculatePerformanceAttribution con movimenti', () => {
  it('costi e proventi escono dalla Liquidità: classi e costi riconciliano il P/L', () => {
    // T0: 10.000 cash. Nel periodo: acquisto azioni 5.000 + commissioni 10,
    // dividendo lordo 100 con ritenuta 26. T1: azioni 5.200, cash 5.064.
    const start = snapshot('2026-08-01', 10_000);
    const end = snapshot('2026-08-31', 5_064, [{ isin: 'US0000000009', description: 'ACME', asset_type: 'stock', quantity: 10, snapshot_market_value: 5_200 }]);
    const result = calculatePerformanceAttribution({
      startSnapshot: start,
      endSnapshot: end,
      startHistorical: historical('2026-08-01', 10_000),
      endHistorical: historical('2026-08-31', 10_264),
      allHistoricalData: [],
      deposits: [],
      trades: [{ basis_key: 'US0000000009', trade_date: '2026-08-05', side: 'ACQ', quantity: 10, price: 500, asset_type: 'stock', gross_eur: 5_000 }],
      internalTransfers: [],
      cashEvents: [
        { date: '2026-08-05', kind: 'cost', category: 'fees', amount: 10, label: 'Commissioni compravendita titoli' },
        { date: '2026-08-20', kind: 'income', category: 'stock', amount: 100, label: 'Dividendi (lordi)' },
        { date: '2026-08-20', kind: 'cost', category: 'taxes', amount: 26, label: 'Ritenute su dividendi e cedole' },
        { date: '2026-08-25', kind: 'cost', category: 'capital_gain_tax', amount: 0, label: 'Addebiti imposta capital gain' },
      ],
      movementCoverage: { hasUploads: true, titoli: 'full', cash: 'full' },
    });
    expect(result.totalPL).toBeCloseTo(264, 6);
    expect(amountOf(result, 'stock')).toBeCloseTo(300, 6); // 5.200 − 0 − (5.000 − 100)
    expect(amountOf(result, 'fees')).toBeCloseTo(-10, 6);
    expect(amountOf(result, 'taxes')).toBeCloseTo(-26, 6);
    expect(amountOf(result, 'cash')).toBeCloseTo(0, 6);
    expect(amountOf(result, 'reconciliation_gap')).toBeCloseTo(0, 6);
    const stock = result.items.find(item => item.category === 'stock')!;
    expect(stock.breakdown).toEqual([
      { label: 'Acquisti', amount: 5_000 },
      { label: 'Dividendi (lordi)', amount: -100 },
    ]);
    expect(result.items.find(item => item.category === 'fees')?.status).toBe('calculated');
  });

  it('assegnazione put dai movimenti: la perdita resta sull’opzione, le azioni partono dallo spot', () => {
    // Short put 550 valutata 60 (spot 500: intrinseco 50, tempo 10). Esercizio
    // con spot 490: azioni in carico a 55.000, valore di mercato 49.000.
    const option = {
      asset_type: 'derivative' as const, ticker: 'WDC', underlying: 'WDC', option_type: 'put' as const,
      strike_price: 550, expiry_date: '2026-08-21', quantity: -1, snapshot_price: 60,
    };
    const start = snapshot('2026-08-11', 50_000, [option]);
    const end = snapshot('2026-08-25', -5_000, [{ isin: 'US9581021055', description: 'WESTERN DIGITAL CORP', asset_type: 'stock', quantity: 100, snapshot_market_value: 49_000 }]);
    const rows = stored([
      ...parseMovementFile([TIT_HEADER, TIT_CSV.split('\r\n')[1], TIT_CSV.split('\r\n')[3]].join('\r\n'), silvias).rows,
    ]).map(row => row.kind === 'option_exercise' ? { ...row, underlyingPrice: 490 } : { ...row, exchangeRate: 1, grossEur: 55_000, netEur: -55_000 });
    const inputs = buildMovementAttributionInputs({ rows, uploads: [{ source: 'titoli', periodStart: '2026-08-01', periodEnd: '2026-08-31' }], snapshots: [start, end] });
    const result = calculatePerformanceAttribution({
      startSnapshot: start,
      endSnapshot: end,
      startHistorical: historical('2026-08-11', 44_000, { WDC: 500 }),
      endHistorical: historical('2026-08-25', 44_000, { WDC: 490 }),
      allHistoricalData: [],
      deposits: [],
      trades: inputs.trades,
      internalTransfers: [],
      cashEvents: inputs.cashEvents,
      positionEvents: inputs.positionEvents,
      movementCoverage: buildMovementCoverage(inputs, '2026-08-11', '2026-08-25'),
    });
    expect(result.totalPL).toBeCloseTo(0, 6);
    expect(amountOf(result, 'option_intrinsic')).toBeCloseTo(-1_000, 6); // 5.000 a T0 − 6.000 estinti
    expect(amountOf(result, 'option_time')).toBeCloseTo(1_000, 6);
    expect(amountOf(result, 'stock')).toBeCloseTo(0, 6);
    expect(amountOf(result, 'cash')).toBeCloseTo(0, 6);
    expect(amountOf(result, 'reconciliation_gap')).toBeCloseTo(0, 6);
    expect(result.coverage.uncoveredPositionChanges).toEqual([]);
  });

  it('put venduta ITM: come premio conta solo il valore temporale, l’intrinseco resta sulla sua riga', () => {
    // Strike 550, spot 500 alla data operazione, premio 60 → intrinseco 50, tempo 10.
    const line = titLine({ account: '02805213452', desc: 'WDCU6P550', contabile: '21/08/2026', op: '20/08/2026', causale: 'VEN', qty: '1,0', price: '60,0', fx: '1,0', grossLocal: '6000,0', grossEur: '6000,0', net: '6000,0' });
    const rows = stored(parseMovementFile([TIT_HEADER, line].join('\r\n'), silvias).rows, { underlyingPrice: 500 });
    const option = {
      asset_type: 'derivative' as const, ticker: 'WDC', underlying: 'WDC', option_type: 'put' as const,
      strike_price: 550, expiry_date: '2026-09-18', quantity: -1, snapshot_price: 60,
    };
    const start = snapshot('2026-08-11', 0);
    const end = snapshot('2026-08-25', 6_000, [option]);
    const inputs = buildMovementAttributionInputs({ rows, uploads: [{ source: 'titoli', periodStart: '2026-08-01', periodEnd: '2026-08-31' }], snapshots: [start, end] });
    const result = calculatePerformanceAttribution({
      startSnapshot: start,
      endSnapshot: end,
      startHistorical: historical('2026-08-11', 0, { WDC: 500 }),
      endHistorical: historical('2026-08-25', 0, { WDC: 500 }),
      allHistoricalData: [],
      deposits: [],
      trades: inputs.trades,
      internalTransfers: [],
      cashEvents: inputs.cashEvents,
      movementCoverage: buildMovementCoverage(inputs, '2026-08-11', '2026-08-25'),
    });
    const time = result.items.find(item => item.category === 'option_time')!;
    const intrinsic = result.items.find(item => item.category === 'option_intrinsic')!;
    expect(time.label).toBe('Premi temporali opzioni');
    expect(time.breakdown).toEqual([{ label: 'Premi temporali incassati (vendite)', amount: -1_000 }]);
    expect(intrinsic.breakdown).toEqual([{ label: 'Intrinseco incassato (vendite)', amount: -5_000 }]);
    // Apertura senza movimento di prezzo: nessun utile né sul tempo né sull'intrinseco.
    expect(time.amount).toBeCloseTo(0, 6);
    expect(intrinsic.amount).toBeCloseTo(0, 6);
  });

  it('senza file movimenti le righe di costo restano nascoste', () => {
    const result = calculatePerformanceAttribution({
      startSnapshot: snapshot('2026-08-01', 1_000),
      endSnapshot: snapshot('2026-08-31', 1_000),
      startHistorical: historical('2026-08-01', 1_000),
      endHistorical: historical('2026-08-31', 1_000),
      allHistoricalData: [],
      deposits: [],
      trades: [],
      internalTransfers: [],
    });
    expect(result.items.find(item => item.category === 'fees')?.status).toBe('no_activity');
    expect(result.items.find(item => item.category === 'capital_gain_tax')?.status).toBe('no_activity');
  });
});
