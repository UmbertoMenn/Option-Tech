/**
 * Portafoglio virtuale — Stress Lab su un portafoglio modificabile.
 *
 * Parte dalle posizioni reali del portafoglio selezionato; l'utente può aggiungere
 * posizioni (singolarmente o incollando un elenco) e rimuoverne (singolarmente o in
 * blocco). Le posizioni risultanti sono iniettate con VirtualPositionsContext, quindi lo
 * Stress Lab (e tutti gli hook che usano usePortfolio) le vede come il portafoglio.
 * Nessuna scrittura su DB: lo stato vive nel browser, per portafoglio.
 */
import { useMemo, useState } from 'react';
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
import { StressLabContent } from '@/pages/RiskSimulator';
import { Position } from '@/types/portfolio';
import {
  VirtualKind,
  VirtualPositionSpec,
  newSpecId,
  parseNum,
  parseVirtualPositionsText,
  positionKey,
  validateSpec,
  optionDescriptor,
  inferCurrency,
  ParseError,
} from '@/lib/virtualPortfolio';

/* ============================== FORMAT ============================== */

const fmtNum = (v: number, dec = 2) =>
  v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fmtEUR = (v: number) =>
  (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' €';
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const KIND_LABEL: Record<string, string> = {
  stock: 'Azione',
  etf: 'ETF',
  derivative: 'Opzione',
  option: 'Opzione',
  bond: 'Obbligazione',
  commodity: 'Commodity',
  cash: 'Liquidità',
};

type TypeFilter = 'all' | 'stock' | 'etf' | 'option' | 'other';

interface Row {
  rowId: string;
  origin: 'real' | 'added';
  removed: boolean;
  realKey?: string;
  specId?: string;
  kind: string; // asset_type o 'option'
  name: string;
  detail: string;
  qty: number;
  price: number | null;
  ccy: string;
  mvEUR: number | null;
  status?: string;
}

function optionLabel(ticker: string, type: 'call' | 'put' | null, strike: number | null) {
  return `${ticker} ${type === 'call' ? 'CALL' : 'PUT'} ${strike != null ? fmtNum(strike, 3) : '?'}`;
}

function realRow(p: Position, removed: boolean): Row {
  const isOpt = p.asset_type === 'derivative';
  const mvAbs = p.snapshot_market_value ?? p.market_value;
  const mv = mvAbs == null ? null : isOpt ? Math.sign(p.quantity || 1) * Math.abs(mvAbs) : mvAbs;
  const und = (p.underlying || p.ticker || '').toUpperCase();
  return {
    rowId: 'r:' + p.id,
    origin: 'real',
    removed,
    realKey: positionKey(p),
    kind: p.asset_type,
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
    origin: 'added',
    removed: false,
    specId: s.id,
    kind: s.kind,
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

const matchesType = (kind: string, f: TypeFilter) =>
  f === 'all' ||
  (f === 'stock' && kind === 'stock') ||
  (f === 'etf' && kind === 'etf') ||
  (f === 'option' && (kind === 'derivative' || kind === 'option')) ||
  (f === 'other' && !['stock', 'etf', 'derivative', 'option'].includes(kind));

/* ============================== FORM SINGOLO ============================== */

function SingleAddForm({ onAdd }: { onAdd: (s: VirtualPositionSpec) => void }) {
  const [kind, setKind] = useState<VirtualKind>('option');
  const [ticker, setTicker] = useState('');
  const [optType, setOptType] = useState<'call' | 'put'>('put');
  const [strike, setStrike] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [ccy, setCcy] = useState<'auto' | 'EUR' | 'USD' | 'HKD'>('auto');
  const [err, setErr] = useState<string | null>(null);

  const isOpt = kind === 'option';

  const submit = () => {
    const q = parseNum(qty);
    const px = price.trim() ? parseNum(price) : undefined;
    const spec: Omit<VirtualPositionSpec, 'id'> = {
      kind,
      ticker: ticker.toUpperCase().trim(),
      qty: q ?? NaN,
      ...(px !== undefined ? { price: px ?? NaN } : {}),
      ...(ccy !== 'auto' ? { currency: ccy } : {}),
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
              <Input className="h-9" inputMode="decimal" placeholder="150" value={strike}
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
          <span className={lbl}>{isOpt ? 'Premio (per azione)' : 'Prezzo (vuoto = live)'}</span>
          <Input className="h-9" inputMode="decimal" placeholder={isOpt ? '7,40' : 'live'} value={price}
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

function PositionsTable({ vp }: { vp: UseVirtualPortfolio }) {
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo<Row[]>(() => {
    const resolvedById = new Map(vp.positions.map((p) => [p.id, p]));
    const real = vp.realPositions.map((p) => realRow(p, vp.removedKeys.has(positionKey(p))));
    const added = vp.state.added.map((s) => addedRow(s, resolvedById.get('virtual:' + s.id), vp.isFetchingPrices));
    return [...added, ...real];
  }, [vp.positions, vp.realPositions, vp.removedKeys, vp.state.added, vp.isFetchingPrices]);

  const visible = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return rows.filter(
      (r) =>
        (showRemoved || !r.removed) &&
        matchesType(r.kind, typeFilter) &&
        (!f || r.name.toUpperCase().includes(f) || r.detail.toUpperCase().includes(f)),
    );
  }, [rows, filter, typeFilter, showRemoved]);

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
              <th className="p-2">Origine</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">Strumento</th>
              <th className="p-2 text-right">Qtà</th>
              <th className="p-2 text-right">Prezzo</th>
              <th className="p-2 text-right">Controvalore</th>
              <th className="p-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">Nessuna posizione.</td>
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
                  ) : r.removed ? (
                    <Badge variant="outline" className="line-through">Rimossa</Badge>
                  ) : (
                    <Badge variant="outline">Reale</Badge>
                  )}
                </td>
                <td className="p-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className="p-2">
                  <div className={`font-mono font-semibold ${r.removed ? 'line-through' : ''}`}>{r.name}</div>
                  {r.detail && <div className="text-[10.5px] text-muted-foreground truncate max-w-[340px]">{r.detail}</div>}
                  {r.status && <div className="text-[10.5px] text-amber-500">{r.status}</div>}
                </td>
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

function VirtualPortfolioEditor({ vp }: { vp: UseVirtualPortfolio }) {
  const [open, setOpen] = useState(true);
  const realCount = vp.realPositions.length;
  const removed = vp.realPositions.filter((p) => vp.removedKeys.has(positionKey(p))).length;
  const added = vp.state.added.length;
  const total = vp.positions.length;
  const modified = removed > 0 || added > 0;

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
          {vp.pending.length > 0 && (
            <span className="text-amber-500 flex items-center gap-1">
              {vp.isFetchingPrices && <Loader2 className="w-3 h-3 animate-spin" />}· {vp.pending.length} senza prezzo
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!modified}
            onClick={() => { vp.resetToReal(); toast.success('Portafoglio virtuale riallineato al reale'); }}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Ripristina reale
          </Button>
          <Button size="sm" variant="outline" disabled={total === 0 && added === 0}
            onClick={() => { vp.clearAll(); toast.success('Portafoglio virtuale svuotato'); }}>
            <Eraser className="w-3.5 h-3.5 mr-1" /> Svuota
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <Tabs defaultValue="single">
            <TabsList>
              <TabsTrigger value="single">Aggiungi singola</TabsTrigger>
              <TabsTrigger value="bulk">Inserimento massivo</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="pt-2">
              <SingleAddForm onAdd={(s) => { vp.addSpecs([s]); toast.success(`${s.ticker} aggiunta`); }} />
            </TabsContent>
            <TabsContent value="bulk" className="pt-2">
              <BulkAddForm onAdd={vp.addSpecs} />
            </TabsContent>
          </Tabs>
          <PositionsTable vp={vp} />
          <p className="text-[11px] text-muted-foreground">
            Le modifiche restano solo nel portafoglio virtuale (salvate in questo browser, per portafoglio): il
            portafoglio reale non viene toccato. Le posizioni aggiunte entrano nello Stress Lab come quelle reali
            (classificazione strategie, rolling, margine, netting); rimosse per chiave stabile, restano escluse anche
            dopo un nuovo caricamento dei flussi. Liquidità e Gestione Patrimoniale restano quelle reali.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================== PAGE ============================== */

function VirtualPortfolioBody() {
  const vp = useVirtualPortfolio();
  const ctx = useMemo(() => ({ positions: vp.positions }), [vp.positions]);
  return (
    <>
      <VirtualPortfolioEditor vp={vp} />
      <VirtualPositionsContext.Provider value={ctx}>
        <ErrorBoundary title="Errore nello Stress Lab del portafoglio virtuale">
          <StressLabContent virtual />
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
