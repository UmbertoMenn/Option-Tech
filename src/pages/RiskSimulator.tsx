/**
 * RiskSimulator — Stress Lab integrato nel portafoglio dell'utente.
 *
 * Tutta la matematica vive in src/lib/stressLab.ts (puro).
 * I dati arrivano da src/hooks/useStressLab.ts (orchestrazione DB+cache).
 * Questa pagina è SOLO UI.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Activity, AlertTriangle, Loader2, FlaskConical } from 'lucide-react';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { useIsMobile } from '@/hooks/use-mobile';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useStressLab, StressLabInputs } from '@/hooks/useStressLab';
import {
  runScenario,
  occMargin,
  coupledDV1M,
  termFactor,
  T0M,
  marginCallShock,
  BOND_MARGIN_HAIRCUT,
  StressUnderlyingMap,
} from '@/lib/stressLab';

/* ============================== THEME ==============================
 * Colori legati alle CSS vars tematiche (definite in src/index.css per
 * :root [dark] e .light). In questo modo lo Stress Lab segue il tema. */
const C = {
  bg: 'hsl(var(--stress-bg))',
  panel: 'hsl(var(--stress-panel))',
  panel2: 'hsl(var(--stress-panel2))',
  border: 'hsl(var(--stress-border))',
  border2: 'hsl(var(--stress-border2))',
  text: 'hsl(var(--stress-text))',
  mut: 'hsl(var(--stress-mut))',
  up: '#089981',
  dn: '#F23645',
  blue: '#2962FF',
  amber: '#F7A600',
  cyan: '#22AEC4',
};

const MONO = "'JetBrains Mono','SF Mono','Roboto Mono',ui-monospace,Menlo,monospace";
const SANS = "-apple-system,'Inter','Segoe UI',Roboto,sans-serif";

const fmtEUR = (v: number, dec = 0) =>
  (v < 0 ? '−' : '') +
  Math.abs(v).toLocaleString('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }) +
  ' €';
const fmtN = (v: number, dec = 2) =>
  v.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const sgn = (v: number, dec = 1) =>
  (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v), dec);
const pnlColor = (v: number) => (v > 0 ? C.up : v < 0 ? C.dn : C.mut);

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ============================== TOOLTIP ============================== */
function Info({
  title,
  children,
  w = 320,
  right = false,
}: {
  title: string;
  children: React.ReactNode;
  w?: number;
  right?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            style={{
              cursor: 'help',
              width: 15,
              height: 15,
              borderRadius: '50%',
              border: `1px solid ${C.border2}`,
              color: C.mut,
              fontSize: 10,
              lineHeight: '13px',
              textAlign: 'center',
              fontFamily: SANS,
              fontStyle: 'italic',
              fontWeight: 700,
              userSelect: 'none',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 6,
            }}
          >
            i
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={right ? 'right' : 'top'}
          sideOffset={6}
          style={{ maxWidth: w, width: w }}
          className="!bg-[#1C2030] !border-[#2A2E3D] !text-[#B0B8C8] p-3 text-xs leading-relaxed"
        >
          <div style={{ color: C.blue, fontWeight: 700, marginBottom: 5, fontSize: 12 }}>
            {title}
          </div>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ============================== UI BITS ============================== */
function Slider({
  label,
  info,
  value,
  set,
  min,
  max,
  step,
  fmt,
  accent = C.blue,
}: {
  label: string;
  info?: React.ReactNode;
  value: number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  accent?: string;
}) {
  // Il thumb e l'etichetta seguono uno stato LOCALE → si muovono istantaneamente a
  // ogni tick di drag. Il valore vero viene propagato al genitore dentro una
  // transition: il ricalcolo pesante (riprezzo di tutto il portafoglio) è a bassa
  // priorità e NON blocca lo scorrimento dello slider.
  const [local, setLocal] = useState(value);
  const [, startTransition] = useTransition();
  // sync se il valore cambia dall'esterno (es. reset dei parametri)
  useEffect(() => {
    setLocal(value);
  }, [value]);
  const handle = (v: number) => {
    setLocal(v);
    startTransition(() => set(v));
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: C.mut,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {label}
          {info}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: accent }}>
          {fmt(local)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => handle(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: accent, height: 4 }}
      />
    </div>
  );
}

function Panel({
  title,
  info,
  headerRight,
  children,
  style,
  collapsible,
  collapsed,
  onToggle,
}: {
  title?: string;
  info?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const isCollapsed = collapsible && collapsed;
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 16,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.mut,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: isCollapsed ? 0 : 12,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span
            onClick={collapsible ? onToggle : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: collapsible ? 'pointer' : undefined,
            }}
          >
            {collapsible && (
              <span style={{ color: C.mut, fontSize: 10, width: 10, display: 'inline-block' }}>
                {collapsed ? '▸' : '▾'}
              </span>
            )}
            {title}
          </span>
          {info}
          {headerRight && <span style={{ marginLeft: 'auto' }}>{headerRight}</span>}
        </div>
      )}
      {!isCollapsed && children}
    </div>
  );
}

/* ============================== STRESS LAB CONTENT ============================== */

