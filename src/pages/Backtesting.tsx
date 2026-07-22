import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { ShortPutBacktestPanel } from '@/components/backtesting/ShortPutBacktestPanel';
import { checkThetaDataHealth } from '@/lib/backtesting/thetaDataClient';
import { DEFAULT_BACKTEST_CONFIG, STRATEGY_CATALOG, getStrategyDefinition } from '@/lib/backtesting/strategyCatalog';
import { BacktestConfig, BacktestStrategyId, BacktestValidationIssue, ThetaDataHealth } from '@/lib/backtesting/types';
import { ENGINE_INVARIANTS, validateBacktestConfig } from '@/lib/backtesting/validation';
import { toast } from 'sonner';

const PHASE_LABELS = {
  1: 'Priorità',
  2: 'Rischio definito',
  3: 'Multi-scadenza',
} as const;

function numericValue(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function RuleList({ title, rules }: { title: string; rules: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      <ul className="space-y-2">
        {rules.map((rule) => (
          <li key={rule} className="flex gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueList({ issues }: { issues: BacktestValidationIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-2">
      {issues.map((issue, index) => (
        <Alert key={`${issue.field}-${index}`} variant={issue.severity === 'error' ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{issue.severity === 'error' ? 'Configurazione non valida' : 'Verifica consigliata'}</AlertTitle>
          <AlertDescription>{issue.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

export function Backtesting() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState<BacktestConfig>(() => ({
    ...structuredClone(DEFAULT_BACKTEST_CONFIG),
    strategyId: 'cash_secured_put' as BacktestStrategyId,
  }));
  const [issues, setIssues] = useState<BacktestValidationIssue[]>([]);
  const [health, setHealth] = useState<ThetaDataHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const selectedStrategy = useMemo(() => getStrategyDefinition(config.strategyId), [config.strategyId]);

  const updateEntry = <K extends keyof BacktestConfig['entry']>(key: K, value: BacktestConfig['entry'][K]) => {
    setConfig((current) => ({ ...current, entry: { ...current.entry, [key]: value } }));
  };
  const updateManagement = <K extends keyof BacktestConfig['management']>(key: K, value: BacktestConfig['management'][K]) => {
    setConfig((current) => ({ ...current, management: { ...current.management, [key]: value } }));
  };
  const updateExecution = <K extends keyof BacktestConfig['execution']>(key: K, value: BacktestConfig['execution'][K]) => {
    setConfig((current) => ({ ...current, execution: { ...current.execution, [key]: value } }));
  };

  const handleValidate = () => {
    const nextIssues = validateBacktestConfig(config);
    setIssues(nextIssues);
    const errors = nextIssues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) toast.error(`${errors.length} errori da correggere`);
    else toast.success('Configurazione valida per il motore di backtesting');
  };

  const handleHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const result = await checkThetaDataHealth();
      setHealth(result);
      if (result.connected) toast.success('ThetaData v3 collegato');
      else toast.error(result.message || 'ThetaData non raggiungibile');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ThetaData non raggiungibile';
      setHealth({
        connected: false,
        provider: 'thetadata',
        apiVersion: 'v3',
        baseUrlConfigured: false,
        message,
      });
      toast.error(message);
    } finally {
      setCheckingHealth(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Alert className="max-w-xl">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Backtesting in fase di configurazione</AlertTitle>
          <AlertDescription>
            L’accesso resta temporaneamente riservato agli admin finché licenza dati, Theta Terminal e regole di esecuzione non sono validati.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <BarChart3 className="w-6 h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold">Backtesting</h1>
              <p className="text-xs text-muted-foreground truncate">Strategie automatiche in opzioni · ThetaData v3</p>
            </div>
          </div>
          <AppHeaderMenu includePortfolioSelector={false} />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Database className={`w-5 h-5 ${health?.connected ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Data provider</p>
                <p className="font-semibold">ThetaData v3</p>
                <p className="text-xs text-muted-foreground truncate">
                  {health?.connected ? 'Collegato' : health?.message || 'Gateway da configurare'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleHealthCheck} disabled={checkingHealth}>
                {checkingHealth ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span className="sr-only">Verifica collegamento</span>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock3 className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Granularità iniziale</p>
                <p className="font-semibold">End of Day</p>
                <p className="text-xs text-muted-foreground">Intraday 1m dopo validazione EOD</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Layers3 className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Strategie prioritarie</p>
                <p className="font-semibold">5 famiglie</p>
                <p className="text-xs text-muted-foreground">CC, sintetiche, DR CC, CSP, Wheel</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {!health?.connected && (
          <Alert>
            <Database className="h-4 w-4" />
            <AlertTitle>Ambiente predisposto, dati reali non ancora attivi</AlertTitle>
            <AlertDescription>
              La pagina usa un proxy server-side: il browser non riceve credenziali ThetaData. Dopo l’upgrade serviranno un Theta Terminal v3 sempre acceso e un gateway HTTPS privato raggiungibile da Supabase.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="configuration" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="configuration">Configurazione</TabsTrigger>
            <TabsTrigger value="rules">Regole strategia</TabsTrigger>
            <TabsTrigger value="roadmap">Ordine di sviluppo</TabsTrigger>
          </TabsList>

          <TabsContent value="configuration" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Strategia</CardTitle>
                <CardDescription>
                  {config.strategyId === 'cash_secured_put'
                    ? 'Motore implementato: vendita PUT OTM mensile su paniere con roll in discesa (1–4) e gestione al rialzo.'
                    : 'Motore in sviluppo: per questa strategia è disponibile solo la validazione della configurazione.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={config.strategyId} onValueChange={(value) => setConfig((current) => ({ ...current, strategyId: value as BacktestStrategyId }))}>
                  <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STRATEGY_CATALOG.map((strategy) => (
                      <SelectItem key={strategy.id} value={strategy.id}>
                        Fase {strategy.phase} · {strategy.name}
                        {strategy.id === 'cash_secured_put' ? ' · motore attivo' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {config.strategyId === 'cash_secured_put' ? (
              <ShortPutBacktestPanel />
            ) : (
              <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Universo e periodo</CardTitle>
                <CardDescription>La prima validazione usa un ticker alla volta e dati EOD.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="space-y-1.5">
                  <Label>Ticker</Label>
                  <Input value={config.symbol} onChange={(event) => setConfig((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Dal</Label>
                  <Input type="date" value={config.startDate} onChange={(event) => setConfig((current) => ({ ...current, startDate: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Al</Label>
                  <Input type="date" value={config.endDate} onChange={(event) => setConfig((current) => ({ ...current, endDate: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capitale iniziale</Label>
                  <Input type="number" min={1} value={config.initialCapital} onChange={(event) => setConfig((current) => ({ ...current, initialCapital: numericValue(event.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contratti</Label>
                  <Input type="number" min={1} step={1} value={config.contracts} onChange={(event) => setConfig((current) => ({ ...current, contracts: numericValue(event.target.value, 1) }))} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Strategia e ingresso</CardTitle>
                <CardDescription>Selezione del contratto senza usare informazioni future.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label>Frequenza ingresso</Label>
                    <Select value={config.entry.frequency} onValueChange={(value) => updateEntry('frequency', value as BacktestConfig['entry']['frequency'])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="once">Una volta</SelectItem>
                        <SelectItem value="weekly">Settimanale</SelectItem>
                        <SelectItem value="monthly">Mensile</SelectItem>
                        <SelectItem value="after_expiry">Dopo chiusura/scadenza</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Selezione strike</Label>
                    <Select value={config.entry.selectionMode} onValueChange={(value) => updateEntry('selectionMode', value as BacktestConfig['entry']['selectionMode'])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="delta">Delta target</SelectItem>
                        <SelectItem value="otm_pct">Distanza OTM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{config.entry.selectionMode === 'delta' ? 'Delta target' : 'Distanza OTM %'}</Label>
                    <Input
                      type="number"
                      step={config.entry.selectionMode === 'delta' ? 0.05 : 0.5}
                      value={config.entry.selectionMode === 'delta' ? config.entry.targetDelta : config.entry.targetOtmPct}
                      onChange={(event) => config.entry.selectionMode === 'delta'
                        ? updateEntry('targetDelta', numericValue(event.target.value))
                        : updateEntry('targetOtmPct', numericValue(event.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>DTE minimo</Label>
                    <Input type="number" min={0} value={config.entry.minDte} onChange={(event) => updateEntry('minDte', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>DTE massimo</Label>
                    <Input type="number" min={0} value={config.entry.maxDte} onChange={(event) => updateEntry('maxDte', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Premio minimo %</Label>
                    <Input type="number" min={0} step={0.1} value={config.entry.minPremiumPct} onChange={(event) => updateEntry('minPremiumPct', numericValue(event.target.value))} />
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Open interest minimo</Label>
                    <Input type="number" min={0} value={config.entry.minOpenInterest} onChange={(event) => updateEntry('minOpenInterest', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Volume minimo</Label>
                    <Input type="number" min={0} value={config.entry.minVolume} onChange={(event) => updateEntry('minVolume', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Spread bid/ask massimo %</Label>
                    <Input type="number" min={0} max={100} value={config.entry.maxBidAskSpreadPct} onChange={(event) => updateEntry('maxBidAskSpreadPct', numericValue(event.target.value))} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">3. Gestione ed esecuzione</CardTitle>
                <CardDescription>Roll, take profit e fill devono essere riproducibili e contabilizzati.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label>Take profit %</Label>
                    <Input type="number" min={1} max={100} value={config.management.takeProfitPct} onChange={(event) => updateManagement('takeProfitPct', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Roll a DTE</Label>
                    <Input type="number" min={0} value={config.management.rollAtDte} onChange={(event) => updateManagement('rollAtDte', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Roll a delta</Label>
                    <Input type="number" min={0} max={1} step={0.05} value={config.management.rollAtDelta} onChange={(event) => updateManagement('rollAtDelta', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Approccio strike %</Label>
                    <Input type="number" min={0} step={0.5} value={config.management.rollAtStrikeDistancePct} onChange={(event) => updateManagement('rollAtStrikeDistancePct', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Modello di fill</Label>
                    <Select value={config.execution.fillPriceModel} onValueChange={(value) => updateExecution('fillPriceModel', value as BacktestConfig['execution']['fillPriceModel'])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="natural">Natural: acquisto ask / vendita bid</SelectItem>
                        <SelectItem value="mid">Mid puro</SelectItem>
                        <SelectItem value="mid_with_slippage">Mid + slippage</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Slippage % dello spread</Label>
                    <Input type="number" min={0} max={100} value={config.execution.slippagePctOfSpread} onChange={(event) => updateExecution('slippagePctOfSpread', numericValue(event.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Commissione / contratto</Label>
                    <Input type="number" min={0} step={0.01} value={config.execution.commissionPerContract} onChange={(event) => updateExecution('commissionPerContract', numericValue(event.target.value))} />
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col sm:flex-row gap-6">
                  <label className="flex items-center gap-3 text-sm">
                    <Switch checked={config.management.requireNetCredit} onCheckedChange={(value) => updateManagement('requireNetCredit', value)} />
                    Roll solo a credito netto
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <Switch checked={config.management.closeBeforeExpiry} onCheckedChange={(value) => updateManagement('closeBeforeExpiry', value)} />
                    Chiudi prima della scadenza
                  </label>
                </div>
              </CardContent>
            </Card>

            <IssueList issues={issues} />

            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Button variant="outline" size="lg" onClick={handleValidate}>
                <ShieldCheck className="w-5 h-5 mr-2" />
                Valida configurazione
              </Button>
              <Button size="lg" disabled title="Il runner verrà attivato dopo il collegamento e la validazione dei dati ThetaData">
                <Play className="w-5 h-5 mr-2" />
                Esegui backtest
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Il runner resta bloccato finché ThetaData non è collegato; non vengono prodotti risultati con prezzi sintetici spacciati per storici.
            </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{selectedStrategy.name}</CardTitle>
                  <Badge>Fase {selectedStrategy.phase}</Badge>
                  <Badge variant="outline">{PHASE_LABELS[selectedStrategy.phase]}</Badge>
                </div>
                <CardDescription>{selectedStrategy.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Gambe e stato</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedStrategy.legs.map((leg) => (
                      <div key={leg.role} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{leg.role}</span>
                          <Badge variant={leg.required ? 'default' : 'secondary'}>{leg.required ? 'Richiesta' : 'Opzionale'}</Badge>
                          {leg.canBeTemporarilyMissing && <Badge variant="outline">Può essere da sostituire</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">{leg.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <RuleList title="Ingresso" rules={selectedStrategy.entryRules} />
                  <RuleList title="Gestione" rules={selectedStrategy.managementRules} />
                  <RuleList title="Uscita" rules={selectedStrategy.exitRules} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Regole invarianti del motore</CardTitle>
                <CardDescription>Valgono per ogni strategia e impediscono backtest artificialmente ottimistici.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {ENGINE_INVARIANTS.map((rule, index) => (
                    <li key={rule} className="flex gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</span>
                      <span className="pt-0.5">{rule}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roadmap" className="space-y-4">
            {[1, 2, 3].map((phase) => (
              <Card key={phase}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge>Fase {phase}</Badge>
                    <CardTitle className="text-base">{PHASE_LABELS[phase as keyof typeof PHASE_LABELS]}</CardTitle>
                  </div>
                  <CardDescription>
                    {phase === 1 && 'Prima validiamo copertura, assegnazioni e roll sulle strategie che usi più spesso.'}
                    {phase === 2 && 'Poi aggiungiamo payoff a rischio definito e gestione coordinata delle gambe.'}
                    {phase === 3 && 'Infine gestiamo term structure, scadenze diverse e strutture incomplete.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {STRATEGY_CATALOG.filter((strategy) => strategy.phase === phase).map((strategy) => (
                    <div key={strategy.id} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="font-semibold text-sm">{strategy.name}</p>
                        <Badge variant={strategy.status === 'foundation' ? 'default' : 'secondary'}>
                          {strategy.status === 'foundation' ? 'Impostata' : 'Pianificata'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{strategy.description}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default Backtesting;
