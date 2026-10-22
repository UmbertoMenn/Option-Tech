import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  EMPTY_OPTION_LEG_FILTER,
  MONEYNESS_BUCKETS,
  computeFilterFacets,
  isOptionLegFilterActive,
  toggleBucket,
  toggleExpiry,
  type FilterableLeg,
  type OptionLegFilter,
} from '@/lib/optionLegFilter';

/**
 * Barra filtri condivisa: PUT ITM / PUT OTM / CALL ITM / CALL OTM + scadenze.
 * Multi-selezione (OR) dentro ogni gruppo, "Tutte" azzera il gruppo.
 * I conteggi indicano quanti elementi resterebbero cliccando quel pulsante.
 *
 * `itemsLegs` = una lista di gambe per ogni elemento filtrabile (riga, strategia, …).
 * Gli eventi click/pointer non risalgono: la barra può stare dentro un trigger
 * di Collapsible o una riga cliccabile senza aprirla/chiuderla.
 */
interface Props {
  value: OptionLegFilter;
  onChange: (next: OptionLegFilter) => void;
  itemsLegs: FilterableLeg[][];
  /** 'stress' = palette/font dello Stress Lab (tabella dashboard), 'app' = shadcn/tailwind. */
  variant?: 'app' | 'stress';
  className?: string;
  /** Nasconde la riga scadenze se non c'è nessuna scadenza nota. */
  hideEmptyExpiries?: boolean;
  ariaLabel?: string;
  /** false = solo filtro scadenza (es. Posizioni da monitorare, già ITM/OTM per costruzione). */
  showMoneyness?: boolean;
}

const S = {
  panel: 'hsl(var(--stress-panel))',
  panel2: 'hsl(var(--stress-panel2))',
  border: 'hsl(var(--stress-border))',
  mut: 'hsl(var(--stress-mut))',
  cyan: '#22AEC4',
};

const BUCKET_TONE: Record<string, string> = {
  put_itm: 'data-[on=true]:border-red-500/60 data-[on=true]:bg-red-500/15 data-[on=true]:text-red-400',
  put_otm: 'data-[on=true]:border-amber-500/60 data-[on=true]:bg-amber-500/15 data-[on=true]:text-amber-400',
  call_itm: 'data-[on=true]:border-emerald-500/60 data-[on=true]:bg-emerald-500/15 data-[on=true]:text-emerald-400',
  call_otm: 'data-[on=true]:border-sky-500/60 data-[on=true]:bg-sky-500/15 data-[on=true]:text-sky-400',
};

export function OptionLegFilterBar({
  value,
  onChange,
  itemsLegs,
  variant = 'app',
  className,
  hideEmptyExpiries = true,
  ariaLabel = 'Filtri opzioni',
  showMoneyness = true,
}: Props) {
  const facets = useMemo(() => computeFilterFacets(itemsLegs, value), [itemsLegs, value]);
  const stress = variant === 'stress';
  const active = isOptionLegFilterActive(value);

  const stop = {
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onPointerDownCapture: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  };

  const chip = (
    key: string,
    label: string,
    on: boolean,
    onClick: () => void,
    opts: { count?: number; tone?: string; title?: string; disabled?: boolean } = {},
  ) => {
    const text = opts.count != null ? `${label} (${opts.count})` : label;
    if (stress) {
      const style: CSSProperties = {
        padding: '4px 9px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        border: `1px solid ${on ? S.cyan : S.border}`,
        background: on ? S.panel2 : S.panel,
        color: on ? S.cyan : S.mut,
        cursor: opts.disabled ? 'default' : 'pointer',
        opacity: opts.disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
      };
      return (
        <button key={key} type="button" aria-pressed={on} title={opts.title} disabled={opts.disabled} onClick={onClick} style={style}>
          {text}
        </button>
      );
    }
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        data-on={on}
        title={opts.title}
        disabled={opts.disabled}
        onClick={onClick}
        className={cn(
          'h-6 rounded-md border px-2 text-[11px] font-semibold whitespace-nowrap transition-colors',
          'border-border bg-background text-muted-foreground hover:bg-muted/60',
          'data-[on=true]:border-primary/60 data-[on=true]:bg-primary/15 data-[on=true]:text-primary',
          opts.tone,
          'disabled:opacity-40 disabled:hover:bg-background disabled:cursor-default',
        )}
      >
        {text}
      </button>
    );
  };

  const labelStyle: CSSProperties | undefined = stress
    ? { fontSize: 10, color: S.mut, textTransform: 'uppercase', fontWeight: 600, minWidth: 58 }
    : undefined;
  const labelClass = stress ? undefined : 'text-[10px] uppercase tracking-wider font-semibold text-muted-foreground w-16 shrink-0';
  const rowStyle: CSSProperties | undefined = stress ? { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 } : undefined;
  const rowClass = stress ? undefined : 'flex flex-wrap items-center gap-1.5';

  const showExpiries = !hideEmptyExpiries || facets.expiries.length > 0;
  if (!showMoneyness && !showExpiries) return null;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      {...stop}
      className={cn(!stress && 'space-y-1.5', className)}
      style={stress ? { display: 'flex', flexDirection: 'column', gap: 6 } : undefined}
    >
      {showMoneyness && (
      <div className={rowClass} style={rowStyle}>
        <span className={labelClass} style={labelStyle}>Opzioni</span>
        {chip('all-b', 'Tutte', value.buckets.length === 0, () => onChange({ ...value, buckets: [] }), {
          title: 'Nessun filtro ITM/OTM',
        })}
        {MONEYNESS_BUCKETS.map((b) => {
          const on = value.buckets.includes(b.value);
          const count = facets.buckets[b.value];
          return chip(b.value, b.label, on, () => onChange(toggleBucket(value, b.value)), {
            count,
            tone: BUCKET_TONE[b.value],
            disabled: !on && count === 0,
            title: b.value.endsWith('itm')
              ? `${b.label}: ${b.value.startsWith('call') ? 'spot > strike' : 'spot < strike'} (multi-selezione)`
              : `${b.label}: ${b.value.startsWith('call') ? 'spot ≤ strike' : 'spot ≥ strike'} (multi-selezione)`,
          });
        })}
      </div>
      )}
      {showExpiries && (
        <div className={rowClass} style={rowStyle}>
          <span className={labelClass} style={labelStyle}>Scadenza</span>
          {chip('all-e', 'Tutte', value.expiries.length === 0, () => onChange({ ...value, expiries: [] }), {
            title: 'Nessun filtro per scadenza',
          })}
          {facets.expiries.map((e) => {
            const on = value.expiries.includes(e.value);
            return chip(`e-${e.value}`, e.label, on, () => onChange(toggleExpiry(value, e.value)), {
              count: e.count,
              disabled: !on && e.count === 0,
              title: `Scadenza ${e.label} (multi-selezione)`,
            });
          })}
          {active && chip('reset', '✕ Azzera', false, () => onChange(EMPTY_OPTION_LEG_FILTER), {
            title: 'Rimuove tutti i filtri',
          })}
        </div>
      )}
    </div>
  );
}
