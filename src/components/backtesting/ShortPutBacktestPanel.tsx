import { useMemo, useState } from 'react';
import { ChevronDown, FlaskConical, Loader2, Plus, X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { runShortPutBacktest, validateShortPutConfig } from '@/lib/backtesting/shortPut/engine';
import {
  SyntheticMarketDataProvider,
  DEFAULT_SYNTHETIC_PARAMS,
  SyntheticSymbolParams,
} from '@/lib/backtesting/shortPut/syntheticProvider';
import {
  DEFAULT_SHORT_PUT_CONFIG,
  ShortPutBacktestResult,
  ShortPutConfig,
  ShortPutEvent,
} from '@/lib/backtesting/shortPut/types';
import { toast } from 'sonner';

const EVENT_LABELS: Record<ShortPutEvent['type'], string> = {
  entry: 'Ingresso',
  entry_skipped: 'Ingresso rimandato',
  roll_down: 'Roll ↓',
  roll_down_failed: 'Roll ↓ non eseguibile',
  roll_up: 'Roll ↑',
  roll_to_front: 'Rientro front',
  time_roll: 'Roll scadenza',
  survival_roll: 'Roll orizzontale',
  max_rolls_reached: 'Roll esauriti',
  expired_otm: 'Scaduta OTM',
  assignment: 'Assegnazione',
};

const EVENT_VARIANTS: Record<ShortPutEvent['type'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  entry: 'default',
  entry_skipped: 'outline',
  roll_down: 'secondary',
  roll_down_failed: 'outline',
  roll_up: 'secondary',
  roll_to_front: 'secondary',
  time_roll: 'outline',
  survival_roll: 'secondary',
  max_rolls_reached: 'outline',
  expired_otm: 'outline',
  assignment: 'destructive',
};

const num = (v: string, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const fmt = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 0 });

