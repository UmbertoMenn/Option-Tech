import { useMemo, useState } from 'react';
import type { LegDecompositionRow } from '@/hooks/useDerivativeNetting';

// Palette e font allineati allo Stress Lab (variabili --stress-* theme-aware)
const C = {
  panel: 'hsl(var(--stress-panel))',
  panel2: 'hsl(var(--stress-panel2))',
  border: 'hsl(var(--stress-border))',
  border2: 'hsl(var(--stress-border2))',
  text: 'hsl(var(--stress-text))',
  mut: 'hsl(var(--stress-mut))',
  up: '#089981',
  dn: '#F23645',
  amber: '#F7A600',
  cyan: '#22AEC4',
};
const MONO = "'JetBrains Mono','SF Mono','Roboto Mono',ui-monospace,Menlo,monospace";

const fmtN = (v: number, dec = 2) =>
  v.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtEUR = (v: number, dec = 0) =>
  (v < 0 ? '−' : '') +
  Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) +
  ' €';
const pnlColor = (v: number) => (v > 0 ? C.up : v < 0 ? C.dn : C.mut);

/** "YYYY-MM-DD" → "MM/YY" */
function fmtExpiry(exp: string | null): string {
  if (!exp) return '—';
  const parts = exp.split('-');
  if (parts.length < 3) return exp;
  return `${parts[1]}/${parts[0].slice(2)}`;
}

type SortKey = 'ticker' | 'gamba' | 'q' | 'spot' | 'px' | 'intr' | 'tv' | 'tot';
type OptionFilter = 'all' | 'put' | 'call';
const OPTION_FILTERS = [
  { value: 'all', label: 'Tutte' },
  { value: 'put', label: 'Solo PUT' },
  { value: 'call', label: 'Solo CALL' },
] as const;

interface Props {
  rows: LegDecompositionRow[];
  viewMode: 'netting_total' | 'netting_intrinsic_a' | 'netting_intrinsic_b';
}