function StressLabContent() {
  const isMobile = useIsMobile();
  /* ---------- Ambito del patrimonio di riferimento ----------
   * total  = patrimonio totale (netting completo della dashboard, GP inclusa)
  /* ---------- Esposizione di riferimento ----------
   * Il denominatore di P&L%/beta/delta è SEMPRE l'Esposizione Potenziale in Equity
   * (esposizione equity del Risk Analyzer), coi due sotto-toggle qui sotto. Il patrimonio
   * assoluto "stressato" mostrato è invece sempre patrimonio totale + P&L. */
  // Include le azioni della Gestione Patrimoniale (= toggle GP del Risk Analyzer).
  const [gpEquity, setGpEquity] = useState(true);
  // Include ETF e commodity/ETC. OFF → esposizione e shock solo su singoli titoli (+ opzioni).
  const [includeEtfCommodity, setIncludeEtfCommodity] = useState(true);
  // Include le protezioni nel VALORE dell'esposizione equity (denominatore). Le protezioni
  // restano sempre nello shock; cambia solo l'esposizione di riferimento → beta/delta.
  const [includeProtections, setIncludeProtections] = useState(true);

  // Ordinamento delle tabelle di dettaglio (click sull'intestazione di colonna)
  const [undSort, setUndSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'nm', dir: 'asc' });
  const [legSort, setLegSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'ticker', dir: 'asc' });

  const inputs: StressLabInputs = useMemo(
    () => ({ gpEquity, includeEtfCommodity, includeProtections }),
    [gpEquity, includeEtfCommodity, includeProtections],
  );

  const data = useStressLab(inputs);

  /* ---------- Override editabili dei sottostanti ----------
   * Gli edit dell'utente sono un override SPARSO. Gli `unders` effettivi usati in
   * TUTTI i calcoli (beta, P&L, margine) sono SEMPRE il baseline live di
   * useStressLab con sopra gli override dell'utente. Niente effetto di sync, niente
   * stato che "congela" beta/spot: così non può esserci desync tra `unders` e
   * legs/prezzi/netting. Conseguenza: rientrando nella pagina (remount) o facendo
   * refresh i numeri sono IDENTICI, perché derivano dallo stesso baseline. */
  const [undersOverride, setUndersOverride] = useState<StressUnderlyingMap>({});

  const unders = useMemo<StressUnderlyingMap>(() => {
    const m: StressUnderlyingMap = { ...data.baselineUnders };
    for (const k of Object.keys(undersOverride)) m[k] = undersOverride[k];
    return m;
  }, [data.baselineUnders, undersOverride]);

  /* ---------- Slider scenario ---------- */
  const [d, setD] = useState(-10);
  const [heatCollapsed, setHeatCollapsed] = useState(true); // matrice shock/vol ridotta di default
  const [marginCollapsed, setMarginCollapsed] = useState(true); // margine cassa ridotto di default
  const [plPct, setPlPct] = useState(true); // card P&L vs shock: default in % sul patrimonio
  const [volMode, setVolMode] = useState<'auto' | 'manual'>('auto');
  const [dVman, setDVman] = useState(15);
  const [days, setDays] = useState(0);
  const [skewB, setSkewB] = useState(-0.018);
  const [kappa, setKappa] = useState(0.6);
  const [pExp, setPExp] = useState(0.5);
  const [showAdv, setShowAdv] = useState(false);
  const [showUnd, setShowUnd] = useState(false);
  const [netting, setNetting] = useState(false);
  // Metodologia dello scenario: 'market' = shock di MERCATO (mossa trasmessa via beta
  // di ciascun nome) → card "Beta". 'titoli' = shock diretto sui TITOLI in portafoglio
  // (beta=1 su ogni nome, l'EUR/USD resta fermo) → card "Delta di portafoglio".
  // Il toggle vive nella card Scenario perché cambia TUTTI i P&L (totale/azioni/opzioni).
  // Shock di mercato sempre trasmesso ai titoli via beta reale (selettore rimosso).
  const shockMode = 'market' as 'market' | 'titoli';
  const [kScan, setKScan] = useState(0.7);
  const [fxRange, setFxRange] = useState(3);
  const [ivScan, setIvScan] = useState(0.4);
  const [nakedPct, setNakedPct] = useState(0.2);

  const { legs, eq, fx, effIV, ptfBaseMTM, equityExposure, riskFree, patrimonyBreakdown } = data;
  /* Copertura del margine = cash + bond valorizzati al 95% (haircut prudenziale
   * banca; cash GP escluso). La margin call scatta quando il margine richiesto
   * supera questa soglia. */
  const marginCover =
    (patrimonyBreakdown?.cashEUR ?? 0) +
    (patrimonyBreakdown?.bondsEUR ?? 0) * BOND_MARGIN_HAIRCUT;
  const r = riskFree;

  // Sottostanti per lo SCENARIO attivo: in modalità 'titoli' i nomi si muovono
  // direttamente della stessa % (beta=1), l'EUR/USD resta fermo. Così l'intero
  // scenario (P&L totale, azioni, opzioni, curva, heatmap, margine a scenario)
  // segue la metodologia scelta.
  const undersDelta = useMemo<StressUnderlyingMap>(() => {
    const m: StressUnderlyingMap = {};
    for (const k of Object.keys(unders)) {
      m[k] = { S: unders[k].S, beta: k === 'EURUSD' ? 0 : 1 };
    }
    return m;
  }, [unders]);

  const undersActive = shockMode === 'titoli' ? undersDelta : unders;
  const prm = useMemo(
    () => ({ r, skewB, kappa, pExp, days, fx, netting }),
    [r, skewB, kappa, pExp, days, fx, netting],
  );

  const dV1M = volMode === 'auto' ? coupledDV1M(d) : dVman;

  const scen = useMemo(
    () => runScenario(legs, eq, undersActive, effIV, d, dV1M, prm),
    [legs, eq, undersActive, effIV, d, dV1M, prm],
  );

  /* ---------- Esposizione di riferimento vs patrimonio stressato ----------
   * DENOMINATORE di P&L% / beta / delta = Esposizione Potenziale in Equity (esposizione
   * equity del Risk Analyzer, coi sotto-toggle ETF/commodity e GP applicati nell'hook).
   * PATRIMONIO STRESSATO assoluto = patrimonio TOTALE (netting dashboard, con GP) + P&L:
   * è il numero che interessa davvero, indipendente dall'ambito di analisi. Il toggle
   * Netting Intrinseco (A) sceglie la metrica del totale (e la valutazione opzioni nel P&L).
   */
  const ptfBase = equityExposure;
  const totalPatrimony = netting ? data.nettingIntrinsicARaw : data.nettingTotalRaw;

  const volAt = (x: number) => (volMode === 'auto' ? coupledDV1M(x) : dVman);


  /* ---------- Beta di riferimento ∓10% ---------- */
  const { betaDown, betaUp } = useMemo(() => {
    if (!ptfBase || ptfBase === 0) return { betaDown: 0, betaUp: 0 };
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting };
    const dn = runScenario(legs, eq, unders, effIV, -10, volAt(-10), bp).totEUR;
    const up = runScenario(legs, eq, unders, effIV, 10, volAt(10), bp).totEUR;
    return { betaDown: dn / ptfBase / -0.1, betaUp: up / ptfBase / 0.1 };
  }, [legs, eq, unders, effIV, ptfBase, r, skewB, kappa, pExp, fx, netting, volMode, dVman]);

  /* ---------- Beta a scenario corrente ---------- */
  const betaScen = useMemo(() => {
    if (!ptfBase || ptfBase === 0) return 0;
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting };
    if (Math.abs(d) < 0.25) {
      const pu = runScenario(legs, eq, unders, effIV, 0.25, volAt(0.25), bp).totEUR;
      const pd = runScenario(legs, eq, unders, effIV, -0.25, volAt(-0.25), bp).totEUR;
      return (pu - pd) / ptfBase / 0.005;
    }
    const pl = runScenario(legs, eq, unders, effIV, d, volAt(d), bp).totEUR;
    return pl / ptfBase / (d / 100);
  }, [legs, eq, unders, effIV, d, ptfBase, r, skewB, kappa, pExp, fx, netting, volMode, dVman]);

  /* ---------- DELTA DI PORTAFOGLIO (beta sui titoli) ----------
   * Misura quanto si muove il portafoglio quando i SUOI sottostanti si muovono
   * direttamente di una certa %, indipendentemente dal beta col mercato. Es. solo
   * MICRON: se MICRON fa −10% e il portafoglio fa −5% → Delta 0,50. Usa undersDelta
   * (beta=1, EUR/USD fermo), definito sopra. Denominatore identico (patrimonio). */
  const { deltaDown, deltaUp } = useMemo(() => {
    if (!ptfBase || ptfBase === 0) return { deltaDown: 0, deltaUp: 0 };
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting };
    const dn = runScenario(legs, eq, undersDelta, effIV, -10, volAt(-10), bp).totEUR;
    const up = runScenario(legs, eq, undersDelta, effIV, 10, volAt(10), bp).totEUR;
    return { deltaDown: dn / ptfBase / -0.1, deltaUp: up / ptfBase / 0.1 };
  }, [legs, eq, undersDelta, effIV, ptfBase, r, skewB, kappa, pExp, fx, netting, volMode, dVman]);

  const deltaScen = useMemo(() => {
    if (!ptfBase || ptfBase === 0) return 0;
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting };
    if (Math.abs(d) < 0.25) {
      const pu = runScenario(legs, eq, undersDelta, effIV, 0.25, volAt(0.25), bp).totEUR;
      const pd = runScenario(legs, eq, undersDelta, effIV, -0.25, volAt(-0.25), bp).totEUR;
      return (pu - pd) / ptfBase / 0.005;
    }
    const pl = runScenario(legs, eq, undersDelta, effIV, d, volAt(d), bp).totEUR;
    return pl / ptfBase / (d / 100);
  }, [legs, eq, undersDelta, effIV, d, ptfBase, r, skewB, kappa, pExp, fx, netting, volMode, dVman]);

  /* ---------- P&L VERO dello scenario di mercato (= card P&L Totale). ---------- */
  const scenMarketTot = scen.totEUR;

  /* ---------- Margine cassa ----------
   * Diviso in due memo per le performance dello slider:
   *  - marNow (margine iniziale) e marCurve (curva margine vs shock) NON dipendono dallo
   *    shock corrente d → si ricalcolano solo se cambiano portafoglio/override/orizzonte;
   *  - marScen/marPnlMTM dipendono da d → poche chiamate per tick. */
  const { marNow, marCurve, marginCallX } = useMemo(() => {
    const fxR = fxRange / 100;
    const marPrm = { r, fxUSD: fx.USD, kScan, fxRange: fxR, skewB, kappa, pExp, ivScan, nakedPct };
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting: false };
    const base = runScenario(legs, eq, unders, effIV, 0, 0, bp);
    const sig0s: Record<number, number> = {};
    base.rows.forEach((x) => (sig0s[x.i] = x.sig0));
    const now = occMargin(legs, eq, unders, 0, sig0s, 0, marPrm);
    // Scan esteso fino a −95%: serve sia alla curva sia a trovare la margin call
    // anche quando scatta oltre il range di default −35%.
    const all: { d: number; Margine: number }[] = [];
    for (let x = -95; x <= 15.01; x += 2.5) {
      const s = runScenario(legs, eq, undersActive, effIV, x, volAt(x), { ...bp, days });
      const sgs: Record<number, number> = {};
      s.rows.forEach((row) => (sgs[row.i] = row.sig1));
      all.push({
        d: x,
        Margine: Math.round(occMargin(legs, eq, undersActive, x, sgs, days, marPrm).total),
      });
    }
    // Margin call: margine richiesto > cash + bond·95%, scandendo da 0 verso il basso.
    const downside = all
      .filter((p) => p.d <= 0.01)
      .sort((a, b) => b.d - a.d)
      .map((p) => ({ x: p.d, margin: p.Margine }));
    const mcX = marginCallShock(downside, marginCover);
    // La curva mostrata parte da −35%, o più a sinistra se serve a includere la margin call.
    const chartMin =
      mcX != null ? Math.max(-95, Math.min(-35, Math.floor((mcX - 6) / 5) * 5)) : -35;
    return { marNow: now, marCurve: all.filter((p) => p.d >= chartMin - 0.01), marginCallX: mcX };
  }, [legs, eq, unders, undersActive, effIV, days, r, skewB, kappa, pExp, fx, kScan, fxRange, ivScan, nakedPct, volMode, dVman, marginCover]);

  const { marScen, marPnlMTM } = useMemo(() => {
    const fxR = fxRange / 100;
    const marPrm = { r, fxUSD: fx.USD, kScan, fxRange: fxR, skewB, kappa, pExp, ivScan, nakedPct };
    const bp = { r, skewB, kappa, pExp, days, fx, netting: false };
    const cur = runScenario(legs, eq, undersActive, effIV, d, dV1M, bp);
    const sigDs: Record<number, number> = {};
    cur.rows.forEach((x) => (sigDs[x.i] = x.sig1));
    const sc = occMargin(legs, eq, undersActive, d, sigDs, days, marPrm);
    return { marScen: sc, marPnlMTM: cur.totEUR };
  }, [legs, eq, undersActive, effIV, d, dV1M, days, r, skewB, kappa, pExp, fx, kScan, fxRange, ivScan, nakedPct]);

  /* ---------- Tabella per sottostante ---------- */
  const undTable = useMemo(() => {
    type Row = {
      key: string;
      beta: number | null;
      spot: number | null;
      ctv: number;
      pnlEq: number;
      pnlOpt: number;
      nLegs: number;
      optNotional: number; // esposizione opzioni (Σ|q|·100·spot in EUR) — peso per il beta medio
      nm: string;
      tot?: number;
    };
    const m: Record<string, Row> = {};
    const get = (k: string): Row =>
      m[k] ||
      (m[k] = {
        key: k,
        beta: null,
        spot: null,
        ctv: 0,
        pnlEq: 0,
        pnlOpt: 0,
        nLegs: 0,
        optNotional: 0,
        nm: '',
      });
    scen.eqRows.forEach((e) => {
      const o = get(e.key);
      o.beta = e.beta;
      o.ctv += e.ctv || 0;
      o.pnlEq += e.pnl;
      // Mostra il ticker se è un vero ticker (ha almeno una lettera); altrimenti la
      // descrizione (es. azioni GP con ticker_code numerico → niente numeri in tabella).
      o.nm = e.tick && /[A-Za-z]/.test(e.tick) ? e.tick : e.nm || e.tick;
      if (e.tick && undersActive[e.tick]) o.spot = undersActive[e.tick].S;
    });
    scen.rows.forEach((rr) => {
      const l = legs[rr.i];
      const o = get(l.u);
      o.pnlOpt += rr.pnlEUR;
      o.nLegs += 1;
      o.nm = l.u;
      if (undersActive[l.u]) {
        o.beta = undersActive[l.u].beta;
        o.spot = undersActive[l.u].S;
        o.optNotional += (Math.abs(l.q) * l.mult * undersActive[l.u].S) / fx.USD;
      }
    });
    return Object.values(m).map((o) => ({ ...o, tot: o.pnlEq + o.pnlOpt }));
  }, [scen, undersActive, legs, fx.USD]);

  // Vista ordinabile (click sull'intestazione). Default: ticker A→Z.
  const undView = useMemo(() => {
    const get = (o: (typeof undTable)[number], k: string): number | string => {
      switch (k) {
        case 'nm': return o.nm;
        case 'beta': return o.beta ?? -Infinity;
        case 'spot': return o.spot ?? -Infinity;
        case 'spotScen': return (o.spot ?? 0) * (1 + ((o.beta ?? 0) * d) / 100);
        case 'move': return (o.beta ?? 0) * d;
        case 'ctv': return o.ctv;
        case 'nLegs': return o.nLegs;
        case 'pnlEq': return o.pnlEq;
        case 'pnlOpt': return o.pnlOpt;
        default: return o.tot ?? 0;
      }
    };
    const dir = undSort.dir === 'asc' ? 1 : -1;
    return [...undTable].sort((a, b) => {
      const av = get(a, undSort.col);
      const bv = get(b, undSort.col);
      const c =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return dir * c;
    });
  }, [undTable, undSort, d]);

  // Beta "totale" = media dei beta di riga PESATA per l'esposizione al sottostante
  // (|ctv titoli| + nozionale opzioni). È il vero totale della COLONNA beta: in modalità
  // titoli ogni nome ha beta 1 → la media pesata è 1,00. L'EUR/USD non è un titolo → escluso.
  const totBetaWeighted = useMemo(() => {
    let num = 0;
    let den = 0;
    for (const o of undTable) {
      if (o.key === 'EURUSD' || o.beta == null) continue;
      const w = Math.abs(o.ctv) + o.optNotional;
      num += o.beta * w;
      den += w;
    }
    return den > 0 ? num / den : 0;
  }, [undTable]);

  /* ---------- Beta di portafoglio per la card Delta ----------
   * È lo STESSO beta totale mostrato dalla tabella per sottostante (totBetaWeighted):
   * media dei beta di riga pesata per esposizione (|ctv titoli| + nozionale opzioni),
   * con beta da undersActive (override UI inclusi). Usato nel P/L teorico = esposizione
   * potenziale × beta × shock. Allineato alla tabella per coerenza. */
  const betaPort = totBetaWeighted;

  /* ---------- DELTA @ scenario (UNICA fonte, usato da card Delta + Esposizione Reale) ----------
   * P/L reale = P&L vero dello scenario di mercato (= card P&L Totale).
   * P/L teorico = Esposizione Potenziale × beta portafoglio × shock (se avessi i titoli
   *               a delta pieno, coi loro beta).
   * Delta = P/L reale ÷ P/L teorico = quota della perdita teorica che si realizza. */
  const plReale = scenMarketTot;
  const plTeoricoScen = ptfBase * betaPort * (d / 100);
  const deltaEff =
    Math.abs(plTeoricoScen) > 1
      ? plReale / plTeoricoScen
      : betaPort
      ? betaScen / betaPort
      : 0;

  /* ---------- Curva P&L vs mercato ---------- */
  // Shock di mercato di "rovina": x in cui il P&L Totale = −patrimonio (−100%).
  // Scan fine e indipendente dallo slider (0 → −95%), interpolazione lineare sul
  // primo attraversamento. null se la rovina non si raggiunge entro −95%.
  const ruinX = useMemo<number | null>(() => {
    if (!totalPatrimony) return null;
    const target = -totalPatrimony;
    let prev: { x: number; tot: number } | null = null;
    for (let x = 0; x >= -95.01; x -= 1.5) {
      const dv = volMode === 'auto' ? coupledDV1M(x) : dVman;
      const tot = runScenario(legs, eq, unders, effIV, x, dv, prm).totEUR;
      if (prev && prev.tot > target && tot <= target) {
        const t = (target - prev.tot) / (tot - prev.tot);
        return prev.x + t * (x - prev.x);
      }
      prev = { x, tot };
    }
    return null;
  }, [legs, eq, unders, effIV, volMode, dVman, prm, totalPatrimony]);

  // Estremo sinistro della curva: abbastanza profondo da mostrare sia la riga di
  // rovina sia quella di margin call.
  const leftMost = Math.min(ruinX ?? Infinity, marginCallX ?? Infinity);
  const curveMin = Number.isFinite(leftMost)
    ? Math.max(-95, Math.min(-35, Math.floor((leftMost - 6) / 5) * 5))
    : -35;

  const curve = useMemo(() => {
    // Shock di mercato trasmesso ai titoli via beta reale (unders).
    const pts: { d: number; Totale: number; 'Azioni/ETF': number; Opzioni: number }[] = [];
    for (let x = curveMin; x <= 15.01; x += 2.5) {
      const dv = volMode === 'auto' ? coupledDV1M(x) : dVman;
      const s = runScenario(legs, eq, unders, effIV, x, dv, prm);
      pts.push({
        d: x,
        Totale: Math.round(s.totEUR),
        'Azioni/ETF': Math.round(s.eqEUR),
        Opzioni: Math.round(s.optEUR),
      });
    }
    return pts;
  }, [legs, eq, unders, effIV, volMode, dVman, prm, curveMin]);

  // Stessa curva in % sul patrimonio (totalPatrimony rispetta il toggle Intrinseco A).
  const curvePct = useMemo(
    () =>
      curve.map((p) => ({
        d: p.d,
        Totale: totalPatrimony ? (p.Totale / totalPatrimony) * 100 : 0,
        'Azioni/ETF': totalPatrimony ? (p['Azioni/ETF'] / totalPatrimony) * 100 : 0,
        Opzioni: totalPatrimony ? (p.Opzioni / totalPatrimony) * 100 : 0,
      })),
    [curve, totalPatrimony],
  );

  /* ---------- Heatmap ---------- */
  const HM_D = [-30, -25, -20, -15, -10, -5, 0, 5, 10];
  const HM_V = [40, 30, 20, 15, 10, 5, 0, -5, -10];
  const heat = useMemo(
    () => HM_V.map((v) => HM_D.map((x) => runScenario(legs, eq, undersActive, effIV, x, v, prm).totEUR)),
    [legs, eq, undersActive, effIV, prm],
  );
  const hmMax = Math.max(...heat.flat().map(Math.abs), 1);

  /* ---------- Term-structure ladder ---------- */
  const ladder = useMemo(
    () =>
      [
        { l: '2 sett', T: 14 / 365 },
        { l: '1 mese', T: 1 / 12 },
        { l: '2 mesi', T: 2 / 12 },
        { l: '3 mesi', T: 0.25 },
        { l: '6 mesi', T: 0.5 },
        { l: '1 anno', T: 1 },
        { l: '18 mesi', T: 1.5 },
      ].map((b) => ({ ...b, dv: dV1M * termFactor(b.T, pExp) })),
    [dV1M, pExp],
  );
  const ladderMax = Math.max(...ladder.map((b) => Math.abs(b.dv)), 1);

  /* ---------- Tabella per gamba ---------- */
  const tableRows = useMemo(() => {
    const rows = scen.rows.map((rr) => ({ ...rr, leg: legs[rr.i] }));
    const get = (rr: (typeof rows)[number], k: string): number | string => {
      switch (k) {
        case 'ticker': return rr.leg.u;
        case 'gamba': return rr.leg.cp + String(rr.leg.K).padStart(12, '0');
        case 'q': return rr.leg.q;
        case 'spot': return undersActive[rr.leg.u]?.S ?? 0;
        case 'sig0': return rr.sig0;
        case 'sig1': return rr.sig1;
        case 'dIV': return rr.dIV;
        case 'p0': return rr.p0;
        case 'p1': return rr.p1;
        default: return rr.pnlEUR;
      }
    };
    const dir = legSort.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      if (legSort.col === 'ticker') {
        // raggruppa per ticker (A→Z o Z→A); dentro al gruppo, impatto |P&L| decrescente
        const t = a.leg.u.localeCompare(b.leg.u);
        if (t !== 0) return dir * t;
        return Math.abs(b.pnlEUR) - Math.abs(a.pnlEUR);
      }
      const av = get(a, legSort.col);
      const bv = get(b, legSort.col);
      const c =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return dir * c;
    });
  }, [scen, legs, legSort, undersActive]);

  const kpi = [
    {
      l: 'P&L Totale',
      v: scen.totEUR,
      sub: '',
      pPatr: totalPatrimony ? scen.totEUR / totalPatrimony : null,
      pEsp: ptfBase ? scen.totEUR / ptfBase : null,
    },
    { l: 'P&L Azioni / ETF', v: scen.eqEUR, sub: 'via beta reale', pPatr: null, pEsp: null },
    {
      l: 'P&L Opzioni',
      v: scen.optEUR,
      sub: netting ? '⚠ netting attivo: opzioni a intrinseco (hold to expiry)' : 'rivalutazione completa Black-Scholes',
      pPatr: null,
      pEsp: null,
    },
  ];

  const lbl: React.CSSProperties = {
    fontSize: 11,
    color: C.mut,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  };

  /* ---------- Stati vuoti / loading ---------- */
  if (data.isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.mut, fontFamily: SANS }}>
        <Loader2 className="inline-block animate-spin mr-2" />
        Caricamento dati del portafoglio…
      </div>
    );
  }

  if (legs.length === 0 && eq.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          color: C.mut,
          fontFamily: SANS,
        }}
      >
        <Activity style={{ width: 48, height: 48, margin: '0 auto 16px', opacity: 0.5 }} />
        <p>Nessuna posizione nel portafoglio selezionato.</p>
        <p style={{ fontSize: 12, marginTop: 8 }}>
          Carica un file di portafoglio dalla Dashboard per iniziare l'analisi di stress.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        fontFamily: SANS,
        padding: '18px 18px 60px',
        borderRadius: 12,
      }}
    >
      <style>{`
        input[type=range]{-webkit-appearance:none;background:${C.border2};border-radius:3px;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${C.text};border:3px solid ${C.blue};cursor:pointer}
        table.grid td,table.grid th{padding:5px 8px;border-bottom:1px solid ${C.border};white-space:nowrap}
        ::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:${C.border2};border-radius:4px}
      `}</style>

      {/* HEADER */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, color: C.blue }}>
          STRESS LAB
        </div>
        <div style={{ fontSize: 12, color: C.mut, fontFamily: MONO }}>
          {legs.length} gambe opzioni · {eq.length} titoli · {fmtEUR(ptfBase)}
          {netting ? (
            <span style={{ color: C.amber }}> (netting: opzioni a intrinseco)</span>
          ) : (
            ''
          )}
        </div>
        <Info title="Cosa fa questo strumento" w={380}>
          Riprezza <b>ogni singola opzione</b> del portafoglio (rivalutazione completa Black-Scholes) sotto
          uno shock congiunto di mercato e volatilità. Lo smile si muove insieme al prezzo e la
          superficie viene deformata in modo non-parallelo: le scadenze brevi si gonfiano più delle lunghe e lo
          skew si irripidisce, come osservato empiricamente nei crash (2008, ago-2015, feb-2018, mar-2020).
          Le azioni si muovono linearmente via beta. Bond e oro sono esclusi dallo shock azionario (beta 0):
          la duration non è modellata.
        </Info>
      </div>

      {/* WARNING BANNERS */}
      {data.missingBetaTickers.length > 0 && (
        <div
          style={{
            background: 'rgba(247,166,0,.08)',
            border: `1px solid ${C.amber}`,
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: C.amber,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle size={14} />
          <span>
            Beta non trovato per {data.missingBetaTickers.length} ticker
            {data.isFetchingBeta ? ' (recupero in corso da Yahoo/GuruFocus…)' : ' — usando default 1.0'}
            : <code style={{ fontFamily: MONO }}>{data.missingBetaTickers.slice(0, 8).join(', ')}</code>
            {data.missingBetaTickers.length > 8 ? '…' : ''}
          </span>
        </div>
      )}
      {data.ivWarnings > 0 && (
        <div
          style={{
            background: 'rgba(34,174,196,.08)',
            border: `1px solid ${C.cyan}`,
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: C.cyan,
          }}
        >
          ⚑ {data.ivWarnings} gambe con prezzo di riferimento sotto l'intrinseco: quotate a intrinseco
          (delta 1), si muovono uno-a-uno con il sottostante.
        </div>
      )}

      {/* PATRIMONIO — AMBITO */}
      <Panel
        title="Esposizione di riferimento"
        info={
          <Info title="Esposizione Potenziale in Equity" w={360}>
            È il <b>denominatore</b> di P&L%, beta e delta a scenario: l'esposizione equity del
            <b> Risk Analyzer</b> (singoli titoli + ETF nette protezioni + commodity + naked put + LEAP +
            strategie + sintetiche).
            <br />
            <br />
            Il <b>patrimonio stressato</b> mostrato (sotto la card P&L Totale) è invece sempre
            <b> patrimonio totale + P&L</b>: è il valore assoluto del tuo patrimonio dopo lo shock.
            <br />
            <br />
            <b>Includi azioni GP</b>: aggiunge l'esposizione azionaria della Gestione Patrimoniale
            (anche allo shock). <b>Includi ETF e Commodities</b>: se spento, esposizione e shock si
            basano solo sui singoli titoli (+ opzioni), togliendo ETF/ETC/commodity.
            <br />
            <br />
            Il toggle <b>Netting Intrinseco (A)</b> qui a fianco sceglie la metrica del totale e la
            valutazione delle opzioni sotto shock (intrinseco hold-to-expiry).
          </Info>
        }
        headerRight={
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: netting ? C.amber : C.mut,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Netting Intrinseco (A)
            </span>
            <button
              onClick={() => setNetting(!netting)}
              style={{
                width: 42,
                height: 22,
                borderRadius: 11,
                border: `1px solid ${netting ? C.amber : C.border2}`,
                background: netting ? 'rgba(247,166,0,.3)' : C.panel,
                cursor: 'pointer',
                position: 'relative',
                padding: 0,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: netting ? 22 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: netting ? C.amber : C.mut,
                  transition: 'left .15s',
                }}
              />
            </button>
            <Info title="Netting Ex Covered Call e Naked Put" w={360} right>
              Cambia il <b>criterio di valutazione delle opzioni sotto shock</b>: invece del mark-to-market,
              ogni gamba vale il suo <b>valore intrinseco</b> allo spot, in logica "hold to expiry" (il premio
              è già contabilizzato). Le opzioni OTM valgono 0 in modo naturale; quelle ITM seguono l'intrinseco.
              <br />
              <br />
              <b>Covered call ITM</b>: 100 azioni a 500, call venduta strike 350. Le azioni scendono a 400: tu
              non perdi nulla, perché sei sopra lo strike → azioni −100, call +100 (intrinseco 150→50) = 0.
              Inizi a perdere solo <b>sotto lo strike</b> (350), dove la call vale 0.
              <br />
              <br />
              <b>Naked put</b>: put venduta strike 200, premio 5. Crash, spot 190: il MTM sarebbe −20, qui vedi
              solo −10 = intrinseco (200−190).
              <br />
              <br />
              <b>Attenzione</b>: spariscono il rischio di vol e il vero costo di chiusura anticipata. In un
              crash il riacquisto avviene al MTM, non all'intrinseco. Con il toggle attivo il beta al ribasso
              scende: non perché il rischio sia minore, ma perché parte non viene misurata.
            </Info>
          </span>
        }
        style={{ marginBottom: 14 }}
      >
        {(() => {
          const pb = data.patrimonyBreakdown;
          const tog = (on: boolean, onClick: () => void) => (
            <button
              onClick={onClick}
              style={{
                width: 42,
                height: 22,
                borderRadius: 11,
                border: `1px solid ${on ? C.cyan : C.border2}`,
                background: on ? 'rgba(0,200,255,.25)' : C.panel,
                cursor: 'pointer',
                position: 'relative',
                padding: 0,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: on ? 22 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: on ? C.cyan : C.mut,
                  transition: 'left .15s',
                }}
              />
            </button>
          );
          return (
            <>
              {/* Card esposizioni: Potenziale (sempre) · Reale + Leva Reale (solo titoli) */}
              {(() => {
                const reale = ptfBase * deltaEff;
                const leva = totalPatrimony ? reale / totalPatrimony : 0;
                const betaW = totBetaWeighted;
                // Rovina (−100% perf.) da FULL REVALUATION: ruinX è lo shock di mercato a
                // cui il P&L = −100% del patrimonio (stesso punto della riga rossa, gamma+vol
                // inclusi). Shock titoli = beta titoli ponderato × shock mercato.
                const ruinMktV = ruinX; // shock mercato di rovina (o null se oltre −95%)
                const ruinTitoliV = ruinX != null ? betaW * ruinX : null;
                // Leva reale alla rovina = |−100% perf.| ÷ |movimento titoli a rovina|
                // = 100 / |β × ruinX| (leva secante implicita nel punto di rovina full-reval).
                const ruinLeva =
                  ruinTitoliV != null && Math.abs(ruinTitoliV) > 0.01 ? 100 / Math.abs(ruinTitoliV) : null;
                const showReal = true;
                const card = (
                  label: string,
                  value: string,
                  accent: string,
                  info: React.ReactNode,
                  sub?: React.ReactNode,
                ) => (
                  <div
                    style={{
                      flex: '1 1 150px',
                      padding: '10px 12px',
                      background: `${accent}14`,
                      border: `1px solid ${accent}`,
                      borderRadius: 7,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: accent,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {label}
                      {info}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 800, color: C.text, marginTop: 3 }}>
                      {value}
                    </div>
                    {sub && (
                      <div style={{ fontSize: 9.5, color: C.mut, fontFamily: MONO, marginTop: 4, lineHeight: 1.55 }}>
                        {sub}
                      </div>
                    )}
                  </div>
                );
                return (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {card(
                      'Esposizione Potenziale in Equity',
                      fmtEUR(ptfBase),
                      C.cyan,
                      <Info title="Esposizione Potenziale in Equity" w={340}>
                        Esposizione equity del Risk Analyzer (coi sotto-toggle qui sotto). È il
                        <b> denominatore</b> di P&L%, beta e delta. Rappresenta il rischio se TUTTO si muovesse
                        a pieno (delta 1): è il "potenziale", non l'esposizione direzionale effettiva.
                      </Info>,
                    )}
                    {showReal &&
                      card(
                        `Esposizione Reale in Equity · @ ${sgn(d, 1)}%`,
                        fmtEUR(reale),
                        C.blue,
                        <Info title="Esposizione Reale in Equity" w={360}>
                          <b>Esposizione Potenziale × Delta @ scenario</b>. Il delta @ scenario misura quanta
                          parte dell'esposizione si muove <b>davvero</b> coi tuoi sottostanti allo shock
                          corrente (include gamma e vol lungo il tragitto), quindi <b>cambia con lo slider</b>.
                          <br />
                          <br />
                          Esempio: covered call con delta netto 0,7 su 50k potenziali → 35k reali (le call
                          coperte tagliano parte dell'upside). Put venduta OTM con delta 0,2 su 10k → 2k reali
                          (poca direzionalità finché non va ITM).
                          <br />
                          <br />
                          È un'esposizione <b>lineare</b> (delta-€): in un crash la perdita reale è maggiore,
                          perché il gamma delle put vendute accelera. Negativa = sei net short.
                        </Info>,
                      )}
                    {showReal &&
                      card(
                        `Leva Reale · @ ${sgn(d, 1)}%`,
                        `${fmtN(leva, 2)}×`,
                        C.amber,
                        <Info title="Leva Reale" w={360}>
                          <b>Esposizione Reale / Patrimonio totale</b> (netting della dashboard, coerente col
                          toggle <b>Netting Intrinseco (A)</b>: il denominatore è il netting totale o l'Intrinseco A).
                          <br />
                          <br />
                          Dice quanta parte del patrimonio è <b>davvero esposta</b> alla direzione dell'equity:
                          0,80 = l'80% del patrimonio si muove col book; 1,30 = sei in <b>leva 1,3×</b>; valori
                          bassi = molto coperto/poco direzionale.
                          <br />
                          <br />
                          Cambia con lo slider (segue il delta @ scenario) e col toggle Intrinseco (A). Negativa =
                          net short. È leva <b>direzionale lineare</b>, non perdita massima (la coda è peggiore
                          per il gamma).
                        </Info>,
                        <>
                          {ruinX != null ? (
                            <div>
                              rovina −100% perf. (full reval):{' '}
                              <span style={{ color: C.dn }}>{sgn(ruinMktV as number, 1)}%</span> mercato ·{' '}
                              <span style={{ color: C.dn }}>{sgn(ruinTitoliV as number, 1)}%</span> titoli · leva
                              rovina <span style={{ color: C.amber, fontWeight: 700 }}>{ruinLeva != null ? fmtN(ruinLeva, 2) : '—'}×</span>{' '}
                              (β pond. {fmtN(betaW, 2)})
                            </div>
                          ) : (
                            <div>rovina oltre −95% di mercato (book robusto)</div>
                          )}
                        </>,
                      )}
                  </div>
                );
              })()}

              {/* Patrimonio iniziale → stressato (allo shock corrente) */}
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,.02)',
                  border: `1px solid ${C.border2}`,
                  borderRadius: 7,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  flexWrap: 'wrap',
                  fontFamily: MONO,
                }}
              >
                <span style={{ fontSize: 10.5, color: C.mut, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Patrimonio iniziale
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{fmtEUR(totalPatrimony)}</span>
                <span style={{ color: C.mut, fontSize: 15 }}>→</span>
                <span style={{ fontSize: 10.5, color: C.mut, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Patrimonio stressato @ {sgn(d, 1)}%
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: pnlColor(scen.totEUR) }}>
                  {fmtEUR(totalPatrimony + scen.totEUR)}
                </span>
                <span style={{ fontSize: 11, color: pnlColor(scen.totEUR) }}>
                  ({sgn(totalPatrimony ? (scen.totEUR / totalPatrimony) * 100 : 0, 1)}%)
                </span>
              </div>

              {/* Toggle: Includi ETF e Commodities */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                {tog(includeEtfCommodity, () => setIncludeEtfCommodity((v) => !v))}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: includeEtfCommodity ? C.cyan : C.mut,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  Includi ETF e Commodities
                  <Info title="Includi ETF e Commodities" w={340}>
                    Se <b>spento</b>, l'Esposizione Potenziale in Equity e lo shock (beta/delta, P&L, tabelle)
                    <b> escludono ETF, ETC e commodity</b> e si basano <b>solo sui singoli titoli</b> (più le
                    opzioni). Serve ad analizzare gli effetti dello shock solo sul portafoglio gestito in
                    opzioni e singoli titoli. Il patrimonio stressato assoluto resta comunque totale + P&L.
                  </Info>
                </span>
              </div>

              {/* Toggle: Includi azioni GP */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                {tog(gpEquity, () => setGpEquity((v) => !v))}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: gpEquity ? C.cyan : C.mut,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  Includi azioni GP
                  {pb.gpEquityEUR > 0 ? ` (+${fmtN(pb.gpEquityEUR / 1000, 0)}k)` : ''}
                  <Info title="Includi azioni GP" w={320}>
                    Aggiunge l'esposizione azionaria della <b>Gestione Patrimoniale</b> all'esposizione di
                    riferimento e allo shock dello scenario (equivale al toggle GP del Risk Analyzer).
                  </Info>
                </span>
              </div>

              {/* Toggle: Includi protezioni */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                {tog(includeProtections, () => setIncludeProtections((v) => !v))}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: includeProtections ? C.cyan : C.mut,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  Includi protezioni
                  {data.equityProtectionSavings > 0
                    ? ` (${includeProtections ? '−' : '+'}${fmtN(data.equityProtectionSavings / 1000, 0)}k)`
                    : ''}
                  <Info title="Includi protezioni" w={360}>
                    Le protezioni (put protettive, gambe lunghe di spread) sono <b>sempre incluse nello
                    shock</b>: il P&L dello scenario non cambia. Questo toggle agisce <b>solo sul valore
                    dell'Esposizione Potenziale in Equity</b> presa come riferimento:
                    <br />• <b>ON</b> (default): esposizione <b>netta</b> delle protezioni (rischio ridotto).
                    <br />• <b>OFF</b>: esposizione <b>lorda</b>, come se le protezioni non riducessero il
                    rischio.
                    <br />
                    <br />
                    Cambiando il denominatore cambiano <b>beta e delta</b> a scenario (esposizione più grande →
                    beta/delta più bassi, e viceversa).
                  </Info>
                </span>
              </div>

              <div style={{ marginTop: 9, fontSize: 10.5, color: C.mut, fontFamily: MONO }}>
                Risk Analyzer {fmtN(data.equityGrandTotal / 1000, 0)}k
                {!includeProtections && data.equityProtectionSavings > 0
                  ? ` + protezioni ${fmtN(data.equityProtectionSavings / 1000, 0)}k`
                  : ''}
                {!includeEtfCommodity
                  ? ` − ETF ${fmtN(data.equityEtfEUR / 1000, 0)}k − commodity ${fmtN(data.equityCommodityEUR / 1000, 0)}k`
                  : ''}
                {gpEquity ? ` + azioni GP ${fmtN(pb.gpEquityEUR / 1000, 0)}k` : ''} = {fmtN(ptfBase / 1000, 0)}k
              </div>
            </>
          );
        })()}
      </Panel>

      {/* CONTROLS + KPI */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(280px,360px) 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Panel
          title="Scenario shock di mercato"
          info={
            <Info title="Come leggere i controlli" w={360}>
              Lo slider è lo <b>shock di mercato</b> (la variazione % dell'indice di riferimento). Viene
              trasmesso a ogni titolo tramite il suo <b>beta reale</b> (es. beta 1,5 → −15% se il mercato fa
              −10%).
              <br />
              <br />
              A fianco vedi sempre sia il <b>Beta</b> (sensibilità al mercato) sia il <b>Delta</b> (quanto della
              perdita teorica beta-adjusted si realizza davvero).
              <br />
              <br />
              <b>Vol accoppiata (consigliata)</b>: la vol ATM a 1 mese reagisce al mercato secondo la relazione
              empirica SPX–VIX. Un −10% genera ≈ +12,5 punti; un −30% ≈ +52 punti. <b>Manuale</b>: imposti tu lo
              shock sulla vol ATM 1M, propagato poi alle altre scadenze.
            </Info>
          }
        >
          <Slider
            label="Shock di mercato"
            value={d}
            set={setD}
            min={-40}
            max={20}
            step={1}
            fmt={(v) => sgn(v, 1) + '%'}
            accent={d < 0 ? C.dn : C.up}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              margin: '-4px 0 10px',
              fontSize: 12,
              fontFamily: MONO,
              color: C.mut,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Beta totale ponderato:{' '}
              <b style={{ color: C.text }}>{fmtN(totBetaWeighted, 2)}</b>
              <Info title="Beta totale ponderato" w={400}>
                È il <b>beta medio del portafoglio</b>, pesato per l'esposizione di ogni sottostante
                (controvalore dei titoli + nozionale delle opzioni). Indica di quanto si muove
                complessivamente il book per ogni 1% di mercato: 1,00 = come l'indice, 2,00 = il doppio.
                <br />
                <br />
                I beta per nome sono quelli della tabella per sottostante (override UI inclusi). È lo stesso
                beta usato nel <b>P/L teorico</b> della card Delta.
                <br />
                <br />
                <b>Shock Titoli</b> qui a fianco = beta totale × shock di mercato: la variazione % media
                attesa sui tuoi titoli per lo shock impostato.
              </Info>
            </span>
            <span>
              Shock Titoli:{' '}
              <b style={{ color: totBetaWeighted * d < 0 ? C.dn : C.up }}>
                {sgn(totBetaWeighted * d, 2)}%
              </b>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(
              [
                ['auto', 'Vol accoppiata (empirica)'],
                ['manual', 'Vol manuale'],
              ] as [typeof volMode, string][]
            ).map(([k, t]) => (
              <button
                key={k}
                onClick={() => setVolMode(k)}
                style={{
                  flex: 1,
                  padding: '7px 4px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: volMode === k ? 'rgba(41,98,255,.16)' : 'transparent',
                  border: `1px solid ${volMode === k ? C.blue : C.border2}`,
                  color: volMode === k ? C.blue : C.mut,
                  fontFamily: SANS,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {volMode === 'manual' ? (
            <Slider
              label="Δ Vol ATM 1M"
              value={dVman}
              set={setDVman}
              min={-15}
              max={50}
              step={0.5}
              fmt={(v) => sgn(v, 1) + ' pt'}
              accent={C.amber}
            />
          ) : (
            <div
              style={{
                ...lbl,
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Δ Vol ATM 1M derivata</span>
              <span style={{ fontFamily: MONO, color: C.amber, fontSize: 13, fontWeight: 700 }}>
                {sgn(dV1M, 1)} pt
              </span>
            </div>
          )}
          <Slider
            label="Orizzonte (giorni)"
            value={days}
            set={setDays}
            min={0}
            max={30}
            step={1}
            fmt={(v) => v + ' gg'}
            accent={C.cyan}
            info={
              <Info title="Orizzonte temporale" w={300}>
                A 0 giorni lo shock è istantaneo. Aumentandolo, ogni opzione perde vita residua (theta) e le
                gambe in scadenza vengono valutate a intrinseco se l'orizzonte le supera. Utile per stress
                "a fine settimana / a scadenza tecnica".
              </Info>
            }
          />
          <div
            onClick={() => setShowAdv(!showAdv)}
            style={{ ...lbl, cursor: 'pointer', color: C.blue, marginTop: 4 }}
          >
            {showAdv ? '▾' : '▸'} parametri avanzati superficie
          </div>
          {showAdv && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              <Slider
                label="Skew base β"
                value={skewB}
                set={setSkewB}
                min={-0.04}
                max={0}
                step={0.001}
                fmt={(v) => fmtN(v * 100, 1) + ' pt/σ'}
                accent={C.cyan}
              />
              <Slider
                label="Irripidimento skew κ"
                value={kappa}
                set={setKappa}
                min={0}
                max={1.5}
                step={0.05}
                fmt={(v) => fmtN(v, 2)}
                accent={C.cyan}
              />
              <Slider
                label="Esponente term p"
                value={pExp}
                set={setPExp}
                min={0.2}
                max={1}
                step={0.05}
                fmt={(v) => fmtN(v, 2)}
                accent={C.cyan}
              />
              <button
                onClick={() => {
                  setSkewB(-0.018);
                  setKappa(0.6);
                  setPExp(0.5);
                }}
                disabled={skewB === -0.018 && kappa === 0.6 && pExp === 0.5}
                style={{
                  marginTop: 2,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontFamily: SANS,
                  fontWeight: 600,
                  background: 'transparent',
                  color: skewB === -0.018 && kappa === 0.6 && pExp === 0.5 ? C.mut : C.cyan,
                  border: `1px solid ${skewB === -0.018 && kappa === 0.6 && pExp === 0.5 ? C.border2 : C.cyan}`,
                  borderRadius: 6,
                  cursor: skewB === -0.018 && kappa === 0.6 && pExp === 0.5 ? 'default' : 'pointer',
                }}
              >
                ↺ Ripristina default (β −1,8 · κ 0,60 · p 0,50)
              </button>
            </div>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,minmax(0,1fr))', gap: 14 }}>
            {kpi.map((k) => (
              <Panel key={k.l} style={{ padding: '14px 16px' }}>
                <div style={lbl}>{k.l}</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 24,
                    fontWeight: 800,
                    color: pnlColor(k.v),
                    margin: '6px 0 2px',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    {k.v > 0 ? '+' : ''}
                    {fmtEUR(k.v)}
                  </span>
                  {k.pPatr != null && (
                    <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
                      ({sgn(k.pPatr * 100, 1)}%)
                      <Info title="Perdita % sul patrimonio" w={340}>
                        È il P&L in percentuale del <b>patrimonio totale</b> (netting della dashboard): netting
                        <b> Intrinseco (A)</b> se il toggle è attivo, altrimenti <b>netting totale</b>.
                      </Info>
                    </span>
                  )}
                </div>
                {k.sub && <div style={{ fontSize: 10.5, color: C.mut }}>{k.sub}</div>}
                {k.pEsp != null && (
                  <div style={{ fontSize: 10.5, color: C.mut, fontFamily: MONO, marginTop: 2 }}>
                    su esp. potenziale{' '}
                    <span style={{ color: pnlColor(k.v), fontWeight: 700 }}>{sgn(k.pEsp * 100, 1)}%</span>
                  </div>
                )}
              </Panel>
            ))}
            {/* Beta @ scenario — sensibilità al mercato */}
            <Panel style={{ padding: '14px 16px', border: `1px solid ${C.blue}` }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>
                Beta @ scenario
                <Info title="Sensibilità al mercato" w={420}>
                  Se il <b>mercato</b> fa −10%, di quanto si muove il portafoglio? La mossa passa per il
                  <b> beta</b> di ogni titolo (beta 1,5 = scende una volta e mezza il mercato). È la sensibilità
                  “vs indice”, complementare al Delta (che misura “vs i tuoi titoli”).
                  <br />
                  <br />
                  Le <b>put vendute</b> hanno gamma negativo: in discesa pesano sempre di più e la perdita
                  accelera.
                  <br />
                  <br />
                  Headline = beta riferito al <b>patrimonio totale</b> (netting dashboard): quanto si muove il
                  patrimonio per 1% di mercato. Sotto, in piccolo, lo stesso beta riferito all'<b>Esposizione
                  Potenziale in Equity</b> (denominatore di P&L%/delta).
                </Info>
              </div>
              {(() => {
                const denomTot = data.nettingTotalRaw;
                const scale = denomTot && ptfBase ? ptfBase / denomTot : 0;
                const betaTot = betaScen * scale;
                return (
                  <>
                    <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, margin: '6px 0 2px', color: betaTot >= 1.5 ? C.dn : betaTot <= 0.9 ? C.up : C.text }}>
                      {fmtN(betaTot, 2)}
                      <span style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}> @ {sgn(d, 1)}%</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: C.mut, fontFamily: MONO }}>
                      β vs patr. totale
                    </div>
                    <div style={{ fontSize: 10.5, color: C.mut, fontFamily: MONO, marginTop: 4 }}>
                      β vs esp. potenziale{' '}
                      <span style={{ color: C.text, fontWeight: 700 }}>{fmtN(betaScen, 2)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.mut, fontFamily: MONO, marginTop: 2 }}>
                      rif. <span style={{ color: C.dn }}>{fmtN(betaDown, 2)}↓</span> ·{' '}
                      <span style={{ color: C.up }}>{fmtN(betaUp, 2)}↑</span>{' '}
                      <span style={{ fontSize: 10 }}>(∓10%)</span>
                    </div>
                  </>
                );
              })()}
            </Panel>

            {/* Delta @ scenario — quota della perdita beta-implicita che si realizza davvero */}
            <Panel style={{ padding: '14px 16px', border: `1px solid ${C.cyan}` }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>
                Delta @ scenario
                <Info title="Quanto realizzi della perdita teorica" w={440}>
                  Se il <b>mercato fa −10%</b>, quanto perdo <b>davvero</b> (P/L reale, = card P&L Totale)
                  rispetto a quanto perderei se l'intera <b>Esposizione Potenziale</b> si muovesse a
                  <b> delta pieno (1,00)</b> col mio <b>beta di portafoglio</b> (P/L teorico)?
                  <br />
                  <br />
                  <b>Esempio</b>: esposizione potenziale 1 mln, beta 1,5 → teorico = 1M × 1,5 × 10% = 150k. Se in
                  realtà perdo 100k → <b>Delta = 100 / 150 = 0,66</b>.
                  <br />
                  <br />
                  Misura quanta parte dell'esposizione beta-adjusted è <b>direzionalmente viva</b>: le call
                  vendute coperte e le put OTM tagliano il delta (&lt; 1), un book molto direzionale lo avvicina
                  a 1. Cambia con lo slider (gamma e vol lungo il tragitto).
                </Info>
              </div>
              {(() => {
                const plTeorico = plTeoricoScen;
                return (
                  <>
                    <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, margin: '6px 0 2px', color: deltaEff >= 1.5 ? C.dn : deltaEff <= 0.9 ? C.up : C.text }}>
                      {fmtN(deltaEff, 2)}
                      <span style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}> @ {sgn(d, 1)}%</span>
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: C.mut,
                        fontFamily: MONO,
                        marginTop: 5,
                        paddingTop: 5,
                        borderTop: `1px solid ${C.border}`,
                        lineHeight: 1.6,
                      }}
                    >
                      <div>
                        P/L reale{' '}
                        <span style={{ color: pnlColor(plReale), fontWeight: 700 }}>{fmtEUR(plReale)}</span>
                      </div>
                      <div>
                        / P/L teorico (esp.pot × β {fmtN(betaPort, 2)} × {sgn(d, 0)}%){' '}
                        <span style={{ color: pnlColor(plTeorico), fontWeight: 700 }}>{fmtEUR(plTeorico)}</span>
                      </div>
                      <div>
                        = Delta{' '}
                        <span style={{ color: C.text, fontWeight: 800 }}>{fmtN(deltaEff, 2)}</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </Panel>

            {/* Margine richiesto + incidenza bond/cash accorpata */}
            <Panel
              style={{
                padding: '14px 16px',
                border: `1px solid ${
                  marginCover > 0 &&
                  (marScen.total > marginCover ||
                    marScen.total / Math.max(marginCover, 1) >
                      (marNow.total / marginCover) * 1.2)
                    ? C.dn
                    : C.border
                }`,
              }}
            >
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>
                Margine richiesto
                <Info title="Margine cassa e soglia di margin call" w={420} right>
                  <b>Margine richiesto</b>: per ogni sottostante e lato, <b>max(strategy-based, scan TIMS)</b> —
                  margine interno (premio + 20%/floor, call coperte dai titoli escluse) e, sui soli veri spread,
                  lo scan a 2 giorni con vol accoppiata. Nel crash la premium delle put vendute si gonfia: il
                  margine sale proprio mentre il patrimonio si svuota.
                  <br />
                  <br />
                  <b>Incidenza su cash + bond·95%</b> (riga piccola): margine / copertura disponibile, dove la
                  copertura = cash + <b>bond valorizzati al 95%</b> (haircut prudenziale; cash GP escluso). La{' '}
                  <b>margin call</b> scatta quando il margine richiesto supera questa copertura, cioè quando
                  l'incidenza passa il <b>100%</b>: nel crash il numeratore cresce mentre bond e cash restano
                  stabili, quindi l'incidenza accelera. Il bordo diventa rosso in margin call a scenario o se
                  lo scenario fa salire l'incidenza oltre +20% rispetto a oggi.
                </Info>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, margin: '6px 0 2px' }}>
                <span style={{ color: C.mut, fontSize: 15 }}>{fmtN(marNow.total / 1000, 0)}k → </span>
                <span style={{ color: marScen.total > marNow.total ? C.dn : C.up }}>
                  {fmtN(marScen.total / 1000, 0)}k €
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: C.mut, fontFamily: MONO }}>
                @ scen.: strategy {fmtN(marScen.totStrat / 1000, 0)}k + scan{' '}
                {fmtN(marScen.totScan / 1000, 0)}k
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: C.mut,
                  fontFamily: MONO,
                  marginTop: 5,
                  paddingTop: 5,
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                incidenza cash+bond·95%{' '}
                <span style={{ color: C.mut }}>
                  {marginCover > 0 ? fmtN((marNow.total / marginCover) * 100, 0) : '—'}% →{' '}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color:
                      marginCover > 0 &&
                      (marScen.total > marginCover ||
                        marScen.total / Math.max(marginCover, 1) >
                          (marNow.total / marginCover) * 1.2)
                        ? C.dn
                        : C.text,
                  }}
                >
                  {marginCover > 0
                    ? fmtN((marScen.total / Math.max(marginCover, 1)) * 100, 0)
                    : '—'}
                  %
                </span>
                <div style={{ marginTop: 3 }}>
                  margin call (marg. &gt; cash+bond·95%){' '}
                  <span style={{ fontWeight: 800, color: marginCallX != null ? '#A855F7' : C.mut }}>
                    {marginCallX != null ? `@ mercato ${sgn(marginCallX, 1)}%` : 'non raggiunta entro −95%'}
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          {/* Term-structure ladder */}
          <Panel
            title="Shock di vol applicato per scadenza"
            info={
              <Info title="La superficie non si muove in parallelo" w={350}>
                Questa scaletta mostra quanti punti di vol vengono aggiunti all'ATM di ogni scadenza nello
                scenario corrente. Il front (≤1 mese) prende lo shock pieno, le scadenze lunghe una frazione ∝
                1/√T: è il pattern empirico della term structure che si inverte in backwardation durante i
                crash.
              </Info>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ladder.map((b) => (
                <div key={b.l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: C.mut,
                      width: 56,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {b.l}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 16,
                      background: C.panel2,
                      borderRadius: 3,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: `${Math.min(100, (Math.abs(b.dv) / ladderMax) * 100)}%`,
                        background:
                          b.dv >= 0
                            ? `linear-gradient(90deg, rgba(242,54,69,.25), ${C.dn})`
                            : `linear-gradient(90deg, rgba(8,153,129,.25), ${C.up})`,
                        borderRadius: 3,
                        transition: 'width .25s',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 700,
                      width: 70,
                      color: b.dv >= 0 ? C.dn : C.up,
                    }}
                  >
                    {sgn(b.dv, 1)} pt
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* CHART */}
      <Panel
        title={`${plPct ? 'P/L % su patrimonio' : 'P&L (€)'} vs shock mercato (β reale)`}
        style={{ marginBottom: 14 }}
        info={
          <Info title="Perché la curva delle opzioni non è una retta" w={350}>
            Ogni punto è una full revaluation: a ogni shock di mercato corrisponde la sua vol coerente. La
            convessità che vedi è il gamma/vega aggregato del book; un approccio delta×beta sarebbe la tangente
            in zero e divergerebbe proprio nelle code.
            <br />
            <br />
            In <b>%</b> il P&L è rapportato al <b>patrimonio totale</b> (netting della dashboard; Intrinseco A se
            il toggle è attivo).
            <br />
            <br />
            La <b>riga rossa</b> segna lo shock di mercato a cui il P&L = <b>−100% del patrimonio</b> (rovina).
            Il badge mostra anche lo <b>shock titoli</b> corrispondente = beta titoli ponderato × shock mercato.
            <br />
            <br />
            La <b>riga viola tratteggiata</b> segna la <b>margin call</b>: lo shock di mercato a cui il margine
            richiesto supera la copertura disponibile = <b>cash + bond valorizzati al 95%</b> (haircut
            prudenziale; cash GP escluso).
          </Info>
        }
        headerRight={
          <div style={{ display: 'flex', gap: 0 }}>
            {(['pct', 'eur'] as const).map((u, i) => (
                <button
                  key={u}
                  onClick={() => setPlPct(u === 'pct')}
                  style={{
                    padding: '3px 9px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    background: (plPct ? 'pct' : 'eur') === u ? C.blue : 'transparent',
                    border: `1px solid ${(plPct ? 'pct' : 'eur') === u ? C.blue : C.border2}`,
                    borderLeft: i === 1 ? 'none' : undefined,
                    color: (plPct ? 'pct' : 'eur') === u ? '#fff' : C.mut,
                    borderRadius: i === 0 ? '6px 0 0 6px' : '0 6px 6px 0',
                    fontFamily: SANS,
                  }}
                >
                  {u === 'pct' ? '% patrim.' : '€'}
                </button>
              ))}
            </div>
          }
      >
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={plPct ? curvePct : curve} margin={{ top: 8, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="d"
                type="number"
                domain={[curveMin, 15]}
                allowDataOverflow
                ticks={Array.from({ length: Math.floor((15 - curveMin) / 5) + 1 }, (_, i) => curveMin + i * 5)}
                tick={{ fill: C.mut, fontSize: 11, fontFamily: MONO }}
                tickFormatter={(v) => v + '%'}
                stroke={C.border2}
              />
              <YAxis
                tick={{ fill: C.mut, fontSize: 11, fontFamily: MONO }}
                tickFormatter={(v) => (plPct ? fmtN(v, 0) + '%' : (v / 1000).toFixed(0) + 'k')}
                stroke={C.border2}
                width={52}
              />
              <RTooltip
                contentStyle={{
                  background: '#1C2030',
                  border: `1px solid ${C.border2}`,
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontSize: 12,
                }}
                labelFormatter={(v: number) => 'Mercato ' + sgn(v, 1) + '%'}
                formatter={(v: number, n: string) => [plPct ? fmtN(v, 2) + '%' : fmtEUR(v), n]}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: SANS }} />
              <ReferenceLine
                x={0}
                stroke={C.mut}
                strokeDasharray="2 4"
                label={{ value: 'attuale', fill: C.mut, fontSize: 10, fontFamily: MONO, position: 'insideTopRight' }}
              />
              {ruinX != null && (
                <ReferenceLine
                  x={ruinX}
                  stroke={C.dn}
                  strokeWidth={2.5}
                  label={(props: { viewBox?: { x?: number; y?: number; height?: number } }) => {
                    const vb = props.viewBox || {};
                    const lx = (vb.x ?? 0) + 7;
                    const ly = (vb.y ?? 0) + 8;
                    const tShock = betaPort * (ruinX as number);
                    return (
                      <g>
                        <rect x={lx} y={ly} width={190} height={50} rx={5} fill="#1C2030" stroke={C.dn} strokeWidth={1} />
                        <text x={lx + 8} y={ly + 16} fill={C.dn} fontFamily={MONO} fontSize={10.5} fontWeight={700}>
                          Rovina (−100% patrim.)
                        </text>
                        <text x={lx + 8} y={ly + 30} fill={C.text} fontFamily={MONO} fontSize={10}>
                          shock mercato {sgn(ruinX as number, 1)}%
                        </text>
                        <text x={lx + 8} y={ly + 43} fill={C.text} fontFamily={MONO} fontSize={10}>
                          shock titoli {sgn(tShock, 1)}%
                        </text>
                      </g>
                    );
                  }}
                />
              )}
              {marginCallX != null && (
                <ReferenceLine
                  x={marginCallX}
                  stroke="#A855F7"
                  strokeWidth={2.5}
                  strokeDasharray="7 4"
                  label={(props: { viewBox?: { x?: number; y?: number; height?: number } }) => {
                    const vb = props.viewBox || {};
                    const lx = (vb.x ?? 0) + 7;
                    const ly = (vb.y ?? 0) + 64; // sotto l'eventuale badge di rovina
                    const tShock = betaPort * (marginCallX as number);
                    return (
                      <g>
                        <rect x={lx} y={ly} width={248} height={50} rx={5} fill="#1C2030" stroke="#A855F7" strokeWidth={1} />
                        <text x={lx + 8} y={ly + 16} fill="#A855F7" fontFamily={MONO} fontSize={10.5} fontWeight={700}>
                          Margin call (marg. &gt; cash+bond·95%)
                        </text>
                        <text x={lx + 8} y={ly + 30} fill={C.text} fontFamily={MONO} fontSize={10}>
                          shock mercato {sgn(marginCallX as number, 1)}%
                        </text>
                        <text x={lx + 8} y={ly + 43} fill={C.text} fontFamily={MONO} fontSize={10}>
                          shock titoli {sgn(tShock, 1)}%
                        </text>
                      </g>
                    );
                  }}
                />
              )}
              <ReferenceLine y={0} stroke={C.border2} />
              <Line type="monotone" dataKey="Totale" stroke={C.blue} strokeWidth={2.5} dot={false} />
              <Line
                type="monotone"
                dataKey="Azioni/ETF"
                stroke={C.mut}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="5 4"
              />
              <Line type="monotone" dataKey="Opzioni" stroke={C.amber} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* HEATMAP */}
      <Panel
        title="Matrice P&L totale · mercato × Δvol ATM 1M"
        collapsible
        collapsed={heatCollapsed}
        onToggle={() => setHeatCollapsed((v) => !v)}
        style={{ marginBottom: 14 }}
        info={
          <Info title="Griglia congiunta, non indipendente" w={350}>
            Ogni cella è una full revaluation con shock di mercato (colonne) e shock di vol 1M (righe) imposti
            insieme. Empiricamente spot e vol sono correlati negativamente: le celle realistiche stanno sulla
            diagonale <i>mercato giù / vol su</i> — evidenziata.
          </Info>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              fontFamily: MONO,
              fontSize: 11.5,
              minWidth: 640,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    padding: '4px 8px',
                    color: C.mut,
                    fontWeight: 400,
                    fontSize: 10,
                    textAlign: 'right',
                  }}
                >
                  Δvol ↓ · mkt →
                </th>
                {HM_D.map((x) => (
                  <th
                    key={x}
                    style={{
                      padding: '4px 8px',
                      color: x < 0 ? C.dn : x > 0 ? C.up : C.mut,
                      fontWeight: 700,
                    }}
                  >
                    {sgn(x, 0)}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HM_V.map((v, ri) => (
                <tr key={v}>
                  <td
                    style={{
                      padding: '4px 8px',
                      color: v > 0 ? C.dn : v < 0 ? C.up : C.mut,
                      fontWeight: 700,
                      textAlign: 'right',
                    }}
                  >
                    {sgn(v, 0)} pt
                  </td>
                  {HM_D.map((x, ci) => {
                    const val = heat[ri][ci];
                    const a = Math.min(0.85, (Math.abs(val) / hmMax) * 0.95 + 0.06);
                    const coherent =
                      (x < 0 &&
                        v > 0 &&
                        Math.abs(v - coupledDV1M(x)) <
                          Math.max(6, Math.abs(coupledDV1M(x)) * 0.45)) ||
                      (x === 0 && v === 0) ||
                      (x > 0 && v <= 0 && v >= coupledDV1M(x) - 5);
                    return (
                      <td
                        key={x}
                        style={{
                          padding: '5px 8px',
                          textAlign: 'right',
                          background:
                            val >= 0
                              ? `rgba(8,153,129,${a * 0.55})`
                              : `rgba(242,54,69,${a * 0.55})`,
                          color: '#fff',
                          fontWeight: 600,
                          outline: coherent ? `1.5px solid ${C.amber}` : 'none',
                          outlineOffset: -1.5,
                        }}
                      >
                        {(val / 1000).toLocaleString('it-IT', { maximumFractionDigits: 0 })}k
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: C.mut, marginTop: 8 }}>
          valori in migliaia di € · bordo <span style={{ color: C.amber }}>ambra</span> = combinazioni spot-vol
          storicamente coerenti
        </div>
      </Panel>

      {/* MARGINE */}
      <Panel
        title="Margine cassa · TIMS ibrido (strategy-based + scan sugli spread)"
        collapsible
        collapsed={marginCollapsed}
        onToggle={() => setMarginCollapsed((v) => !v)}
        style={{ marginBottom: 14 }}
        info={
          <Info title="Come viene calcolato" w={440}>
            Metodologia <b>validata su 5 portafogli reali</b> (errore medio 2,3%). Per ogni sottostante e per
            lato, max(strategy-based Reg-T, scan TIMS sui veri spread). Premio ancorato al valore reale a stato
            base, gonfiato sotto shock dal delta di rivalutazione. Azioni come copertura; ETF/ETC/oro/bond fuori.
            Min $0,375/azione sulle corte residue. R = clip(k·σ, 10%, 80%).
          </Info>
        }
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
            gap: '0 24px',
            marginBottom: 4,
          }}
        >
          <Slider
            label="Moltiplicatore scan k"
            value={kScan}
            set={setKScan}
            min={0.3}
            max={1.2}
            step={0.05}
            fmt={(v) => 'k = ' + fmtN(v, 2)}
            accent={C.amber}
            info={
              <Info title="Cos'è k (ampiezza dello scan)" w={380}>
                Fissa quanto far muovere ogni titolo nello scan TIMS, proporzionalmente alla sua vol: R = k · σ,
                tagliato fra 10% e 80%. Default 0,70 (≈3,5σ a 2 giorni), valore tarato sui margini reali.
              </Info>
            }
          />
          <Slider
            label="Range sweep FX"
            value={fxRange}
            set={setFxRange}
            min={1}
            max={6}
            step={0.25}
            fmt={(v) => '±' + fmtN(v, 2) + '%'}
            accent={C.amber}
            info={
              <Info title="Range sweep FX (solo EUR/USD)" w={320}>
                Per la sola gamba EUR/USD, che non segue il modello equity: niente floor 20%, solo scan con vol
                smorzata. ±3% è tipico per uno stress giornaliero sul cambio.
              </Info>
            }
          />
          <Slider
            label="Scan volatilità (TIMS)"
            value={ivScan}
            set={setIvScan}
            min={0}
            max={1}
            step={0.05}
            fmt={(v) => '±' + fmtN(v * 100, 0) + '% della vol'}
            accent={C.amber}
            info={
              <Info title="Range di scan della IV (TIMS)" w={400}>
                Lo scan TIMS, a ogni punto di prezzo, sposta la volatilità implicita su e giù di una frazione
                del suo livello (±ivScan·σ) e prende lo scenario peggiore. È la componente che fa "mordere" i
                calendar/diagonal con net-vega (gamba lunga lontana), che il solo scan di prezzo ignora. Si
                applica SOLO sui veri spread: nude e coperte da titoli restano Reg-T. Parametro reale del TIMS,
                non un fattore inventato. Default ±40% del livello di vol; taralo sull'eccedenza spread reale.
              </Info>
            }
          />
          <Slider
            label="Mantenimento short nude (Reg-T)"
            value={nakedPct}
            set={setNakedPct}
            min={0.15}
            max={0.4}
            step={0.01}
            fmt={(v) => fmtN(v * 100, 0) + '% del sottostante'}
            accent={C.amber}
            info={
              <Info title="Requisito di mantenimento Reg-T sulle short nude" w={400}>
                Il margine di una short nuda = premio + max(<b>pct</b>·sottostante − OTM, floor 10%). Il 20% è il
                minimo regolamentare Reg-T, ma il broker/banca lo alza sui nomi volatili (small/mid-cap tech:
                25–35%). È il parametro che governa la BASE strategy-based, cioè il "302k" della banca. Taralo
                finché la voce <i>strategy</i> nel log [MarginDiag] ≈ il Reg-T della banca; poi rifinisci lo scan
                (k / IV) sull'eccedenza spread. Default 20% (textbook).
              </Info>
            }
          />
        </div>
        <div style={{ fontSize: 10.5, color: C.mut, marginBottom: 14, fontFamily: MONO }}>
          max(<span style={{ color: C.amber }}>strategy-based</span>,{' '}
          <span style={{ color: C.amber }}>scan TIMS</span>) per lato · call coperte dai titoli: {marNow.nCov}{' '}
          gambe escluse · validato MAE 2,3% su 5 clienti reali
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 18px',
            marginBottom: 14,
            fontFamily: MONO,
            fontSize: 12,
          }}
        >
          <span style={{ color: C.mut }}>
            Attuale <span style={{ color: C.text, fontWeight: 700 }}>{fmtEUR(marNow.total)}</span>{' '}
            <span style={{ fontSize: 10.5 }}>
              (strategy {fmtN(marNow.totStrat / 1000, 0)}k + scan {fmtN(marNow.totScan / 1000, 0)}k)
            </span>
          </span>
          <span style={{ color: C.mut }}>
            @ {sgn(d, 1)}%{' '}
            <span style={{ color: marScen.total > marNow.total ? C.dn : C.up, fontWeight: 700 }}>
              {fmtEUR(marScen.total)}
            </span>{' '}
            <span style={{ fontSize: 10.5 }}>
              (strategy {fmtN(marScen.totStrat / 1000, 0)}k + scan {fmtN(marScen.totScan / 1000, 0)}k)
            </span>
          </span>
          <span style={{ color: C.mut }}>
            incidenza su cash+bond·95%{' '}
            <span style={{ color: C.text, fontWeight: 700 }}>
              {marginCover > 0 ? fmtN((marNow.total / marginCover) * 100, 0) : '—'}% →{' '}
              {marginCover > 0
                ? fmtN((marScen.total / Math.max(marginCover, 1)) * 100, 0)
                : '—'}
              %
            </span>
          </span>
          <span style={{ color: C.mut }}>
            margin call (marg. &gt; cash+bond·95%){' '}
            <span style={{ fontWeight: 700, color: marginCallX != null ? '#A855F7' : C.text }}>
              {marginCallX != null ? `@ mercato ${sgn(marginCallX, 1)}%` : 'non raggiunta entro −95%'}
            </span>
          </span>
        </div>
        <div style={{ width: '100%', height: 200, marginBottom: 14 }}>
          <ResponsiveContainer>
            <LineChart data={marCurve} margin={{ top: 6, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="d"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: C.mut, fontSize: 11, fontFamily: MONO }}
                tickFormatter={(v) => v + '%'}
                stroke={C.border2}
              />
              <YAxis
                tick={{ fill: C.mut, fontSize: 11, fontFamily: MONO }}
                tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'}
                stroke={C.border2}
                width={52}
              />
              <RTooltip
                contentStyle={{
                  background: '#1C2030',
                  border: `1px solid ${C.border2}`,
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontSize: 12,
                }}
                labelFormatter={(v: number) => 'Mercato ' + sgn(v, 1) + '%'}
                formatter={(v: number) => [fmtEUR(v), 'Margine richiesto']}
              />
              <ReferenceLine x={d} stroke={C.amber} strokeDasharray="4 3" />
              <ReferenceLine
                y={marNow.total}
                stroke={C.mut}
                strokeDasharray="2 4"
                label={{ value: 'attuale', fill: C.mut, fontSize: 10, position: 'insideTopRight' }}
              />
              {marginCover > 0 && (
                <ReferenceLine
                  y={marginCover}
                  stroke="#A855F7"
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: 'copertura: cash + bond·95%',
                    fill: '#A855F7',
                    fontSize: 10,
                    fontFamily: MONO,
                    position: 'insideBottomRight',
                  }}
                />
              )}
              {marginCallX != null && (
                <ReferenceLine
                  x={marginCallX}
                  stroke="#A855F7"
                  strokeWidth={2}
                  strokeDasharray="7 4"
                  label={{
                    value: `margin call ${sgn(marginCallX, 1)}%`,
                    fill: '#A855F7',
                    fontSize: 10,
                    fontFamily: MONO,
                    position: 'insideTopLeft',
                  }}
                />
              )}
              <Line type="monotone" dataKey="Margine" stroke={C.dn} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ ...lbl, marginBottom: 8 }}>
          Maggiori assorbimenti per sottostante · attuale → scenario
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
            gap: '6px 18px',
            fontFamily: MONO,
            fontSize: 11.5,
          }}
        >
          {marScen.bd.slice(0, 12).map((b) => {
            const cur = marNow.bd.find((x) => x.u === b.u);
            const c0 = cur ? cur.mar : 0;
            return (
              <div
                key={b.u}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottom: `1px solid ${C.border}`,
                  padding: '3px 0',
                }}
                title={`@ scenario: strategy ${fmtN(b.strat / 1000, 0)}k + scan ${fmtN(b.scan / 1000, 0)}k`}
              >
                <span
                  style={{
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.u}
                </span>
                <span style={{ color: C.mut, flexShrink: 0 }}>
                  {fmtN(c0 / 1000, 0)}k →{' '}
                  <span style={{ color: b.mar > c0 * 1.05 ? C.dn : C.text, fontWeight: 700 }}>
                    {fmtN(b.mar / 1000, 0)}k
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* DETTAGLIO PER SOTTOSTANTE */}
      <Panel
        title={`Dettaglio per sottostante · scenario corrente (${sgn(d, 1)}% / ${sgn(dV1M, 1)} pt)`}
        style={{ marginBottom: 14 }}
        info={
          <Info title="La vista che riconcilia tutto" w={400}>
            Per ogni sottostante: beta usato, spot e spot nello scenario, controvalore titoli,
            P&L titoli e P&L opzioni. <b>P&L titoli = Ctv × (β × shock%)</b>; passa il mouse sulla riga
            per il calcolo completo. Il beta <b>TOTALE</b> è la media dei beta pesata per l'esposizione
            (|ctv| + nozionale opzioni): in modalità <b>titoli</b> ogni beta è 1 → totale 1,00. La somma
            riconcilia con le card in alto. I beta sono modificabili nel pannello "Sottostanti".
          </Info>
        }
      >
        <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
          <table
            style={{
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontFamily: MONO,
              fontSize: 11.5,
              width: '100%',
              minWidth: 920,
            }}
          >
            <thead>
              <tr>
                {[
                  { h: 'Sottostante', k: 'nm' },
                  { h: 'β', k: 'beta' },
                  { h: 'Spot', k: 'spot' },
                  { h: 'Spot scen.', k: 'spotScen' },
                  { h: 'Mossa %', k: 'move' },
                  { h: 'Ctv titoli €', k: 'ctv' },
                  { h: 'Gambe opz.', k: 'nLegs' },
                  { h: 'P&L titoli €', k: 'pnlEq' },
                  { h: 'P&L opzioni €', k: 'pnlOpt' },
                  { h: 'P&L totale €', k: 'tot' },
                ].map((c, i) => (
                  <th
                    key={c.h}
                    onClick={() =>
                      setUndSort((s) =>
                        s.col === c.k
                          ? { col: c.k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                          : { col: c.k, dir: c.k === 'nm' ? 'asc' : 'desc' },
                      )
                    }
                    title="Clicca per ordinare"
                    style={{
                      color: undSort.col === c.k ? C.cyan : C.mut,
                      fontWeight: 600,
                      fontSize: 10,
                      textTransform: 'uppercase',
                      textAlign: i === 0 ? 'left' : 'right',
                      position: 'sticky',
                      top: 0,
                      background: C.panel,
                      zIndex: 5,
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.h}
                    {undSort.col === c.k ? (undSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {undView.map((o) => {
                const moveP = (o.beta ?? 0) * d; // mossa del sottostante in %
                const spot1 = o.spot != null ? o.spot * (1 + moveP / 100) : null;
                const sEUR = (x: number) => (x > 0 ? '+' : '') + fmtN(x, 0);
                const tip =
                  `${o.nm}\n` +
                  `Mossa sottostante = β ${fmtN(o.beta ?? 0, 2)} × ${sgn(d, 1)}% = ${sgn(moveP, 2)}%\n` +
                  (o.spot != null ? `Spot ${fmtN(o.spot, 2)} → ${fmtN(spot1 as number, 2)}\n` : '') +
                  `P&L titoli = Ctv ${fmtN(o.ctv, 0)} € × (${sgn(moveP, 2)}%) = ${sEUR(o.pnlEq)} €\n` +
                  `P&L opzioni = somma di ${o.nLegs} gambe = ${sEUR(o.pnlOpt)} € (dettaglio nella tabella per gamba)\n` +
                  `P&L totale = ${sEUR(o.tot ?? 0)} €`;
                return (
                  <tr key={o.key} title={tip} style={{ cursor: 'help' }}>
                    <td style={{ fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {o.nm}
                    </td>
                    <td style={{ textAlign: 'right', color: C.cyan, fontWeight: 700 }}>
                      {o.beta != null ? fmtN(o.beta, 2) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>
                      {o.spot != null ? fmtN(o.spot, o.spot < 5 ? 3 : 2) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>
                      {spot1 != null ? fmtN(spot1, spot1 < 5 ? 3 : 2) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: o.beta != null ? pnlColor(moveP) : C.mut }}>
                      {o.beta != null ? sgn(moveP, 2) + '%' : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>{o.ctv ? fmtN(o.ctv, 0) : '—'}</td>
                    <td style={{ textAlign: 'right', color: C.mut }}>{o.nLegs || '—'}</td>
                    <td style={{ textAlign: 'right', color: pnlColor(o.pnlEq) }}>
                      {o.pnlEq ? (o.pnlEq > 0 ? '+' : '') + fmtN(o.pnlEq, 0) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: pnlColor(o.pnlOpt) }}>
                      {o.pnlOpt ? (o.pnlOpt > 0 ? '+' : '') + fmtN(o.pnlOpt, 0) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(o.tot ?? 0) }}>
                      {((o.tot ?? 0) > 0 ? '+' : '') + fmtN(o.tot ?? 0, 0)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: C.panel2 }}>
                <td style={{ fontWeight: 800, color: C.text }}>TOTALE</td>
                <td
                  style={{ textAlign: 'right', color: C.cyan, fontWeight: 800, cursor: 'help' }}
                  title={"Media dei beta di riga pesata per l'esposizione (|ctv titoli| + nozionale opzioni). In modalità titoli ogni beta è 1 → 1,00."}
                >
                  {fmtN(totBetaWeighted, 2)}
                </td>
                <td></td>
                <td></td>
                <td></td>
                <td style={{ textAlign: 'right', color: C.mut, fontWeight: 700 }}>
                  {fmtN(undTable.reduce((a, o) => a + o.ctv, 0), 0)}
                </td>
                <td style={{ textAlign: 'right', color: C.mut, fontWeight: 700 }}>{legs.length}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(scen.eqEUR) }}>
                  {(scen.eqEUR > 0 ? '+' : '') + fmtN(scen.eqEUR, 0)}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(scen.optEUR) }}>
                  {(scen.optEUR > 0 ? '+' : '') + fmtN(scen.optEUR, 0)}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(scen.totEUR) }}>
                  {(scen.totEUR > 0 ? '+' : '') + fmtN(scen.totEUR, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* DETTAGLIO PER GAMBA */}
      <Panel
        title={`Dettaglio per gamba · scenario corrente (${sgn(d, 1)}% / ${sgn(dV1M, 1)} pt)`}
        info={
          <Info title="Cosa succede a ogni opzione" w={360}>
            Per ogni gamba: IV di partenza (implicita dal prezzo di mercato via bisezione) → IV nello scenario.
            Il flag ⚑ indica gambe deep-ITM quotate sotto l'intrinseco: IV non ricavabile, sostituita con la
            mediana del sottostante.
          </Info>
        }
      >
        <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
          <table
            style={{
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontFamily: MONO,
              fontSize: 11.5,
              width: '100%',
              minWidth: 760,
            }}
          >
            <thead>
              <tr>
                {[
                  { h: 'Sottostante', k: 'ticker' },
                  { h: 'Gamba', k: 'gamba' },
                  { h: 'Qtà', k: 'q' },
                  { h: 'Spot → scen.', k: 'spot' },
                  { h: 'IV base', k: 'sig0' },
                  { h: 'IV scen.', k: 'sig1' },
                  { h: 'ΔIV', k: 'dIV' },
                  { h: 'Px base', k: 'p0' },
                  { h: 'Px scen.', k: 'p1' },
                  { h: 'P&L €', k: 'pnl' },
                ].map((c, i) => (
                  <th
                    key={c.h}
                    onClick={() =>
                      setLegSort((s) =>
                        s.col === c.k
                          ? { col: c.k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                          : { col: c.k, dir: c.k === 'ticker' || c.k === 'gamba' ? 'asc' : 'desc' },
                      )
                    }
                    title="Clicca per ordinare"
                    style={{
                      color: legSort.col === c.k ? C.cyan : C.mut,
                      fontWeight: 600,
                      fontSize: 10,
                      textTransform: 'uppercase',
                      textAlign: i < 2 ? 'left' : 'right',
                      position: 'sticky',
                      top: 0,
                      background: C.panel,
                      zIndex: 5,
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.h}
                    {legSort.col === c.k ? (legSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((rr) => {
                const l = rr.leg;
                const expS = l.exp.slice(2).split('-');
                const und = undersActive[l.u];
                const S0 = und ? und.S : null;
                const betaL = und ? und.beta : 0;
                const moveP = betaL * d;
                const S1 = S0 != null ? S0 * Math.max(0.02, 1 + moveP / 100) : null;
                const isCall = l.cp === 'C';
                const kFmt = fmtN(l.K, l.K < 5 ? 3 : 2);
                const sEUR = (x: number) => (x > 0 ? '+' : '') + fmtN(x, 0);
                const header = `${l.u} ${isCall ? 'CALL' : 'PUT'} K${fmtN(l.K, l.K < 5 ? 3 : 0)} ${expS[1]}/${expS[0]} · q ${l.q}`;
                const spotLine =
                  S0 != null
                    ? `Spot ${fmtN(S0, 2)} → ${fmtN(S1 as number, 2)}  (β ${fmtN(betaL, 2)} × ${sgn(d, 1)}% = ${sgn(moveP, 2)}%)`
                    : '';
                const intr = (S: number) =>
                  isCall ? `max(0, ${fmtN(S, 2)} − ${kFmt})` : `max(0, ${kFmt} − ${fmtN(S, 2)})`;
                let valBlock: string;
                let pxLabel: string;
                if (rr.atIntrinsic) {
                  pxLabel = 'intrinseco';
                  const why = rr.netted
                    ? 'NETTING EX CC E NP: valore = INTRINSECO a scadenza, NON il prezzo di mercato (niente time-value né vol).'
                    : 'Prezzo di riferimento sotto l\'intrinseco: gamba quotata a INTRINSECO (delta 1).';
                  const interp = isCall
                    ? l.q < 0
                      ? 'Call venduta: scendendo l\'intrinseco cala → guadagno, che compensa i titoli FINCHÉ si resta sopra lo strike.'
                      : 'Call comprata: l\'intrinseco esiste solo sopra lo strike.'
                    : l.q < 0
                      ? 'Put venduta: l\'intrinseco cresce solo SOTTO lo strike → è lì che iniziano le perdite.'
                      : 'Put comprata: protegge sotto lo strike (l\'intrinseco cresce).';
                  valBlock =
                    `${why}\n` +
                    `Intrinseco ${isCall ? 'CALL = max(0, spot − K)' : 'PUT = max(0, K − spot)'}\n` +
                    `  base: ${S0 != null ? intr(S0) : '—'} = ${fmtN(rr.p0, 2)}\n` +
                    `  scen: ${S1 != null ? intr(S1 as number) : '—'} = ${fmtN(rr.p1, 2)}\n` +
                    `${interp}`;
                } else {
                  pxLabel = 'Px';
                  valBlock =
                    `IV ${fmtN(rr.sig0 * 100, 1)}% → ${fmtN(rr.sig1 * 100, 1)}%   T ${fmtN(l.T, 3)} anni   r ${fmtN(r * 100, 2)}%\n` +
                    `Prezzo opzione Black-Scholes (USD): ${fmtN(rr.p0, 4)} → ${fmtN(rr.p1, 4)}`;
                }
                const tip =
                  `${header}\n` +
                  (spotLine ? `${spotLine}\n` : '') +
                  `${valBlock}\n` +
                  `P&L = q(${l.q}) × ${l.mult} × (${pxLabel}_scen − ${pxLabel}_base) / EURUSD(${fmtN(fx.USD, 4)})\n` +
                  `    = ${l.q} × ${l.mult} × (${fmtN(rr.p1, 4)} − ${fmtN(rr.p0, 4)}) / ${fmtN(fx.USD, 4)} = ${sEUR(rr.pnlEUR)} €`;
                return (
                  <tr key={rr.i} title={tip} style={{ cursor: 'help' }}>
                    <td style={{ color: C.text, fontWeight: 700 }}>
                      {l.u}
                      {l.fl ? (
                        <span
                          style={{ color: C.amber }}
                          title="prezzo di riferimento sotto l'intrinseco: gamba quotata a intrinseco (delta 1)"
                        >
                          {' '}
                          ⚑
                        </span>
                      ) : (
                        ''
                      )}
                      {rr.atIntrinsic ? (
                        <span
                          style={{ color: C.amber, fontSize: 9, fontWeight: 800 }}
                          title={
                            rr.netted
                              ? 'gamba corta valutata a intrinseco (Netting Intrinseco A)'
                              : 'gamba valutata a intrinseco (prezzo sotto intrinseco)'
                          }
                        >
                          {' '}
                          INT
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td style={{ color: C.mut }}>
                      <span style={{ color: l.cp === 'C' ? C.cyan : C.amber, fontWeight: 700 }}>
                        {l.cp === 'C' ? 'CALL' : 'PUT'}
                      </span>{' '}
                      {fmtN(l.K, l.K < 5 ? 3 : 0)} · {expS[1]}/{expS[0]}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: l.q < 0 ? C.dn : C.up,
                        fontWeight: 700,
                      }}
                    >
                      {l.q > 0 ? '+' : ''}
                      {l.q}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>
                      {S0 != null
                        ? `${fmtN(S0, S0 < 5 ? 3 : 2)} → ${fmtN(S1 as number, (S1 as number) < 5 ? 3 : 2)}`
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>
                      {rr.atIntrinsic ? '—' : fmtN(rr.sig0 * 100, 1)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {rr.atIntrinsic ? '—' : fmtN(rr.sig1 * 100, 1)}
                    </td>
                    <td style={{ textAlign: 'right', color: rr.dIV >= 0 ? C.dn : C.up }}>
                      {rr.atIntrinsic ? '—' : sgn(rr.dIV, 1)}
                    </td>
                    <td style={{ textAlign: 'right', color: C.mut }}>{fmtN(rr.p0, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtN(rr.p1, 2)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(rr.pnlEUR) }}>
                      {rr.pnlEUR > 0 ? '+' : ''}
                      {fmtEUR(rr.pnlEUR)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* UNDERLYINGS */}
      <div
        onClick={() => setShowUnd(!showUnd)}
        style={{ ...lbl, cursor: 'pointer', color: C.blue, margin: '14px 0 8px' }}
      >
        {showUnd ? '▾' : '▸'} spot e beta dei sottostanti (modificabili)
        <Info title="Da dove vengono spot e beta" w={340}>
          Gli spot dei titoli in portafoglio vengono dai prezzi del giorno. I beta sono presi da{' '}
          <code>ticker_fundamentals</code> (sorgente Yahoo Finance/GuruFocus, refresh mensile). Modificare un
          beta qui aggiorna sia le opzioni sia la posizione in titoli ed è SOLO sessione corrente: per
          aggiornare il dato persistente, esegui un refresh dal pannello admin.
        </Info>
      </div>
      {showUnd && (
        <Panel>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))',
              gap: 8,
            }}
          >
            {Object.entries(unders).map(([u, o]) => (
              <div
                key={u}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: MONO,
                  fontSize: 12,
                }}
              >
                <span style={{ width: 62, fontWeight: 700 }}>{u}</span>
                <input
                  value={o.S}
                  type="number"
                  step="any"
                  onChange={(e) =>
                    setUndersOverride((p) => ({
                      ...p,
                      [u]: { ...o, S: parseFloat(e.target.value) || o.S },
                    }))
                  }
                  style={{
                    width: 70,
                    background: C.panel2,
                    border: `1px solid ${C.border2}`,
                    color: C.text,
                    borderRadius: 4,
                    padding: '3px 5px',
                    fontFamily: MONO,
                    fontSize: 11.5,
                  }}
                />
                <span style={{ color: C.mut, fontSize: 10 }}>β</span>
                <input
                  value={o.beta}
                  type="number"
                  step="0.1"
                  onChange={(e) =>
                    setUndersOverride((p) => ({
                      ...p,
                      [u]: { ...o, beta: parseFloat(e.target.value) || 0 },
                    }))
                  }
                  style={{
                    width: 48,
                    background: C.panel2,
                    border: `1px solid ${C.border2}`,
                    color: C.text,
                    borderRadius: 4,
                    padding: '3px 5px',
                    fontFamily: MONO,
                    fontSize: 11.5,
                  }}
                />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div
        style={{
          fontSize: 10.5,
          color: C.mut,
          marginTop: 16,
          lineHeight: 1.6,
          maxWidth: 900,
        }}
      >
        Limiti del modello: pricing europeo (le americane deep-ITM sono approssimate), dividendi non modellati,
        cambio EUR/USD pari allo spot EURUSD nel pannello sottostanti, liquidità, bond e oro fuori dallo shock
        equity. Il margine usa la metodologia ibrida validata (strategy-based + scan TIMS, MAE 2,3% su 5
        clienti reali). <b>Strumento di analisi, non consulenza.</b>
      </div>
    </div>
  );
}

/* ============================== PAGE WRAPPER ============================== */

export function RiskSimulator() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FlaskConical className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold">Stress Lab</h1>
          </div>
          <AppHeaderMenu />
        </div>
      </header>
      <main className="container mx-auto px-4 py-4">
        <ErrorBoundary title="Errore nel caricamento dello Stress Lab">
          <StressLabContent />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default RiskSimulator;
