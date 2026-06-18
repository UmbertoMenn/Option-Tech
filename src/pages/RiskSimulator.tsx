/**
 * RiskSimulator — Stress Lab integrato nel portafoglio dell'utente.
 *
 * Tutta la matematica vive in src/lib/stressLab.ts (puro).
 * I dati arrivano da src/hooks/useStressLab.ts (orchestrazione DB+cache).
 * Questa pagina è SOLO UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { AppHeaderMenu } from '@/components/layout/AppHeaderMenu';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useStressLab, StressLabInputs } from '@/hooks/useStressLab';
import {
  runScenario,
  occMargin,
  coupledDV1M,
  termFactor,
  T0M,
  StressUnderlyingMap,
} from '@/lib/stressLab';

/* ============================== THEME ============================== */
const C = {
  bg: '#0B0E14',
  panel: '#131722',
  panel2: '#171B26',
  border: '#1E222D',
  border2: '#2A2E39',
  text: '#D1D4DC',
  mut: '#787B86',
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 6 }}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        style={{
          cursor: 'pointer',
          width: 15,
          height: 15,
          borderRadius: '50%',
          border: `1px solid ${open ? C.blue : C.border2}`,
          color: open ? C.blue : C.mut,
          fontSize: 10,
          lineHeight: '13px',
          textAlign: 'center',
          fontFamily: SANS,
          fontStyle: 'italic',
          fontWeight: 700,
          userSelect: 'none',
          flexShrink: 0,
        }}
        title="spiegazione"
      >
        i
      </span>
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 999,
            top: 20,
            [right || w >= 400 ? 'right' : 'left']: -10,
            width: w,
            maxWidth: 'min(88vw, 420px)',
            background: '#1C2030',
            border: `1px solid ${C.border2}`,
            borderRadius: 8,
            padding: '12px 14px',
            boxShadow: '0 12px 32px rgba(0,0,0,.55)',
            fontSize: 12,
            lineHeight: 1.55,
            color: C.text,
            fontFamily: SANS,
            fontWeight: 400,
            textAlign: 'left',
            whiteSpace: 'normal',
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          <div style={{ color: C.blue, fontWeight: 700, marginBottom: 5, fontSize: 12 }}>
            {title}
          </div>
          {children}
        </div>
      )}
    </span>
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
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: accent, height: 4 }}
      />
    </div>
  );
}

function Panel({
  title,
  info,
  children,
  style,
}: {
  title?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
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
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {title}
          {info}
        </div>
      )}
      {children}
    </div>
  );
}

function Toggle({
  active,
  set,
  label,
  info,
  accent = C.blue,
}: {
  active: boolean;
  set: (v: boolean) => void;
  label: string;
  info?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        background: active ? `${accent}14` : C.panel2,
        border: `1px solid ${active ? accent : C.border2}`,
        borderRadius: 7,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: active ? accent : C.mut,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {label}
        {info}
      </span>
      <button
        onClick={() => set(!active)}
        style={{
          width: 38,
          height: 20,
          borderRadius: 10,
          border: `1px solid ${active ? accent : C.border2}`,
          background: active ? `${accent}4D` : C.panel,
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
            left: active ? 20 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: active ? accent : C.mut,
            transition: 'left .15s',
          }}
        />
      </button>
    </div>
  );
}

/* ============================== STRESS LAB CONTENT ============================== */

