import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip,
} from 'recharts';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info, ChevronDown, Wrench } from 'lucide-react';
import {
  buildProjectionInputs, buildTimeGrid, projectDeterministic, decomposeAtHorizon,
  ResolvedBondOverride, ProjectionScope, INFLATION_TARGET,
} from '@/lib/portfolioProjection';
import { resolveBond, BondOverrideLike } from '@/lib/bondMath';
import { useBondOverrides, BondOverride } from '@/hooks/useBondOverrides';
import { cn } from '@/lib/utils';

type ProjectionTimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '3Y';

const PROJECTION_TIME_RANGES: { value: ProjectionTimeRange; label: string; months: number }[] = [
  { value: '1M', label: '1M', months: 1 },
  { value: '3M', label: '3M', months: 3 },
  { value: '6M', label: '6M', months: 6 },
  { value: '1Y', label: '1A', months: 12 },
  { value: '2Y', label: '2A', months: 24 },
  { value: '3Y', label: '3A', months: 36 },
];

/** Adatta una riga bond_overrides al formato atteso da resolveBond (Date, non ISO string). */
function overrideToLike(ov?: BondOverride): BondOverrideLike | null {
  if (!ov) return null;
  return {
    couponRatePct: ov.coupon_rate_pct,
    maturity: ov.maturity_date ? new Date(ov.maturity_date + 'T00:00:00Z') : null,
    frequency: ov.frequency,
  };
}

interface Props {
  positions: Position[];
  baseValue: number;
  underlyingPrices?: Record<string, UnderlyingPrice>;
  gpEquityValue?: number;
  derivativesNettingT0?: number;
}

const fmtEURc = (n: number) => '€' + n.toLocaleString('it-IT', { maximumFractionDigits: 0 });
const fmtEURcompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return '€' + (n / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + 'M';
  if (a >= 1_000) return '€' + (n / 1_000).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + 'k';
  return '€' + n.toFixed(0);
};
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const fmtDateIT = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Spiegazione di cosa include ciascuna vista "Analizza" — mostrata sotto ai bottoni, dinamica. */
const SCOPE_INFO: Record<ProjectionScope, { label: string; desc: string }> = {
  all: {
    label: 'Tutto',
    desc: 'Patrimonio complessivo: azioni + ETF + GP (azionaria e liquidità) + bond + materie prime + cash + Netting Totale derivati.',
  },
  equity: {
    label: 'Equity (incl. derivati)',
    desc: 'Solo componente azionaria: azioni + ETF + GP azionaria (esclusa la liquidità GP) + Netting Totale derivati a t0. Esclude bond, materie prime e cash.',
  },
  bond_commodity: {
    label: 'Bond/Comm.',
    desc: 'Solo obbligazioni (rivalutate a modello, vedi sotto) e materie prime (tenute al valore corrente). Esclude azioni, ETF, GP, derivati e cash.',
  },
};

