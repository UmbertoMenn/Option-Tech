import { useMemo, useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ShieldAlert, Target, Layers, CircleDollarSign, Rocket, Puzzle, TrendingUp, Newspaper, Settings, Info, AlertCircle, XCircle, CheckCheck, Check, Pencil, Plus, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { Position } from '@/types/portfolio';
import { UnderlyingPrice } from '@/hooks/useUnderlyingPrices';
import { DerivativeCategories, normalizeForMatching, getCanonicalKey } from '@/lib/derivativeStrategies';
import { useCallBuybacks, useCallBuybackMutations, effectiveMarketPrice, openCallBuybacksValueEUR, openCallBuybacksGainLossEUR, CallBuybackRow, CallBuybackEditableFields, ManualCallBuybackInput } from '@/hooks/useCallBuybacks';
import { toast } from 'sonner';
import { getOptionExpirationDateISO } from '@/lib/optionExpiry';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAlerts, useUnreadAlertsCount, useMarkAlertAsRead, useMarkAllAlertsAsRead, useDeleteAlert } from '@/hooks/useAlerts';
import { usePortfolioContext } from '@/contexts/PortfolioContext';
import { AlertSettingsDialog } from './AlertSettingsDialog';
import { AlertSeverity } from '@/types/alerts';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { StrategyConfiguration } from '@/hooks/useStrategyConfigurations';
import { computeMonitoring, buildSnapshotSections, MonitoringResult } from '@/lib/monitoringEngine';
import { canonicalKeyForText, DynamicAliases } from '@/lib/tickerIdentity';

interface DerivativesSummaryCardProps {
  categories: DerivativeCategories;
  allPositions: Position[];
  stockPositions: Position[];
  underlyingPrices: Record<string, UnderlyingPrice>;
  strategyConfigs: StrategyConfiguration[];
  archivedKeys?: string[];
  dynamicAliases?: DynamicAliases;
  missingCount?: number;
  isFetchingMissing?: boolean;
}

// Badge tooltip descriptions
const BADGE_TOOLTIPS: Record<string, string> = {
  'ITM': 'In The Money',
  'OTM': 'Out of The Money',
  'OOR': 'Out of Range: il sottostante è fuori dagli strike venduti',
  'IR': 'In Range: il sottostante è all\'interno degli strike venduti',
  'IB': 'In Breakeven: il sottostante è all\'interno della zona profittevole',
  'OOB': 'Out of Breakeven: il sottostante è fuori dalla zona profittevole',
  'G': 'In Gain: la Leap sta guadagnando',
  'L': 'Loss: la Leap sta perdendo',
  'OOR/OOB': 'Out of Range o Out of Breakeven',
};

