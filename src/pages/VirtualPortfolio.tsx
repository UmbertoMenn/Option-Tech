/**
 * Portafoglio virtuale — Stress Lab su un portafoglio modificabile.
 *
 * Parte dalle posizioni reali del portafoglio selezionato; l'utente può aggiungere
 * posizioni (singolarmente, da strumenti attuali dei clienti, incollando un elenco o con
 * la simulazione casuale) e rimuoverne (singolarmente o in blocco); può simulare il
 * patrimonio (liquidità) e fissare un'esposizione potenziale obiettivo. Le posizioni
 * risultanti sono iniettate con VirtualPositionsContext, quindi lo Stress Lab (e tutti gli
 * hook che usano usePortfolio) le vede come il portafoglio.
 * Nessuna scrittura su DB: lo stato vive nel browser, per portafoglio.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Eraser,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VirtualPositionsContext } from '@/contexts/VirtualPositionsContext';
import { useVirtualPortfolio, UseVirtualPortfolio } from '@/hooks/useVirtualPortfolio';
import { StressLabContent, StressLabMetrics } from '@/pages/RiskSimulator';
import { useClientUniverse } from '@/hooks/useVirtualSimulationData';
import { useUnderlyingMappings } from '@/hooks/useUnderlyingMappings';
import { useGPHoldings } from '@/hooks/useGPHoldings';
import { resolveUnderlyingTickerFromMappings, UnderlyingMappingRow } from '@/lib/underlyingTickerResolve';
import { specPutExposureEUR, theoreticalPremium, UniverseInstrument, UniverseUnderlying } from '@/lib/virtualSimulation';
import { SimSettingsPanel } from '@/components/virtual/SimSettingsPanel';
import { CurrentInstrumentsPicker } from '@/components/virtual/CurrentInstrumentsPicker';
import { RandomSimPanel } from '@/components/virtual/RandomSimPanel';
import { SortTh } from '@/components/virtual/virtualUi';
import { cmp, fmtDate, fmtEUR, fmtNum, SortState } from '@/components/virtual/virtualFormat';
import { Position } from '@/types/portfolio';
import {
  VirtualKind,
  VirtualPositionSpec,
  newSpecId,
  parseNum,
  parseVirtualPositionsText,
  parseExpiry,
  positionKey,
  validateSpec,
  optionDescriptor,
  inferCurrency,
  ParseError,
  cashForTargetPatrimony,
} from '@/lib/virtualPortfolio';

/* ============================== RIGHE ============================== */

const KIND_LABEL: Record<string, string> = {
  stock: 'Azione',
  etf: 'ETF',
  derivative: 'Opzione',
  option: 'Opzione',
  bond: 'Obbligazione',
  commodity: 'Commodity',
  cash: 'Liquidità',
};

type TypeFilter = 'all' | 'stock' | 'etf' | 'option' | 'put' | 'call' | 'other';

interface Row {
  rowId: string;
  origin: 'real' | 'added' | 'random';
  removed: boolean;
  realKey?: string;
  specId?: string;
  kind: string; // asset_type o 'option'
  /** Sottostante (opzioni) o ticker (titoli), risolto via underlying_mappings. */
  und: string;
  cp: 'call' | 'put' | null;
  strike: number | null;
  expiry: string | null;
  name: string;
  detail: string;
  qty: number;
  price: number | null;
  ccy: string;
  mvEUR: number | null;
  status?: string;
}

type Resolver = (raw: string | null | undefined) => string;

function optionLabel(ticker: string, type: 'call' | 'put' | null, strike: number | null) {
  return `${ticker} ${type === 'call' ? 'CALL' : 'PUT'} ${strike != null ? fmtNum(strike, 3) : '?'}`;
}