/** Campo compatto: label micro sopra input basso. */
function F({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-[11px] leading-tight text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function N({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <Input className="h-8" type="number" value={value} onChange={(e) => onChange(num(e.target.value))} {...rest} />;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="flex items-baseline gap-2 mb-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-[11px] text-muted-foreground truncate">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ShortPutBacktestPanel() {
  const [config, setConfig] = useState<ShortPutConfig>(() => structuredClone(DEFAULT_SHORT_PUT_CONFIG));
  const [result, setResult] = useState<ShortPutBacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [eventsOpen, setEventsOpen] = useState(false);

  const set = <K extends keyof ShortPutConfig>(k: K, v: ShortPutConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));
  const setEntry = <K extends keyof ShortPutConfig['entry']>(k: K, v: ShortPutConfig['entry'][K]) =>
    setConfig((c) => ({ ...c, entry: { ...c.entry, [k]: v } }));
  const setDown = <K extends keyof ShortPutConfig['downside']>(k: K, v: ShortPutConfig['downside'][K]) =>
    setConfig((c) => ({ ...c, downside: { ...c.downside, [k]: v } }));
  const setUp = <K extends keyof ShortPutConfig['upside']>(k: K, v: ShortPutConfig['upside'][K]) =>
    setConfig((c) => ({ ...c, upside: { ...c.upside, [k]: v } }));
  const setExec = <K extends keyof ShortPutConfig['execution']>(k: K, v: ShortPutConfig['execution'][K]) =>
    setConfig((c) => ({ ...c, execution: { ...c.execution, [k]: v } }));
  const setRoll = (i: number, k: 'netPremiumTargetPct' | 'netPremiumTolerancePct', v: number) =>
    setConfig((c) => {
      const rolls = [...c.downside.rolls] as ShortPutConfig['downside']['rolls'];
      rolls[i] = { ...rolls[i], [k]: v };
      return { ...c, downside: { ...c.downside, rolls } };
    });

  const chartData = useMemo(
    () => result?.equityCurve.map((p) => ({ date: p.date, equity: Math.round(p.equity) })) ?? [],
    [result],
  );

  const handleRun = async () => {
    const validation = validateShortPutConfig(config);
    setErrors(validation);
    if (validation.length > 0) {
      toast.error(validation[0]);
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const params = new Map<string, SyntheticSymbolParams>(
        config.basket.map((item, i) => [
          item.symbol.trim().toUpperCase(),
          { ...DEFAULT_SYNTHETIC_PARAMS, initialPrice: 100 + i * 60, seed: 1000 + i * 97 },
        ]),
      );
      const provider = new SyntheticMarketDataProvider(params, config.startDate, config.endDate);
      setResult(await runShortPutBacktest(config, provider, 'Dati sintetici (test motore)'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Errore durante il backtest');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Riga 1: paniere + periodo + capitale */}
      <Section title="Paniere e periodo">
        <div className="flex flex-wrap items-end gap-2">
          {config.basket.map((item, i) => (
            <div key={i} className="flex items-end gap-1">
              <F label={i === 0 ? 'Ticker' : ''}>
                <Input
                  className="h-8 w-24"
                  value={item.symbol}
                  placeholder="AAPL"
                  onChange={(e) =>
                    set('basket', config.basket.map((b, j) => (j === i ? { ...b, symbol: e.target.value.toUpperCase() } : b)))
                  }
                />
              </F>
              <F label={i === 0 ? 'Contratti' : ''}>
                <Input
                  className="h-8 w-16"
                  type="number"
                  min={1}
                  value={item.contracts}
                  onChange={(e) =>
                    set('basket', config.basket.map((b, j) => (j === i ? { ...b, contracts: Math.max(1, Math.round(num(e.target.value, 1))) } : b)))
                  }
                />
              </F>
              {config.basket.length > 1 && (
                <Button variant="ghost" size="icon" className="h-8 w-7" onClick={() => set('basket', config.basket.filter((_, j) => j !== i))}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-8" onClick={() => set('basket', [...config.basket, { symbol: '', contracts: 1 }])}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <div className="h-8 w-px bg-border mx-1" />
          <F label="Dal">
            <Input className="h-8 w-[140px]" type="date" value={config.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </F>
          <F label="Al">
            <Input className="h-8 w-[140px]" type="date" value={config.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </F>
          <F label="Capitale">
            <Input className="h-8 w-28" type="number" value={config.initialCapital} onChange={(e) => set('initialCapital', num(e.target.value))} />
          </F>
        </div>
      </Section>

      {/* Riga 2: ingresso + esecuzione affiancati */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Ingresso" hint="PUT OTM, mensile più vicina">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <F label="Criterio strike" className="col-span-2 sm:col-span-1">
              <Select value={config.entry.strikeMode} onValueChange={(v) => setEntry('strikeMode', v as ShortPutConfig['entry']['strikeMode'])}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="distance">Distanza</SelectItem>
                  <SelectItem value="premium">Premio %</SelectItem>
                  <SelectItem value="both">Entrambe</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Distanza OTM %"><N value={config.entry.distancePct} min={0} step={0.5} onChange={(v) => setEntry('distancePct', v)} /></F>
            <F label="DTE min"><N value={config.entry.minDte} min={0} onChange={(v) => setEntry('minDte', Math.round(v))} /></F>
            <F label="Premio target %"><N value={config.entry.premiumTargetPct} step={0.1} onChange={(v) => setEntry('premiumTargetPct', v)} /></F>
            <F label="Tolleranza ±%"><N value={config.entry.premiumTolerancePct} min={0} step={0.1} onChange={(v) => setEntry('premiumTolerancePct', v)} /></F>
            <F label="Roll sotto DTE"><N value={config.maintenance.timeRollAtDte} min={0} onChange={(v) => setConfig((c) => ({ ...c, maintenance: { timeRollAtDte: Math.round(v) } }))} /></F>
          </div>
        </Section>

        <Section title="Esecuzione">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <F label="Fill" className="col-span-2 sm:col-span-1">
              <Select value={config.execution.fillModel} onValueChange={(v) => setExec('fillModel', v as ShortPutConfig['execution']['fillModel'])}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Natural (bid/ask)</SelectItem>
                  <SelectItem value="mid">Mid</SelectItem>
                  <SelectItem value="mid_with_slippage">Mid + slippage</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Slippage % spread"><N value={config.execution.slippagePctOfHalfSpread} min={0} max={100} onChange={(v) => setExec('slippagePctOfHalfSpread', v)} /></F>
            <F label="Commiss./contratto"><N value={config.execution.commissionPerContract} min={0} step={0.01} onChange={(v) => setExec('commissionPerContract', v)} /></F>
          </div>
        </Section>
      </div>

      {/* Riga 3: discesa + salita affiancate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Gestione discesa" hint="strike più basso e OTM, premio netto ±">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <F label="Trigger: spot ≤ strike +%"><N value={config.downside.triggerDistancePct} min={0} step={0.5} onChange={(v) => setDown('triggerDistancePct', v)} /></F>
            <F label="Cap mesi scadenza"><N value={config.downside.maxMonthsForward} min={1} max={24} onChange={(v) => setDown('maxMonthsForward', Math.round(v))} /></F>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-left font-normal pb-1 w-16">Roll</th>
                <th className="text-left font-normal pb-1">Netto target %</th>
                <th className="text-left font-normal pb-1">Tolleranza ±%</th>
              </tr>
            </thead>
            <tbody>
              {config.downside.rolls.map((rule, i) => (
                <tr key={i}>
                  <td className="pr-2 py-0.5 font-medium">{i + 1}</td>
                  <td className="pr-2 py-0.5">
                    <Input className="h-7" type="number" step={0.1} value={rule.netPremiumTargetPct} onChange={(e) => setRoll(i, 'netPremiumTargetPct', num(e.target.value))} />
                  </td>
                  <td className="py-0.5">
                    <Input className="h-7" type="number" min={0} step={0.1} value={rule.netPremiumTolerancePct} onChange={(e) => setRoll(i, 'netPremiumTolerancePct', num(e.target.value))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Gestione salita" hint="solo su recupero reale">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <F label="Trigger distanza %"><N value={config.upside.triggerDistancePct} min={0.5} step={0.5} onChange={(v) => setUp('triggerDistancePct', v)} /></F>
            <F label="Recupero min. %"><N value={config.upside.minRecoveryAbovePct} min={0} step={0.5} onChange={(v) => setUp('minRecoveryAbovePct', v)} /></F>
            <F label="Distanza min. strike %"><N value={config.upside.minDistancePct} min={0} step={0.5} onChange={(v) => setUp('minDistancePct', v)} /></F>
            <F label="Netto min. roll ↑ %"><N value={config.upside.minNetPremiumPct} step={0.1} onChange={(v) => setUp('minNetPremiumPct', v)} /></F>
            <F label="Rientro netto %"><N value={config.upside.recoveryNetPremiumTargetPct} step={0.1} onChange={(v) => setUp('recoveryNetPremiumTargetPct', v)} /></F>
            <F label="Rientro ±%"><N value={config.upside.recoveryNetPremiumTolerancePct} min={0} step={0.1} onChange={(v) => setUp('recoveryNetPremiumTolerancePct', v)} /></F>
          </div>
        </Section>
      </div>

      {errors.length > 0 && (
        <p className="text-xs text-destructive">{errors.join(' · ')}</p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleRun} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
          Esegui su dati sintetici
        </Button>
        <span className="text-[11px] text-muted-foreground">Test motore: prezzi Black-Scholes, non storici.</span>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <Kpi label="Equity finale" value={fmt(result.finalEquity)} />
            <Kpi label="P&L" value={fmt(result.totalPL)} tone={result.totalPL >= 0 ? 'pos' : 'neg'} />
            <Kpi label="P&L %" value={`${result.totalPLPct.toFixed(2)}%`} tone={result.totalPL >= 0 ? 'pos' : 'neg'} />
            <Kpi label="Premi netti" value={fmt(result.totalNetPremiums)} />
            <Kpi label="Commissioni" value={fmt(result.totalCommissions)} />
            <Kpi label="Max DD" value={`${result.maxDrawdownPct.toFixed(2)}%`} tone="neg" />
          </div>

          <Section title="Equity curve">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={56} />
                  <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} width={60} tickFormatter={fmt} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <ReferenceLine y={result.config.initialCapital} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="equity" dot={false} strokeWidth={2} stroke="hsl(var(--primary))" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Per titolo">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b">
                    <th className="py-1 pr-2 font-normal">Titolo</th>
                    <th className="py-1 pr-2 font-normal">Ctr</th>
                    <th className="py-1 pr-2 font-normal">Ingr.</th>
                    <th className="py-1 pr-2 font-normal">↓</th>
                    <th className="py-1 pr-2 font-normal">↑</th>
                    <th className="py-1 pr-2 font-normal">Rientri</th>
                    <th className="py-1 pr-2 font-normal">Scad.</th>
                    <th className="py-1 pr-2 font-normal">Orizz.</th>
                    <th className="py-1 pr-2 font-normal">Assegn.</th>
                    <th className="py-1 pr-2 font-normal text-right">Premi netti</th>
                    <th className="py-1 font-normal text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bySymbol.map((s) => (
                    <tr key={s.symbol} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{s.symbol}</td>
                      <td className="py-1 pr-2">{s.contracts}</td>
                      <td className="py-1 pr-2">{s.entries}</td>
                      <td className="py-1 pr-2">{s.rollsDown}</td>
                      <td className="py-1 pr-2">{s.rollsUp}</td>
                      <td className="py-1 pr-2">{s.rollsToFront}</td>
                      <td className="py-1 pr-2">{s.timeRolls}</td>
                      <td className="py-1 pr-2">{s.survivalRolls}</td>
                      <td className="py-1 pr-2">{s.assignments}</td>
                      <td className="py-1 pr-2 text-right">{fmt(s.netPremiums)}</td>
                      <td className={`py-1 text-right ${s.realizedPL >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>{fmt(s.realizedPL)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Collapsible open={eventsOpen} onOpenChange={setEventsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between h-8">
                <span className="text-xs">Registro eventi ({result.events.length})</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${eventsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-lg border max-h-80 overflow-y-auto divide-y">
                {result.events.map((e, i) => (
                  <div key={i} className="px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{e.date}</span>
                    <span className="font-medium">{e.symbol}</span>
                    <Badge variant={EVENT_VARIANTS[e.type]} className="h-4 px-1.5 text-[10px]">{EVENT_LABELS[e.type]}</Badge>
                    <span className="text-muted-foreground flex-1 min-w-40 truncate" title={e.description}>{e.description}</span>
                    {e.premiumPct != null && <span className="text-[11px] tabular-nums">{e.premiumPct.toFixed(2)}%</span>}
                    {e.cashFlow !== 0 && (
                      <span className={`text-[11px] font-medium tabular-nums ${e.cashFlow >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                        {e.cashFlow >= 0 ? '+' : ''}{fmt(e.cashFlow)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone === 'pos' ? 'text-emerald-500' : tone === 'neg' ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  );
}

export default ShortPutBacktestPanel;
