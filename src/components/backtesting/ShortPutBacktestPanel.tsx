import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
  roll_down: 'Roll discesa',
  roll_down_failed: 'Roll discesa non eseguibile',
  roll_up: 'Roll rialzo',
  roll_to_front: 'Rientro prima scadenza',
  time_roll: 'Roll di scadenza',
  max_rolls_reached: 'Roll esauriti',
  expired_otm: 'Scaduta OTM',
  assignment: 'Assegnazione',
};

const EVENT_VARIANTS: Partial<Record<ShortPutEvent['type'], 'default' | 'secondary' | 'destructive' | 'outline'>> = {
  entry: 'default',
  roll_down: 'secondary',
  roll_up: 'secondary',
  roll_to_front: 'secondary',
  time_roll: 'outline',
  assignment: 'destructive',
  max_rolls_reached: 'destructive',
  roll_down_failed: 'outline',
  entry_skipped: 'outline',
  expired_otm: 'outline',
};

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const fmtEur = (v: number) =>
  v.toLocaleString('it-IT', { maximumFractionDigits: 0 });

export function ShortPutBacktestPanel() {
  const [config, setConfig] = useState<ShortPutConfig>(() => structuredClone(DEFAULT_SHORT_PUT_CONFIG));
  const [result, setResult] = useState<ShortPutBacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const set = <K extends keyof ShortPutConfig>(key: K, value: ShortPutConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const setEntry = <K extends keyof ShortPutConfig['entry']>(key: K, value: ShortPutConfig['entry'][K]) =>
    setConfig((c) => ({ ...c, entry: { ...c.entry, [key]: value } }));
  const setDownside = <K extends keyof ShortPutConfig['downside']>(key: K, value: ShortPutConfig['downside'][K]) =>
    setConfig((c) => ({ ...c, downside: { ...c.downside, [key]: value } }));
  const setUpside = <K extends keyof ShortPutConfig['upside']>(key: K, value: ShortPutConfig['upside'][K]) =>
    setConfig((c) => ({ ...c, upside: { ...c.upside, [key]: value } }));
  const setExecution = <K extends keyof ShortPutConfig['execution']>(key: K, value: ShortPutConfig['execution'][K]) =>
    setConfig((c) => ({ ...c, execution: { ...c.execution, [key]: value } }));
  const setRoll = (index: number, key: 'netPremiumTargetPct' | 'netPremiumTolerancePct', value: number) =>
    setConfig((c) => {
      const rolls = [...c.downside.rolls] as ShortPutConfig['downside']['rolls'];
      rolls[index] = { ...rolls[index], [key]: value };
      return { ...c, downside: { ...c.downside, rolls } };
    });
  const setBasketItem = (index: number, key: 'symbol' | 'contracts', value: string) =>
    setConfig((c) => {
      const basket = c.basket.map((item, i) =>
        i === index
          ? { ...item, [key]: key === 'symbol' ? value.toUpperCase() : Math.max(1, Math.round(num(value, 1))) }
          : item,
      );
      return { ...c, basket };
    });

  const chartData = useMemo(
    () => result?.equityCurve.map((p) => ({ date: p.date, equity: Math.round(p.equity) })) ?? [],
    [result],
  );

  const handleRun = async () => {
    const validation = validateShortPutConfig(config);
    setErrors(validation);
    if (validation.length > 0) {
      toast.error('Correggi la configurazione prima di eseguire');
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
      const run = await runShortPutBacktest(config, provider, 'Dati sintetici Black-Scholes (test motore)');
      setResult(run);
      toast.success('Backtest completato su dati sintetici');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Errore durante il backtest');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paniere e periodo</CardTitle>
          <CardDescription>Posizioni indipendenti per titolo, contratti fissi, cassa unica di portafoglio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {config.basket.map((item, index) => (
              <div key={index} className="flex items-end gap-3">
                <div className="space-y-1.5 flex-1">
                  <Label>Ticker</Label>
                  <Input value={item.symbol} onChange={(e) => setBasketItem(index, 'symbol', e.target.value)} placeholder="AAPL" />
                </div>
                <div className="space-y-1.5 w-32">
                  <Label>Contratti</Label>
                  <Input type="number" min={1} value={item.contracts} onChange={(e) => setBasketItem(index, 'contracts', e.target.value)} />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={config.basket.length <= 1}
                  onClick={() => set('basket', config.basket.filter((_, i) => i !== index))}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set('basket', [...config.basket, { symbol: '', contracts: 1 }])}>
              <Plus className="w-4 h-4 mr-1" /> Aggiungi titolo
            </Button>
          </div>
          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Data inizio</Label>
              <Input type="date" value={config.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data fine</Label>
              <Input type="date" value={config.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Capitale iniziale</Label>
              <Input type="number" min={1} value={config.initialCapital} onChange={(e) => set('initialCapital', num(e.target.value))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresso — PUT OTM su mensile più vicina (DTE ≥ minimo)</CardTitle>
          <CardDescription>Strike per distanza dal prezzo, premio % sul nozionale (strike × contratti × 100), o entrambe.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label>Criterio strike</Label>
            <Select value={config.entry.strikeMode} onValueChange={(v) => setEntry('strikeMode', v as ShortPutConfig['entry']['strikeMode'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="distance">Distanza dal prezzo</SelectItem>
                <SelectItem value="premium">Premio % sul nozionale</SelectItem>
                <SelectItem value="both">Entrambe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Distanza OTM %</Label>
            <Input type="number" min={0} step={0.5} value={config.entry.distancePct} onChange={(e) => setEntry('distancePct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Premio target %</Label>
            <Input type="number" min={0} step={0.1} value={config.entry.premiumTargetPct} onChange={(e) => setEntry('premiumTargetPct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Tolleranza ± %</Label>
            <Input type="number" min={0} step={0.1} value={config.entry.premiumTolerancePct} onChange={(e) => setEntry('premiumTolerancePct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>DTE minimo</Label>
            <Input type="number" min={0} value={config.entry.minDte} onChange={(e) => setEntry('minDte', Math.round(num(e.target.value)))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-destructive" />
            <CardTitle className="text-base">Gestione discesa — roll 1/2/3/4</CardTitle>
          </div>
          <CardDescription>
            Trigger: spot ≤ strike × (1 + soglia%). Nuovo strike più basso, scadenza mensile successiva più vicina che centra il
            premio netto target ± tolleranza sul nuovo nozionale; tra i candidati si sceglie lo strike più basso. Dopo il roll 4 si
            tiene fino a scadenza (assegnazione accettata).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Soglia trigger % (unica)</Label>
              <Input type="number" min={0} step={0.5} value={config.downside.triggerDistancePct} onChange={(e) => setDownside('triggerDistancePct', num(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Cap mesi nuova scadenza</Label>
              <Input type="number" min={1} max={24} value={config.downside.maxMonthsForward} onChange={(e) => setDownside('maxMonthsForward', Math.round(num(e.target.value)))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {config.downside.rolls.map((rule, index) => (
              <div key={index} className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Roll {index + 1}</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Premio netto target %</Label>
                  <Input type="number" step={0.1} value={rule.netPremiumTargetPct} onChange={(e) => setRoll(index, 'netPremiumTargetPct', num(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tolleranza ± %</Label>
                  <Input type="number" min={0} step={0.1} value={rule.netPremiumTolerancePct} onChange={(e) => setRoll(index, 'netPremiumTolerancePct', num(e.target.value))} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
            <CardTitle className="text-base">Gestione salita</CardTitle>
          </div>
          <CardDescription>
            Trigger: distanza spot-strike ≥ soglia %. Su prima scadenza: roll al rialzo con distanza minima dal sottostante e
            premio netto ≥ minimo. Su scadenze successive: rientro sulla prima scadenza con premio netto target ± tolleranza.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label>Soglia trigger %</Label>
            <Input type="number" min={0.5} step={0.5} value={config.upside.triggerDistancePct} onChange={(e) => setUpside('triggerDistancePct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Distanza minima strike %</Label>
            <Input type="number" min={0} step={0.5} value={config.upside.minDistancePct} onChange={(e) => setUpside('minDistancePct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Netto minimo roll rialzo %</Label>
            <Input type="number" step={0.1} value={config.upside.minNetPremiumPct} onChange={(e) => setUpside('minNetPremiumPct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Rientro: netto target %</Label>
            <Input type="number" step={0.1} value={config.upside.recoveryNetPremiumTargetPct} onChange={(e) => setUpside('recoveryNetPremiumTargetPct', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Rientro: tolleranza ± %</Label>
            <Input type="number" min={0} step={0.1} value={config.upside.recoveryNetPremiumTolerancePct} onChange={(e) => setUpside('recoveryNetPremiumTolerancePct', num(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Esecuzione e mantenimento scadenza</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label>Modello di fill</Label>
            <Select value={config.execution.fillModel} onValueChange={(v) => setExecution('fillModel', v as ShortPutConfig['execution']['fillModel'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="natural">Natural: vendo bid / compro ask</SelectItem>
                <SelectItem value="mid">Mid puro</SelectItem>
                <SelectItem value="mid_with_slippage">Mid + slippage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Slippage % half-spread</Label>
            <Input type="number" min={0} max={100} value={config.execution.slippagePctOfHalfSpread} onChange={(e) => setExecution('slippagePctOfHalfSpread', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Commissione / contratto</Label>
            <Input type="number" min={0} step={0.01} value={config.execution.commissionPerContract} onChange={(e) => setExecution('commissionPerContract', num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Roll di scadenza sotto DTE (0 = mai)</Label>
            <Input
              type="number"
              min={0}
              value={config.maintenance.timeRollAtDte}
              onChange={(e) => setConfig((c) => ({ ...c, maintenance: { timeRollAtDte: Math.round(num(e.target.value)) } }))}
            />
          </div>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Configurazione non valida</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={handleRun} disabled={running}>
          {running ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FlaskConical className="w-5 h-5 mr-2" />}
          Esegui su dati sintetici (test motore)
        </Button>
        <p className="text-xs text-center text-muted-foreground max-w-2xl">
          Il run usa un provider Black-Scholes deterministico per validare regole e contabilità del motore. I risultati non sono
          storici: il run su dati reali si attiva collegando ThetaData, con lo stesso identico motore.
        </p>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{result.dataProviderLabel}</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Equity finale" value={fmtEur(result.finalEquity)} />
            <KpiCard label="P&L" value={`${fmtEur(result.totalPL)} (${result.totalPLPct.toFixed(2)}%)`} tone={result.totalPL >= 0 ? 'positive' : 'negative'} />
            <KpiCard label="Premi netti" value={fmtEur(result.totalNetPremiums)} />
            <KpiCard label="Commissioni" value={fmtEur(result.totalCommissions)} />
            <KpiCard label="Max drawdown" value={`${result.maxDrawdownPct.toFixed(2)}%`} tone="negative" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equity curve</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={48} />
                  <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} width={72} tickFormatter={(v: number) => fmtEur(v)} />
                  <Tooltip formatter={(v: number) => fmtEur(v)} />
                  <ReferenceLine y={result.config.initialCapital} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="equity" dot={false} strokeWidth={2} stroke="hsl(var(--primary))" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Riepilogo per titolo</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                    <th className="py-2 pr-3">Titolo</th>
                    <th className="py-2 pr-3">Contratti</th>
                    <th className="py-2 pr-3">Ingressi</th>
                    <th className="py-2 pr-3">Roll ↓</th>
                    <th className="py-2 pr-3">Roll ↑</th>
                    <th className="py-2 pr-3">Rientri</th>
                    <th className="py-2 pr-3">Roll scad.</th>
                    <th className="py-2 pr-3">Assegn.</th>
                    <th className="py-2 pr-3 text-right">Premi netti</th>
                    <th className="py-2 pr-3 text-right">P&L realizzato</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bySymbol.map((s) => (
                    <tr key={s.symbol} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{s.symbol}</td>
                      <td className="py-2 pr-3">{s.contracts}</td>
                      <td className="py-2 pr-3">{s.entries}</td>
                      <td className="py-2 pr-3">{s.rollsDown}</td>
                      <td className="py-2 pr-3">{s.rollsUp}</td>
                      <td className="py-2 pr-3">{s.rollsToFront}</td>
                      <td className="py-2 pr-3">{s.timeRolls}</td>
                      <td className="py-2 pr-3">{s.assignments}</td>
                      <td className="py-2 pr-3 text-right">{fmtEur(s.netPremiums)}</td>
                      <td className={`py-2 pr-3 text-right ${s.realizedPL >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>{fmtEur(s.realizedPL)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registro eventi ({result.events.length})</CardTitle>
              <CardDescription>Ogni ingresso, roll, scadenza e assegnazione con flussi di cassa e premio % di riferimento.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto space-y-2">
              {result.events.map((event, index) => (
                <div key={index} className="rounded-lg border p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-muted-foreground">{event.date}</span>
                  <span className="font-medium">{event.symbol}</span>
                  <Badge variant={EVENT_VARIANTS[event.type] ?? 'outline'}>{EVENT_LABELS[event.type]}</Badge>
                  <span className="text-muted-foreground flex-1 min-w-48">{event.description}</span>
                  {event.premiumPct != null && <span className="text-xs">{event.premiumPct.toFixed(2)}%</span>}
                  {event.cashFlow !== 0 && (
                    <span className={`text-xs font-medium ${event.cashFlow >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                      {event.cashFlow >= 0 ? '+' : ''}{fmtEur(event.cashFlow)}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${tone === 'positive' ? 'text-emerald-500' : tone === 'negative' ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default ShortPutBacktestPanel;