// ── Riga editor per risolvere un bond ──────────────────────────
function BondFixRow({ position, override, onSave, saving }: {
  position: Position;
  override?: BondOverride;
  onSave: (inp: { portfolioId: string; isin: string; couponRatePct: number | null; maturityDate: string | null; frequency: number }) => void;
  saving: boolean;
}) {
  // Prefill dalla risoluzione unificata (description + eventuale override già salvato):
  // così i campi partono già compilati con quanto dedotto dalla description.
  const resolved = resolveBond(position.description, overrideToLike(override));
  const [coupon, setCoupon] = useState(resolved.couponRatePct != null ? String(resolved.couponRatePct) : '');
  const [maturity, setMaturity] = useState(resolved.maturity ? toISO(resolved.maturity) : '');
  // frequenza: 0 = zero coupon; default a quella dedotta.
  const [freq, setFreq] = useState(String(resolved.zeroCoupon ? 0 : (override?.frequency ?? resolved.frequency)));

  const isZC = freq === '0';
  const canSave = !!position.isin && maturity !== '';

  // Se l'utente sceglie "0 (ZC)" la cedola è per definizione 0; se la sposta via da 0
  // e la cedola era 0, la lasciamo modificabile.
  const onFreqChange = (v: string) => {
    setFreq(v);
    if (v === '0') setCoupon('0');
  };

  return (
    <div className="flex flex-wrap items-end gap-2 py-2 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate" title={position.description}>{position.description}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {position.isin ?? 'ISIN assente — non salvabile'}
          {resolved.stepUp && <span className="ml-1 text-amber-500">· step-up</span>}
          {resolved.inflationLinked && <span className="ml-1 text-sky-500">· indicizzato</span>}
        </div>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Cedola %</label>
        <Input
          value={coupon}
          onChange={e => setCoupon(e.target.value)}
          placeholder={resolved.stepUp ? 'step-up' : 'es. 2,45'}
          disabled={isZC}
          className="h-7 w-20 text-xs"
          inputMode="decimal"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Scadenza</label>
        <Input type="date" value={maturity} onChange={e => setMaturity(e.target.value)} className="h-7 w-36 text-xs" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-muted-foreground">Cedole/anno</label>
        <Select value={freq} onValueChange={onFreqChange}>
          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">0 (ZC)</SelectItem>
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
          couponRatePct: isZC ? 0 : (coupon.trim() === '' ? null : parseFloat(coupon.replace(',', '.'))),
          maturityDate: maturity || null,
          frequency: parseInt(freq, 10),
        })}
      >
        Salva
      </Button>
    </div>
  );
}

