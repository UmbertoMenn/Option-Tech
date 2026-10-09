/**
 * Simulazione casuale: put vendute su sottostanti estratti dall'universo dei clienti,
 * premio teorico dall'IV attuale dei clienti, strike a livello unico, mix empirico storico
 * OTM/ATM/ITM oppure ripartizione percentuale manuale.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Loader2, Play, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEmpiricalPutMix } from '@/hooks/useVirtualSimulationData';
import {
  generateRandomPuts,
  ListedChain,
  MixMode,
  monthlyExpiries,
  UniverseUnderlying,
} from '@/lib/virtualSimulation';
import { FxRates, VirtualPositionSpec, VirtualSimSettings, parseNum } from '@/lib/virtualPortfolio';
import type { StressLabMetrics } from '@/pages/RiskSimulator';
import { SortTh, Tip } from './virtualUi';
import { cmp, fmtDate, fmtEUR, fmtNum, fmtPct, lbl, SortState } from './virtualFormat';

const field = 'flex flex-col gap-1';

/** Input percentuale testuale ("−10", "5,5"); onChange riceve la frazione (−0,10). */
function PctInput({ value, onChange, className = 'w-20' }: { value: number; onChange: (v: number) => void; className?: string }) {
  const [text, setText] = useState(fmtNum(value * 100, 2));
  const commit = () => {
    const n = parseNum(text.replace('−', '-').replace('%', ''));
    if (n == null) return setText(fmtNum(value * 100, 2));
    onChange(n / 100);
    setText(fmtNum(n, 2));
  };
  return (
    <div className="relative">
      <Input className={`h-8 pr-6 font-mono ${className}`} value={text} inputMode="decimal"
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

type UCol = 'ticker' | 'spot' | 'iv' | 'clients' | 'puts' | 'date';

const PERIODS: { v: string; label: string; days: number | null }[] = [
  { v: 'all', label: 'Tutto lo storico', days: null },
  { v: '365', label: 'Ultimi 12 mesi', days: 365 },
  { v: '180', label: 'Ultimi 6 mesi', days: 180 },
  { v: '90', label: 'Ultimi 3 mesi', days: 90 },
];

export function RandomSimPanel({
  underlyings,
  chains,
  riskFree,
  fx,
  sim,
  metrics,
  randomExposureEUR,
  randomCount,
  spotsByPortfolioDate,
  isLoading,
  onApply,
}: {
  underlyings: UniverseUnderlying[];
  chains: Record<string, ListedChain[]>;
  riskFree: number;
  fx: FxRates;
  sim: VirtualSimSettings;
  metrics: StressLabMetrics | null;
  randomExposureEUR: number;
  randomCount: number;
  spotsByPortfolioDate: Record<string, Record<string, number>> | null;
  isLoading: boolean;
  onApply: (specs: VirtualPositionSpec[], replace: boolean) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const expiries = useMemo(() => monthlyExpiries(today, 24), [today]);
  const defaultExpiry = useMemo(
    () => expiries.find((e) => (Date.parse(e) - today.getTime()) / 86400000 >= 45) ?? expiries[0] ?? null,
    [expiries, today],
  );

  // ---- parametri ----
  const [sizing, setSizing] = useState<'target' | 'amount'>(sim.exposure ? 'target' : 'amount');
  // Obiettivo di esposizione impostato/rimosso → dimensionamento coerente.
  const hadTarget = useRef(sim.exposure != null);
  useEffect(() => {
    const has = sim.exposure != null;
    if (has !== hadTarget.current) setSizing(has ? 'target' : 'amount');
    hadTarget.current = has;
  }, [sim.exposure]);
  const [amount, setAmount] = useState('500.000');
  const [replace, setReplace] = useState(true);
  const [nUnd, setNUnd] = useState('10');
  const [mode, setMode] = useState<MixMode>('single');
  const [singleM, setSingleM] = useState(-0.1);
  const [manual, setManual] = useState({ otmPct: 0.6, atmPct: 0.1, itmPct: 0.3, otmM: -0.1, atmM: 0, itmM: 0.05 });
  const [atmBand, setAtmBand] = useState(0.02);
  const [period, setPeriod] = useState('all');
  const [expiryMode, setExpiryMode] = useState<'fixed' | 'empirical'>('fixed');
  const [fixedExpiry, setFixedExpiry] = useState<string | null>(null);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [onlySoldPuts, setOnlySoldPuts] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [uSort, setUSort] = useState<SortState<UCol>>({ col: 'ticker', dir: 'asc' });
  const [showUniverse, setShowUniverse] = useState(false);

  const needEmpirical = mode === 'empirical' || expiryMode === 'empirical';
  const sinceDate = useMemo(() => {
    const d = PERIODS.find((p) => p.v === period)?.days;
    return d ? new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10) : null;
  }, [period, today]);
  const { stats, isLoading: loadingEmp, error: empError } = useEmpiricalPutMix(needEmpirical, spotsByPortfolioDate, atmBand, sinceDate);

  const pool = useMemo(
    () => underlyings.filter((u) => !excluded.has(u.ticker) && (!onlySoldPuts || u.soldPuts > 0)),
    [underlyings, excluded, onlySoldPuts],
  );

  // ---- esposizione da generare ----
  const existingExposure = metrics ? metrics.equityExposure - (replace ? randomExposureEUR : 0) : null;
  const targetGen =
    sizing === 'target'
      ? sim.exposure != null && existingExposure != null
        ? Math.max(0, sim.exposure - existingExposure)
        : 0
      : Math.max(0, parseNum(amount) ?? 0);

  const expiry = fixedExpiry ?? defaultExpiry;
  const result = useMemo(
    () =>
      generateRandomPuts(pool, {
        targetExposureEUR: targetGen,
        nUnderlyings: Math.max(1, Math.round(parseNum(nUnd) ?? 1)),
        mode,
        singleM,
        manual,
        empirical: stats,
        expiryMode,
        fixedExpiry: expiry,
        seed,
        today,
        riskFree,
        fx,
        chains,
      }),
    [pool, targetGen, nUnd, mode, singleM, manual, stats, expiryMode, expiry, seed, today, riskFree, fx, chains],
  );

  const manualTot = manual.otmPct + manual.atmPct + manual.itmPct;
  const waitingEmp = needEmpirical && (loadingEmp || !stats);

  const uRows = useMemo(() => {
    const key = (u: UniverseUnderlying) =>
      uSort.col === 'ticker' ? u.ticker : uSort.col === 'spot' ? u.spot : uSort.col === 'iv' ? u.ivAtm
        : uSort.col === 'clients' ? u.clients : uSort.col === 'puts' ? u.soldPuts : u.latestDate;
    return [...underlyings].sort((a, b) => cmp(key(a), key(b), uSort.dir) || cmp(a.ticker, b.ticker, 'asc'));
  }, [underlyings, uSort]);

  const apply = (rep: boolean) => {
    if (!result.specs.length) return;
    onApply(result.specs, rep);
    toast.success(`${result.specs.length} put generate ${rep ? '(sostituite le precedenti)' : 'aggiunte'}`);
  };

  return (
    <div className="space-y-4">
      {/* ----------------- Dimensione ----------------- */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <div className={lbl}>
            Esposizione da generare
            <Tip>
              <b>Fino all'obiettivo</b>: put per (esposizione obiettivo − esposizione attuale del portafoglio virtuale),
              escludendo dall'attuale le put generate in precedenza se le sostituisci. <b>Importo</b>: esposizione
              delle sole nuove put. Esposizione di una put venduta = Strike × Contratti × 100 / Cambio (come le naked put
              del Risk Analyzer). I contratti sono arrotondati all'intero (minimo 1).
            </Tip>
          </div>
          <Select value={sizing} onValueChange={(v) => setSizing(v as 'target' | 'amount')}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="target" disabled={sim.exposure == null}>Fino all'obiettivo di esposizione</SelectItem>
              <SelectItem value="amount">Importo</SelectItem>
            </SelectContent>
          </Select>
          {sizing === 'amount' ? (
            <Input className="h-8 font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          ) : (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Obiettivo</span><span className="font-mono">{sim.exposure != null ? fmtEUR(sim.exposure) : '—'}</span></div>
              <div className="flex justify-between"><span>Già presente</span><span className="font-mono">{existingExposure != null ? fmtEUR(existingExposure) : '—'}</span></div>
            </div>
          )}
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Da generare</span><span className="font-mono font-semibold">{fmtEUR(targetGen)}</span></div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} />
            Sostituisci le put generate in precedenza ({randomCount})
          </label>
        </div>

        {/* ----------------- Strike ----------------- */}
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <div className={lbl}>
            Strike
            <Tip>
              Livello dello strike rispetto allo spot attuale (K/S − 1): negativo = put OTM, 0 = ATM, positivo = put ITM.
              Lo strike è il più vicino fra quelli realmente quotati per quella scadenza (catene salvate), altrimenti
              con passo 2,5 / 5 / 10 (spot &lt; 70 / ≤ 300 / &gt; 300), senza mai cambiare lato rispetto allo spot.
            </Tip>
          </div>
          <Select value={mode} onValueChange={(v) => setMode(v as MixMode)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Livello unico</SelectItem>
              <SelectItem value="empirical">Mix OTM/ATM/ITM empirico (storico)</SelectItem>
              <SelectItem value="manual">Ripartizione percentuale</SelectItem>
            </SelectContent>
          </Select>
          {mode === 'single' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Strike vs spot</span>
              <PctInput value={singleM} onChange={setSingleM} />
              <Badge variant="outline">{singleM < 0 ? 'OTM' : singleM > 0 ? 'ITM' : 'ATM'}</Badge>
            </div>
          )}
          {mode === 'manual' && (
            <div className="space-y-1 text-xs">
              <div className="grid grid-cols-[48px_1fr_1fr] gap-1 text-muted-foreground"><span /><span>Quota</span><span>Strike vs spot</span></div>
              {(['otm', 'atm', 'itm'] as const).map((b) => (
                <div key={b} className="grid grid-cols-[48px_1fr_1fr] gap-1 items-center">
                  <span className="font-semibold uppercase">{b}</span>
                  <PctInput value={manual[(b + 'Pct') as keyof typeof manual]}
                    onChange={(v) => setManual((m) => ({ ...m, [b + 'Pct']: Math.max(0, v) }))} />
                  <PctInput value={manual[(b + 'M') as keyof typeof manual]}
                    onChange={(v) => setManual((m) => ({ ...m, [b + 'M']: v }))} />
                </div>
              ))}
              {Math.abs(manualTot - 1) > 0.001 && (
                <div className="text-amber-500">Totale quote {fmtNum(manualTot * 100, 1)}%: verranno riproporzionate a 100%.</div>
              )}
            </div>
          )}
          {needEmpirical && (
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PERIODS.map((p) => <SelectItem key={p.v} value={p.v}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-muted-foreground">banda ATM ±</span>
                <PctInput value={atmBand} onChange={(v) => setAtmBand(Math.max(0, Math.abs(v)))} className="w-16" />
                <Tip>
                  Put vendute in tutti gli snapshot storici completi (Visualizzazione storica) di tutti i clienti, con lo
                  spot congelato di ciascuno snapshot. Pesi: ogni cliente pesa uguale, ogni suo snapshot pesa uguale,
                  dentro lo snapshot pesa l'esposizione. Con il mix empirico ogni put prende moneyness (e, con scadenza
                  empirica, durata) di una gamba storica estratta a caso nella sua fascia.
                </Tip>
              </div>
              {waitingEmp ? (
                <div className="text-muted-foreground flex items-center gap-1">
                  {empError ? <span className="text-destructive">Errore: {empError.message}</span> : <><Loader2 className="w-3 h-3 animate-spin" /> carico gli snapshot storici…</>}
                </div>
              ) : stats && (
                <div className="space-y-0.5">
                  {(['otm', 'atm', 'itm'] as const).map((b) => (
                    <div key={b} className="flex justify-between">
                      <span className="uppercase font-semibold">{b}</span>
                      <span className="font-mono">
                        {fmtNum(stats.pct[b] * 100, 1)}%
                        {stats.meanM[b] != null && <span className="text-muted-foreground"> · media {fmtPct(stats.meanM[b]!)}</span>}
                      </span>
                    </div>
                  ))}
                  <div className="text-muted-foreground">
                    {stats.legs} put · {stats.snapshots} snapshot · {stats.portfolios} clienti · DTE mediana {stats.medianDte ?? '—'} gg
                    {stats.firstDate && <> · {fmtDate(stats.firstDate)}–{fmtDate(stats.lastDate)}</>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ----------------- Scadenza / titoli ----------------- */}
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <div className={lbl}>Scadenza e titoli</div>
          <Select value={expiryMode} onValueChange={(v) => setExpiryMode(v as 'fixed' | 'empirical')}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Scadenza mensile fissa</SelectItem>
              <SelectItem value="empirical">Durata empirica (storico)</SelectItem>
            </SelectContent>
          </Select>
          {expiryMode === 'fixed' && (
            <Select value={expiry ?? ''} onValueChange={setFixedExpiry}>
              <SelectTrigger className="h-8"><SelectValue placeholder="scadenza" /></SelectTrigger>
              <SelectContent>
                {expiries.map((e) => (
                  <SelectItem key={e} value={e}>
                    {fmtDate(e)} · {Math.round((Date.parse(e + 'T16:00:00Z') - today.getTime()) / 86400000)} gg
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {expiryMode === 'empirical' && (
            <div className="text-xs text-muted-foreground">
              Durata residua estratta dalle put vendute storiche, arrotondata alla scadenza mensile più vicina (≥ 7 gg).
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Numero titoli</span>
            <Input className="h-8 w-16 font-mono" inputMode="numeric" value={nUnd} onChange={(e) => setNUnd(e.target.value)} />
            <span className="text-muted-foreground">su {pool.length}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Seed</span>
            <span className="font-mono">{seed}</span>
            <Button size="sm" variant="outline" className="h-7 ml-auto" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
              <Dices className="w-3.5 h-3.5 mr-1" /> Nuova estrazione
            </Button>
          </div>
          <button className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShowUniverse((s) => !s)}>
            {showUniverse ? 'Nascondi' : 'Mostra'} universo titoli ({underlyings.length}, esclusi {excluded.size})
          </button>
        </div>
      </div>

      {/* ----------------- Universo ----------------- */}
      {showUniverse && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
              <Checkbox checked={onlySoldPuts} onCheckedChange={(v) => setOnlySoldPuts(!!v)} />
              Solo sottostanti su cui i clienti hanno put vendute
            </label>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setExcluded(new Set())}>Includi tutti</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setExcluded(new Set(underlyings.map((u) => u.ticker)))}>Escludi tutti</Button>
            <span className="text-muted-foreground ml-auto">
              Universo: sottostanti delle opzioni detenute dai clienti con spot e IV disponibili.
              <Tip>
                Spot: prezzo live (underlying_prices), altrimenti quello congelato dello snapshot. IV: dalle opzioni OTM
                (± 2% ATM) degli snapshot più recenti del sottostante (± 7 giorni), premio snapshot vs spot congelato.
                Per ogni put generata l'IV è la media pesata dei punti vicini per strike relativo (banda 5%) e per
                durata (banda ×1,65 su T); le opzioni a meno di 10 giorni sono usate solo se non c'è altro. IV ATM =
                strike = spot a 2 mesi.
              </Tip>
            </span>
          </div>
          <div className="rounded-md border border-border max-h-[260px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background-secondary z-10 text-muted-foreground">
                <tr>
                  <th className="p-2 w-8" />
                  <SortTh col="ticker" sort={uSort} onSort={setUSort}>Ticker</SortTh>
                  <SortTh col="spot" sort={uSort} onSort={setUSort} align="right">Spot</SortTh>
                  <SortTh col="iv" sort={uSort} onSort={setUSort} align="right">IV ATM 2m</SortTh>
                  <th className="p-2 text-right">Punti smile</th>
                  <SortTh col="clients" sort={uSort} onSort={setUSort} align="right">Clienti</SortTh>
                  <SortTh col="puts" sort={uSort} onSort={setUSort} align="right">Put vendute</SortTh>
                  <SortTh col="date" sort={uSort} onSort={setUSort}>Dato al</SortTh>
                </tr>
              </thead>
              <tbody>
                {uRows.map((u) => (
                  <tr key={u.ticker} className={`border-t border-border/60 ${excluded.has(u.ticker) || (onlySoldPuts && !u.soldPuts) ? 'opacity-40' : ''}`}>
                    <td className="p-2">
                      <Checkbox
                        checked={!excluded.has(u.ticker)}
                        onCheckedChange={() =>
                          setExcluded((s) => {
                            const n = new Set(s);
                            if (n.has(u.ticker)) n.delete(u.ticker);
                            else n.add(u.ticker);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <span className="font-mono font-semibold">{u.ticker}</span>
                      <span className="text-[10.5px] text-muted-foreground ml-2">{u.name}</span>
                    </td>
                    <td className="p-2 text-right font-mono">
                      {fmtNum(u.spot, 2)} {u.currency}
                      {u.spotSource === 'snapshot' && <span className="text-amber-500" title="spot dello snapshot (live non disponibile)"> *</span>}
                    </td>
                    <td className="p-2 text-right font-mono">{fmtNum(u.ivAtm * 100, 1)}%</td>
                    <td className="p-2 text-right font-mono">{u.ivPoints.length}</td>
                    <td className="p-2 text-right font-mono">{u.clients}</td>
                    <td className="p-2 text-right font-mono">{u.soldPuts}</td>
                    <td className="p-2 font-mono">{fmtDate(u.latestDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------- Anteprima ----------------- */}
      <GeneratedPreview
        rows={result.rows}
        warnings={result.warnings}
        exposureEUR={result.exposureEUR}
        premiumEUR={result.premiumEUR}
        targetEUR={targetGen}
        loading={isLoading || waitingEmp}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!result.specs.length || waitingEmp} onClick={() => apply(replace)}>
          <Play className="w-4 h-4 mr-1" /> {replace ? 'Applica (sostituisce le generate)' : 'Applica'}
        </Button>
        {replace && randomCount > 0 && (
          <Button variant="outline" disabled={!result.specs.length || waitingEmp} onClick={() => apply(false)}>
            <Plus className="w-4 h-4 mr-1" /> Aggiungi alle generate esistenti
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          Le put generate entrano nel portafoglio virtuale come posizioni "Generata": Stress Lab, rolling, margine e
          netting le trattano come put reali.
        </span>
      </div>
    </div>
  );
}

type GCol = 'ticker' | 'bucket' | 'm' | 'K' | 'expiry' | 'iv' | 'premium' | 'contracts' | 'exp';

function GeneratedPreview({
  rows,
  warnings,
  exposureEUR,
  premiumEUR,
  targetEUR,
  loading,
}: {
  rows: ReturnType<typeof generateRandomPuts>['rows'];
  warnings: string[];
  exposureEUR: number;
  premiumEUR: number;
  targetEUR: number;
  loading: boolean;
}) {
  const [sort, setSort] = useState<SortState<GCol>>({ col: 'ticker', dir: 'asc' });
  const sorted = useMemo(() => {
    const key = (r: (typeof rows)[number]) =>
      sort.col === 'exp' ? r.exposureEUR : sort.col === 'bucket' ? r.bucket : (r[sort.col] as string | number);
    return [...rows].sort((a, b) => cmp(key(a), key(b), sort.dir) || cmp(a.ticker, b.ticker, 'asc'));
  }, [rows, sort]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-sm">Anteprima</span>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        <span className="text-muted-foreground">{rows.length} put</span>
        <span>esposizione <b className="font-mono">{fmtEUR(exposureEUR)}</b> <span className="text-muted-foreground">su {fmtEUR(targetEUR)}</span></span>
        <span>premi incassati <b className="font-mono">{fmtEUR(premiumEUR)}</b></span>
      </div>
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-0.5">
          {[...new Set(warnings)].map((w, i) => <div key={i} className="text-amber-600 dark:text-amber-400">{w}</div>)}
        </div>
      )}
      {rows.length > 0 && (
        <div className="rounded-md border border-border max-h-[300px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background-secondary z-10 text-muted-foreground">
              <tr>
                <SortTh col="ticker" sort={sort} onSort={setSort}>Ticker</SortTh>
                <SortTh col="bucket" sort={sort} onSort={setSort}>Fascia</SortTh>
                <SortTh col="m" sort={sort} onSort={setSort} align="right">K/S</SortTh>
                <SortTh col="K" sort={sort} onSort={setSort} align="right">Strike</SortTh>
                <SortTh col="expiry" sort={sort} onSort={setSort}>Scadenza</SortTh>
                <SortTh col="iv" sort={sort} onSort={setSort} align="right">IV</SortTh>
                <SortTh col="premium" sort={sort} onSort={setSort} align="right">Premio</SortTh>
                <SortTh col="contracts" sort={sort} onSort={setSort} align="right">Contratti</SortTh>
                <SortTh col="exp" sort={sort} onSort={setSort} align="right">Esposizione</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="p-2 font-mono font-semibold">{r.ticker} <span className="text-muted-foreground font-normal">@ {fmtNum(r.spot, 2)}</span></td>
                  <td className="p-2 uppercase">{r.bucket}</td>
                  <td className="p-2 text-right font-mono">{fmtPct(r.m)}</td>
                  <td className="p-2 text-right font-mono">
                    {fmtNum(r.K, 2)}
                    {r.strikeSource === 'rule' && <span className="text-muted-foreground" title="strike da regola 2,5/5/10 (catena non disponibile)"> ·r</span>}
                  </td>
                  <td className="p-2 font-mono">{fmtDate(r.expiry)}</td>
                  <td className="p-2 text-right font-mono">{fmtNum(r.iv * 100, 1)}%</td>
                  <td className="p-2 text-right font-mono">{fmtNum(r.premium, 2)}</td>
                  <td className="p-2 text-right font-mono text-destructive">−{r.contracts}</td>
                  <td className="p-2 text-right font-mono">{fmtEUR(r.exposureEUR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
