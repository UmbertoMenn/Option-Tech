import { describe, expect, it } from 'vitest';
import {
  EMPTY_OPTION_LEG_FILTER,
  anyLegMatches,
  computeFilterFacets,
  describeOptionLegFilter,
  filterByLegs,
  formatExpiryLabel,
  legMatches,
  moneynessOf,
  normalizeExpiry,
  optionPositionsToLegs,
  toggleBucket,
  toggleExpiry,
  type FilterableLeg,
} from '@/lib/optionLegFilter';

const L = (optionType: 'call' | 'put', strike: number, spot: number | null, expiry: string | null = '2026-12-18'): FilterableLeg =>
  ({ optionType, strike, spot, expiry });

describe('moneynessOf', () => {
  it('call ITM sopra lo strike, put ITM sotto lo strike', () => {
    expect(moneynessOf(L('call', 100, 110))).toBe('call_itm');
    expect(moneynessOf(L('call', 100, 90))).toBe('call_otm');
    expect(moneynessOf(L('put', 100, 90))).toBe('put_itm');
    expect(moneynessOf(L('put', 100, 110))).toBe('put_otm');
  });

  it('ATM è OTM (intrinseco nullo) per call e put', () => {
    expect(moneynessOf(L('call', 100, 100))).toBe('call_otm');
    expect(moneynessOf(L('put', 100, 100))).toBe('put_otm');
  });

  it('senza spot, strike o tipo non è classificabile', () => {
    expect(moneynessOf(L('call', 100, null))).toBeNull();
    expect(moneynessOf(L('put', 0, 90))).toBeNull();
    expect(moneynessOf({ optionType: null, strike: 100, spot: 90, expiry: null })).toBeNull();
  });
});

describe('normalizeExpiry / formatExpiryLabel', () => {
  it('accetta ISO con orario e formato italiano', () => {
    expect(normalizeExpiry('2026-12-18T00:00:00Z')).toBe('2026-12-18');
    expect(normalizeExpiry('18/12/2026')).toBe('2026-12-18');
    expect(normalizeExpiry('dic-26')).toBeNull();
    expect(normalizeExpiry(null)).toBeNull();
    expect(formatExpiryLabel('2026-12-18')).toBe('18/12/26');
  });
});

describe('legMatches / anyLegMatches', () => {
  it('filtro vuoto lascia passare tutto, anche gambe non classificabili', () => {
    expect(anyLegMatches([L('call', 100, null)], EMPTY_OPTION_LEG_FILTER)).toBe(true);
    expect(anyLegMatches([], EMPTY_OPTION_LEG_FILTER)).toBe(true);
  });

  it('gamba senza spot esclusa con filtro ITM/OTM attivo', () => {
    expect(legMatches(L('put', 100, null), { buckets: ['put_otm'], expiries: [] })).toBe(false);
    expect(legMatches(L('put', 100, null), { buckets: [], expiries: ['2026-12-18'] })).toBe(true);
  });

  it('moneyness e scadenza in AND sulla STESSA gamba (proof-of-bug: non su gambe diverse)', () => {
    // Strategia con put ITM a dicembre e call OTM a gennaio:
    const legs = [L('put', 100, 90, '2026-12-18'), L('call', 120, 90, '2027-01-15')];
    expect(anyLegMatches(legs, { buckets: ['put_itm'], expiries: ['2027-01-15'] })).toBe(false);
    expect(anyLegMatches(legs, { buckets: ['put_itm'], expiries: ['2026-12-18'] })).toBe(true);
    expect(anyLegMatches(legs, { buckets: ['call_otm'], expiries: ['2027-01-15'] })).toBe(true);
  });

  it('selezioni multiple nella stessa dimensione in OR', () => {
    const f = { buckets: ['put_itm', 'call_itm'] as const, expiries: [] };
    expect(legMatches(L('call', 100, 110), { ...f, buckets: [...f.buckets] })).toBe(true);
    expect(legMatches(L('put', 100, 90), { ...f, buckets: [...f.buckets] })).toBe(true);
    expect(legMatches(L('put', 100, 110), { ...f, buckets: [...f.buckets] })).toBe(false);
  });

  it('elemento senza gambe escluso quando il filtro è attivo', () => {
    expect(anyLegMatches([], { buckets: ['put_itm'], expiries: [] })).toBe(false);
  });
});

