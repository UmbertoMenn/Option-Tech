/** Formattazione e ordinamento condivisi dai pannelli del Portafoglio virtuale. */

export const fmtNum = (v: number, dec = 2) =>
  v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: dec });
export const fmtEUR = (v: number) =>
  (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' €';
export const fmtPct = (v: number, dec = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v) * 100, dec) + '%';
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

export const lbl = 'text-[11px] uppercase tracking-wide text-muted-foreground font-semibold';

export type SortDir = 'asc' | 'desc';
export interface SortState<C extends string> {
  col: C;
  dir: SortDir;
}

/** Confronto con null/undefined sempre in fondo (in entrambe le direzioni). */
export function cmp(a: string | number | null | undefined, b: string | number | null | undefined, dir: SortDir): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'it');
  return dir === 'asc' ? r : -r;
}
