/**
 * Patrimonio simulato ed esposizione potenziale obiettivo del Portafoglio virtuale.
 *
 * Patrimonio: la liquidità del portafoglio virtuale viene impostata in modo che il
 * patrimonio totale (netting della dashboard, come nello Stress Lab) sia pari al valore
 * inserito. Esposizione: obiettivo di Esposizione Potenziale in Equity, usato dalla
 * simulazione casuale per dimensionare le put e mostrato contro quella attuale.
 */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { parseNum, VirtualSimSettings } from '@/lib/virtualPortfolio';
import type { StressLabMetrics } from '@/pages/RiskSimulator';
import { Tip } from './virtualUi';
import { fmtEUR, fmtNum, lbl } from './virtualFormat';

function MoneyInput({
  value,
  onCommit,
  placeholder,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value != null ? fmtNum(value, 0) : '');
  useEffect(() => setText(value != null ? fmtNum(value, 0) : ''), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) return onCommit(null);
    // "1,5m" / "800k" accettati come scorciatoie
    const m = t.toLowerCase().match(/^([\d.,]+)\s*([km])$/);
    const n = m ? (parseNum(m[1]) ?? NaN) * (m[2] === 'k' ? 1e3 : 1e6) : parseNum(t);
    if (n == null || !Number.isFinite(n) || n <= 0) {
      setText(value != null ? fmtNum(value, 0) : '');
      return;
    }
    onCommit(Math.round(n));
  };
  return (
    <div className="relative">
      <Input
        className="h-9 pr-12 font-mono"
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">EUR</span>
    </div>
  );
}

export function SimSettingsPanel({
  sim,
  setSim,
  metrics,
  cashOverride,
  realCash,
  hasGP,
}: {
  sim: VirtualSimSettings;
  setSim: (p: Partial<VirtualSimSettings>) => void;
  metrics: StressLabMetrics | null;
  cashOverride: number | null;
  realCash: number;
  hasGP: boolean;
}) {
  const pat = metrics?.patrimony ?? null;
  const exp = metrics?.equityExposure ?? null;
  const lev = pat && exp != null && pat > 0 ? exp / pat : null;
  const targetLev = sim.exposure && (sim.patrimony ?? pat) ? sim.exposure / (sim.patrimony ?? pat!) : null;
  const gap = sim.exposure != null && exp != null ? sim.exposure - exp : null;
  const mismatch = sim.patrimony != null && pat != null && !metrics?.isLoading && Math.abs(pat - sim.patrimony) > 1;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 rounded-md border border-border/70 p-3">
        <div className="flex items-center gap-2">
          <span className={lbl}>Patrimonio simulato</span>
          <Tip>
            Il portafoglio virtuale assume questo patrimonio totale (stessa metrica dello Stress Lab: netting totale
            della dashboard, GP inclusa se non esclusa). Lo si ottiene impostando la <b>liquidità</b> a{' '}
            <i>patrimonio simulato − valore di tutte le altre componenti</i> (titoli, opzioni nettate, GP). Se le
            posizioni valgono più del patrimonio indicato, la liquidità diventa negativa (debito). Vuoto = liquidità
            reale.
          </Tip>
          {sim.patrimony != null && (
            <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" title="Torna alla liquidità reale"
              onClick={() => setSim({ patrimony: null })}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <MoneyInput value={sim.patrimony} onCommit={(v) => setSim({ patrimony: v })} placeholder="reale — es. 1.000.000 o 1m" />
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Patrimonio attuale (Stress Lab)</span>
            <span className="font-mono text-foreground">
              {metrics?.isLoading && <Loader2 className="inline w-3 h-3 animate-spin mr-1" />}
              {pat != null ? fmtEUR(pat) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Liquidità {cashOverride != null ? 'simulata' : 'reale'}</span>
            <span className={`font-mono ${cashOverride != null && cashOverride < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {fmtEUR(cashOverride ?? realCash)}
            </span>
          </div>
          {cashOverride != null && cashOverride < 0 && (
            <div className="text-destructive">Liquidità negativa: le posizioni superano il patrimonio simulato.</div>
          )}
          {mismatch && <div className="text-amber-500">Allineamento in corso…</div>}
        </div>
        {hasGP && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer pt-1">
            <Checkbox checked={sim.excludeGP} onCheckedChange={(v) => setSim({ excludeGP: !!v })} />
            Escludi la Gestione Patrimoniale reale
          </label>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-border/70 p-3">
        <div className="flex items-center gap-2">
          <span className={lbl}>Esposizione potenziale obiettivo</span>
          <Tip>
            Obiettivo di <b>Esposizione Potenziale in Equity</b> (Risk Analyzer, coi toggle correnti dello Stress Lab:
            naked put = Strike × Contratti × 100 / Cambio, titoli a controvalore, strategie a perdita massima). La
            simulazione casuale dimensiona le put vendute per raggiungerlo; qui vedi lo scarto rispetto
            all'esposizione attuale del portafoglio virtuale.
          </Tip>
          {sim.exposure != null && (
            <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" title="Rimuovi obiettivo"
              onClick={() => setSim({ exposure: null })}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <MoneyInput value={sim.exposure} onCommit={(v) => setSim({ exposure: v })} placeholder="nessuno — es. 1.500.000" />
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Esposizione attuale</span>
            <span className="font-mono text-foreground">
              {exp != null ? fmtEUR(exp) : '—'}
              {lev != null && <span className="text-muted-foreground"> · {fmtNum(lev, 2)}× patrimonio</span>}
            </span>
          </div>
          {sim.exposure != null && (
            <>
              <div className="flex justify-between">
                <span>Obiettivo</span>
                <span className="font-mono text-foreground">
                  {fmtEUR(sim.exposure)}
                  {targetLev != null && <span className="text-muted-foreground"> · {fmtNum(targetLev, 2)}× patrimonio</span>}
                </span>
              </div>
              {gap != null && (
                <div className="flex justify-between">
                  <span>{gap >= 0 ? 'Mancano' : 'In eccesso'}</span>
                  <span className={`font-mono ${gap >= 0 ? 'text-foreground' : 'text-amber-500'}`}>{fmtEUR(Math.abs(gap))}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