describe('filterByLegs', () => {
  it('ritorna lo stesso array senza filtro e filtra per gambe con filtro', () => {
    const items = [{ id: 'a', legs: [L('put', 100, 90)] }, { id: 'b', legs: [L('call', 100, 90)] }];
    expect(filterByLegs(items, (i) => i.legs, EMPTY_OPTION_LEG_FILTER)).toBe(items);
    expect(filterByLegs(items, (i) => i.legs, { buckets: ['call_otm'], expiries: [] }).map((i) => i.id)).toEqual(['b']);
  });
});

describe('computeFilterFacets', () => {
  const items = [
    [L('put', 100, 90, '2026-12-18')],                                   // put ITM dic
    [L('put', 100, 110, '2027-01-15')],                                  // put OTM gen
    [L('put', 100, 90, '2027-01-15'), L('call', 120, 90, '2027-01-15')], // IC-like gen
  ];

  it('conta gli elementi (non le gambe) per bucket e scadenza', () => {
    const f = computeFilterFacets(items, EMPTY_OPTION_LEG_FILTER);
    expect(f.buckets).toEqual({ put_itm: 2, put_otm: 1, call_itm: 0, call_otm: 1 });
    expect(f.expiries.map((e) => [e.value, e.count])).toEqual([['2026-12-18', 1], ['2027-01-15', 2]]);
    expect(f.total).toBe(3);
    expect(f.matching).toBe(3);
  });

  it('i conteggi riflettono il risultato del click combinato con l\'altra dimensione', () => {
    const f = computeFilterFacets(items, { buckets: [], expiries: ['2027-01-15'] });
    expect(f.buckets.put_itm).toBe(1);
    expect(f.buckets.put_otm).toBe(1);
    const g = computeFilterFacets(items, { buckets: ['put_itm'], expiries: [] });
    expect(g.expiries.find((e) => e.value === '2027-01-15')?.count).toBe(1);
    expect(g.matching).toBe(2);
  });

  it('una scadenza selezionata resta disponibile anche se sparita dai dati', () => {
    const f = computeFilterFacets([[L('put', 100, 90, '2026-12-18')]], { buckets: [], expiries: ['2025-06-20'] });
    expect(f.expiries.map((e) => e.value)).toEqual(['2025-06-20', '2026-12-18']);
  });
});

describe('toggle / describe', () => {
  it('toggle aggiunge e rimuove, scadenze ordinate', () => {
    let f = toggleBucket(EMPTY_OPTION_LEG_FILTER, 'put_itm');
    f = toggleExpiry(toggleExpiry(f, '2027-01-15'), '2026-12-18');
    expect(f).toEqual({ buckets: ['put_itm'], expiries: ['2026-12-18', '2027-01-15'] });
    expect(describeOptionLegFilter(f)).toBe('PUT ITM · scad. 18/12/26, 15/01/27');
    expect(toggleBucket(f, 'put_itm').buckets).toEqual([]);
    expect(describeOptionLegFilter(EMPTY_OPTION_LEG_FILTER)).toBe('Tutte le opzioni');
  });
});

describe('optionPositionsToLegs', () => {
  it('ignora null e non-opzioni, normalizza il tipo e scarta spot non positivi', () => {
    const legs = optionPositionsToLegs(
      [
        { option_type: 'PUT', strike_price: 100, expiry_date: '2026-12-18' },
        null,
        undefined,
        { option_type: null, strike_price: null, expiry_date: null },
      ],
      0,
    );
    expect(legs).toEqual([{ optionType: 'put', strike: 100, expiry: '2026-12-18', spot: null }]);
  });
});