export function NettingLegDetailTable({ rows, viewMode }: Props) {
  const [sort, setSort] = useState<{ col: SortKey; dir: 'asc' | 'desc' }>({ col: 'tot', dir: 'asc' });
  const [optionFilter, setOptionFilter] = useState<OptionFilter>('all');
  const filteredRows = useMemo(
    () => optionFilter === 'all' ? rows : rows.filter((r) => r.optionType === optionFilter),
    [rows, optionFilter],
  );

  const sortedRows = useMemo(() => {
    const val = (r: LegDecompositionRow): number | string => {
      switch (sort.col) {
        case 'ticker': return r.ticker;
        case 'gamba': return (r.optionType === 'call' ? 'C' : 'P') + String(r.strike ?? 0).padStart(12, '0');
        case 'q': return r.quantity;
        case 'spot': return r.spot ?? -Infinity;
        case 'px': return r.optionPrice;
        case 'intr': return r.intrinsicCountedEUR;
        case 'tv': return viewMode !== 'netting_total' && r.atIntrinsic ? r.timeValueExcludedEUR : r.timeValueCountedEUR;
        case 'tot': return r.contribEUR;
      }
    };
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      let cmp: number;
      if (typeof va === 'string' || typeof vb === 'string') cmp = String(va).localeCompare(String(vb));
      else cmp = va - vb;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sort, viewMode]);

  const totals = useMemo(() => {
    let intr = 0, tvCounted = 0, tvExcluded = 0, tot = 0;
    for (const r of filteredRows) {
      intr += r.intrinsicCountedEUR;
      tvCounted += r.timeValueCountedEUR;
      tvExcluded += r.timeValueExcludedEUR;
      tot += r.contribEUR;
    }
    return { intr, tvCounted, tvExcluded, tot };
  }, [filteredRows]);

  if (rows.length === 0) {
    return (
      <div style={{ fontFamily: MONO, fontSize: 12, color: C.mut, textAlign: 'center', padding: '28px 0' }}>
        Nessuna gamba derivati da scomporre
      </div>
    );
  }

  const isEx = viewMode !== 'netting_total';
  const totalLabel = optionFilter === 'all' ? 'Totale derivati' : `Subtotale ${optionFilter.toUpperCase()}`;

  const th = (label: string, key: SortKey, align: 'left' | 'right', title: string) => (
    <th
      onClick={() =>
        setSort((s) =>
          s.col === key
            ? { col: key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
            : { col: key, dir: key === 'ticker' || key === 'gamba' ? 'asc' : 'desc' },
        )
      }
      title={title}
      style={{
        color: sort.col === key ? C.cyan : C.mut,
        fontWeight: 600,
        fontSize: 9.5,
        textTransform: 'uppercase',
        textAlign: align,
        position: 'sticky',
        top: 0,
        background: C.panel,
        zIndex: 5,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        padding: '4px 6px',
      }}
    >
      {label}
      {sort.col === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div style={{ fontFamily: MONO }}>
      <p style={{ fontSize: 10.5, color: C.mut, margin: '0 0 6px', lineHeight: 1.5 }}>
        Scomposizione per gamba del costo di chiusura in <b style={{ color: C.text }}>valore intrinseco</b> e{' '}
        <b style={{ color: C.text }}>valore temporale</b>.{' '}
        {isEx ? (
          <>
            In questa vista le gambe valutate a intrinseco (OTM escluse, ITM al solo intrinseco) hanno il{' '}
            <span style={{ color: C.amber }}>time value escluso</span> (badge{' '}
            <span style={{ color: C.amber, fontWeight: 800 }}>INT</span>, hold to expiry).
          </>
        ) : (
          <>Ogni gamba è valutata a mercato: il totale coincide con il valore intrinseco più il valore temporale.</>
        )}
      </p>

      <div
        role="group"
        aria-label="Filtra gambe per tipo di opzione"
        onPointerDownCapture={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}
      >
        {OPTION_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={optionFilter === value}
            onClick={() => setOptionFilter(value)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              border: `1px solid ${optionFilter === value ? C.cyan : C.border}`,
              background: optionFilter === value ? C.panel2 : C.panel,
              color: optionFilter === value ? C.cyan : C.mut, cursor: 'pointer',
            }}
          >
            {label} ({value === 'all' ? rows.length : rows.filter((r) => r.optionType === value).length})
          </button>
        ))}
      </div>

      <div
        onPointerDownCapture={(e) => e.stopPropagation()}
        style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 6 }}
      >
        <table
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontFamily: MONO,
            fontSize: 11,
            width: '100%',
            minWidth: 620,
          }}
        >
          <thead>
            <tr>
              {th('Sott.', 'ticker', 'left', 'Sottostante — clicca per ordinare')}
              {th('Gamba', 'gamba', 'left', 'Tipo, strike e scadenza — clicca per ordinare')}
              {th('Qtà', 'q', 'right', 'Contratti (segno) — clicca per ordinare')}
              {th('Spot', 'spot', 'right', 'Prezzo sottostante — clicca per ordinare')}
              {th('Prezzo', 'px', 'right', 'Prezzo opzione (nativo) — clicca per ordinare')}
              {th('Perdita intr.', 'intr', 'right', 'Perdita/valore intrinseco (EUR) — clicca per ordinare')}
              {th('Val. temp.', 'tv', 'right', 'Valore temporale (EUR) — clicca per ordinare')}
              {th('Totale', 'tot', 'right', 'Contributo al netting (EUR) — clicca per ordinare')}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '20px 6px', color: C.mut }}>
                  Nessuna gamba {optionFilter.toUpperCase()} presente
                </td>
              </tr>
            )}
            {sortedRows.map((r) => {
              const isCall = r.optionType === 'call';
              const kDec = (r.strike ?? 0) < 5 ? 3 : 0;
              const excluded = isEx && r.atIntrinsic;
              const tvShown = excluded ? r.timeValueExcludedEUR : r.timeValueCountedEUR;

              const intrLine =
                r.spot != null && r.strike != null
                  ? `Intrinseco = max(0, ${isCall ? `${fmtN(r.spot, 2)} − ${fmtN(r.strike, kDec)}` : `${fmtN(r.strike, kDec)} − ${fmtN(r.spot, 2)}`}) × ${Math.abs(r.quantity)} × 100 / ${fmtN(r.exchangeRate, 4)} = ${fmtEUR(r.intrinsicCountedEUR)}`
                  : 'Intrinseco: spot sottostante non disponibile';

              const tip = excluded
                ? `${r.ticker} ${isCall ? 'CALL' : 'PUT'} K${fmtN(r.strike ?? 0, kDec)} ${fmtExpiry(r.expiry)} · q ${r.quantity}\n` +
                  (r.spot != null ? `Spot ${fmtN(r.spot, 2)}\n` : '') +
                  `${intrLine}\n` +
                  (r.isOTM
                    ? `OTM in vista intrinseca: gamba esclusa, contributo 0.\n`
                    : `ITM: conta solo l'intrinseco (${fmtEUR(r.intrinsicCountedEUR)}).\n`) +
                  `Valore temporale ESCLUSO = MTM (${fmtEUR(r.marketValueEUR)}) − intrinseco (${fmtEUR(r.intrinsicCountedEUR)}) = ${fmtEUR(r.timeValueExcludedEUR)} (hold to expiry, non pagato).\n` +
                  `Totale gamba = ${fmtEUR(r.contribEUR)}`
                : `${r.ticker} ${isCall ? 'CALL' : 'PUT'} K${fmtN(r.strike ?? 0, kDec)} ${fmtExpiry(r.expiry)} · q ${r.quantity}\n` +
                  (r.spot != null ? `Spot ${fmtN(r.spot, 2)} · ` : '') +
                  `Prezzo opzione ${fmtN(r.optionPrice, 4)}\n` +
                  `MTM = q(${r.quantity}) × 100 × ${fmtN(r.optionPrice, 4)} / ${fmtN(r.exchangeRate, 4)} = ${fmtEUR(r.marketValueEUR)}\n` +
                  `${intrLine}\n` +
                  `Valore temporale = MTM (${fmtEUR(r.marketValueEUR)}) − intrinseco (${fmtEUR(r.intrinsicCountedEUR)}) = ${fmtEUR(r.timeValueCountedEUR)}\n` +
                  `Totale gamba = ${fmtEUR(r.contribEUR)}`;

              return (
                <tr key={r.positionId} title={tip} style={{ cursor: 'help', borderTop: `1px solid ${C.border}` }}>
                  <td style={{ color: C.text, fontWeight: 700, padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    {r.ticker}
                    {excluded && (
                      <span
                        style={{ color: C.amber, fontSize: 8.5, fontWeight: 800, marginLeft: 4 }}
                        title={r.isOTM ? 'OTM: gamba esclusa (vista intrinseca)' : 'ITM: valutata a intrinseco, time value escluso'}
                      >
                        INT
                      </span>
                    )}
                  </td>
                  <td style={{ color: C.mut, padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: isCall ? C.cyan : C.amber, fontWeight: 700 }}>
                      {isCall ? 'CALL' : 'PUT'}
                    </span>{' '}
                    {fmtN(r.strike ?? 0, kDec)} · {fmtExpiry(r.expiry)}
                  </td>
                  <td style={{ textAlign: 'right', color: r.quantity < 0 ? C.dn : C.up, fontWeight: 700, padding: '4px 6px' }}>
                    {r.quantity > 0 ? '+' : ''}
                    {r.quantity}
                  </td>
                  <td style={{ textAlign: 'right', color: C.mut, padding: '4px 6px' }}>
                    {r.spot != null ? fmtN(r.spot, r.spot < 5 ? 3 : 2) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: C.mut, padding: '4px 6px' }}>
                    {fmtN(r.optionPrice, r.optionPrice < 5 ? 3 : 2)}
                  </td>
                  <td style={{ textAlign: 'right', color: pnlColor(r.intrinsicCountedEUR), padding: '4px 6px' }}>
                    {Math.abs(r.intrinsicCountedEUR) < 0.5 ? '—' : fmtEUR(r.intrinsicCountedEUR)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: excluded ? C.mut : pnlColor(tvShown),
                      textDecoration: excluded ? 'line-through' : 'none',
                      fontStyle: excluded ? 'italic' : 'normal',
                      padding: '4px 6px',
                    }}
                  >
                    {Math.abs(tvShown) < 0.5 ? '—' : fmtEUR(tvShown)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(r.contribEUR), padding: '4px 6px' }}>
                    {Math.abs(r.contribEUR) < 0.5 ? '0 €' : fmtEUR(r.contribEUR)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${C.border2}`, background: C.panel2 }}>
              <td colSpan={5} style={{ color: C.text, fontWeight: 700, textTransform: 'uppercase', fontSize: 10, padding: '6px' }}>
                {totalLabel}
              </td>
              <td style={{ textAlign: 'right', color: pnlColor(totals.intr), fontWeight: 800, padding: '6px' }}>
                {fmtEUR(totals.intr)}
              </td>
              <td style={{ textAlign: 'right', color: pnlColor(totals.tvCounted), fontWeight: 800, padding: '6px' }}>
                {fmtEUR(totals.tvCounted)}
                {isEx && Math.abs(totals.tvExcluded) >= 0.5 && (
                  <div style={{ color: C.mut, fontStyle: 'italic', fontWeight: 500, fontSize: 9 }}>
                    escl. {fmtEUR(totals.tvExcluded)}
                  </div>
                )}
              </td>
              <td style={{ textAlign: 'right', color: pnlColor(totals.tot), fontWeight: 800, padding: '6px' }}>
                {fmtEUR(totals.tot)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
