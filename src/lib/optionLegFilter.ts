/**
 * Filtri trasversali sulle gambe opzioni: PUT ITM / PUT OTM / CALL ITM / CALL OTM
 * e scadenza. Logica pura, condivisa da Dashboard (tabella intrinseco/temporale),
 * Strategie Derivati (posizioni da monitorare + sezioni strategie) e Risk Analyzer
 * (Equity Exposure).
 *
 * Semantica:
 * - Selezione vuota = nessun filtro su quella dimensione (equivale a "Tutte").
 * - Selezioni multiple nella stessa dimensione sono in OR (PUT ITM + CALL ITM).
 * - Le due dimensioni sono in AND sulla STESSA gamba: "PUT ITM" + scadenza X
 *   richiede una put ITM che scada in X, non una put ITM qualsiasi più
 *   un'altra gamba in scadenza X.
 * - Un elemento multi-gamba (strategia) passa il filtro se ALMENO UNA delle sue
 *   gambe lo soddisfa: la strategia non si spezza, si mostra/somma per intero.
 * - Moneyness: CALL ITM se spot > strike, PUT ITM se spot < strike; ATM = OTM
 *   (intrinseco nullo). Senza spot o strike la gamba non è classificabile ed è
 *   esclusa quando è attivo un filtro ITM/OTM (resta visibile senza filtro).
 */

export type OptionKind = 'call' | 'put';
export type MoneynessBucket = 'put_itm' | 'put_otm' | 'call_itm' | 'call_otm';

export const MONEYNESS_BUCKETS: ReadonlyArray<{ value: MoneynessBucket; label: string }> = [
  { value: 'put_itm', label: 'PUT ITM' },
  { value: 'put_otm', label: 'PUT OTM' },
  { value: 'call_itm', label: 'CALL ITM' },
  { value: 'call_otm', label: 'CALL OTM' },
];

export interface FilterableLeg {
  optionType: OptionKind | null;
  strike: number | null;
  /** Scadenza (ISO "YYYY-MM-DD", eventuale orario ignorato). */
  expiry: string | null;
  /** Prezzo del sottostante usato per la moneyness; null se ignoto. */
  spot: number | null;
}

export interface OptionLegFilter {
  buckets: MoneynessBucket[];
  expiries: string[];
}

export const EMPTY_OPTION_LEG_FILTER: OptionLegFilter = Object.freeze({ buckets: [], expiries: [] }) as OptionLegFilter;

export function isOptionLegFilterActive(f: OptionLegFilter | null | undefined): boolean {
  return !!f && (f.buckets.length > 0 || f.expiries.length > 0);
}

/** Normalizza una scadenza a "YYYY-MM-DD"; null se non interpretabile. */
export function normalizeExpiry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  return null;
}

/** "2026-12-18" → "18/12/26" */
export function formatExpiryLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function moneynessOf(leg: FilterableLeg): MoneynessBucket | null {
  const strike = positive(leg.strike);
  const spot = positive(leg.spot);
  if (!leg.optionType || strike == null || spot == null) return null;
  if (leg.optionType === 'call') return spot > strike ? 'call_itm' : 'call_otm';
  return spot < strike ? 'put_itm' : 'put_otm';
}

export function legMatches(leg: FilterableLeg, f: OptionLegFilter): boolean {
  if (f.buckets.length > 0) {
    const b = moneynessOf(leg);
    if (!b || !f.buckets.includes(b)) return false;
  }
  if (f.expiries.length > 0) {
    const e = normalizeExpiry(leg.expiry);
    if (!e || !f.expiries.includes(e)) return false;
  }
  return true;
}

/** Filtro inattivo → sempre true; attivo → almeno una gamba deve soddisfarlo. */
export function anyLegMatches(legs: FilterableLeg[], f: OptionLegFilter): boolean {
  if (!isOptionLegFilterActive(f)) return true;
  return legs.some((l) => legMatches(l, f));
}

export function filterByLegs<T>(items: T[], getLegs: (item: T) => FilterableLeg[], f: OptionLegFilter): T[] {
  if (!isOptionLegFilterActive(f)) return items;
  return items.filter((it) => anyLegMatches(getLegs(it), f));
}

