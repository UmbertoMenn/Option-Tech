import { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip,
} from 'recharts';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info, ChevronDown, Wrench } from 'lucide-react';
import {
  buildProjectionInputs, buildTimeGrid, projectDeterministic, projectMonteCarlo,
  DEFAULT_MC, ResolvedBondOverride, ProjectionScope,
} from '@/lib/portfolioProjection';
import { parseBondPartial } from '@/lib/bondMath';
import { useBondOverrides, BondOverride } from '@/hooks/useBondOverrides';

interface Props {
  positions: Position[];
  baseValue: number;
  underlyingPrices?: Record<string, UnderlyingPrice>;
}

const MS_YEAR = 365.25 * 24 * 3600 * 1000;
const fmtEURc = (n: number) => '€' + n.toLocaleString('it-IT', { maximumFractionDigits: 0 });
const fmtEURcompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return '€' + (n / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + 'M';
  if (a >= 1_000) return '€' + (n / 1_000).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + 'k';
  return '€' + n.toFixed(0);
};
const toISO = (d: Date) => d.toISOString().slice(0, 10);

// ── Riga editor per risolvere un bond ──────────────────────────
function BondFixRow({ position, override, onSave, saving }: {
  position: Position;
  override?: BondOverride;
  onSave: (inp: { portfolioId: string; isin: string; couponRatePct: number | null; maturityDate: string | null; frequency: number }) => void;
  saving: boolean;
}) {
  const partial = parseBondPartial(position.description);
  const [coupon, setCoupon] = useState(
    override?.coupon_rate_pct != null ? String(override.coupon_rate_pct)
      : partial.couponRatePct != null ? String(partial.couponRatePct) : '',
  );
  const [maturity, setMaturity] = useState(
    override?.maturity_date ?? (partial.maturity ? toISO(partial.maturity) : ''),
  );
  const [freq, setFreq] = useState(String(override?.frequency ?? partial.frequency));

  const canSave = !!position.isin && maturity !== '';

  return (
    <div className="flex flex-wrap items-end gap-2 py-2 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate" title={position.description}>{position.description}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{position.isin ?? 'ISIN assente — non salvabile'}</div>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Cedola %</label>
        <Input value={coupon} onChange={e => setCoupon(e.target.value)} placeholder="es. 2,45" className="h-7 w-20 text-xs" inputMode="decimal" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Scadenza</label>
        <Input type="date" value={maturity} onChange={e => setMaturity(e.target.value)} className="h-7 w-36 text-xs" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Cedole/anno</label>
        <Select value={freq} onValueChange={setFreq}>
          <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="4">4</SelectItem>
            <SelectItem value="12">12</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm" variant="outline" className="h-7"
        disabled={!canSave || saving}
        onClick={() => onSave({
          portfolioId: position.portfolio_id,
          isin: position.isin as string,
          couponRatePct: coupon.trim() === '' ? null : parseFloat(coupon.replace(',', '.')),
          maturityDate: maturity || null,
          frequency: parseInt(freq, 10) || 1,
        })}
      >
        Salva
      </Button>
    </div>
  );
}