function realRow(p: Position, removed: boolean, resolve: Resolver): Row {
  const isOpt = p.asset_type === 'derivative';
  const mvAbs = p.snapshot_market_value ?? p.market_value;
  const mv = mvAbs == null ? null : isOpt ? Math.sign(p.quantity || 1) * Math.abs(mvAbs) : mvAbs;
  const rawUnd = (p.underlying || p.ticker || '').toUpperCase();
  const und = isOpt
    ? resolve(p.underlying || p.ticker || p.description) || rawUnd || p.description
    : (p.ticker || resolve(p.description) || p.description || '').toUpperCase();
  return {
    rowId: 'r:' + p.id,
    origin: 'real',
    removed,
    realKey: positionKey(p),
    kind: p.asset_type,
    und,
    cp: isOpt ? p.option_type : null,
    strike: isOpt ? p.strike_price : null,
    expiry: isOpt ? p.expiry_date : null,
    name: isOpt ? optionLabel(und || p.description, p.option_type, p.strike_price) : p.ticker || p.description,
    detail: isOpt ? `scad. ${fmtDate(p.expiry_date)} · ${p.description}` : p.ticker ? p.description : '',
    qty: p.quantity,
    price: p.snapshot_price ?? p.current_price,
    ccy: (p.currency || 'EUR').toUpperCase(),
    mvEUR: mv,
  };
}

function addedRow(s: VirtualPositionSpec, resolved: Position | undefined, fetching: boolean): Row {
  const isOpt = s.kind === 'option';
  const mvAbs = resolved ? resolved.snapshot_market_value ?? resolved.market_value : null;
  return {
    rowId: 'a:' + s.id,
    origin: s.origin === 'random' ? 'random' : 'added',
    removed: false,
    specId: s.id,
    kind: s.kind,
    und: s.ticker.toUpperCase(),
    cp: isOpt ? s.optionType ?? null : null,
    strike: isOpt ? s.strike ?? null : null,
    expiry: isOpt ? s.expiry ?? null : null,
    name: isOpt ? optionLabel(s.ticker, s.optionType ?? null, s.strike ?? null) : s.ticker,
    detail: isOpt
      ? `scad. ${fmtDate(s.expiry)} · ${optionDescriptor(s.ticker, s.expiry!, s.optionType!, s.strike!)}`
      : s.price
        ? 'prezzo inserito'
        : 'prezzo live',
    qty: s.qty,
    price: resolved ? resolved.snapshot_price ?? resolved.current_price : s.price ?? null,
    ccy: (resolved?.currency || s.currency || inferCurrency(s.ticker)).toUpperCase(),
    mvEUR: mvAbs == null ? null : isOpt ? Math.sign(s.qty) * Math.abs(mvAbs) : mvAbs,
    status: resolved ? undefined : fetching ? 'prezzo in caricamento…' : 'prezzo non disponibile: esclusa',
  };
}

const isOptKind = (kind: string) => kind === 'derivative' || kind === 'option';
const matchesType = (r: Row, f: TypeFilter) =>
  f === 'all' ||
  (f === 'stock' && r.kind === 'stock') ||
  (f === 'etf' && r.kind === 'etf') ||
  (f === 'option' && isOptKind(r.kind)) ||
  (f === 'put' && isOptKind(r.kind) && r.cp === 'put') ||
  (f === 'call' && isOptKind(r.kind) && r.cp === 'call') ||
  (f === 'other' && !['stock', 'etf', 'derivative', 'option'].includes(r.kind));

type PosCol = 'origin' | 'kind' | 'und' | 'cp' | 'strike' | 'expiry' | 'qty' | 'price' | 'mv';
const ORIGIN_ORDER: Record<Row['origin'], number> = { added: 0, random: 1, real: 2 };
const KIND_ORDER: Record<string, number> = { stock: 0, etf: 1, derivative: 2, option: 2, bond: 3, commodity: 4 };

function sortKey(r: Row, col: PosCol): string | number | null {
  switch (col) {
    case 'origin': return ORIGIN_ORDER[r.origin];
    case 'kind': return KIND_ORDER[r.kind] ?? 9;
    case 'und': return r.und;
    case 'cp': return r.cp;
    case 'strike': return r.strike;
    case 'expiry': return r.expiry;
    case 'qty': return r.qty;
    case 'price': return r.price;
    case 'mv': return r.mvEUR;
  }
}