export interface ExpiryOption {
  value: string;
  label: string;
  /** Elementi che passerebbero il filtro scegliendo solo questa scadenza (con i bucket correnti). */
  count: number;
}

/**
 * Conteggi per i pulsanti: ogni bucket conta gli elementi che passerebbero con
 * SOLO quel bucket (mantenendo le scadenze selezionate); ogni scadenza conta gli
 * elementi che passerebbero con SOLO quella scadenza (mantenendo i bucket).
 * Così i numeri mostrati sono quelli che si otterranno cliccando.
 */
export function computeFilterFacets(
  itemsLegs: FilterableLeg[][],
  current: OptionLegFilter,
): { buckets: Record<MoneynessBucket, number>; expiries: ExpiryOption[]; total: number; matching: number } {
  const buckets = { put_itm: 0, put_otm: 0, call_itm: 0, call_otm: 0 } as Record<MoneynessBucket, number>;
  for (const { value } of MONEYNESS_BUCKETS) {
    const probe: OptionLegFilter = { buckets: [value], expiries: current.expiries };
    buckets[value] = itemsLegs.filter((legs) => anyLegMatches(legs, probe)).length;
  }
  const allExpiries = new Set<string>();
  for (const legs of itemsLegs) {
    for (const l of legs) {
      const e = normalizeExpiry(l.expiry);
      if (e) allExpiries.add(e);
    }
  }
  // Una scadenza selezionata resta in elenco anche se sparita dai dati (deselezionabile).
  for (const e of current.expiries) allExpiries.add(e);
  const expiries = [...allExpiries].sort().map((value) => {
    const probe: OptionLegFilter = { buckets: current.buckets, expiries: [value] };
    return {
      value,
      label: formatExpiryLabel(value),
      count: itemsLegs.filter((legs) => anyLegMatches(legs, probe)).length,
    };
  });
  return {
    buckets,
    expiries,
    total: itemsLegs.length,
    matching: itemsLegs.filter((legs) => anyLegMatches(legs, current)).length,
  };
}

export function toggleBucket(f: OptionLegFilter, b: MoneynessBucket): OptionLegFilter {
  return {
    ...f,
    buckets: f.buckets.includes(b) ? f.buckets.filter((x) => x !== b) : [...f.buckets, b],
  };
}

export function toggleExpiry(f: OptionLegFilter, e: string): OptionLegFilter {
  return {
    ...f,
    expiries: f.expiries.includes(e) ? f.expiries.filter((x) => x !== e) : [...f.expiries, e].sort(),
  };
}

/** Descrizione breve del filtro, per etichette e tooltip. */
export function describeOptionLegFilter(f: OptionLegFilter): string {
  if (!isOptionLegFilterActive(f)) return 'Tutte le opzioni';
  const parts: string[] = [];
  if (f.buckets.length > 0) {
    parts.push(MONEYNESS_BUCKETS.filter((b) => f.buckets.includes(b.value)).map((b) => b.label).join(' + '));
  }
  if (f.expiries.length > 0) {
    parts.push(`scad. ${f.expiries.map(formatExpiryLabel).join(', ')}`);
  }
  return parts.join(' · ');
}

/** Minimo comune delle posizioni opzione (Position e simili). */
export interface OptionPositionLike {
  option_type?: string | null;
  strike_price?: number | null;
  expiry_date?: string | null;
}

export function optionPositionToLeg(p: OptionPositionLike, spot: number | null): FilterableLeg {
  const t = (p.option_type || '').toLowerCase();
  return {
    optionType: t === 'call' || t === 'put' ? t : null,
    strike: p.strike_price ?? null,
    expiry: p.expiry_date ?? null,
    spot: positive(spot),
  };
}

/** Gambe di un elemento a partire dalle sue posizioni opzione (ignora null/undefined e non-opzioni). */
export function optionPositionsToLegs(
  positions: ReadonlyArray<OptionPositionLike | null | undefined>,
  spot: number | null,
): FilterableLeg[] {
  const out: FilterableLeg[] = [];
  for (const p of positions) {
    if (!p) continue;
    const leg = optionPositionToLeg(p, spot);
    if (leg.optionType) out.push(leg);
  }
  return out;
}