function StressLabContent() {
  /* ---------- Toggle patrimonio / GP ---------- */
  const [includeBonds, setIncludeBonds] = useState(true);
  const [includeCash, setIncludeCash] = useState(true);
  const [includeCommodity, setIncludeCommodity] = useState(true);
  const [includeGPInPatrimony, setIncludeGPInPatrimony] = useState(false);
  const [includeGPInShock, setIncludeGPInShock] = useState(false);

  const inputs: StressLabInputs = useMemo(
    () => ({
      includeBonds,
      includeCash,
      includeCommodity,
      includeGPInPatrimony,
      includeGPInShock,
    }),
    [includeBonds, includeCash, includeCommodity, includeGPInPatrimony, includeGPInShock],
  );

  const data = useStressLab(inputs);

  /* ---------- Override editabili dei sottostanti ---------- */
  const [unders, setUnders] = useState<StressUnderlyingMap>({});

  // Quando arrivano nuovi underlyings dall'hook, resetto solo i nuovi (preservo gli edit fatti dall'utente).
  // IMPORTANTE: dipendiamo da una FIRMA STABILE (chiavi + valori baseline serializzati), non dal
  // riferimento dell'oggetto `data.baselineUnders`, che cambia a ogni render dell'hook e causerebbe
  // un loop infinito di setState ("Maximum update depth exceeded").
  const baselineSig = useMemo(() => {
    const keys = Object.keys(data.baselineUnders).sort();
    return keys
      .map((k) => `${k}:${data.baselineUnders[k].S.toFixed(4)}:${data.baselineUnders[k].beta.toFixed(4)}`)
      .join('|');
  }, [data.baselineUnders]);

  useEffect(() => {
    setUnders((prev) => {
      const next: StressUnderlyingMap = { ...prev };
      let changed = false;
      for (const [k, v] of Object.entries(data.baselineUnders)) {
        if (!next[k]) { next[k] = v; changed = true; }
      }
      for (const k of Object.keys(next)) {
        if (!data.baselineUnders[k]) { delete next[k]; changed = true; }
      }
      return changed ? next : prev; // niente nuovo riferimento se nulla è cambiato → niente re-render inutile
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineSig]);

  /* ---------- Slider scenario ---------- */
  const [d, setD] = useState(-15);
  const [volMode, setVolMode] = useState<'auto' | 'manual'>('auto');
  const [dVman, setDVman] = useState(15);
  const [days, setDays] = useState(0);
  const [skewB, setSkewB] = useState(-0.018);
  const [kappa, setKappa] = useState(0.6);
  const [pExp, setPExp] = useState(0.5);
  const [showAdv, setShowAdv] = useState(false);
  const [showUnd, setShowUnd] = useState(false);
  const [netting, setNetting] = useState(false);
  const [kScan, setKScan] = useState(0.7);
  const [fxRange, setFxRange] = useState(3);
  const [ivScan, setIvScan] = useState(0.4);
  const [nakedPct, setNakedPct] = useState(0.2);

  const { legs, eq, fx, effIV, ptfBaseMTM, nettingTotal, nettingExCCAndNP, riskFree } = data;
  const r = riskFree;
  const prm = useMemo(
    () => ({ r, skewB, kappa, pExp, days, fx, netting }),
    [r, skewB, kappa, pExp, days, fx, netting],
  );

  const dV1M = volMode === 'auto' ? coupledDV1M(d) : dVman;

  const scen = useMemo(
    () => runScenario(legs, eq, unders, effIV, d, dV1M, prm),
    [legs, eq, unders, effIV, d, dV1M, prm],
  );

  /* ---------- Patrimonio di riferimento = NETTING della dashboard ----------
   * Il patrimonio (denominatore di P&L% e beta, e valore mostrato) è il NETTING
   * TOTALE quando il toggle è spento, il NETTING EX CC E NP quando è acceso.
   * Stessa identica metrica e stesso motore della dashboard, così i numeri
   * coincidono ovunque. ptfBaseMTM resta disponibile solo per riferimento/debug.
   */
  const ptfBase = netting ? nettingExCCAndNP : nettingTotal;

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

  /* ---------- Margine cassa ---------- */
  const { marNow, marScen, marCurve, marPnlMTM } = useMemo(() => {
    const fxR = fxRange / 100;
    const marPrm = { r, fxUSD: fx.USD, kScan, fxRange: fxR, skewB, kappa, pExp, ivScan, nakedPct };
    const bp = { r, skewB, kappa, pExp, days: 0, fx, netting: false };
    const base = runScenario(legs, eq, unders, effIV, 0, 0, bp);
    const sig0s: Record<number, number> = {};
    base.rows.forEach((x) => (sig0s[x.i] = x.sig0));
    const now = occMargin(legs, eq, unders, 0, sig0s, 0, marPrm);

    // Diagnostica margine iniziale: scomposizione per sottostante (strategy vs scan),
    // call coperte dai titoli, range di scan. Serve a capire DOVE il margine risulta
    // troppo basso rispetto al broker (es. short trattata come coperta, scan azzerato).
    try {
      console.log('[MarginDiag] Margine iniziale totale (EUR):', Math.round(now.total),
        '| Reg-T puro:', Math.round(now.totRegT),
        '| strategy:', Math.round(now.totStrat), '| scan:', Math.round(now.totScan),
        '| call coperte da titoli:', now.nCov,
        '| kScan:', kScan, '| ivScan:', ivScan, '| nakedPct:', nakedPct);
      console.table(
        now.bd.map((b) => ({
          sottostante: b.u,
          margine_EUR: Math.round(b.mar),
          strategy_EUR: Math.round(b.strat),
          scan_EUR: Math.round(b.scan),
          range_scan: +(b.R * 100).toFixed(1) + '%',
        })),
      );
      // Dettaglio gambe per sottostante (qty firmata, strike, scadenza)
      console.log('[MarginDiag] Gambe opzioni:', legs.map((l) => ({
        u: l.u, cp: l.cp, q: l.q, K: l.K, T_anni: +l.T.toFixed(3), px: l.px,
      })));
      console.log('[MarginDiag] Titoli (per copertura call):', eq.map((s) => ({
        tick: s.tick, q: s.q,
      })));
    } catch (e) {
      console.error('[MarginDiag] log error', e);
    }
    const cur = runScenario(legs, eq, unders, effIV, d, dV1M, { ...bp, days });
    const sigDs: Record<number, number> = {};
    cur.rows.forEach((x) => (sigDs[x.i] = x.sig1));
    const sc = occMargin(legs, eq, unders, d, sigDs, days, marPrm);
    const pts: { d: number; Margine: number }[] = [];
    for (let x = -35; x <= 15.01; x += 2.5) {
      const s = runScenario(legs, eq, unders, effIV, x, volAt(x), { ...bp, days });
      const sgs: Record<number, number> = {};
      s.rows.forEach((row) => (sgs[row.i] = row.sig1));
      pts.push({
        d: x,
        Margine: Math.round(occMargin(legs, eq, unders, x, sgs, days, marPrm).total),
      });
    }
    return { marNow: now, marScen: sc, marCurve: pts, marPnlMTM: cur.totEUR };
  }, [legs, eq, unders, effIV, d, dV1M, days, r, skewB, kappa, pExp, fx, kScan, fxRange, ivScan, nakedPct, volMode, dVman]);

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
        nm: '',
      });
    scen.eqRows.forEach((e) => {
      const o = get(e.key);
      o.beta = e.beta;
      o.ctv += e.ctv || 0;
      o.pnlEq += e.pnl;
      o.nm = e.tick || e.nm;
      if (e.tick && unders[e.tick]) o.spot = unders[e.tick].S;
    });
    scen.rows.forEach((rr) => {
      const l = legs[rr.i];
      const o = get(l.u);
      o.pnlOpt += rr.pnlEUR;
      o.nLegs += 1;
      o.nm = l.u;
      if (unders[l.u]) {
        o.beta = unders[l.u].beta;
        o.spot = unders[l.u].S;
      }
    });
    return Object.values(m)
      .map((o) => ({ ...o, tot: o.pnlEq + o.pnlOpt }))
      .sort((a, b) => Math.abs(b.tot) - Math.abs(a.tot));
  }, [scen, unders, legs]);

  /* ---------- Curva P&L vs mercato ---------- */
  const curve = useMemo(() => {
    const pts: { d: number; Totale: number; 'Azioni/ETF': number; Opzioni: number }[] = [];
    for (let x = -35; x <= 15.01; x += 2.5) {
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
  }, [legs, eq, unders, effIV, volMode, dVman, prm]);

  /* ---------- Heatmap ---------- */
  const HM_D = [-30, -25, -20, -15, -10, -5, 0, 5, 10];
  const HM_V = [40, 30, 20, 15, 10, 5, 0, -5, -10];
  const heat = useMemo(
    () => HM_V.map((v) => HM_D.map((x) => runScenario(legs, eq, unders, effIV, x, v, prm).totEUR)),
    [legs, eq, unders, effIV, prm],
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
  const tableRows = useMemo(
    () =>
      scen.rows
        .map((rr) => ({ ...rr, leg: legs[rr.i] }))
        .sort((a, b) => Math.abs(b.pnlEUR) - Math.abs(a.pnlEUR)),
    [scen, legs],
  );

  const kpi = [
    { l: 'P&L Totale', v: scen.totEUR, sub: `valore stressato ${fmtEUR(ptfBase + scen.totEUR)}` },
    { l: 'P&L Azioni / ETF', v: scen.eqEUR, sub: 'lineare via beta' },
    {
      l: 'P&L Opzioni',
      v: scen.optEUR,
      sub: netting ? '⚠ netting attivo: gambe corte a intrinseco' : 'full revaluation sticky-delta',
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
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>
          STRESS LAB <span style={{ color: C.blue }}>· STICKY-DELTA</span>
        </div>
        <div style={{ fontSize: 12, color: C.mut, fontFamily: MONO }}>
          {legs.length} gambe opzioni · {eq.length} titoli · {fmtEUR(ptfBase)}
          {netting ? (
            <span style={{ color: C.amber }}> (netting: corte a intrinseco)</span>
          ) : (
            ''
          )}
        </div>
        <Info title="Cosa fa questo strumento" w={380}>
          Riprezza <b>ogni singola opzione</b> del portafoglio (full revaluation Black-Scholes) sotto uno shock
          congiunto di mercato e volatilità. Lo smile si muove con il prezzo (regime <b>sticky-delta</b>) e la
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

      {/* PATRIMONIO TOGGLES */}
      <Panel
        title="Patrimonio — cosa includere"
        info={
          <Info title="Cosa entra nel patrimonio di riferimento" w={400}>
            Il <b>patrimonio MTM</b> è il denominatore per calcolare il P&L percentuale e il beta scenario.
            Le voci escluse dallo shock equity (bond, cash, oro) influiscono sul patrimonio ma non vengono
            shockate dal modello: la loro presenza “attutisce” il beta complessivo.
            <br />
            <br />
            <b>GP nel patrimonio</b>: somma i valori delle Gestioni Patrimoniali al patrimonio totale.
            <br />
            <b>GP nello shock</b>: applica anche alle azioni GP lo shock di mercato secondo i loro beta.
            Senza questo toggle, le GP restano statiche.
          </Info>
        }
        style={{ marginBottom: 14 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          <Toggle
            active={includeBonds}
            set={setIncludeBonds}
            label={`Bond (${fmtN(data.patrimonyBreakdown.bondsEUR / 1000, 0)}k)`}
            info={
              <Info title="Bond" w={280}>
                Inclusi nel patrimonio MTM ma <b>esclusi dallo shock equity</b> (la duration non è modellata).
                Spegnere se vuoi vedere solo l'esposizione al rischio azionario/derivati.
              </Info>
            }
            accent={C.cyan}
          />
          <Toggle
            active={includeCash}
            set={setIncludeCash}
            label={`Cash (${fmtN(data.patrimonyBreakdown.cashEUR / 1000, 0)}k)`}
            info={
              <Info title="Cash" w={280}>
                Liquidità del conto. Sempre esclusa dallo shock; spegnere per misurare l'esposizione "lorda" del
                portafoglio investito.
              </Info>
            }
            accent={C.cyan}
          />
          <Toggle
            active={includeCommodity}
            set={setIncludeCommodity}
            label={`Oro / Commodity (${fmtN(data.patrimonyBreakdown.commodityEUR / 1000, 0)}k)`}
            info={
              <Info title="Oro / Materie Prime" w={280}>
                Inclusi nel patrimonio con beta 0 (non si muovono con lo shock equity). Se vuoi che l'oro
                reagisca, modifica il suo beta nel pannello “Sottostanti”.
              </Info>
            }
            accent={C.cyan}
          />
          <Toggle
            active={includeGPInPatrimony}
            set={setIncludeGPInPatrimony}
            label={`GP nel patrimonio (${fmtN(data.patrimonyBreakdown.gpEUR / 1000, 0)}k)`}
            info={
              <Info title="GP nel patrimonio" w={300}>
                Somma i valori delle Gestioni Patrimoniali al patrimonio totale. Senza questo toggle il GP è
                considerato un asset separato (e non incide sull'incidenza del margine).
              </Info>
            }
            accent={C.amber}
          />
          <Toggle
            active={includeGPInShock}
            set={setIncludeGPInShock}
            label="GP nello shock"
            info={
              <Info title="GP nello shock equity" w={300}>
                Estende lo shock di mercato anche alle azioni delle Gestioni Patrimoniali (con i loro beta).
                Le obbligazioni GP restano sempre fuori dallo shock.
              </Info>
            }
            accent={C.amber}
          />
        </div>
      </Panel>

      {/* CONTROLS + KPI */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px,360px) 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Panel
          title="Scenario"
          info={
            <Info title="Come leggere i controlli" w={340}>
              <b>Mercato</b>: shock dell'indice azionario di riferimento; ogni titolo si muove di beta × shock.
              <br />
              <br />
              <b>Vol accoppiata (consigliata)</b>: la vol ATM a 1 mese reagisce al mercato secondo la relazione
              empirica SPX–VIX. Un −10% genera ≈ +12,5 punti; un −30% ≈ +52 punti (a marzo 2020 un −34% portò il
              VIX da ~15 a 82). Nei rialzi la vol comprime ~0,55 pt per +1%.
              <br />
              <br />
              <b>Manuale</b>: imposti tu lo shock sulla vol ATM 1M, che viene poi propagato alle altre scadenze.
            </Info>
          }
        >
          <Slider
            label="Shock mercato"
            value={d}
            set={setD}
            min={-40}
            max={20}
            step={1}
            fmt={(v) => sgn(v, 1) + '%'}
            accent={d < 0 ? C.dn : C.up}
          />
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
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              padding: '9px 10px',
              background: netting ? 'rgba(247,166,0,.08)' : C.panel2,
              border: `1px solid ${netting ? C.amber : C.border2}`,
              borderRadius: 7,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: netting ? C.amber : C.mut,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Netting Ex CC e NP
              <Info title="Netting Ex Covered Call e Naked Put" w={380}>
                Cambia il <b>criterio di valutazione delle gambe corte</b> (call coperte e put vendute):
                invece del mark-to-market, contano solo per il <b>valore intrinseco</b>. Logica "hold to expiry":
                il premio è già incassato. <b>Esempio</b>: put venduta strike 200, premio 5. Crash, spot 190, la
                put quota 25. MTM = −20; qui vedi solo −10 = intrinseco (200−190).
                <br />
                <br />
                <b>Attenzione</b>: il rischio di vol e il vero costo di chiusura anticipata spariscono. Se in un
                crash devi ricomprare le put vendute, il prezzo è il MTM, non l'intrinseco. Con il toggle attivo
                il beta al ribasso scende: non perché il rischio sia diminuito, ma perché parte del rischio non
                viene misurata.
              </Info>
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
          </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14 }}>
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
                  }}
                >
                  {k.v > 0 ? '+' : ''}
                  {fmtEUR(k.v)}
                </div>
                <div style={{ fontSize: 10.5, color: C.mut }}>{k.sub}</div>
              </Panel>
            ))}
            <Panel style={{ padding: '14px 16px' }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>
                Beta @ scenario
                <Info title="Quanto si muove il portafoglio col mercato" w={420}>
                  Se il mercato fa −10%, di quanto si muove il portafoglio? Beta 1,5 = cala una volta e mezza il
                  mercato. Le put vendute hanno <b>gamma negativo</b>: a ogni gradino di discesa pesano di più e
                  la perdita accelera. Per questo il numero cresce muovendo lo slider verso il basso.
                </Info>
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 800,
                  margin: '6px 0 2px',
                  color: betaScen >= 1.5 ? C.dn : betaScen <= 0.9 ? C.up : C.text,
                }}
              >
                {fmtN(betaScen, 2)}
                <span style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>
                  {' '}
                  @ {sgn(d, 1)}%
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.mut, fontFamily: MONO }}>
                rif. <span style={{ color: C.dn }}>{fmtN(betaDown, 2)}↓</span> ·{' '}
                <span style={{ color: C.up }}>{fmtN(betaUp, 2)}↑</span>{' '}
                <span style={{ fontSize: 10 }}>(∓10%)</span>
              </div>
            </Panel>

            <Panel style={{ padding: '14px 16px' }}>
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>
                Margine richiesto
                <Info title="Margine cassa: attuale → scenario" w={380} right>
                  Per ogni sottostante e per lato, <b>max(strategy-based, scan TIMS)</b>: il margine interno
                  (premio + 20%/floor, call coperte dai titoli escluse) e — sui soli veri spread — lo scan a
                  2 giorni con vol accoppiata. Nel crash la premium delle put vendute si gonfia, quindi il
                  margine sale proprio mentre il patrimonio si svuota.
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
            </Panel>

            <Panel
              style={{
                padding: '14px 16px',
                border: `1px solid ${
                  ptfBaseMTM > 0 &&
                  marScen.total / Math.max(ptfBaseMTM + marPnlMTM, 1) >
                    (marNow.total / ptfBaseMTM) * 1.2
                    ? C.dn
                    : C.border
                }`,
              }}
            >
              <div style={{ ...lbl, display: 'flex', alignItems: 'center' }}>
                Incidenza patrimonio
                <Info title="La metrica del margin call" w={360} right>
                  Margine richiesto / valore del portafoglio a mark-to-market. È il rapporto che fa scattare la
                  richiesta di reintegro: nel crash il numeratore cresce e il denominatore cala, quindi
                  l'incidenza accelera verso l'alto.
                </Info>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, margin: '6px 0 2px' }}>
                <span style={{ color: C.mut, fontSize: 15 }}>
                  {ptfBaseMTM > 0 ? fmtN((marNow.total / ptfBaseMTM) * 100, 0) : '—'}% →{' '}
                </span>
                <span
                  style={{
                    color:
                      ptfBaseMTM > 0 &&
                      marScen.total / Math.max(ptfBaseMTM + marPnlMTM, 1) >
                        (marNow.total / ptfBaseMTM) * 1.2
                        ? C.dn
                        : C.text,
                  }}
                >
                  {ptfBaseMTM > 0
                    ? fmtN((marScen.total / Math.max(ptfBaseMTM + marPnlMTM, 1)) * 100, 0)
                    : '—'}
                  %
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: C.mut }}>
                margine / patrimonio (MTM) · soglia margin call
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
        title="P&L vs shock di mercato (vol coerente per ogni punto)"
        style={{ marginBottom: 14 }}
        info={
          <Info title="Perché la curva delle opzioni non è una retta" w={350}>
            Ogni punto è una full revaluation: a ogni shock di mercato corrisponde la sua vol coerente. La
            convessità che vedi è il gamma/vega aggregato del book; un approccio delta×beta sarebbe la tangente
            in zero e divergerebbe proprio nelle code.
          </Info>
        }
      >
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ top: 8, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="d"
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
                formatter={(v: number, n: string) => [fmtEUR(v), n]}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: SANS }} />
              <ReferenceLine x={d} stroke={C.amber} strokeDasharray="4 3" />
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
            incidenza{' '}
            <span style={{ color: C.text, fontWeight: 700 }}>
              {ptfBaseMTM > 0 ? fmtN((marNow.total / ptfBaseMTM) * 100, 0) : '—'}% →{' '}
              {ptfBaseMTM > 0
                ? fmtN((marScen.total / Math.max(ptfBaseMTM + marPnlMTM, 1)) * 100, 0)
                : '—'}
              %
            </span>
          </span>
        </div>
        <div style={{ width: '100%', height: 200, marginBottom: 14 }}>
          <ResponsiveContainer>
            <LineChart data={marCurve} margin={{ top: 6, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="d"
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
          <Info title="La vista che riconcilia tutto" w={360}>
            Per ogni sottostante: beta, P&L titoli e P&L opzioni. La somma riconcilia con le card in alto. I
            beta sono modificabili nel pannello "Sottostanti".
          </Info>
        }
      >
        <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
          <table
            className="grid"
            style={{
              borderCollapse: 'collapse',
              fontFamily: MONO,
              fontSize: 11.5,
              width: '100%',
              minWidth: 780,
            }}
          >
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 5 }}>
                {[
                  'Sottostante',
                  'β',
                  'Spot',
                  'Ctv titoli €',
                  'Gambe opz.',
                  'P&L titoli €',
                  'P&L opzioni €',
                  'P&L totale €',
                ].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      color: C.mut,
                      fontWeight: 600,
                      fontSize: 10,
                      textTransform: 'uppercase',
                      textAlign: i === 0 ? 'left' : 'right',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {undTable.map((o) => (
                <tr key={o.key}>
                  <td style={{ fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.nm}
                  </td>
                  <td style={{ textAlign: 'right', color: C.cyan, fontWeight: 700 }}>
                    {o.beta != null ? fmtN(o.beta, 2) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: C.mut }}>
                    {o.spot != null ? fmtN(o.spot, o.spot < 5 ? 3 : 2) : '—'}
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
              ))}
              <tr style={{ background: C.panel2 }}>
                <td style={{ fontWeight: 800, color: C.text }}>TOTALE</td>
                <td style={{ textAlign: 'right', color: C.cyan, fontWeight: 800 }}>{fmtN(betaDown, 2)}↓</td>
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
            className="grid"
            style={{
              borderCollapse: 'collapse',
              fontFamily: MONO,
              fontSize: 11.5,
              width: '100%',
              minWidth: 760,
            }}
          >
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: C.panel, zIndex: 5 }}>
                {[
                  'Sottostante',
                  'Gamba',
                  'Qtà',
                  'IV base',
                  'IV scen.',
                  'ΔIV',
                  'Px base',
                  'Px scen.',
                  'P&L €',
                ].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      color: C.mut,
                      fontWeight: 600,
                      fontSize: 10,
                      textTransform: 'uppercase',
                      textAlign: i < 2 ? 'left' : 'right',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((rr) => {
                const l = rr.leg;
                const expS = l.exp.slice(2).split('-');
                return (
                  <tr key={rr.i}>
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
                              ? 'gamba corta valutata a intrinseco (Netting Ex CC e NP)'
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
                    setUnders({
                      ...unders,
                      [u]: { ...o, S: parseFloat(e.target.value) || o.S },
                    })
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
                    setUnders({
                      ...unders,
                      [u]: { ...o, beta: parseFloat(e.target.value) || 0 },
                    })
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
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold">Risk / Margin Simulator</h1>
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