// Compact section component - collapsible with count
function CompactSection({
  title, 
  icon: Icon,
  iconColor,
  statusBadge,
  items, 
  renderItem,
}: { 
  title: string;
  icon: React.ElementType;
  iconColor: string;
  statusBadge?: { label: string; colorClass: string };
  items: any[];
  renderItem: (item: any, idx: number) => React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="py-2 border-b border-border/50 last:border-b-0">
      <div 
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(!isExpanded); }}
        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors cursor-pointer"
      >
        <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
        <span className="text-sm font-bold text-foreground">{title}</span>
        
        {statusBadge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span 
                className={`inline-flex items-center rounded-full border text-[10px] px-1.5 py-0 h-4 cursor-pointer ${statusBadge.colorClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {statusBadge.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{BADGE_TOOLTIPS[statusBadge.label] || statusBadge.label}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        <span className="text-xs text-muted-foreground">
          ({items.length} {items.length === 1 ? 'elemento' : 'elementi'})
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>
      
      {isExpanded && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-6">
          {items.map((item, idx) => renderItem(item, idx))}
        </div>
      )}
    </div>
  );
}

/**
 * Riga editabile di un riacquisto call. In lettura mostra i valori; con la
 * matita entra in modifica su prezzo di riacquisto, quantità, strike, scadenza.
 * Il salvataggio marca la riga come manually_edited (il CSV non la sovrascrive
 * più). Il prezzo di mercato resta gestito dal cron.
 */
function BuybackRow({
  b,
  today,
  included,
  onToggleIncluded,
  onSaveFields,
  onDelete,
  fmt2,
  fmtDate,
}: {
  b: CallBuybackRow;
  today: string;
  included: boolean;
  onToggleIncluded: (included: boolean) => void;
  onSaveFields: (fields: CallBuybackEditableFields) => void;
  onDelete: () => void;
  fmt2: (n: number) => string;
  fmtDate: (iso: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [buybackPrice, setBuybackPrice] = useState(String(b.buyback_price));
  const [quantity, setQuantity] = useState(String(b.quantity));
  const [strike, setStrike] = useState(String(b.strike));
  const initMonth = String(new Date(b.expiry_date + 'T00:00:00').getMonth() + 1);
  const initYear = String(new Date(b.expiry_date + 'T00:00:00').getFullYear());
  const [expMonth, setExpMonth] = useState(initMonth);
  const [expYear, setExpYear] = useState(initYear);

  const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const nowYear = new Date().getFullYear();
  const YEARS = Array.from(new Set([nowYear, nowYear + 1, nowYear + 2, parseInt(initYear, 10)])).sort();

  const parsePrice = (s: string): number => {
    const t = s.trim();
    if (!t) return NaN;
    if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return parseFloat(t);
  };

  const beginEdit = () => {
    setBuybackPrice(String(b.buyback_price));
    setQuantity(String(b.quantity));
    setStrike(String(b.strike));
    setExpMonth(String(new Date(b.expiry_date + 'T00:00:00').getMonth() + 1));
    setExpYear(String(new Date(b.expiry_date + 'T00:00:00').getFullYear()));
    setEditing(true);
  };

  const save = () => {
    const bp = parsePrice(buybackPrice);
    const qty = parseInt(quantity, 10);
    const stk = parsePrice(strike);
    const newExpiry = getOptionExpirationDateISO(parseInt(expYear, 10), parseInt(expMonth, 10));
    const fields: CallBuybackEditableFields = {};
    if (Number.isFinite(bp) && bp !== b.buyback_price) fields.buyback_price = bp;
    if (Number.isFinite(qty) && qty > 0 && qty !== b.quantity) fields.quantity = qty;
    if (Number.isFinite(stk) && stk > 0 && stk !== b.strike) fields.strike = stk;
    if (newExpiry && newExpiry !== b.expiry_date) fields.expiry_date = newExpiry;
    if (Object.keys(fields).length > 0) onSaveFields(fields);
    setEditing(false);
  };

  const expired = b.expiry_date < today;
  const mkt = effectiveMarketPrice(b, today);
  const potentialGainLoss = (mkt - b.buyback_price) * 100 * b.quantity;

  if (editing) {
    return (
      <tr className="border-b border-border/30 last:border-b-0 bg-muted/20">
        <td className="py-1 pr-2">
          <Checkbox checked={included} disabled aria-label="Inclusione (bloccata in modifica)" />
        </td>
        <td className="py-1 pr-2">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-muted-foreground">{b.underlying} C</span>
            <Input
              value={strike}
              onChange={e => setStrike(e.target.value)}
              className="h-6 w-16 text-xs px-1"
              inputMode="decimal"
              aria-label="Strike"
            />
            <Select value={expMonth} onValueChange={setExpMonth}>
              <SelectTrigger className="h-6 w-16 text-xs px-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, idx) => (
                  <SelectItem key={idx} value={String(idx + 1)} className="text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={expYear} onValueChange={setExpYear}>
              <SelectTrigger className="h-6 w-20 text-xs px-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map(y => (
                  <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </td>
        <td className="text-right py-1 px-2">
          <Input
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="h-6 w-14 text-xs px-1 text-right ml-auto"
            inputMode="numeric"
            aria-label="Quantità"
          />
        </td>
        <td className="text-right py-1 px-2">
          <Input
            value={buybackPrice}
            onChange={e => setBuybackPrice(e.target.value)}
            className="h-6 w-20 text-xs px-1 text-right ml-auto"
            inputMode="decimal"
            aria-label="Prezzo riacquisto"
          />
        </td>
        <td className="text-right py-1 px-2 text-muted-foreground">
          {expired ? `0,00 ${b.currency}` : (b.market_price != null ? `${fmt2(mkt)} ${b.currency}` : '—')}
        </td>
        <td className="py-1 pl-2" colSpan={2}>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={save}
              className="p-1 rounded hover:bg-green-500/20 text-green-500"
              aria-label="Salva modifiche"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="p-1 rounded hover:bg-red-500/20 text-red-500"
              aria-label="Annulla modifiche"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b border-border/30 last:border-b-0 ${!included ? 'opacity-40' : ''}`}>
      <td className="py-1 pr-2">
        <Checkbox
          checked={included}
          onCheckedChange={val => onToggleIncluded(val === true)}
          aria-label={`Includi ${b.underlying} C ${b.strike} nel totale`}
        />
      </td>
      <td className="py-1 pr-2">
        {b.underlying} C {b.strike} {fmtDate(b.expiry_date)}
        {b.manually_edited && (
          <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0 h-4 bg-blue-500/10 border-blue-500/30 text-blue-400">
            man.
          </Badge>
        )}
        {expired && (
          <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0 h-4 bg-muted text-muted-foreground">
            scaduta
          </Badge>
        )}
      </td>
      <td className="text-right py-1 px-2">{b.quantity}</td>
      <td className="text-right py-1 px-2">{fmt2(b.buyback_price)} {b.currency}</td>
      <td className="text-right py-1 px-2">
        {expired ? `0,00 ${b.currency}` : (b.market_price != null ? `${fmt2(mkt)} ${b.currency}` : '—')}
      </td>
      <td className="text-right py-1 pl-2">
        {fmt2(mkt * 100 * b.quantity)} {b.currency}
      </td>
      <td className={`text-right py-1 pl-2 ${potentialGainLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
        <div className="flex items-center justify-end gap-1.5">
          <span>{potentialGainLoss >= 0 ? '+' : ''}{fmt2(potentialGainLoss)} {b.currency}</span>
          <button
            type="button"
            onClick={beginEdit}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            aria-label="Modifica riga"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
            aria-label="Elimina call da rivendere"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

interface AvailableCallItem {
  ticker: string;
  availableContracts: number;
}

interface TickerMeta {
  currency: string;
  exchangeRate: number;
}

/**
 * Form inline per registrare una call da rivendere collegandola a un
 * sottostante GIÀ presente tra le "call da rivendere" (BABA/CEG/…): si sceglie
 * il ticker dall'elenco, la quantità è prefillata dai contratti disponibili,
 * la scadenza si indica come mese/anno (viene calcolato il terzo venerdì reale).
 * Valuta e cambio sono derivati automaticamente dal sottostante. Il prezzo di
 * mercato lo aggiorna il cron opzioni (chiave sottostante+strike+scadenza).
 */
function AddBuybackForm({
  items,
  tickerMeta,
  onSubmit,
  onCancel,
}: {
  items: AvailableCallItem[];
  tickerMeta: Record<string, TickerMeta>;
  onSubmit: (row: ManualCallBuybackInput) => void;
  onCancel: () => void;
}) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentYear = now.getFullYear();

  const [ticker, setTicker] = useState(items[0]?.ticker ?? '');
  const [strike, setStrike] = useState('');
  const [expMonth, setExpMonth] = useState(String(now.getMonth() + 1)); // 1-12
  const [expYear, setExpYear] = useState(String(currentYear));
  const [quantity, setQuantity] = useState(String(items[0]?.availableContracts ?? 1));
  const [buybackPrice, setBuybackPrice] = useState('');
  const [buybackDate, setBuybackDate] = useState(today);

  // Quando cambia il ticker, riallinea la quantità di default ai contratti disponibili.
  const onTickerChange = (t: string) => {
    setTicker(t);
    const it = items.find(i => i.ticker === t);
    if (it) setQuantity(String(it.availableContracts));
  };

  const meta = tickerMeta[ticker] ?? { currency: 'USD', exchangeRate: 1 };

  const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const YEARS = [currentYear, currentYear + 1, currentYear + 2];

  // Parse tollerante del prezzo in formato IT o US:
  // "4,55" -> 4.55 (virgola = decimale, punto = migliaia) ; "4.55" -> 4.55.
  const parsePrice = (s: string): number => {
    const t = s.trim();
    if (!t) return NaN;
    if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return parseFloat(t);
  };

  const submit = () => {
    if (!ticker) return toast.error('Seleziona un sottostante');
    const stk = parsePrice(strike);
    const qty = parseInt(quantity, 10);
    const bp = parsePrice(buybackPrice);
    if (!Number.isFinite(stk) || stk <= 0) return toast.error('Strike non valido');
    if (!Number.isFinite(qty) || qty <= 0) return toast.error('Quantità non valida');
    if (!Number.isFinite(bp) || bp < 0) return toast.error('Prezzo di riacquisto non valido');
    const expiry_date = getOptionExpirationDateISO(parseInt(expYear, 10), parseInt(expMonth, 10));
    onSubmit({
      underlying: ticker,
      strike: stk,
      expiry_date,
      quantity: qty,
      buyback_price: bp,
      currency: meta.currency,
      exchange_rate: meta.exchangeRate,
      buyback_date: buybackDate,
    });
  };

  return (
    <div className="rounded border border-green-500/30 bg-green-500/5 p-3 space-y-3">
      <div className="text-xs font-semibold text-foreground">Registra una call da rivendere</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Sottostante
          <Select value={ticker} onValueChange={onTickerChange}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Scegli…" /></SelectTrigger>
            <SelectContent>
              {items.map(i => (
                <SelectItem key={i.ticker} value={i.ticker} className="text-xs">
                  {i.ticker} (disp. {i.availableContracts})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Strike
          <Input value={strike} onChange={e => setStrike(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Quantità (contratti)
          <Input value={quantity} onChange={e => setQuantity(e.target.value)} className="h-8 text-xs" inputMode="numeric" />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Scadenza — mese
          <Select value={expMonth} onValueChange={setExpMonth}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, idx) => (
                <SelectItem key={idx} value={String(idx + 1)} className="text-xs">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Scadenza — anno
          <Select value={expYear} onValueChange={setExpYear}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (
                <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Prezzo di riacquisto ({meta.currency})
          <Input value={buybackPrice} onChange={e => setBuybackPrice(e.target.value)} className="h-8 text-xs" inputMode="decimal" />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          Scadenza: 3° venerdì di {MONTHS[parseInt(expMonth, 10) - 1]} {expYear}. Cambio→EUR {meta.exchangeRate}. Il prezzo di mercato lo aggiorna il cron.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>Annulla</Button>
          <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700" onClick={submit}>
            <Check className="w-3.5 h-3.5 mr-1" /> Salva
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sezione "Covered Call da rivendere" con tabella espandibile dei riacquisti:
 * per ogni call ricomprata (e non ancora rivenduta) mostra prezzo di
 * riacquisto e prezzo di mercato corrente (0 se scaduta). Il premio di
 * mercato complessivo (solo righe selezionate, in EUR) è il patrimonio netting
 * intrinseco mancante. La selezione (included_in_netting) è persistita e guida
 * anche il totale sommato ai due netting quando il toggle globale è attivo.
 */
function AvailableCallsSection({
  items,
  portfolioId,
  allPositions,
  archivedKeys = [],
  dynamicAliases,
}: {
  items: { ticker: string; availableContracts: number }[];
  portfolioId: string | null | undefined;
  allPositions: Position[];
  archivedKeys?: string[];
  dynamicAliases?: DynamicAliases;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const { buybacks } = useCallBuybacks([portfolioId]);
  const { setIncluded, editFields, insertManual, remove } = useCallBuybackMutations([portfolioId]);

  // Meta per sottostante (valuta + cambio→EUR) ricavata dalle posizioni:
  // serve a derivare automaticamente valuta e cambio nel form, senza digitarli.
  const tickerMeta = useMemo(() => {
    const map: Record<string, { currency: string; exchangeRate: number }> = {};
    const register = (rawKey: string | null | undefined, currency: string | null, rate: number | null) => {
      if (!rawKey || !currency || !rate || rate <= 0) return;
      const key = (getCanonicalKey(rawKey) || normalizeForMatching(rawKey)).toUpperCase();
      if (key && !map[key]) map[key] = { currency: currency.toUpperCase(), exchangeRate: rate };
    };
    for (const p of allPositions) {
      register(p.underlying || p.description, p.currency, p.exchange_rate);
    }
    // Risolve per ogni item il proprio meta (fallback USD/cambio più comune).
    const fallbackRate = allPositions.find(p => (p.currency || '').toUpperCase() === 'USD' && p.exchange_rate && p.exchange_rate > 0)?.exchange_rate ?? 1;
    const out: Record<string, { currency: string; exchangeRate: number }> = {};
    for (const it of items) {
      const k = (getCanonicalKey(it.ticker) || normalizeForMatching(it.ticker)).toUpperCase();
      out[it.ticker] = map[k] ?? { currency: 'USD', exchangeRate: fallbackRate };
    }
    return out;
  }, [allPositions, items]);

  // Mostra solo i riacquisti dei ticker presenti nella card (esclusi archiviati a monte)
  const archivedCanonicalSet = useMemo(() => {
    const set = new Set<string>();
    for (const k of archivedKeys) {
      const trimmed = (k || '').trim();
      if (!trimmed) continue;
      set.add(canonicalKeyForText(trimmed, dynamicAliases));
    }
    return set;
  }, [archivedKeys, dynamicAliases]);

  const visibleBuybacks = useMemo(() => {
    if (buybacks.length === 0) return [] as CallBuybackRow[];
    const tickerKeys = items.map(i => getCanonicalKey(i.ticker) || normalizeForMatching(i.ticker));
    return buybacks.filter(b => {
      // Un riacquisto la cui sottostante è stata archiviata in configurazione
      // strategie non va mai mostrato, indipendentemente dal matching con gli
      // "available calls to sell" qui sotto.
      if (archivedCanonicalSet.size > 0 && archivedCanonicalSet.has(canonicalKeyForText(b.underlying, dynamicAliases))) {
        return false;
      }
      const bKey = getCanonicalKey(b.underlying) || normalizeForMatching(b.underlying);
      return tickerKeys.some(tk => tk === bKey || tk.includes(bKey) || bKey.includes(tk));
    });
  }, [items, buybacks, archivedCanonicalSet, dynamicAliases]);

  if (items.length === 0) return null;

  const today = new Date().toISOString().split('T')[0];
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
  };
  const fmt2 = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleInsert = (row: ManualCallBuybackInput) => {
    if (!portfolioId) return;
    insertManual.mutate(
      { portfolioId, row },
      {
        onSuccess: () => {
          toast.success('Call da rivendere aggiunta', { description: `${row.underlying} C ${row.strike}` });
          setShowAddForm(false);
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : 'errore sconosciuto';
          toast.error('Inserimento non riuscito', {
            description: /duplicate key|unique/i.test(msg)
              ? 'Esiste già un riacquisto per questo sottostante/strike/scadenza nella stessa data.'
              : msg,
          });
        },
      },
    );
  };

  const handleDelete = (b: CallBuybackRow) => {
    if (typeof window !== 'undefined' &&
        !window.confirm(`Eliminare la call da rivendere ${b.underlying} C ${b.strike}?`)) return;
    remove.mutate(
      { id: b.id },
      {
        onSuccess: () => toast.success('Call da rivendere eliminata', { description: `${b.underlying} C ${b.strike}` }),
        onError: (e: unknown) => toast.error('Eliminazione non riuscita', {
          description: e instanceof Error ? e.message : 'errore sconosciuto',
        }),
      },
    );
  };

  // Totali: solo righe con included_in_netting != false, sempre in EUR (le
  // funzioni pure filtrano già per inclusione).
  const totalMarketPremiumEUR = openCallBuybacksValueEUR(visibleBuybacks, today);
  const totalPotentialGainLossEUR = openCallBuybacksGainLossEUR(visibleBuybacks, today);
  const hasIncluded = visibleBuybacks.some(b => b.included_in_netting !== false);

  return (
    <div className="py-2 border-b border-border/50 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(!isExpanded); }}
        className="flex items-center gap-2 w-full text-left hover:bg-muted/30 rounded px-1 -mx-1 transition-colors cursor-pointer"
      >
        <TrendingUp className="w-4 h-4 text-green-500 shrink-0" />
        <span className="text-sm font-bold text-foreground">Covered Call da rivendere</span>
        <span className="text-xs text-muted-foreground">
          ({items.length} {items.length === 1 ? 'elemento' : 'elementi'})
        </span>
        {hasIncluded && (
          <span className="text-xs font-semibold text-green-500">
            € {fmt2(totalMarketPremiumEUR)}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>

      {isExpanded && (
        <div className="mt-2 pl-6 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {items.map((item, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className="text-xs bg-green-500/10 border-green-500/30"
              >
                {item.ticker} ×{item.availableContracts}
              </Badge>
            ))}
          </div>

          {/* Pulsante sempre visibile per inserire una call da rivendere a mano */}
          {!showAddForm && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-green-500/40 text-green-600 hover:bg-green-500/10"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi call da rivendere
            </Button>
          )}

          {showAddForm && (
            <AddBuybackForm
              items={items}
              tickerMeta={tickerMeta}
              onSubmit={handleInsert}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {visibleBuybacks.length === 0 && !showAddForm && (
            <p className="text-xs text-muted-foreground">
              Nessuna call riacquistata registrata. Usa "Aggiungi call da rivendere" per inserirne una,
              oppure carica un file Movimenti Titoli.
            </p>
          )}

          {visibleBuybacks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/50">
                    <th className="text-left py-1 pr-2 font-medium w-6"></th>
                    <th className="text-left py-1 pr-2 font-medium">Call riacquistata</th>
                    <th className="text-right py-1 px-2 font-medium">Qtà</th>
                    <th className="text-right py-1 px-2 font-medium">Prezzo riacquisto</th>
                    <th className="text-right py-1 px-2 font-medium">Prezzo mercato</th>
                    <th className="text-right py-1 pl-2 font-medium">Premio tot. mercato</th>
                    <th className="text-right py-1 pl-2 font-medium">G/P potenziale</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBuybacks.map(b => (
                    <BuybackRow
                      key={b.id}
                      b={b}
                      today={today}
                      included={b.included_in_netting !== false}
                      onToggleIncluded={(included) => setIncluded.mutate({ id: b.id, included })}
                      onSaveFields={(fields) => editFields.mutate({ id: b.id, fields })}
                      onDelete={() => handleDelete(b)}
                      fmt2={fmt2}
                      fmtDate={fmtDate}
                    />
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1 pr-2" colSpan={5}>Premio complessivo da rivendita (selezionate, EUR)</td>
                    <td className="text-right py-1 pl-2">€ {fmt2(totalMarketPremiumEUR)}</td>
                    <td className={`text-right py-1 pl-2 ${totalPotentialGainLossEUR >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {totalPotentialGainLossEUR >= 0 ? '+' : ''}€ {fmt2(totalPotentialGainLossEUR)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DerivativesSummaryCard({
  categories,
  allPositions,
  stockPositions,
  underlyingPrices,
  strategyConfigs,
  archivedKeys = [],
  dynamicAliases,
  missingCount = 0,
  isFetchingMissing = false,
}: DerivativesSummaryCardProps) {
  const { selectedPortfolioId } = usePortfolioContext();
  const snapshotSavedRef = useRef(false);
  
  // ============ Single canonical monitoring computation ============
  const monitoring: MonitoringResult = useMemo(() => {
    return computeMonitoring(categories, allPositions, stockPositions, underlyingPrices, strategyConfigs, archivedKeys, dynamicAliases);
  }, [categories, allPositions, stockPositions, underlyingPrices, strategyConfigs, archivedKeys, dynamicAliases]);

  // ============ Save monitoring snapshot ============
  useEffect(() => {
    if (isFetchingMissing || !selectedPortfolioId) return;
    if (snapshotSavedRef.current) return;

    const sections = buildSnapshotSections(monitoring);

    snapshotSavedRef.current = true;
    supabase
      .from('monitoring_snapshot' as any)
      .upsert(
        { portfolio_id: selectedPortfolioId, sections, updated_at: new Date().toISOString() } as any,
        { onConflict: 'portfolio_id' }
      )
      .then(({ error }) => {
        if (error) console.error('Failed to save monitoring snapshot:', error);
        else console.log('Monitoring snapshot saved');
      });
  }, [isFetchingMissing, selectedPortfolioId, monitoring]);

  // Reset ref when portfolio changes
  useEffect(() => {
    snapshotSavedRef.current = false;
  }, [selectedPortfolioId]);

  const hasContent = monitoring.uncoveredCalls.length > 0 || 
                     monitoring.coveredCallsITM.length > 0 || 
                     monitoring.doubleDiagonalOOR.length > 0 ||
                     monitoring.ironCondorOOR.length > 0 ||
                     monitoring.nakedPutsITM.length > 0 ||
                     monitoring.leapCallsInGain.length > 0 ||
                     monitoring.availableCallsToSell.length > 0 ||
                     monitoring.otherStrategiesOOROOB.length > 0 ||
                     monitoring.incompleteMultiLegStrategies.length > 0;
  
  if (!hasContent) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <CardTitle className="text-xl font-bold tracking-tight">Posizioni da monitorare</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
              <p className="text-sm text-muted-foreground">
                Tutto sotto controllo. Nessuna posizione richiede monitoraggio immediato.
              </p>
            </div>
          </CardContent>
        </Card>
        
        <RecentAlertsCard categories={categories} underlyingPrices={underlyingPrices} />
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="border-border bg-card">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <CardTitle className="text-xl font-bold tracking-tight">Posizioni da monitorare</CardTitle>
        </div>
        {isFetchingMissing && missingCount > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span className="text-xs text-blue-400">
              Risoluzione AI in corso per {missingCount} strumenti...
            </span>
          </div>
        )}
      </CardHeader>
        <CardContent className="pt-0">
          {/* 1. Call non coperte */}
          <CompactSection
            title="Call non coperte"
            icon={ShieldAlert}
            iconColor="text-red-500"
            items={monitoring.uncoveredCalls}
            renderItem={(uc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-red-500/10 border-red-500/30"
              >
                {uc.ticker}: {uc.uncoveredContracts}NC
              </Badge>
            )}
          />
          
          {/* 2. Covered Call */}
          <CompactSection
            title="Covered Call"
            icon={ShieldAlert}
            iconColor="text-amber-500"
            statusBadge={{ label: 'ITM', colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-400' }}
            items={monitoring.coveredCallsITM}
            renderItem={(cc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-amber-500/10 border-amber-500/30"
              >
                {cc.isDeRisking && <span className="font-semibold text-amber-400 mr-1">DR</span>}
                {cc.ticker} ${cc.strike} ×{cc.contracts}
              </Badge>
            )}
          />
          
          {/* 3. Double Diagonal */}
          <CompactSection
            title="Double Diagonal"
            icon={Layers}
            iconColor="text-purple-500"
            statusBadge={{ label: 'OOR', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.doubleDiagonalOOR}
            renderItem={(dd, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-purple-500/10 border-purple-500/30"
              >
                {dd.ticker}{dd.isAlternative ? ' (Alt)' : ''}
              </Badge>
            )}
          />
          
          {/* 4. Iron Condor */}
          <CompactSection
            title="Iron Condor"
            icon={Target}
            iconColor="text-amber-500"
            statusBadge={{ label: 'OOR', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.ironCondorOOR}
            renderItem={(ic, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-amber-500/10 border-amber-500/30"
              >
                {ic.ticker}
              </Badge>
            )}
          />
          
          {/* 5. Naked Put */}
          <CompactSection
            title="Naked Put"
            icon={CircleDollarSign}
            iconColor="text-orange-500"
            statusBadge={{ label: 'ITM', colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-400' }}
            items={monitoring.nakedPutsITM}
            renderItem={(np, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-orange-500/10 border-orange-500/30"
              >
                {np.ticker} ${np.strike} ×{np.contracts}
              </Badge>
            )}
          />
          
          {/* 6. Leap Call */}
          <CompactSection
            title="Leap Call"
            icon={Rocket}
            iconColor="text-blue-500"
            statusBadge={{ label: 'G', colorClass: 'bg-green-500/20 border-green-500/50 text-green-400' }}
            items={monitoring.leapCallsInGain}
            renderItem={(lc, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-blue-500/10 border-blue-500/30"
              >
                {lc.ticker} ${lc.strike} ×{lc.contracts}
              </Badge>
            )}
          />
          
          {/* 7. Altre Strategie OOR/OOB */}
          <CompactSection
            title="Altre Strategie"
            icon={Puzzle}
            iconColor="text-cyan-500"
            statusBadge={{ label: 'OOR/OOB', colorClass: 'bg-red-500/20 border-red-500/50 text-red-400' }}
            items={monitoring.otherStrategiesOOROOB}
            renderItem={(os, idx) => (
              <Badge 
                key={idx}
                variant="outline" 
                className="text-xs bg-cyan-500/10 border-cyan-500/30"
              >
                {os.ticker} {os.strategyName} {os.status}
              </Badge>
            )}
          />
          
          {/* 8. Strategie multi-gamba incomplete */}
          <CompactSection
            title="Strategie incomplete"
            icon={AlertCircle}
            iconColor="text-orange-500"
            statusBadge={{ label: 'MANCA GAMBA', colorClass: 'bg-orange-500/20 border-orange-500/50 text-orange-400' }}
            items={monitoring.incompleteMultiLegStrategies}
            renderItem={(s, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className="text-xs bg-orange-500/10 border-orange-500/30"
              >
                {s.ticker} {s.strategyName} (manca: {s.missingLegs.join(', ')})
              </Badge>
            )}
          />

          {/* 9. Covered Call / D-R CC da rivendere - LAST */}
          <AvailableCallsSection
            items={monitoring.availableCallsToSell}
            portfolioId={selectedPortfolioId}
            allPositions={allPositions}
            archivedKeys={archivedKeys}
            dynamicAliases={dynamicAliases}
          />
        </CardContent>
      </Card>
      
      {/* Card Avvisi recenti (24 h) */}
      <RecentAlertsCard categories={categories} underlyingPrices={underlyingPrices} />
    </div>
  );
}

// Separate component for recent alerts card
interface RecentAlertsCardProps {
  categories: DerivativeCategories;
  underlyingPrices: Record<string, UnderlyingPrice>;
}

function RecentAlertsCard({ categories, underlyingPrices }: RecentAlertsCardProps) {
  const { selectedPortfolio, isAggregatedView } = usePortfolioContext();
  const portfolioId = selectedPortfolio?.id;
  
  const { data: alerts = [], isLoading: alertsLoading } = useAlerts(portfolioId);
  const { data: unreadCount = 0 } = useUnreadAlertsCount(portfolioId);
  const markAsReadMutation = useMarkAlertAsRead();
  const markAllAsReadMutation = useMarkAllAlertsAsRead();
  const deleteAlertMutation = useDeleteAlert();
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return <ShieldAlert className="w-4 h-4 text-destructive" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      default:
        return <Info className="w-4 h-4 text-primary" />;
    }
  };
  
  const handleMarkAsRead = (alertId: string) => {
    markAsReadMutation.mutate(alertId);
  };
  
  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate(portfolioId);
  };
  
  const handleDeleteAlert = (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    deleteAlertMutation.mutate(alertId);
  };
  
  if (isAggregatedView) {
    return (
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-xl font-bold tracking-tight text-muted-foreground">
              Avvisi recenti (24 h)
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
            <Info className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Gli avvisi sono disponibili per i singoli portfolio.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Seleziona un portfolio specifico per visualizzare e gestire gli avvisi.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <CardTitle className="text-xl font-bold tracking-tight">
                Avvisi recenti (24 h)
              </CardTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className="h-9 px-3 gap-2"
              aria-label="Gestione avvisi e notifiche"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm font-medium">Gestisci avvisi</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {alertsLoading ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <span className="text-muted-foreground text-sm">Nessun avviso nelle ultime 24 ore</span>
            </div>
          ) : (
            <div className="space-y-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  disabled={markAllAsReadMutation.isPending}
                  className="w-full mb-2 text-xs"
                >
                  <CheckCheck className="w-3 h-3 mr-1" />
                  Segna tutti come letti
                </Button>
              )}
              
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    onClick={() => !alert.read_at && handleMarkAsRead(alert.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      alert.read_at 
                        ? 'bg-muted/30 border-border/50 opacity-60' 
                        : 'bg-card border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {getSeverityIcon(alert.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs font-mono">
                            {alert.ticker}
                          </Badge>
                          {alert.strategy_type && (
                            <span className="text-xs text-muted-foreground">
                              {alert.strategy_type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm line-clamp-2">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(alert.created_at), { 
                            addSuffix: true,
                            locale: it 
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-destructive/80 hover:text-destructive"
                        onClick={(e) => handleDeleteAlert(e, alert.id)}
                        disabled={deleteAlertMutation.isPending}
                        aria-label="Elimina avviso"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <AlertSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
        categories={categories}
        underlyingPrices={underlyingPrices}
      />
    </>
  );
}