/** Ordinamento per colonna, poi sottostante → C/P → scadenza → strike (stabile tra click). */
function sortRows(rows: Row[], sort: SortState<PosCol>): Row[] {
  return [...rows].sort(
    (a, b) =>
      cmp(sortKey(a, sort.col), sortKey(b, sort.col), sort.dir) ||
      cmp(a.und, b.und, 'asc') ||
      cmp(a.cp, b.cp, 'asc') ||
      cmp(a.expiry, b.expiry, 'asc') ||
      cmp(a.strike, b.strike, 'asc') ||
      cmp(a.rowId, b.rowId, 'asc'),
  );
}

/* ============================== FORM SINGOLO ============================== */

interface Prefill {
  nonce: number;
  spec: Omit<VirtualPositionSpec, 'id'>;
}

function SingleAddForm({
  onAdd,
  prefill,
  underlyings,
  riskFree,
}: {
  onAdd: (s: VirtualPositionSpec) => void;
  prefill: Prefill | null;
  underlyings: Map<string, UniverseUnderlying>;
  riskFree: number;
}) {
  const [kind, setKind] = useState<VirtualKind>('option');
  const [ticker, setTicker] = useState('');
  const [optType, setOptType] = useState<'call' | 'put'>('put');
  const [strike, setStrike] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [ccy, setCcy] = useState<'auto' | 'EUR' | 'USD' | 'HKD'>('auto');
  const [err, setErr] = useState<string | null>(null);

  // Precompilazione da "Strumenti attuali"
  useEffect(() => {
    if (!prefill) return;
    const p = prefill.spec;
    setKind(p.kind);
    setTicker(p.ticker);
    if (p.kind === 'option') {
      setOptType(p.optionType ?? 'put');
      setStrike(p.strike != null ? String(p.strike).replace('.', ',') : '');
      setExpiry(p.expiry ?? '');
    }
    setQty(String(p.qty).replace('.', ','));
    setPrice(p.price != null ? String(p.price).replace('.', ',') : '');
    setCcy(p.currency === 'EUR' || p.currency === 'USD' || p.currency === 'HKD' ? p.currency : 'auto');
    setErr(null);
  }, [prefill]);

  const isOpt = kind === 'option';

  // Premio teorico dall'IV attuale dei clienti sul sottostante (se presente nell'universo)
  const theo = useMemo(() => {
    if (!isOpt) return null;
    const u = underlyings.get(ticker.toUpperCase().trim());
    const K = parseNum(strike);
    if (!u || !K || !expiry || !parseExpiry(expiry)) return null;
    return theoreticalPremium(u, optType, K, expiry, riskFree, new Date());
  }, [isOpt, underlyings, ticker, strike, expiry, optType, riskFree]);

  const submit = () => {
    const q = parseNum(qty);
    const px = price.trim() ? parseNum(price) : isOpt && theo ? theo.price : undefined;
    const spec: Omit<VirtualPositionSpec, 'id'> = {
      kind,
      ticker: ticker.toUpperCase().trim(),
      qty: q ?? NaN,
      ...(px !== undefined ? { price: px ?? NaN } : {}),
      ...(ccy !== 'auto' ? { currency: ccy } : isOpt && underlyings.get(ticker.toUpperCase().trim()) ? { currency: underlyings.get(ticker.toUpperCase().trim())!.currency } : {}),
      ...(isOpt ? { optionType: optType, strike: parseNum(strike) ?? NaN, expiry } : {}),
    };
    const e = validateSpec(spec);
    if (e) {
      setErr(e);
      return;
    }
    setErr(null);
    onAdd({ ...spec, id: newSpecId() });
    setQty('');
    setPrice('');
    setStrike('');
  };

  const field = 'flex flex-col gap-1';
  const lbl = 'text-[11px] uppercase tracking-wide text-muted-foreground font-semibold';
  const u = underlyings.get(ticker.toUpperCase().trim());

  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8 items-end">
        <div className={field}>
          <span className={lbl}>Tipo</span>
          <Select value={kind} onValueChange={(v) => setKind(v as VirtualKind)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="option">Opzione</SelectItem>
              <SelectItem value="stock">Azione</SelectItem>
              <SelectItem value="etf">ETF</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <span className={lbl}>{isOpt ? 'Sottostante' : 'Ticker'}</span>
          <Input className="h-9 uppercase" placeholder={isOpt ? 'NVDA' : 'AAPL · ENI.MI'} value={ticker}
            list="virtual-universe-tickers"
            onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        {isOpt && (
          <>
            <div className={field}>
              <span className={lbl}>Call / Put</span>
              <Select value={optType} onValueChange={(v) => setOptType(v as 'call' | 'put')}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="put">Put</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={field}>
              <span className={lbl}>Strike</span>
              <Input className="h-9" inputMode="decimal" placeholder={u ? fmtNum(u.spot, 2) : '150'} value={strike}
                onChange={(e) => setStrike(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </div>
            <div className={field}>
              <span className={lbl}>Scadenza</span>
              <Input className="h-9" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
          </>
        )}
        <div className={field}>
          <span className={lbl}>{isOpt ? 'Contratti (− = venduta)' : 'Quantità'}</span>
          <Input className="h-9" inputMode="decimal" placeholder={isOpt ? '-2' : '100'} value={qty}
            onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div className={field}>
          <span className={lbl}>{isOpt ? (theo ? 'Premio (vuoto = teorico)' : 'Premio (per azione)') : 'Prezzo (vuoto = live)'}</span>
          <Input className="h-9" inputMode="decimal" placeholder={isOpt ? (theo ? fmtNum(theo.price, 2) : '7,40') : 'live'} value={price}
            onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div className={field}>
          <span className={lbl}>Divisa</span>
          <Select value={ccy} onValueChange={(v) => setCcy(v as typeof ccy)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (da ticker)</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="HKD">HKD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="h-9" onClick={submit}>
          <Plus className="w-4 h-4 mr-1" /> Aggiungi
        </Button>
      </div>
      {isOpt && u && (
        <p className="text-xs text-muted-foreground">
          {u.ticker}: spot {fmtNum(u.spot, 2)} {u.currency} · IV ATM 2m clienti {fmtNum(u.ivAtm * 100, 1)}%
          {theo && (
            <>
              {' '}· premio teorico <b className="text-foreground">{fmtNum(theo.price, 2)}</b> (IV {fmtNum(theo.iv * 100, 1)}% a
              strike e durata, Black-76){' '}
              <button className="text-primary hover:underline" onClick={() => setPrice(String(theo.price).replace('.', ','))}>usa</button>
            </>
          )}
        </p>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

/* ============================== INSERIMENTO MASSIVO ============================== */

const BULK_PLACEHOLDER = `# una posizione per riga — separatori: spazio, tab, ; o |
AAPL 100                      azione, prezzo live
ENI.MI 500 14,20 EUR          azione con prezzo e divisa
ETF SPY 50                    ETF
NVDA P 150 2026-12-18 -2 7,40 opzione: C/P strike scadenza contratti premio
MSFT C 500 12/26 -1 12,5      scadenza mensile MM/AA (terzo venerdì)
[AMZN][03/27][P][180] -3 9,1  descrittore dei flussi banca + contratti premio`;

function BulkAddForm({ onAdd }: { onAdd: (s: VirtualPositionSpec[]) => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<ParseError[]>([]);

  const submit = () => {
    const { specs, errors: errs } = parseVirtualPositionsText(text);
    if (specs.length) onAdd(specs);
    setErrors(errs);
    // Restano nel box solo le righe da correggere.
    setText(errs.map((e) => e.text).join('\n'));
    if (specs.length) toast.success(`${specs.length} posizioni aggiunte`);
    if (errs.length) toast.error(`${errs.length} righe non riconosciute`);
  };

  return (
    <div className="space-y-2">
      <Textarea
        className="font-mono text-xs min-h-[150px]"
        placeholder={BULK_PLACEHOLDER}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!text.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Aggiungi tutte
        </Button>
        <span className="text-xs text-muted-foreground">
          Premio obbligatorio per le opzioni. Titoli senza prezzo → prezzo live. Divisa dedotta dal suffisso del ticker
          (.MI/.PA/.DE… = EUR, .HK = HKD, nessun suffisso = USD).
        </span>
      </div>
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-0.5">
          {errors.map((e, i) => (
            <div key={i} className="font-mono">
              <span className="text-destructive font-semibold">riga {e.line}:</span> {e.reason} —{' '}
              <span className="text-muted-foreground">{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== ELENCO POSIZIONI ============================== */

function PositionsTable({ vp, resolve }: { vp: UseVirtualPortfolio; resolve: Resolver }) {
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState<PosCol>>({ col: 'origin', dir: 'asc' });

  const rows = useMemo<Row[]>(() => {
    const resolvedById = new Map(vp.positions.map((p) => [p.id, p]));
    const real = vp.realPositions.map((p) => realRow(p, vp.removedKeys.has(positionKey(p)), resolve));
    const added = vp.state.added.map((s) => addedRow(s, resolvedById.get('virtual:' + s.id), vp.isFetchingPrices));
    return [...added, ...real];
  }, [vp.positions, vp.realPositions, vp.removedKeys, vp.state.added, vp.isFetchingPrices, resolve]);

  const visible = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return sortRows(
      rows.filter(
        (r) =>
          (showRemoved || !r.removed) &&
          matchesType(r, typeFilter) &&
          (!f || r.und.includes(f) || r.name.toUpperCase().includes(f) || r.detail.toUpperCase().includes(f)),
      ),
      sort,
    );
  }, [rows, filter, typeFilter, showRemoved, sort]);

  const removedCount = rows.filter((r) => r.removed).length;
  const visibleIds = visible.map((r) => r.rowId);
  const selVisible = visible.filter((r) => selected.has(r.rowId));
  const allVisibleSelected = visible.length > 0 && selVisible.length === visible.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) visibleIds.forEach((id) => n.delete(id));
      else visibleIds.forEach((id) => n.add(id));
      return n;
    });

  const removeRows = (rs: Row[]) => {
    const realKeys = rs.filter((r) => r.origin === 'real' && !r.removed).map((r) => r.realKey!);
    const addedIds = rs.filter((r) => r.origin === 'added').map((r) => r.specId!);
    if (!realKeys.length && !addedIds.length) return;
    vp.remove(realKeys, addedIds);
    setSelected((s) => {
      const n = new Set(s);
      rs.forEach((r) => n.delete(r.rowId));
      return n;
    });
  };
  const restoreRows = (rs: Row[]) => {
    const keys = rs.filter((r) => r.removed).map((r) => r.realKey!);
    if (!keys.length) return;
    vp.restoreReal(keys);
    setSelected((s) => {
      const n = new Set(s);
      rs.forEach((r) => n.delete(r.rowId));
      return n;
    });
  };

  const selRemovable = selVisible.filter((r) => !r.removed);
  const selRestorable = selVisible.filter((r) => r.removed);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-48" placeholder="Filtra ticker / descrizione" value={filter}
          onChange={(e) => setFilter(e.target.value)} />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i tipi</SelectItem>
            <SelectItem value="option">Opzioni</SelectItem>
            <SelectItem value="put">Solo put</SelectItem>
            <SelectItem value="call">Solo call</SelectItem>
            <SelectItem value="stock">Azioni</SelectItem>
            <SelectItem value="etf">ETF</SelectItem>
            <SelectItem value="other">Bond / commodity</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={showRemoved} onCheckedChange={(v) => setShowRemoved(!!v)} />
          Mostra rimosse ({removedCount})
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="destructive" disabled={!selRemovable.length} onClick={() => removeRows(selRemovable)}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi selezionate ({selRemovable.length})
          </Button>
          {showRemoved && (
            <Button size="sm" variant="outline" disabled={!selRestorable.length} onClick={() => restoreRows(selRestorable)}>
              <Undo2 className="w-3.5 h-3.5 mr-1" /> Ripristina selezionate ({selRestorable.length})
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border max-h-[440px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background-secondary z-10">
            <tr className="text-left text-muted-foreground">
              <th className="p-2 w-8">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label="Seleziona tutte le righe visibili" />
              </th>
              <SortTh col="origin" sort={sort} onSort={setSort}>Origine</SortTh>
              <SortTh col="kind" sort={sort} onSort={setSort}>Tipo</SortTh>
              <SortTh col="und" sort={sort} onSort={setSort}>Sottostante / strumento</SortTh>
              <SortTh col="cp" sort={sort} onSort={setSort}>C/P</SortTh>
              <SortTh col="strike" sort={sort} onSort={setSort} align="right">Strike</SortTh>
              <SortTh col="expiry" sort={sort} onSort={setSort}>Scadenza</SortTh>
              <SortTh col="qty" sort={sort} onSort={setSort} align="right">Qtà</SortTh>
              <SortTh col="price" sort={sort} onSort={setSort} align="right">Prezzo</SortTh>
              <SortTh col="mv" sort={sort} onSort={setSort} align="right">Controvalore</SortTh>
              <th className="p-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">Nessuna posizione.</td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.rowId} className={`border-t border-border/60 ${r.removed ? 'opacity-45' : ''}`}>
                <td className="p-2">
                  <Checkbox checked={selected.has(r.rowId)} onCheckedChange={() => toggle(r.rowId)} />
                </td>
                <td className="p-2">
                  {r.origin === 'added' ? (
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Aggiunta</Badge>
                  ) : r.origin === 'random' ? (
                    <Badge className="bg-violet-500/15 text-violet-500 hover:bg-violet-500/15">Generata</Badge>
                  ) : r.removed ? (
                    <Badge variant="outline" className="line-through">Rimossa</Badge>
                  ) : (
                    <Badge variant="outline">Reale</Badge>
                  )}
                </td>
                <td className="p-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className="p-2">
                  <div className={`font-mono font-semibold ${r.removed ? 'line-through' : ''}`}>{r.cp ? r.und : r.name}</div>
                  {r.detail && <div className="text-[10.5px] text-muted-foreground truncate max-w-[300px]">{r.detail}</div>}
                  {r.status && <div className="text-[10.5px] text-amber-500">{r.status}</div>}
                </td>
                <td className="p-2">
                  {r.cp && (
                    <Badge variant="outline" className={r.cp === 'put' ? 'text-primary' : 'text-amber-500'}>
                      {r.cp === 'put' ? 'PUT' : 'CALL'}
                    </Badge>
                  )}
                </td>
                <td className="p-2 text-right font-mono">{r.strike != null ? fmtNum(r.strike, 3) : ''}</td>
                <td className="p-2 font-mono">{fmtDate(r.expiry)}</td>
                <td className={`p-2 text-right font-mono ${r.qty < 0 ? 'text-destructive' : ''}`}>{fmtNum(r.qty, 4)}</td>
                <td className="p-2 text-right font-mono">
                  {r.price != null ? `${fmtNum(r.price, 4)} ${r.ccy}` : '—'}
                </td>
                <td className="p-2 text-right font-mono">{r.mvEUR != null ? fmtEUR(r.mvEUR) : '—'}</td>
                <td className="p-2 text-right">
                  {r.removed ? (
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Ripristina" onClick={() => restoreRows([r])}>
                      <Undo2 className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Rimuovi"
                      onClick={() => removeRows([r])}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== EDITOR ============================== */

interface EditorProps {
  vp: UseVirtualPortfolio;
  metrics: StressLabMetrics | null;
  cashOverride: number | null;
}

function VirtualPortfolioEditor({ vp, metrics, cashOverride }: EditorProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState('single');
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const realCount = vp.realPositions.length;
  const removed = vp.realPositions.filter((p) => vp.removedKeys.has(positionKey(p))).length;
  const added = vp.state.added.filter((a) => a.origin !== 'random').length;
  const generated = vp.state.added.filter((a) => a.origin === 'random');
  const total = vp.positions.length;
  const modified = removed > 0 || vp.state.added.length > 0;

  const { universe, chains, riskFree, spotsByPortfolioDate, isLoading: loadingUniverse, error: universeError } = useClientUniverse();
  const { allMappings } = useUnderlyingMappings();
  const mappings = allMappings.data as UnderlyingMappingRow[] | undefined;
  const resolve = useCallback<Resolver>((raw) => resolveUnderlyingTickerFromMappings(raw, mappings), [mappings]);
  const underlyingMap = useMemo(() => new Map((universe?.underlyings ?? []).map((u) => [u.ticker, u])), [universe]);
  const { gpHoldings } = useGPHoldings();
  const realCash = vp.realCash;

  const randomExposure = useMemo(() => generated.reduce((a, s) => a + specPutExposureEUR(s, vp.fx), 0), [generated, vp.fx]);

  const pick = (i: UniverseInstrument) => {
    setPrefill({
      nonce: Date.now(),
      spec:
        i.kind === 'option'
          ? { kind: 'option', ticker: i.ticker, qty: -1, price: i.price ?? undefined, currency: i.currency, optionType: i.optionType, strike: i.strike, expiry: i.expiry }
          : { kind: i.kind, ticker: i.ticker, qty: 100 },
    });
    setTab('single');
  };

  return (
    <div className="rounded-lg border border-border bg-card mb-4">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button className="flex items-center gap-2 font-semibold text-sm" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Composizione portafoglio virtuale
        </button>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{total} posizioni</Badge>
          <span>reali {realCount - removed}/{realCount}</span>
          <span>· rimosse {removed}</span>
          <span>· aggiunte {added}</span>
          <span>· generate {generated.length}</span>
          {vp.pending.length > 0 && (
            <span className="text-amber-500 flex items-center gap-1">
              {vp.isFetchingPrices && <Loader2 className="w-3 h-3 animate-spin" />}· {vp.pending.length} senza prezzo
            </span>
          )}
          {vp.sim.patrimony != null && <Badge variant="outline">patrimonio {fmtEUR(vp.sim.patrimony)}</Badge>}
          {vp.sim.exposure != null && <Badge variant="outline">esposizione obiettivo {fmtEUR(vp.sim.exposure)}</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {generated.length > 0 && (
            <Button size="sm" variant="outline"
              onClick={() => { vp.replaceRandom([]); toast.success('Put generate rimosse'); }}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi generate
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!modified}
            onClick={() => { vp.resetToReal(); toast.success('Portafoglio virtuale riallineato al reale'); }}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Ripristina reale
          </Button>
          <Button size="sm" variant="outline" disabled={total === 0 && vp.state.added.length === 0}
            onClick={() => { vp.clearAll(); toast.success('Portafoglio virtuale svuotato'); }}>
            <Eraser className="w-3.5 h-3.5 mr-1" /> Svuota
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <SimSettingsPanel
            sim={vp.sim}
            setSim={vp.setSim}
            metrics={metrics}
            cashOverride={cashOverride}
            realCash={realCash}
            hasGP={(gpHoldings?.length ?? 0) > 0 || vp.sim.excludeGP}
          />
          {universeError && (
            <p className="text-xs text-destructive">Strumenti dei clienti non disponibili: {universeError.message}</p>
          )}
          <datalist id="virtual-universe-tickers">
            {(universe?.underlyings ?? []).map((u) => <option key={u.ticker} value={u.ticker}>{u.name}</option>)}
          </datalist>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="single">Aggiungi singola</TabsTrigger>
              <TabsTrigger value="current">Da strumenti attuali</TabsTrigger>
              <TabsTrigger value="bulk">Inserimento massivo</TabsTrigger>
              <TabsTrigger value="random">Simulazione casuale</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="pt-2">
              <SingleAddForm
                prefill={prefill}
                underlyings={underlyingMap}
                riskFree={riskFree}
                onAdd={(s) => { vp.addSpecs([s]); toast.success(`${s.ticker} aggiunta`); }}
              />
            </TabsContent>
            <TabsContent value="current" className="pt-2">
              <CurrentInstrumentsPicker
                instruments={universe?.instruments ?? []}
                isLoading={loadingUniverse}
                onPick={pick}
                onAdd={(s) => { vp.addSpecs([s]); toast.success(`${s.ticker} aggiunta`); }}
              />
            </TabsContent>
            <TabsContent value="bulk" className="pt-2">
              <BulkAddForm onAdd={vp.addSpecs} />
            </TabsContent>
            <TabsContent value="random" className="pt-2">
              <RandomSimPanel
                underlyings={universe?.underlyings ?? []}
                chains={chains}
                riskFree={riskFree}
                fx={vp.fx}
                sim={vp.sim}
                metrics={metrics}
                randomExposureEUR={randomExposure}
                randomCount={generated.length}
                spotsByPortfolioDate={spotsByPortfolioDate}
                isLoading={loadingUniverse}
                onApply={(specs, replace) => (replace ? vp.replaceRandom(specs) : vp.addSpecs(specs))}
              />
            </TabsContent>
          </Tabs>
          <PositionsTable vp={vp} resolve={resolve} />
          <p className="text-[11px] text-muted-foreground">
            Le modifiche restano solo nel portafoglio virtuale (salvate in questo browser, per portafoglio): il
            portafoglio reale non viene toccato. Le posizioni aggiunte o generate entrano nello Stress Lab come quelle
            reali (classificazione strategie, rolling, margine, netting); rimosse per chiave stabile, restano escluse
            anche dopo un nuovo caricamento dei flussi. Liquidità reale salvo patrimonio simulato; GP reale salvo
            esclusione.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================== PAGE ============================== */

function VirtualPortfolioBody() {
  const vp = useVirtualPortfolio();
  const [metrics, setMetrics] = useState<StressLabMetrics | null>(null);
  const onMetrics = useCallback((m: StressLabMetrics) => {
    setMetrics((prev) =>
      prev &&
      prev.isLoading === m.isLoading &&
      Math.abs(prev.patrimony - m.patrimony) < 0.005 &&
      Math.abs(prev.cash - m.cash) < 0.005 &&
      Math.abs(prev.equityExposure - m.equityExposure) < 0.005
        ? prev
        : m,
    );
  }, []);

  // Patrimonio simulato → liquidità. patrimonio − liquidità non dipende dalla liquidità, quindi
  // il valore converge in un passo; lo si aggiorna solo a dati caricati (niente salti a vuoto).
  const [cashOverride, setCashOverride] = useState<number | null>(null);
  const target = vp.sim.patrimony;
  useEffect(() => {
    if (target == null) {
      setCashOverride(null);
      return;
    }
    if (!metrics || metrics.isLoading) return;
    const c = cashForTargetPatrimony(target, metrics.patrimony, metrics.cash);
    setCashOverride((prev) => (prev != null && Math.abs(prev - c) < 0.01 ? prev : c));
  }, [target, metrics]);

  const ctx = useMemo(
    () => ({ positions: vp.positions, cashValue: target != null ? cashOverride : null, excludeGP: vp.sim.excludeGP }),
    [vp.positions, target, cashOverride, vp.sim.excludeGP],
  );
  return (
    <>
      <VirtualPortfolioEditor vp={vp} metrics={metrics} cashOverride={target != null ? cashOverride : null} />
      <VirtualPositionsContext.Provider value={ctx}>
        <ErrorBoundary title="Errore nello Stress Lab del portafoglio virtuale">
          <StressLabContent virtual onMetrics={onMetrics} />
        </ErrorBoundary>
      </VirtualPositionsContext.Provider>
    </>
  );
}

export function VirtualPortfolio() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Layers className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Portafoglio virtuale</h1>
              <p className="text-xs text-muted-foreground">Stress Lab su portafoglio modificabile</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/risk-simulator')}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Stress Lab
            </Button>
            <AppHeaderMenu />
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-4">
        <ErrorBoundary title="Errore nel caricamento del portafoglio virtuale">
          <VirtualPortfolioBody />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default VirtualPortfolio;