export function PatrimonyProjectionCard({ positions, baseValue, underlyingPrices, gpEquityValue = 0, derivativesNettingT0 }: Props) {
  const [timeRange, setTimeRange] = useState<ProjectionTimeRange>('3M');
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
    () => buildProjectionInputs(positions, baseValue, underlyingPrices, bondOverrideMap, gpEquityValue, derivativesNettingT0 ?? null),
    [positions, baseValue, underlyingPrices, bondOverrideMap, gpEquityValue, derivativesNettingT0],
  );

  const effectiveHorizon = useMemo(() => {
    const selectedMonths = PROJECTION_TIME_RANGES.find(range => range.value === timeRange)?.months ?? 12;
    const capped = new Date(inputs.t0);
    capped.setMonth(capped.getMonth() + selectedMonths);
    return capped.getTime() < inputs.horizon.getTime() ? capped : inputs.horizon;
  }, [timeRange, inputs]);

  const grid = useMemo(() => buildTimeGrid(inputs.t0, effectiveHorizon, 60), [inputs, effectiveHorizon]);
  const deterministic = useMemo(() => projectDeterministic(inputs, grid, scope), [inputs, grid, scope]);

  // DEBUG diagnostico (stesso flag del netting): confronto gamba per gamba tra intrinseco
  // realizzato a scadenza nella proiezione e i valori del Netting Intrinseco A, più la
  // scomposizione per bucket del valore all'orizzonte massimo.
  // Attivazione: localStorage.setItem('nettingDebug','1') e ricarica.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('nettingDebug') !== '1') return;
    if (inputs.derivs.length === 0 && inputs.bonds.length === 0) return;
    const dec = decomposeAtHorizon(inputs);
    const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 0 });
    console.log('%c[PROIEZIONE] Evoluzione patrimonio — diagnostica orizzonte', 'font-weight:bold;font-size:13px');
    console.table(inputs.derivSummary.map(d => ({
      descr: d.description,
      sottostante: d.underlying,
      tipo: d.type.toUpperCase(),
      qty: d.qty,
      strike: d.strike,
      spot: d.spot,
      fonteSpot: d.spotSource,
      'MV t0': Math.round(d.mvT0),
      'INTRINSECO a scadenza': Math.round(d.intrinsicAtExpiryEUR),
      'Δ (decadimento premio)': Math.round(d.intrinsicAtExpiryEUR - d.mvT0),
    })));
    console.log(
      `Scomposizione valore all'orizzonte massimo (${dec.tYears.toFixed(2)} anni):\n` +
      `  azioni/ETF (piatte):          €${fmt(dec.equityFlat)}\n` +
      `  GP azionaria (piatta):        €${fmt(dec.gpEquityFlat)}\n` +
      `  Σ intrinseci derivati:        €${fmt(dec.derivIntrinsic)}\n` +
      `  gambe SENZA spot (MV flat):   €${fmt(dec.derivNoSpotFlat)}\n` +
      `  gambe già scadute (MV flat):  €${fmt(dec.derivStaleFlat)}\n` +
      `  offset netting−MV locale:     €${fmt(dec.equityDerivOffset)}\n` +
      `  bond a rimborso/inflazione:   €${fmt(dec.bondValue)} (MV t0: €${fmt(inputs.bonds.reduce((s, b) => s + b.mvT0, 0))})\n` +
      `  cedole cumulate:              €${fmt(dec.coupons)}\n` +
      `  bond piatti (no scadenza):    €${fmt(dec.unparsedBondFlat)}\n` +
      `  materie prime (piatte):       €${fmt(dec.commodityFlat)}\n` +
      `  cash residuo:                 €${fmt(dec.cashResidual)}\n` +
      `  ───────────────────────────────\n` +
      `  TOTALE ORIZZONTE:             €${fmt(dec.total)}\n` +
      `Confronto: patrimonio Netting Intrinseco A = base + Σ intrinseci (stessi spot). ` +
      `Il gap vs orizzonte è spiegato da: effetto bond (rimborso − MV t0), cedole, gambe senza spot/scadute e offset.`
    );
  }, [inputs]);

  const data = useMemo(() => deterministic.map(d => ({
    label: d.label,
    patrimony: Math.round(d.patrimony),
    pnlPct: +d.pnlPct.toFixed(2),
  })), [deterministic]);

  const last = deterministic[deterministic.length - 1];
  const horizonLabel = grid[grid.length - 1]?.label ?? '';

  // bond da risolvere: scadenza assente, oppure cedola davvero mancante su bond ordinario.
  // ZC, indicizzati e step-up (BTP Italia/Valore/Più) sono modellati correttamente e NON
  // vengono più segnalati (unica fonte di verità: resolveBond).
  const bondsToFix = useMemo(() => positions.filter(p => {
    if (p.asset_type !== 'bond') return false;
    return resolveBond(p.description, overrideToLike(getOverride(p.portfolio_id, p.isin))).needsFix;
  }), [positions, getOverride]);

  const bondModeledMV = inputs.bondSummary.reduce((s, b) => s + b.mvT0, 0);

  return (
    <div className="flex flex-col gap-2">
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

      {/* Selettore arco temporale asse X + analisi per bucket */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[11px] text-muted-foreground mr-1">Orizzonte:</span>
        <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
          {PROJECTION_TIME_RANGES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTimeRange(value)}
              aria-pressed={timeRange === value}
              className={cn(
                'px-2 py-0.5 text-xs transition-colors',
                timeRange === value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground ml-3 mr-1">Analizza:</span>
        <TooltipProvider delayDuration={150}>
          {(Object.keys(SCOPE_INFO) as ProjectionScope[]).map(v => (
            <Tooltip key={v}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setScope(v)}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                    scope === v
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {SCOPE_INFO[v].label}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">{SCOPE_INFO[v].desc}</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
      {/* Spiegazione persistente (non solo al passaggio del mouse) di cosa mostra la vista corrente */}
      <p className="text-[11px] text-muted-foreground/80 italic -mt-1">{SCOPE_INFO[scope].desc}</p>

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
                  </div>
                );
              }}
            />
            <Line yAxisId="eur" type="monotone" dataKey="patrimony" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} isAnimationActive={false} name="Patrimonio" />
            <Line yAxisId="pct" type="monotone" dataKey="pnlPct" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="P/L %" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> patrimonio (€)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: 'hsl(142, 71%, 45%)' }} /> P/L %</span>
        {inputs.derivSummary.length > 0 && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-blue-500 cursor-pointer">
                  <Info className="w-3 h-3" /> {inputs.derivSummary.length} derivati ({fmtEURc(inputs.derivMVT0)})
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[320px] text-xs">
                <div className="font-semibold mb-1">Derivati inclusi nel bucket Equity:</div>
                <ul className="list-disc pl-4 max-h-[200px] overflow-y-auto">
                  {inputs.derivSummary.slice(0, 20).map((d, i) => (
                    <li key={i}>
                      {d.qty > 0 ? '+' : ''}{d.qty} {d.type.toUpperCase()} {d.underlying} @ {d.strike}
                      {!d.hasUnderlying && <span className="text-amber-500"> (no spot — MV costante)</span>}
                    </li>
                  ))}
                  {inputs.derivSummary.length > 20 && <li>… e altri {inputs.derivSummary.length - 20}</li>}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {inputs.bondSummary.length > 0 && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-blue-500 cursor-pointer">
                  <Info className="w-3 h-3" /> {inputs.bondSummary.length} bond nel modello ({fmtEURc(bondModeledMV)})
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[360px] text-xs">
                <div className="font-semibold mb-1">Valori usati per la rivalutazione (pull-to-par):</div>
                <ul className="list-disc pl-4 max-h-[240px] overflow-y-auto space-y-1">
                  {inputs.bondSummary.slice(0, 20).map((b, i) => (
                    <li key={i}>
                      <div className="font-medium text-foreground">{b.description}</div>
                      <div>
                        {b.inflationLinked
                          ? `Indicizzato inflazione — accredito ~${(INFLATION_TARGET * 100).toFixed(1)}%/anno (nessun pull-to-par)`
                          : b.couponsModeled
                            ? `Cedola ${b.couponRatePct.toFixed(2)}% × ${b.frequency}/anno · scadenza ${fmtDateIT(b.maturity)} · YTM stimato ${b.ytmPct.toFixed(2)}%`
                            : `Cedola non modellata (solo pull-to-par) · scadenza ${fmtDateIT(b.maturity)} · YTM stimato ${b.ytmPct.toFixed(2)}%`}
                        {b.overridden && <span className="text-blue-400"> · valori manuali</span>}
                      </div>
                    </li>
                  ))}
                  {inputs.bondSummary.length > 20 && <li>… e altri {inputs.bondSummary.length - 20}</li>}
                </ul>
                <div className="mt-1 text-muted-foreground">
                  YTM = rendimento a scadenza implicito dal prezzo corrente (usato per scontare i flussi futuri).
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {inputs.partialBonds.length > 0 && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-amber-500 cursor-pointer">
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
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-amber-500 cursor-pointer">
                  <Info className="w-3 h-3" /> {inputs.unparsedBonds.length} bond piatti (no scadenza)
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">
                <div className="font-semibold mb-1">Scadenza non deducibile dalla descrizione: tenuti al valore corrente, nessuna rivalutazione:</div>
                <ul className="list-disc pl-4">{inputs.unparsedBonds.slice(0, 8).map((b, i) => <li key={i}>{b}</li>)}</ul>
                <div className="mt-1">Risolvili qui sotto inserendo scadenza (e cedola).</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
        rivalutati tramite Black-Scholes inverso (IV implicita dal prezzo attuale, poi repricing
        con vita residua decrescente → il premio temporale scende), con calibrazione che ancora
        la curva esattamente al patrimonio di oggi. A scadenza le opzioni ITM vengono{' '}
        <strong>esercitate</strong>: per le covered call le azioni sono consegnate al strike, per
        le short put sono acquistate al strike (l'effetto si materializza nel bucket Equity). I
        bond sono rivalutati a <strong>pull-to-par</strong>: dal prezzo corrente si calcola il
        rendimento a scadenza (YTM) implicito, poi si sconta il flusso di cedole + rimborso a quel
        rendimento fino a convergere al valore di rimborso (100) alla scadenza; le cedole staccate
        incrementano il patrimonio in cassa. I bond indicizzati all'inflazione non convergono a
        100: accreditano sul target BCE ({(INFLATION_TARGET * 100).toFixed(1)}%/anno). Passa il
        mouse su <strong>"N bond nel modello"</strong> qui sopra per vedere cedola, scadenza e YTM
        usati per ciascun bond. Azioni/ETF/cash restano costanti nello scenario base (nessuna
        simulazione stocastica: la proiezione è deterministica). Il toggle <strong>Equity</strong>{' '}
        = azioni + ETF + GP azionaria (esclusa la liquidità GP) + Netting Totale derivati a t0.
      </p>
    </div>
  );
}
