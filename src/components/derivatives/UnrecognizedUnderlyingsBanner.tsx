import { useState } from 'react';
import { AlertTriangle, Link2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnlinkedUnderlying } from '@/lib/unrecognizedUnderlyings';

interface UnrecognizedUnderlyingsBannerProps {
  items: UnlinkedUnderlying[];
  /** Ticker canonici delle azioni possedute nel portafoglio (opzioni suggerite). */
  heldTickers: string[];
  /** Collega il codice del sottostante al ticker scelto (scrive underlying_mappings). */
  onLink: (code: string, ticker: string) => void;
  linkingCode: string | null;
}

const CUSTOM = '__custom__';

function LinkRow({
  item,
  heldTickers,
  onLink,
  isLinking,
}: {
  item: UnlinkedUnderlying;
  heldTickers: string[];
  onLink: (code: string, ticker: string) => void;
  isLinking: boolean;
}) {
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState<string>('');

  const chosen = selected === CUSTOM ? custom.trim().toUpperCase() : selected;
  const canLink = chosen.length > 0 && !isLinking;

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="font-mono font-semibold text-foreground">{item.code}</span>
      <span className="text-xs text-muted-foreground">
        ({item.contractCount} {item.contractCount === 1 ? 'contratto' : 'contratti'} short call non coperti)
      </span>
      <span className="text-muted-foreground">→ collega a</span>
      <Select value={selected} onValueChange={setSelected} disabled={isLinking}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="ticker…" />
        </SelectTrigger>
        <SelectContent>
          {heldTickers.map(t => (
            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
          ))}
          <SelectItem value={CUSTOM} className="text-xs">Altro ticker…</SelectItem>
        </SelectContent>
      </Select>
      {selected === CUSTOM && (
        <Input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          placeholder="es. RACE"
          className="h-8 w-28 text-xs uppercase"
          disabled={isLinking}
        />
      )}
      <Button
        size="sm"
        variant="secondary"
        className="h-8"
        disabled={!canLink}
        onClick={() => onLink(item.code, chosen)}
      >
        {isLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        <span className="ml-1">Collega</span>
      </Button>
    </div>
  );
}

export function UnrecognizedUnderlyingsBanner({
  items,
  heldTickers,
  onLink,
  linkingCode,
}: UnrecognizedUnderlyingsBannerProps) {
  if (items.length === 0) return null;

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="p-4">
        <div className="mb-2 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold text-foreground">Sottostanti non riconosciuti</p>
            <p className="text-xs text-muted-foreground">
              Queste short call non trovano l'azione sottostante (di solito titoli europei con un codice di banca non mappato) e risultano scoperte. Collegale al ticker corretto: la mappatura vale per tutti i portafogli e resta salvata.
            </p>
          </div>
        </div>
        <div className="divide-y divide-border/50 pl-6">
          {items.map(item => (
            <LinkRow
              key={item.code}
              item={item}
              heldTickers={heldTickers}
              onLink={onLink}
              isLinking={linkingCode === item.code}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