export function PatrimonyProjectionCard({ positions, baseValue, underlyingPrices }: Props) {
  const [mcVolRates, setMcVolRates] = useState(false);
  const [mcUnderlying, setMcUnderlying] = useState(false);
  const [rangeYears, setRangeYears] = useState<number | null>(null); // null = Max
  const [scope, setScope] = useState<ProjectionScope>('all');
  const [fixOpen, setFixOpen] = useState(false);

  const { overrides, getOverride, setOverride, isSaving } = useBondOverrides();

  const bondOverrideMap = useMemo(() => {
    const m: Record<string, ResolvedBondOverride> = {};
    for (const o of overrides) {
      m[`${o.portfolio_id}::${o.isin}`] = {
        couponRatePct: o.coupon_rate_pct,
        maturityMs: o.maturity_date ? Date.parse(o.maturity_date) : null,
        frequency: o.frequency,
      };
    }
    return m;
  }, [overrides]);

  const inputs = useMemo(
    () => buildProjectionInputs(positions, baseValue, underlyingPrices, bondOverrideMap),
    [positions, baseValue, underlyingPrices, bondOverrideMap],
  );

  const maxYears = Math.max(0.25, (inputs.horizon.getTime() - inputs.t0.getTime()) / MS_YEAR);
  const effectiveHorizon = useMemo(() => {
    if (rangeYears == null) return inputs.horizon;
    const capped = new Date(inputs.t0.getTime() + rangeYears * MS_YEAR);
    return capped.getTime() < inputs.horizon.getTime() ? capped : inputs.horizon;
  }, [rangeYears, inputs]);

  const grid = useMemo(() => buildTimeGrid(inputs.t0, effectiveHorizon, 60), [inputs, effectiveHorizon]);
  const deterministic = useMemo(() => projectDeterministic(inputs, grid, scope), [inputs, grid, scope]);

  const mcOn = mcVolRates || mcUnderlying;
  const mc = useMemo(() => {
    if (!mcOn) return null;
    return projectMonteCarlo(inputs, grid, { ...DEFAULT_MC, enableVolRates: mcVolRates, enableUnderlying: mcUnderlying }, scope);
  }, [mcOn, mcVolRates, mcUnderlying, inputs, grid, scope]);

  const data = useMemo(() => deterministic.map((d, i) => {
    const m = mc?.[i];
    return {
      label: d.label,
      patrimony: Math.round(d.patrimony),
      pnlPct: +d.pnlPct.toFixed(2),
      ...(m ? { p5: Math.round(m.p5 ?? 0), p50: Math.round(m.p50 ?? 0), p95: Math.round(m.p95 ?? 0), range: [Math.round(m.p5 ?? 0), Math.round(m.p95 ?? 0)] as [number, number] } : {}),
    };
  }), [deterministic, mc]);

  const last = deterministic[deterministic.length - 1];
  const horizonLabel = grid[grid.length - 1]?.label ?? '';

  // bond da risolvere: manca la scadenza, oppure manca la cedola e NON è indicizzato/ZC
  const bondsToFix = useMemo(() => positions.filter(p => {
    if (p.asset_type !== 'bond') return false;
    const ov = getOverride(p.portfolio_id, p.isin);
    const partial = parseBondPartial(p.description);
    const maturity = ov?.maturity_date ?? (partial.maturity ? toISO(partial.maturity) : null);
    const coupon = ov ? ov.coupon_rate_pct : partial.couponRatePct;
    if (!maturity) return true;                       // scadenza assente
    if (coupon == null && !partial.inflationLinked) return true; // cedola sconosciuta (non indicizzato/ZC)
    return false;
  }), [positions, getOverride]);

  const presets: { label: string; years: number | null }[] = [
    { label: '1A', years: 1 }, { label: '2A', years: 2 }, { label: '3A', years: 3 },
    { label: '5A', years: 5 }, { label: '10A', years: 10 },
  ].filter(p => p.years! <= maxYears + 0.5);
  presets.push({ label: 'Max', years: null });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-foreground">Evoluzione patrimonio alle scadenze</p>
          <p className="text-xs text-muted-foreground">
            Proiezione fino a {horizonLabel}. Patrimonio finale stimato{' '}
            <span className="font-semibold text-blue-500">{last ? fmtEURc(last.patrimony) : '—'}</span>{' '}
            <span className={last && last.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}>
              ({last ? (last.pnlPct >= 0 ? '+' : '') + last.pnlPct.toFixed(1) + '%' : ''})
            </span>
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={mcVolRates} onCheckedChange={setMcVolRates} />
            Monte Carlo: vol &amp; tassi
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={mcUnderlying} onCheckedChange={setMcUnderlying} />
            Monte Carlo: variazione titoli
          </label>
        </div>
      </div>

      {/* Selettore arco temporale asse X + analisi per bucket */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[11px] text-muted-foreground mr-1">Orizzonte:</span>
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => setRangeYears(p.years)}
            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
              rangeYears === p.years
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground ml-3 mr-1">Analizza:</span>
        {([
          { v: 'all', l: 'Tutto' },
          { v: 'equity', l: 'Equity (incl. derivati)' },
          { v: 'bond_commodity', l: 'Bond/Comm.' },
        ] as { v: ProjectionScope; l: string }[]).map(s => (
          <button
            key={s.v}
            onClick={() => setScope(s.v)}
            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
              scope === s.v
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {s.l}
          </button>
        ))}
      </div>

      <div className="w-full h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis yAxisId="eur" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={fmtEURcompact} width={56} domain={['auto', 'auto']} />
            <YAxis yAxisId="pct" orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={40} />
            <RechartsTooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as typeof data[number];
                return (
                  <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div className="font-semibold text-foreground">{label}</div>
                    <div className="text-blue-500">Patrimonio: {fmtEURc(row.patrimony)}</div>
                    <div className={row.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}>
                      P/L: {row.pnlPct >= 0 ? '+' : ''}{row.pnlPct.toFixed(2)}%
                    </div>
                    {'p5' in row && row.p5 !== undefined && (
                      <div className="text-muted-foreground pt-0.5 border-t border-border/50 mt-0.5">
                        MC p5–p95: {fmtEURc(row.p5!)} … {fmtEURc(row.p95!)}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {mcOn && (
              <Area yAxisId="eur" dataKey="range" stroke="none" fill="hsl(217, 91%, 60%)" fillOpacity={0.12} isAnimationActive={false} connectNulls />
            )}
            <Line yAxisId="eur" type="monotone" dataKey="patrimony" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} isAnimationActive={false} name="Patrimonio" />
            {mcOn && (
              <Line yAxisId="eur" type="monotone" dataKey="p50" stroke="hsl(217, 91%, 60%)" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} name="MC mediana" />
            )}
            <Line yAxisId="pct" type="monotone" dataKey="pnlPct" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="P/L %" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> patrimonio (€)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: 'hsl(142, 71%, 45%)' }} /> P/L %</span>
        {inputs.partialBonds.length > 0 && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-amber-500 cursor-help">
                  <Info className="w-3 h-3" /> {inputs.partialBonds.length} bond senza cedola
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">
                <div className="font-semibold mb-1">Pull-to-par applicato, ma cedole NON modellate (cedola non deducibile):</div>
                <ul className="list-disc pl-4">{inputs.partialBonds.slice(0, 8).map((b, i) => <li key={i}>{b}</li>)}</ul>
                <div className="mt-1">Risolvili qui sotto inserendo la cedola.</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {inputs.unparsedBonds.length > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-500">
            <Info className="w-3 h-3" /> {inputs.unparsedBonds.length} bond piatti (no scadenza)
          </span>
        )}
      </div>

      {/* Editor manuale bond */}
      {bondsToFix.length > 0 && (
        <Collapsible open={fixOpen} onOpenChange={setFixOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-amber-500 hover:text-amber-400 mt-1">
              <Wrench className="w-3.5 h-3.5" />
              Risolvi bond ({bondsToFix.length})
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${fixOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <p className="text-[11px] text-muted-foreground mb-2">
                Inserisci cedola annua (%), scadenza e numero cedole/anno. I valori vengono salvati per ISIN
                e sopravvivono al re-import dello snapshot. Lascia la cedola vuota se il bond non paga cedole.
              </p>
              {bondsToFix.map(p => (
                <BondFixRow
                  key={p.id}
                  position={p}
                  override={getOverride(p.portfolio_id, p.isin)}
                  onSave={setOverride}
                  saving={isSaving}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <p className="text-[11px] text-muted-foreground leading-snug">
        Per ogni mese da oggi fino alla scadenza massima tra bond e derivati: i derivati sono
        rivalutati al market value tramite Black-Scholes inverso (IV implicita dal prezzo
        attuale, poi repricing con vita residua decrescente → il premio temporale scende); i
        bond convergono al valore di rimborso (pull-to-par) e le cedole staccate incrementano il
        patrimonio. Azioni/ETF/cash restano costanti nello scenario base.
      </p>
    </div>
  );
}
