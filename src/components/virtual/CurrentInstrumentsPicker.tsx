/**
 * Strumenti attualmente detenuti da tutti i clienti (ultimo caricamento di ogni portafoglio):
 * ricerca, filtri, ordinamento; "Usa" precompila il form di inserimento singolo, "+" aggiunge
 * subito con la quantità indicata e il prezzo dello snapshot più recente.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UniverseInstrument } from '@/lib/virtualSimulation';
import { VirtualPositionSpec, newSpecId, parseNum } from '@/lib/virtualPortfolio';
import { SortTh, Tip } from './virtualUi';
import { cmp, fmtDate, fmtNum, fmtPct, lbl, SortState } from './virtualFormat';

type Col = 'ticker' | 'kind' | 'cp' | 'strike' | 'expiry' | 'm' | 'price' | 'iv' | 'clients' | 'qty';
type KindFilter = 'all' | 'put' | 'call' | 'equity';

function instrumentToSpec(i: UniverseInstrument, qty: number): VirtualPositionSpec {
  if (i.kind === 'option') {
    return {
      id: newSpecId(), kind: 'option', ticker: i.ticker, qty, price: i.price ?? undefined, currency: i.currency,
      optionType: i.optionType, strike: i.strike, expiry: i.expiry,
    };
  }
  return { id: newSpecId(), kind: i.kind, ticker: i.ticker, qty };
}

export function CurrentInstrumentsPicker({
  instruments,
  isLoading,
  onPick,
  onAdd,
}: {
  instruments: UniverseInstrument[];
  isLoading: boolean;
  onPick: (i: UniverseInstrument) => void;
  onAdd: (s: VirtualPositionSpec) => void;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('put');
  const [onlyLive, setOnlyLive] = useState(true);
  const [optQty, setOptQty] = useState('-1');
  const [eqQty, setEqQty] = useState('100');
  const [sort, setSort] = useState<SortState<Col>>({ col: 'ticker', dir: 'asc' });
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const f = q.trim().toUpperCase();
    const out = instruments.filter(
      (i) =>
        (kind === 'all' ||
          (kind === 'equity' && i.kind !== 'option') ||
          (i.kind === 'option' && i.optionType === kind)) &&
        (!onlyLive || i.kind !== 'option' || (i.expiry ?? '') >= today) &&
        (!f || i.ticker.includes(f) || i.name.toUpperCase().includes(f)),
    );
    const key = (i: UniverseInstrument): string | number | null => {
      switch (sort.col) {
        case 'ticker': return i.ticker;
        case 'kind': return i.kind;
        case 'cp': return i.optionType ?? null;
        case 'strike': return i.strike ?? null;
        case 'expiry': return i.expiry ?? null;
        case 'm': return i.moneyness;
        case 'price': return i.price;
        case 'iv': return i.iv;
        case 'clients': return i.clients;
        case 'qty': return i.totalQty;
      }
    };
    return out.sort(
      (a, b) =>
        cmp(key(a), key(b), sort.dir) ||
        cmp(a.ticker, b.ticker, 'asc') ||
        cmp(a.optionType ?? null, b.optionType ?? null, 'asc') ||
        cmp(a.expiry ?? null, b.expiry ?? null, 'asc') ||
        cmp(a.strike ?? null, b.strike ?? null, 'asc'),
    );
  }, [instruments, q, kind, onlyLive, sort, today]);

  const qtyFor = (i: UniverseInstrument) => {
    const n = parseNum(i.kind === 'option' ? optQty : eqQty);
    return n && Number.isFinite(n) ? (i.kind === 'option' ? Math.trunc(n) : n) : 0;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="h-8 w-48" placeholder="Cerca ticker / nome" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="put">Put</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="equity">Azioni / ETF</SelectItem>
            <SelectItem value="all">Tutti</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" className="accent-primary" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} />
          solo opzioni non scadute
        </label>
        <div className="flex items-end gap-2 ml-auto">
          <div className="flex flex-col gap-1">
            <span className={lbl}>Contratti per "+"</span>
            <Input className="h-8 w-24" inputMode="decimal" value={optQty} onChange={(e) => setOptQty(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className={lbl}>Azioni per "+"</span>
            <Input className="h-8 w-24" inputMode="decimal" value={eqQty} onChange={(e) => setEqQty(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="rounded-md border border-border max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background-secondary z-10 text-muted-foreground">
            <tr>
              <SortTh col="ticker" sort={sort} onSort={setSort}>Sottostante</SortTh>
              <SortTh col="kind" sort={sort} onSort={setSort}>Tipo</SortTh>
              <SortTh col="cp" sort={sort} onSort={setSort}>C/P</SortTh>
              <SortTh col="strike" sort={sort} onSort={setSort} align="right">Strike</SortTh>
              <SortTh col="expiry" sort={sort} onSort={setSort}>Scadenza</SortTh>
              <SortTh col="m" sort={sort} onSort={setSort} align="right">
                K/S<Tip>Strike rispetto allo spot attuale del sottostante (K/S − 1): per una put, negativo = OTM, positivo = ITM.</Tip>
              </SortTh>
              <SortTh col="price" sort={sort} onSort={setSort} align="right">Prezzo</SortTh>
              <SortTh col="iv" sort={sort} onSort={setSort} align="right">
                IV<Tip>Volatilità implicita dal premio dello snapshot più recente e dallo spot congelato dello stesso snapshot.</Tip>
              </SortTh>
              <SortTh col="clients" sort={sort} onSort={setSort} align="right">Clienti</SortTh>
              <SortTh col="qty" sort={sort} onSort={setSort} align="right">Qtà tot.</SortTh>
              <th className="p-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">
                  {isLoading ? 'Caricamento strumenti dei clienti…' : 'Nessuno strumento.'}
                </td>
              </tr>
            )}
            {rows.map((i) => (
              <tr key={i.key} className="border-t border-border/60">
                <td className="p-2">
                  <div className="font-mono font-semibold">{i.ticker}</div>
                  <div className="text-[10.5px] text-muted-foreground truncate max-w-[200px]">{i.name}</div>
                </td>
                <td className="p-2">{i.kind === 'option' ? 'Opzione' : i.kind === 'etf' ? 'ETF' : 'Azione'}</td>
                <td className="p-2">
                  {i.optionType && (
                    <Badge variant="outline" className={i.optionType === 'put' ? 'text-primary' : 'text-amber-500'}>
                      {i.optionType === 'put' ? 'PUT' : 'CALL'}
                    </Badge>
                  )}
                </td>
                <td className="p-2 text-right font-mono">{i.strike != null ? fmtNum(i.strike, 2) : ''}</td>
                <td className="p-2 font-mono">{fmtDate(i.expiry)}</td>
                <td className="p-2 text-right font-mono">{i.moneyness != null ? fmtPct(i.moneyness) : ''}</td>
                <td className="p-2 text-right font-mono">{i.price != null ? `${fmtNum(i.price, 3)} ${i.currency}` : '—'}</td>
                <td className="p-2 text-right font-mono">{i.iv != null ? fmtNum(i.iv * 100, 1) + '%' : ''}</td>
                <td className="p-2 text-right font-mono">{i.clients}</td>
                <td className={`p-2 text-right font-mono ${i.totalQty < 0 ? 'text-destructive' : ''}`}>{fmtNum(i.totalQty, 2)}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Usa nel form (modifica prima di aggiungere)" onClick={() => onPick(i)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" title="Aggiungi subito"
                    disabled={!qtyFor(i) || (i.kind === 'option' && !(i.price! > 0))}
                    onClick={() => onAdd(instrumentToSpec(i, qtyFor(i)))}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Fonte: ultimo caricamento di ciascun portafoglio cliente. Le opzioni entrano col premio dello snapshot più
        recente; azioni ed ETF col prezzo live. "Usa" porta lo strumento nel form "Aggiungi singola" per cambiare
        strike, scadenza, quantità o premio.
      </p>
    </div>
  );
}
