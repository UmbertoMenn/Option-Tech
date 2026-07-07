import { useState, useMemo } from "react";
import { Activity } from "lucide-react";
import { AppHeaderMenu } from "@/components/layout/AppHeaderMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { premiumDecomposition } from "@/lib/optionEdge";

/* ============================ MATH CORE ============================ */
const SQRT2PI = Math.sqrt(2 * Math.PI);
function erf(x: number): number {
  const s = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const npdf = (x: number) => Math.exp(-(x * x) / 2) / SQRT2PI;

function bsCall(S: number, K: number, T: number, r: number, q: number, sig: number) {
  if (sig <= 0 || T <= 0) return Math.max(S * Math.exp(-q * Math.max(T, 0)) - K * Math.exp(-r * Math.max(T, 0)), 0);
  const d1 = (Math.log(S / K) + (r - q + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return S * Math.exp(-q * T) * N(d1) - K * Math.exp(-r * T) * N(d2);
}
function bsPut(S: number, K: number, T: number, r: number, q: number, sig: number) {
  if (sig <= 0 || T <= 0) return Math.max(K * Math.exp(-r * Math.max(T, 0)) - S * Math.exp(-q * Math.max(T, 0)), 0);
  const d1 = (Math.log(S / K) + (r - q + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return K * Math.exp(-r * T) * N(-d2) - S * Math.exp(-q * T) * N(-d1);
}
function impliedVol(prem: number, S: number, K: number, T: number, r: number, q: number, type: "CALL" | "PUT") {
  const f = (sig: number) => (type === "CALL" ? bsCall(S, K, T, r, q, sig) : bsPut(S, K, T, r, q, sig)) - prem;
  let lo = 0.0001, hi = 5;
  if (f(lo) > 0 || f(hi) < 0) return NaN;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
function realCall(S: number, K: number, T: number, r: number, m: number, sig: number) {
  const d1 = (Math.log(S / K) + (m + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return S * Math.exp((m - r) * T) * N(d1) - K * Math.exp(-r * T) * N(d2);
}
function realPut(S: number, K: number, T: number, r: number, m: number, sig: number) {
  const d1 = (Math.log(S / K) + (m + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return K * Math.exp(-r * T) * N(-d2) - S * Math.exp((m - r) * T) * N(-d1);
}
const pAbove = (S: number, level: number, T: number, m: number, sig: number) =>
  N((Math.log(S / level) + (m - (sig * sig) / 2) * T) / (sig * Math.sqrt(T)));
function pTouch(S: number, B: number, T: number, m: number, sig: number) {
  const nu = m - (sig * sig) / 2;
  const b = Math.log(B / S);
  const v = sig * Math.sqrt(T);
  let p;
  if (B >= S) p = N((-b + nu * T) / v) + Math.exp((2 * nu * b) / (sig * sig)) * N((-b - nu * T) / v);
  else p = N((b - nu * T) / v) + Math.exp((2 * nu * b) / (sig * sig)) * N((b + nu * T) / v);
  return Math.min(Math.max(p, 0), 1);
}
function rootEV(evFn: (m: number) => number): number | null {
  let lo = -0.6, hi = 2.5;
  const a = evFn(lo), c = evFn(hi);
  if (a * c > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (evFn(mid) * evFn(lo) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function thirdFriday(y: number, mo: number) {
  const d = new Date(y, mo, 1);
  const off = (5 - d.getDay() + 7) % 7;
  return new Date(y, mo, 1 + off + 14);
}
function nextExpiries(n: number) {
  const out: Date[] = [];
  const now = new Date();
  let y = now.getFullYear(), mo = now.getMonth();
  while (out.length < n) {
    const f = thirdFriday(y, mo);
    if (f.getTime() > now.getTime() + 86400000) out.push(f);
    mo++; if (mo > 11) { mo = 0; y++; }
  }
  return out;
}

/* ============================ THEME ============================ */
// Color tokens via CSS vars (HSL channels) — switch with light/dark theme
const C = {
  bg: "hsl(var(--background))",
  panel: "hsl(var(--card))",
  panel2: "hsl(var(--background-secondary))",
  border: "hsl(var(--border))",
  text: "hsl(var(--foreground))",
  dim: "hsl(var(--muted-foreground))",
  blue: "hsl(var(--primary))",
  green: "hsl(var(--profit))",
  red: "hsl(var(--loss))",
  amber: "hsl(var(--warning))",
  teal: "hsl(var(--chart-etf))",
};
const mono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const sans = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const fmt = (x: number, d = 2) => (isFinite(x) ? x.toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const pct = (x: number, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
const CW = 720, CH = 210, PAD = 8;

/* ============================ SMALL UI ============================ */
function Field({ label, value, onChange, step = "any", suffix, hint }: any) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label} {hint && <span style={{ opacity: 0.7 }}>· {hint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <input type="number" value={value} step={step}
          onChange={(e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontFamily: mono, fontSize: 15, padding: "9px 10px", width: "100%" }} />
        {suffix && <span style={{ color: C.dim, fontSize: 13, padding: "0 10px", fontFamily: mono }}>{suffix}</span>}
      </div>
    </label>
  );
}
function InfoIcon({ info }: { info: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      style={{ position: "absolute", top: 10, right: 10, cursor: "help", color: C.dim, border: `1px solid ${C.border}`, borderRadius: "50%", width: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1, zIndex: 5 }}>
      i
      {show && (
        <div style={{ position: "absolute", top: 20, right: 0, width: 220, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 11px", fontSize: 11.5, lineHeight: 1.5, color: C.text, zIndex: 50, textTransform: "none", letterSpacing: 0, fontStyle: "normal", fontFamily: sans, fontWeight: 400, boxShadow: "0 8px 24px rgba(0,0,0,0.55)" }}>{info}</div>
      )}
    </span>
  );
}
function Metric({ label, value, sub, color = C.text, big, info, edge }: any) {
  return (
    <div style={{ position: "relative", background: C.panel, border: `1px solid ${edge ? color : C.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, paddingRight: info ? 18 : 0 }}>{label}</div>
      {info && <InfoIcon info={info} />}
      <div style={{ fontFamily: mono, fontSize: big ? 24 : 19, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.dim, marginTop: 5, fontFamily: mono }}>{sub}</div>}
    </div>
  );
}
function MetricDual({ label, a, b, aLab = "Annua", bLab = "A scadenza", color = C.text, info, edge, sub }: any) {
  return (
    <div style={{ position: "relative", background: C.panel, border: `1px solid ${edge ? color : C.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingRight: info ? 18 : 0 }}>{label}</div>
      {info && <InfoIcon info={info} />}
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{aLab}</div>
          <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color }}>{a}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${C.border}`, paddingLeft: 12 }}>
          <div style={{ fontSize: 9.5, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{bLab}</div>
          <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color: edge ? color : C.teal }}>{b}</div>
        </div>
      </div>
      {sub && <div style={{ fontSize: 11.5, color: C.dim, marginTop: 8, fontFamily: mono }}>{sub}</div>}
    </div>
  );
}
function MetricEdgeCard({ label, market, real, edge, sub, info }: {
  label: React.ReactNode; market: number; real: number; edge: number; sub: React.ReactNode; info: React.ReactNode;
}) {
  const ok = isFinite(real) && isFinite(edge);
  const col = !ok ? C.dim : edge > 0 ? C.green : C.red;
  return (
    <div style={{ position: "relative", background: C.panel, border: `1px solid ${ok ? col : C.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingRight: 18 }}>{label}</div>
      <InfoIcon info={info} />
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Mercato</div>
          <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: C.text }}>{fmt(market)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${C.border}`, paddingLeft: 12 }}>
          <div style={{ fontSize: 9.5, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Reale</div>
          <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: C.teal }}>{ok ? fmt(real) : "—"}</div>
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 21, fontWeight: 600, color: col, lineHeight: 1.1 }}>
        {ok ? (edge >= 0 ? "+" : "") + fmt(edge) : "—"}
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 5, fontFamily: mono }}>{sub}</div>
    </div>
  );
}
function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1.2, margin: "18px 0 9px", fontWeight: 600 }}>{children}</div>;
}

/* ============================ MAIN ============================ */
interface FetchInfo {
  name?: string | null;
  asof?: string | null;
  currency?: string | null;
  betaSource?: string | null;
  divYieldSource?: string | null;
}

interface RvWindow { key: string; label: string; calDays: number; value: number }
const RV_WINDOW_DEFS = [
  { key: "1m", label: "1m", calDays: 30 },
  { key: "3m", label: "3m", calDays: 91 },
  { key: "6m", label: "6m", calDays: 182 },
  { key: "1y", label: "1a", calDays: 365 },
];

export function OptionAnalyzer() {
  const isMobile = useIsMobile();
  const expiries = useMemo(() => nextExpiries(14), []);
  const [type, setType] = useState<"CALL" | "PUT">("PUT");
  const [S0, setS0] = useState(100);
  const [K, setK] = useState(90);
  const [prem, setPrem] = useState(5.0);
  const [expIdx, setExpIdx] = useState(2);
  const [RV, setRV] = useState(50);
  const [rvWindows, setRvWindows] = useState<RvWindow[] | null>(null);
  const [rvSel, setRvSel] = useState<string | null>(null);
  const [beta1y, setBeta1y] = useState(1.3);
  const [rf, setRf] = useState(4);
  const [rShort, setRShort] = useState(4);
  const [erp, setErp] = useState(5.5);
  const [q, setQ] = useState(0);
  const [buff, setBuff] = useState(1);
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState("");
  const [fetchInfo, setFetchInfo] = useState<FetchInfo | null>(null);
  const [tab, setTab] = useState<"dist" | "strike" | "drift" | "pnl">("dist");
  const [useMu, setUseMu] = useState(false);
  const [muManual, setMuManual] = useState(8);

  async function loadTicker() {
    const tk = (ticker || "").trim().toUpperCase();
    if (!tk) return;
    setLoading(true); setFetchErr(""); setFetchInfo(null);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-ticker-fundamentals", {
        body: { ticker: tk },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (typeof data.price === "number") setS0(data.price);
      if (typeof data.rv === "number") setRV(data.rv);
      if (typeof data.beta === "number") setBeta1y(data.beta);
      if (typeof data.riskFree === "number") setRf(data.riskFree);
      if (typeof data.riskFreeShort === "number") setRShort(data.riskFreeShort);
      if (typeof data.erp === "number") setErp(data.erp);
      if (typeof data.divYield === "number") setQ(Math.round(data.divYield * 100) / 100);
      // Finestre RV multiple: auto-seleziono quella più vicina all'orizzonte dell'opzione
      const ws: RvWindow[] = RV_WINDOW_DEFS
        .filter((w) => typeof data.rvWindows?.[w.key] === "number" && isFinite(data.rvWindows[w.key]))
        .map((w) => ({ ...w, value: data.rvWindows[w.key] }));
      if (ws.length) {
        setRvWindows(ws);
        const dte = Math.max(Math.round((expiries[expIdx].getTime() - Date.now()) / 86400000), 1);
        let best = ws[0];
        for (const w of ws) if (Math.abs(w.calDays - dte) < Math.abs(best.calDays - dte)) best = w;
        setRV(Math.round(best.value * 100) / 100);
        setRvSel(best.key);
      } else {
        setRvWindows(null);
        setRvSel(null);
        setFetchErr("Risposta senza finestre RV: la Edge Function fetch-ticker-fundamentals live è una versione vecchia, va rideployata.");
      }
      setFetchInfo({ name: data.name, asof: data.asof, currency: data.currency, betaSource: data.betaSource, divYieldSource: data.divYieldSource });
    } catch (e: any) {
      setFetchErr("Impossibile caricare automaticamente (" + (e?.message || e) + "). Inserisci i valori a mano.");
    }
    setLoading(false);
  }

  const calc = useMemo(() => {
    const expiry = expiries[expIdx];
    const T = Math.max((expiry.getTime() - Date.now()) / (365.25 * 86400000), 1 / 365);
    const days = Math.max(Math.round((expiry.getTime() - Date.now()) / 86400000), 0);
    // r breve (^IRX) per sconto e inversione IV delle opzioni corte; rf (10y) resta nel CAPM.
    const r = rShort / 100, sig = RV / 100;
    const beta = beta1y;
    const muCapm = rf / 100 + beta * (erp / 100);
    const mCapm = muCapm - q / 100;
    const m = useMu ? muManual / 100 : mCapm;
    const qd = q / 100;
    const iv = impliedVol(prem, S0, K, T, r, qd, type);
    const premCall = isFinite(iv) ? bsCall(S0, K, T, r, qd, iv) : NaN;
    const premPut = isFinite(iv) ? bsPut(S0, K, T, r, qd, iv) : NaN;
    const rcCall = realCall(S0, K, T, r, m, sig);
    const rcPut = realPut(S0, K, T, r, m, sig);
    const evCall = premCall - rcCall;
    const evPut = premPut - rcPut;
    const muStarCall = rootEV((mm) => premCall - realCall(S0, K, T, r, mm, sig));
    const muStarPut = rootEV((mm) => premPut - realPut(S0, K, T, r, mm, sig));
    const dren = (sig * sig) / 2;
    const mean = S0 * Math.exp(m * T);
    const median = S0 * Math.exp((m - dren) * T);
    const d2r = (Math.log(S0 / K) + (m - dren) * T) / (sig * Math.sqrt(T));
    const d2i = (Math.log(S0 / K) + (r - qd - (iv * iv) / 2) * T) / (iv * Math.sqrt(T));
    const breachReal = type === "CALL" ? N(d2r) : N(-d2r);
    const breachImpl = type === "CALL" ? N(d2i) : N(-d2i);
    const beLevel = type === "CALL" ? K + prem : K - prem;
    const gain = type === "CALL" ? 1 - pAbove(S0, beLevel, T, m, sig) : pAbove(S0, beLevel, T, m, sig);
    const x = buff / 100;
    const barrier = type === "CALL" ? K * (1 - x) : K * (1 + x);
    const inside = type === "CALL" ? S0 >= barrier : S0 <= barrier;
    const noRoll = inside ? 0 : 1 - pTouch(S0, barrier, T, m, sig);

    const decomp = premiumDecomposition({ S: S0, K, T, r, m, iv, rv: sig, q: qd, type, marketPremium: prem });

    return { T, r, qd, sig, beta, muCapm, mCapm, m, iv, premCall, premPut, rcCall, rcPut, evCall, evPut,
      muStarCall, muStarPut, dren, mean, median, breachReal, breachImpl, gain, noRoll, barrier, beLevel, expiry, days, decomp };
  }, [type, S0, K, prem, expIdx, RV, beta1y, rf, rShort, erp, q, buff, useMu, muManual, expiries]);

  const c = calc;
  const selEV = type === "CALL" ? c.evCall : c.evPut;
  const selReal = type === "CALL" ? c.rcCall : c.rcPut;
  const selMuStar = type === "CALL" ? c.muStarCall : c.muStarPut;
  const ivRv = isFinite(c.iv) ? c.iv - c.sig : NaN;
  const dirUp = c.m > c.dren;
  const rt = Math.sqrt(c.T);
  const vp = ivRv;
  const evColor = (v: number) => (v > 0 ? C.green : C.red);

  const chart = useMemo(() => {
    const muLog = Math.log(S0) + (c.m - c.dren) * c.T;
    const sd = c.sig * Math.sqrt(c.T);
    const sMin = Math.max(0.01, Math.exp(muLog - 3.6 * sd));
    const sMax = Math.exp(muLog + 3.6 * sd);
    const pts: [number, number][] = [];
    const Ns = 140;
    let ymax = 0;
    for (let i = 0; i <= Ns; i++) {
      const s = sMin + ((sMax - sMin) * i) / Ns;
      const z = (Math.log(s) - muLog) / sd;
      const y = npdf(z) / (s * sd);
      pts.push([s, y]); if (y > ymax) ymax = y;
    }
    return { pts, sMin, sMax, ymax };
  }, [S0, c.m, c.dren, c.sig, c.T]);

  const strikeData = useMemo(() => {
    if (!isFinite(c.iv)) return null;
    const lo = S0 * 0.7, hi = S0 * 1.3, n = 70, out: { K: number; edge: number; itm: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const Kx = lo + ((hi - lo) * i) / n;
      const mp = type === "CALL" ? bsCall(S0, Kx, c.T, c.r, c.qd, c.iv) : bsPut(S0, Kx, c.T, c.r, c.qd, c.iv);
      const rv = type === "CALL" ? realCall(S0, Kx, c.T, c.r, c.m, c.sig) : realPut(S0, Kx, c.T, c.r, c.m, c.sig);
      const d2r = (Math.log(S0 / Kx) + (c.m - c.dren) * c.T) / (c.sig * Math.sqrt(c.T));
      const itm = type === "CALL" ? N(d2r) : N(-d2r);
      out.push({ K: Kx, edge: mp - rv, itm });
    }
    return { pts: out, lo, hi };
  }, [S0, c.iv, c.T, c.r, c.qd, c.m, c.sig, c.dren, type]);

  const driftData = useMemo(() => {
    const lo = -0.2, hi = 0.6, n = 90, out: { mu: number; edge: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const mu = lo + ((hi - lo) * i) / n;
      const rv = type === "CALL" ? realCall(S0, K, c.T, c.r, mu, c.sig) : realPut(S0, K, c.T, c.r, mu, c.sig);
      out.push({ mu, edge: prem - rv });
    }
    return { pts: out, lo, hi };
  }, [S0, K, c.T, c.r, c.sig, type, prem]);

  const sel = { background: C.blue, color: "#fff" };
  const unsel = { background: C.panel2, color: C.dim };
  const tabs: [typeof tab, string][] = [["dist", "Distribuzione"], ["strike", "Edge vs Strike"], ["drift", "Edge vs μ"], ["pnl", "P&L a scadenza"]];

  const renderDist = () => {
    const TOP = 42, BOT = 24;
    const X = (s: number) => PAD + ((s - chart.sMin) / (chart.sMax - chart.sMin)) * (CW - 2 * PAD);
    const Y = (y: number) => CH - BOT - (y / chart.ymax) * (CH - BOT - TOP);
    const line = chart.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const side = (s: number) => (type === "CALL" ? s > K : s < K);
    const seg = chart.pts.filter((p) => side(p[0]));
    let area = "";
    if (seg.length) {
      area = `M${X(seg[0][0]).toFixed(1)},${(CH - BOT).toFixed(1)}`;
      seg.forEach((p) => (area += `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`));
      area += `L${X(seg[seg.length - 1][0]).toFixed(1)},${(CH - BOT).toFixed(1)}Z`;
    }
    const marks: any[] = [
      { s: S0, c: C.dim, d: "0", l: "oggi" },
      { s: K, c: C.amber, d: "4 3", l: "K " + fmt(K, 0) },
      { s: c.beLevel, c: C.green, d: "4 3", l: "BE " + fmt(c.beLevel, 0) },
      { s: c.median, c: C.teal, d: "1 3", l: "mediana" },
    ].filter((m) => m.s >= chart.sMin && m.s <= chart.sMax).sort((a, b) => X(a.s) - X(b.s));
    let lastX = -999, row = 0;
    marks.forEach((m) => { const x = X(m.s); if (x - lastX < 90) row = (row + 1) % 3; else row = 0; m.row = row; m.x = x; lastX = x; });
    const rowY = [12, 24, 36];
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
        {area && <path d={area} fill={C.red} opacity="0.16" />}
        <path d={line} fill="none" stroke={C.blue} strokeWidth="2" />
        <line x1={PAD} y1={CH - BOT} x2={CW - PAD} y2={CH - BOT} stroke={C.border} strokeWidth="1" />
        {marks.map((m) => (
          <g key={m.l}>
            <line x1={m.x} y1={TOP} x2={m.x} y2={CH - BOT} stroke={m.c} strokeWidth="1.3" strokeDasharray={m.d} />
            <line x1={m.x} y1={rowY[m.row] + 3} x2={m.x} y2={TOP} stroke={m.c} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.55" />
            <text x={m.x} y={rowY[m.row]} fill={m.c} fontSize="10" fontFamily={mono} textAnchor="middle">{m.l}</text>
          </g>
        ))}
        <text x={CW - PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="end">area rossa = {type === "CALL" ? "ST > K" : "ST < K"} (ITM)</text>
      </svg>
    );
  };

  const renderStrike = () => {
    if (!strikeData) return <div style={{ padding: 24, color: C.amber, fontSize: 13, textAlign: "center" }}>IV non risolvibile a questo premio/strike: correggi gli input per vedere la curva Edge vs Strike.</div>;
    const TOP = 18, BOT = 30;
    const X = (k: number) => PAD + ((k - strikeData.lo) / (strikeData.hi - strikeData.lo)) * (CW - 2 * PAD);
    let emin = 0, emax = 0;
    strikeData.pts.forEach((p) => { if (p.edge < emin) emin = p.edge; if (p.edge > emax) emax = p.edge; });
    const padE = (emax - emin) * 0.12 || 1; emin -= padE; emax += padE;
    const Y = (v: number) => CH - BOT - ((v - emin) / (emax - emin)) * (CH - BOT - TOP);
    const Yi = (p: number) => CH - BOT - p * (CH - BOT - TOP);
    const eLine = strikeData.pts.map((p, i) => `${i ? "L" : "M"}${X(p.K).toFixed(1)},${Y(p.edge).toFixed(1)}`).join("");
    const iLine = strikeData.pts.map((p, i) => `${i ? "L" : "M"}${X(p.K).toFixed(1)},${Yi(p.itm).toFixed(1)}`).join("");
    let best = strikeData.pts[0];
    strikeData.pts.forEach((p) => { if (p.edge > best.edge) best = p; });
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
        <line x1={PAD} y1={Y(0)} x2={CW - PAD} y2={Y(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3" />
        <path d={iLine} fill="none" stroke={C.red} strokeWidth="1.3" strokeDasharray="4 3" opacity="0.7" />
        <path d={eLine} fill="none" stroke={C.teal} strokeWidth="2" />
        <line x1={X(K)} y1={TOP} x2={X(K)} y2={CH - BOT} stroke={C.amber} strokeWidth="1.3" strokeDasharray="4 3" />
        <text x={X(K)} y={12} fill={C.amber} fontSize="10" fontFamily={mono} textAnchor="middle">K attuale</text>
        <circle cx={X(best.K)} cy={Y(best.edge)} r="3.5" fill={C.green} />
        <text x={X(best.K)} y={Y(best.edge) - 7} fill={C.green} fontSize="9.5" fontFamily={mono} textAnchor="middle">max {fmt(best.K, 0)}</text>
        <line x1={PAD} y1={CH - BOT} x2={CW - PAD} y2={CH - BOT} stroke={C.border} strokeWidth="1" />
        <text x={PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono}>{fmt(strikeData.lo, 0)}</text>
        <text x={X(S0)} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="middle">S₀ {fmt(S0, 0)}</text>
        <text x={CW - PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="end">{fmt(strikeData.hi, 0)}</text>
        <text x={CW - PAD} y={14} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="end"><tspan fill={C.teal}>— Edge</tspan>  <tspan fill={C.red}>- - ITM</tspan></text>
      </svg>
    );
  };

  const renderDrift = () => {
    const TOP = 18, BOT = 30;
    const X = (mu: number) => PAD + ((mu - driftData.lo) / (driftData.hi - driftData.lo)) * (CW - 2 * PAD);
    let emin = 0, emax = 0;
    driftData.pts.forEach((p) => { if (p.edge < emin) emin = p.edge; if (p.edge > emax) emax = p.edge; });
    const padE = (emax - emin) * 0.12 || 1; emin -= padE; emax += padE;
    const Y = (v: number) => CH - BOT - ((v - emin) / (emax - emin)) * (CH - BOT - TOP);
    const path = driftData.pts.map((p, i) => `${i ? "L" : "M"}${X(p.mu).toFixed(1)},${Y(p.edge).toFixed(1)}`).join("");
    const muNow = c.m, muS = selMuStar;
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
        <line x1={PAD} y1={Y(0)} x2={CW - PAD} y2={Y(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={C.teal} strokeWidth="2" />
        {muNow >= driftData.lo && muNow <= driftData.hi && (
          <g>
            <line x1={X(muNow)} y1={TOP} x2={X(muNow)} y2={CH - BOT} stroke={C.amber} strokeWidth="1.3" strokeDasharray="4 3" />
            <text x={X(muNow)} y={12} fill={C.amber} fontSize="10" fontFamily={mono} textAnchor="middle">μ {pct(muNow)}</text>
          </g>
        )}
        {muS != null && muS >= driftData.lo && muS <= driftData.hi && (
          <g>
            <line x1={X(muS)} y1={TOP} x2={X(muS)} y2={CH - BOT} stroke={C.blue} strokeWidth="1.3" strokeDasharray="1 3" />
            <text x={X(muS)} y={CH - BOT - 6} fill={C.blue} fontSize="10" fontFamily={mono} textAnchor="middle">μ* {pct(muS)}</text>
          </g>
        )}
        <line x1={PAD} y1={CH - BOT} x2={CW - PAD} y2={CH - BOT} stroke={C.border} strokeWidth="1" />
        <text x={PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono}>{pct(driftData.lo, 0)}</text>
        <text x={CW - PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="end">{pct(driftData.hi, 0)}</text>
        <text x={CW - PAD} y={14} fill={C.teal} fontSize="10" fontFamily={mono} textAnchor="end">Edge Reale vs deriva μ</text>
      </svg>
    );
  };

  const renderPnl = () => {
    const TOP = 18, BOT = 30;
    const lo = chart.sMin, hi = chart.sMax, n = 140, pts: [number, number][] = [];
    let pmin = 0; const pmax = prem;
    for (let i = 0; i <= n; i++) {
      const st = lo + ((hi - lo) * i) / n;
      const pnl = type === "CALL" ? prem - Math.max(st - K, 0) : prem - Math.max(K - st, 0);
      if (pnl < pmin) pmin = pnl;
      pts.push([st, pnl]);
    }
    const padP = (pmax - pmin) * 0.12 || 1;
    const ymin = pmin - padP, ymax = pmax + padP;
    const X = (s: number) => PAD + ((s - lo) / (hi - lo)) * (CW - 2 * PAD);
    const Y = (v: number) => CH - BOT - ((v - ymin) / (ymax - ymin)) * (CH - BOT - TOP);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const dY = (y: number) => CH - BOT - (y / chart.ymax) * (CH - BOT - TOP) * 0.85;
    const dPath = chart.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${dY(p[1]).toFixed(1)}`).join("");
    const be = c.beLevel;
    const profSide = (s: number) => (type === "CALL" ? s < be : s > be);
    const seg = pts.filter((p) => profSide(p[0]) && p[1] >= 0);
    const zeroY = Y(0);
    let area = "";
    if (seg.length) {
      area = `M${X(seg[0][0]).toFixed(1)},${zeroY.toFixed(1)}`;
      seg.forEach((p) => (area += `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`));
      area += `L${X(seg[seg.length - 1][0]).toFixed(1)},${zeroY.toFixed(1)}Z`;
    }
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
        {area && <path d={area} fill={C.green} opacity="0.15" />}
        <path d={dPath} fill="none" stroke={C.dim} strokeWidth="1" strokeDasharray="2 3" opacity="0.55" />
        <line x1={PAD} y1={Y(prem)} x2={CW - PAD} y2={Y(prem)} stroke={C.green} strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
        <text x={PAD + 3} y={Y(prem) - 3} fill={C.green} fontSize="9.5" fontFamily={mono}>max +{fmt(prem)}</text>
        <line x1={PAD} y1={Y(0)} x2={CW - PAD} y2={Y(0)} stroke={C.border} strokeWidth="1" />
        <path d={line} fill="none" stroke={C.blue} strokeWidth="2" />
        {be >= lo && be <= hi && (
          <g>
            <line x1={X(be)} y1={TOP} x2={X(be)} y2={CH - BOT} stroke={C.green} strokeWidth="1.3" strokeDasharray="4 3" />
            <text x={X(be)} y={12} fill={C.green} fontSize="10" fontFamily={mono} textAnchor="middle">BE {fmt(be, 0)}</text>
          </g>
        )}
        {K >= lo && K <= hi && (
          <g>
            <line x1={X(K)} y1={TOP} x2={X(K)} y2={CH - BOT} stroke={C.amber} strokeWidth="1" strokeDasharray="1 3" opacity="0.7" />
            <text x={X(K)} y={24} fill={C.amber} fontSize="10" fontFamily={mono} textAnchor="middle">K</text>
          </g>
        )}
        <text x={PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono}>{fmt(lo, 0)}</text>
        <text x={X(S0)} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="middle">S₀</text>
        <text x={CW - PAD} y={CH - 8} fill={C.dim} fontSize="10" fontFamily={mono} textAnchor="end">{fmt(hi, 0)}</text>
      </svg>
    );
  };

  const caption: Record<string, React.ReactNode> = {
    dist: <>La <b style={{ color: C.blue }}>curva</b> è la densità lognormale reale (μ, RV). <b style={{ color: C.amber }}>K</b> strike, <b style={{ color: C.green }}>BE</b> breakeven, <b style={{ color: C.teal }}>mediana</b> 50/50. Prob. di gain = area dal lato giusto del BE; prob. ITM = area rossa oltre lo strike.</>,
    strike: <>Edge Reale (<b style={{ color: C.teal }}>linea piena</b>) e prob. ITM (<b style={{ color: C.red }}>tratteggio</b>) al variare dello strike, a IV costante (niente skew). Il <b style={{ color: C.green }}>punto verde</b> è lo strike a edge massimo; la <b style={{ color: C.amber }}>linea ambra</b> è il tuo strike attuale.</>,
    drift: <>Edge Reale al variare della deriva μ del sottostante. Attraversa lo zero in <b style={{ color: C.blue }}>μ*</b> (pareggio); la <b style={{ color: C.amber }}>linea ambra</b> è la tua μ corrente. Per la {type}, l'edge {type === "PUT" ? "cresce" : "cala"} al salire di μ — sei in utile finché la μ resta dal lato giusto di μ*.</>,
    pnl: <>P&L a scadenza della vendita {type} (<b style={{ color: C.blue }}>linea blu</b>): profitto max +{fmt(prem)} se scade OTM, perdita oltre il <b style={{ color: C.green }}>BE</b>. In <b style={{ color: C.dim }}>grigio</b> la densità del prezzo; l'<b style={{ color: C.green }}>area verde</b> è la zona di profitto pesata dalla probabilità.</>,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background-secondary/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold">Option Analyzer</h1>
          </div>
          <AppHeaderMenu />
        </div>
      </header>

      <main style={{ fontFamily: sans, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.3 }}>Cruscotto Opzioni <span style={{ color: C.dim, fontWeight: 400 }}>· decisione strike</span></div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>IV implicita dal premio (BSM: tasso breve ^IRX, dividendi q) · μ via CAPM (rf 10a) · RV a finestre · valore reale, EV, μ*, probabilità con d₂ reale</div>
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: C.dim }}>
          scad. {c.expiry.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })} · {c.days} gg · T = {fmt(c.T, 3)} a
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Ticker</span>
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadTicker(); }}
          placeholder="es. MU, AAPL, ASTS"
          style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: mono, fontSize: 15, padding: "8px 12px", width: 150, outline: "none", textTransform: "uppercase" }} />
        <button onClick={loadTicker} disabled={loading}
          style={{ background: loading ? C.border : C.blue, color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 6, padding: "9px 16px", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 13, fontFamily: sans }}>
          {loading ? "Carico…" : "Carica dati"}
        </button>
        {fetchInfo && <span style={{ fontSize: 12, color: C.green, fontFamily: mono }}>{(fetchInfo.name || ticker)}{fetchInfo.currency ? ` · ${fetchInfo.currency}` : ""}{fetchInfo.asof ? ` · al ${fetchInfo.asof}` : ""}{fetchInfo.betaSource ? ` · β: ${fetchInfo.betaSource}` : ""}</span>}
        {fetchErr && <span style={{ fontSize: 12, color: C.amber }}>{fetchErr}</span>}
        <span style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>dati auto da verificare · tutti i campi restano modificabili</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {(["PUT", "CALL"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)}
                style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: sans, ...(type === t ? { background: t === "PUT" ? C.green : C.red, color: "#fff" } : unsel) }}>
                Vendi {t}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Sottostante</div>
          <Field label="Prezzo attuale" value={S0} onChange={setS0} suffix="$" />
          <Field label="Volatilità realizzata RV" value={RV} onChange={(v: any) => { setRV(v); setRvSel(null); }} suffix="%"
            hint={rvSel ? `finestra ${RV_WINDOW_DEFS.find((w) => w.key === rvSel)?.label ?? rvSel}` : "annua"} />
          <div style={{ display: "flex", gap: 4, marginTop: -6, marginBottom: 12 }}>
            {RV_WINDOW_DEFS.map((wd) => {
              const win = rvWindows?.find((x) => x.key === wd.key);
              const active = rvSel === wd.key;
              return (
                <button key={wd.key} disabled={!win}
                  onClick={() => { if (win) { setRV(Math.round(win.value * 100) / 100); setRvSel(wd.key); } }}
                  title={win ? `RV annualizzata sugli ultimi ${wd.label === "1a" ? "12 mesi" : wd.label} di borsa` : "Carica un ticker per calcolare le finestre RV"}
                  style={{ flex: 1, minWidth: 0, padding: "4px 2px", borderRadius: 6, cursor: win ? "pointer" : "default", fontSize: 10, fontFamily: mono, lineHeight: 1.3,
                    border: `1px solid ${active ? C.blue : C.border}`,
                    background: active ? C.blue : C.panel2,
                    color: active ? "#fff" : win ? C.text : C.dim,
                    opacity: win ? 1 : 0.45 }}>
                  {wd.label}<br />{win ? win.value.toFixed(1) + "%" : "—"}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1, margin: "6px 0 8px" }}>Opzione</div>
          <Field label="Strike" value={K} onChange={setK} suffix="$" />
          <Field label="Premio incassato" value={prem} onChange={setPrem} suffix="$" />
          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Scadenza · 3º venerdì</div>
            <select value={expIdx} onChange={(e) => setExpIdx(parseInt(e.target.value))}
              style={{ width: "100%", background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: mono, fontSize: 14, padding: "9px 10px", outline: "none" }}>
              {expiries.map((d, i) => (
                <option key={i} value={i} style={{ background: C.panel }}>
                  {d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
                </option>
              ))}
            </select>
          </label>
          <Field label="Risk-free breve r" value={rShort} onChange={setRShort} suffix="%" hint="^IRX 3m · sconto/IV" />

          <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1, margin: "6px 0 8px" }}>CAPM · deriva reale</div>
          <Field label="Beta" value={beta1y} onChange={setBeta1y} hint={fetchInfo?.betaSource || "Yahoo/GuruFocus"} />
          <Field label="Risk-free CAPM" value={rf} onChange={setRf} suffix="%" hint="10 anni" />
          <Field label="Premio rischio mercato" value={erp} onChange={setErp} suffix="%" />
          <Field label="Dividend yield" value={q} onChange={setQ} suffix="%" hint={fetchInfo?.divYieldSource || "opz."} />

          <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 1, margin: "6px 0 8px" }}>Roll</div>
          <Field label="Cuscinetto allo strike" value={buff} onChange={setBuff} suffix="%" hint="non rollare" />
        </div>

        <div>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderLeft: `4px solid ${selEV > 0 ? C.green : C.red}`, borderRadius: 8, padding: "13px 16px", marginBottom: 4 }}>
            {!isFinite(c.iv)
              ? <span style={{ color: C.amber, fontSize: 13.5 }}>Premio sotto il valore intrinseco o non risolvibile a questo strike/scadenza: controlla gli input.</span>
              : <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  Vendere <b style={{ color: type === "PUT" ? C.green : C.red }}>{type}</b> a {fmt(K, 0)}: Edge reale <b style={{ color: evColor(selEV) }}>{selEV >= 0 ? "+" : ""}{fmt(selEV)}</b> {selEV >= 0 ? "(rende più del giusto)" : "(rende meno del giusto)"}, prob. di gain <b>{pct(c.gain)}</b>, prob. di non rollare <b>{pct(c.noRoll)}</b>.{" "}
                  Direzione: titolo più probabile <b>{dirUp ? "su" : "giù"}</b> (μ {dirUp ? ">" : "<"} σ²/2), che favorisce la <b>{dirUp ? "PUT" : "CALL"}</b>{type === (dirUp ? "PUT" : "CALL") ? "." : " — la direzione rema contro, ti regge il premio."}
                </span>}
          </div>

          <GroupTitle>Volatilità</GroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: 10 }}>
            <MetricDual label="IV implicita" a={pct(c.iv)} b={isFinite(c.iv) ? pct(c.iv * rt) : "—"} color={C.blue} info="Volatilità implicita ricavata invertendo Black-Scholes-Merton (con dividend yield q) dal premio inserito." />
            <MetricDual label="RV reale" a={pct(c.sig)} b={pct(c.sig * rt)} info="Volatilità realizzata del sottostante. Finestra selezionabile nel pannello (1m/3m/6m/1a): per opzioni corte usa una finestra vicina alla scadenza." />
            <MetricDual label="Premio di varianza" a={isFinite(vp) ? (vp >= 0 ? "+" : "") + (vp * 100).toFixed(1) + " pt" : "—"} b={isFinite(vp) ? (vp >= 0 ? "+" : "") + (vp * rt * 100).toFixed(1) + " pt" : "—"} color={vp > 0 ? C.green : C.red} edge info="IV − RV in punti: l'edge di chi vende." />
          </div>

          <GroupTitle>Dove finirà il prezzo · a scadenza ({c.days} giorni · T = {fmt(c.T, 3)} anni)</GroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10 }}>
            <MetricDual label={useMu ? <>Deriva reale <span style={{ color: C.red, textTransform: "none" }}>⚠ SLIDER</span></> : "Deriva reale (drift)"} a={pct(c.m)} b={pct(c.m * c.T)} color={C.amber} sub={useMu ? `override manuale attivo · CAPM = ${pct(c.mCapm)}` : `fonte: CAPM (r + β·ERP − q)`} info="Drift del prezzo = μ CAPM − dividendi (μ = risk-free + β×premio di rischio)." />
            <MetricDual label={<>Drenaggio <span style={{ textTransform: "none" }}>σ²/2</span></>} a={pct(c.dren)} b={pct(c.dren * c.T)} info="La zavorra della volatilità: metà della varianza." />
            <Metric label="Mediana a scadenza" value={fmt(c.median)} sub={`media ${fmt(c.mean)}`} color={C.teal} info="Prezzo centrale = S₀·e^((drift−σ²/2)·T)." />
            <Metric label="Direzione (mediana)" value={dirUp ? "↑ Salire" : "↓ Scendere"} sub={dirUp ? "drift > drenaggio" : "drenaggio > drift"} color={type === (dirUp ? "PUT" : "CALL") ? C.green : C.red} edge info="Confronto drift vs drenaggio." />
          </div>

          <GroupTitle>Valore reale & Edge Reale · vendita {type}</GroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10 }}>
            <Metric label="Premio incassato" value={fmt(prem)} sub={<span style={{ color: C.green }}>{pct(prem / K)} dello strike</span>} info="Quanto incassi vendendo l'opzione." />
            <Metric label={`Valore reale ${type}`} value={fmt(selReal)} sub={<span style={{ color: C.green }}>{pct(selReal / K)} dello strike</span>} info="Valore equo dell'opzione con deriva reale μ e vol RV." />
            <MetricDual label={<><span style={{ textTransform: "none" }}>μ*</span> · deriva di pareggio</>}
              aLab={<><span style={{ textTransform: "none" }}>μ</span> reale</>} a={pct(c.m)}
              bLab={<><span style={{ textTransform: "none" }}>μ*</span> pareggio</>} b={selMuStar != null ? pct(selMuStar) : "—"}
              sub={selEV >= 0 ? "μ dal lato giusto → edge +" : "μ dal lato sbagliato → edge −"}
              info="μ* è la deriva che azzera l'edge reale." />
            <Metric label="Edge Reale" value={(selEV >= 0 ? "+" : "") + fmt(selEV)} color={evColor(selEV)} big edge info="= premio incassato − valore reale." />
          </div>

          <GroupTitle>Destrutturazione del premio di mercato · dov'è l'edge</GroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 10 }}>
            <MetricEdgeCard
              label={<>1 · Edge da volatilità</>}
              market={prem} real={c.decomp.bsRealVol} edge={c.decomp.edgeVol}
              sub={<>vol reale RV · deriva B&S (r)</>}
              info="Premio di mercato vs premio Black-Scholes-Merton ricalcolato con la volatilità reale RV, tenendo la deriva risk-neutral (r − q). Isola quanto dell'edge viene dal premio di varianza (IV − RV) tradotto in valuta." />
            <MetricEdgeCard
              label={<>2 · Edge da deriva</>}
              market={prem} real={c.decomp.realDriftImplVol} edge={c.decomp.edgeDrift}
              sub={<>vol implicita IV · deriva reale <span style={{ textTransform: "none" }}>μ</span></>}
              info="Premio di mercato vs valore atteso con la IV di mercato ma deriva reale μ del titolo. Isola quanto dell'edge viene dalla direzione attesa: μ > r favorisce chi vende PUT, penalizza chi vende CALL." />
            <MetricEdgeCard
              label={<>3 · Edge totale</>}
              market={prem} real={c.decomp.realDriftRealVol} edge={c.decomp.edgeTotal}
              sub={isFinite(c.decomp.interaction)
                ? <>= vol {(c.decomp.edgeVol >= 0 ? "+" : "") + fmt(c.decomp.edgeVol)} + deriva {(c.decomp.edgeDrift >= 0 ? "+" : "") + fmt(c.decomp.edgeDrift)} + interaz. {(c.decomp.interaction >= 0 ? "+" : "") + fmt(c.decomp.interaction)}</>
                : <>vol reale RV · deriva reale <span style={{ textTransform: "none" }}>μ</span></>}
              info="Premio di mercato vs valore reale completo (vol reale RV e deriva reale μ): coincide con l'Edge Reale. Si scompone in edge da volatilità + edge da deriva + un termine di interazione vol×deriva, in genere piccolo." />
          </div>

          <GroupTitle>Probabilità · misura reale (<span style={{ textTransform: "none" }}>μ</span>, RV)</GroupTitle>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10 }}>
            <Metric label="Prob. di GAIN" value={pct(c.gain)} sub={`breakeven ${fmt(c.beLevel)}`} color={c.gain >= 0.5 ? C.green : C.amber} info="Probabilità di chiudere in utile col cuscinetto del premio." />
            <Metric label="Prob. ITM (buco)" value={pct(c.breachReal)} sub={`implicita ${pct(c.breachImpl)}`} color={C.red} info="Probabilità che l'opzione finisca in-the-money a scadenza." />
            <Metric label="Prob. di NON rollare" value={pct(c.noRoll)} sub={`oltre ${buff}% (barriera ${fmt(c.barrier, 0)})`} color={c.noRoll >= 0.6 ? C.green : C.amber} info="Probabilità che il prezzo non tocchi mai la barriera (first-passage)." />
            <Metric label="Gap reale − impl." value={(c.breachReal - c.breachImpl >= 0 ? "+" : "") + ((c.breachReal - c.breachImpl) * 100).toFixed(1) + " pt"} color={c.breachReal < c.breachImpl ? C.green : C.red} big edge info="Quanto la prob. reale di breach differisce da quella implicita." />
          </div>

          <GroupTitle>Grafici interattivi</GroupTitle>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px 8px" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {tabs.map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: sans, ...(tab === k ? sel : unsel) }}>{l}</button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10, padding: "7px 10px", background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text, cursor: "pointer", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={useMu} onChange={(e) => setUseMu(e.target.checked)} style={{ accentColor: C.blue as any }} />
                μ da slider
              </label>
              <input type="range" min={-20} max={60} step={0.5} value={muManual} disabled={!useMu}
                onChange={(e) => setMuManual(parseFloat(e.target.value))}
                style={{ flex: 1, minWidth: 120, accentColor: C.blue as any, opacity: useMu ? 1 : 0.35 }} />
              <span style={{ fontFamily: mono, fontSize: 12, color: C.amber, whiteSpace: "nowrap" }}>μ = {pct(c.m)} · {useMu ? "slider" : "CAPM"}</span>
              <button onClick={() => { setMuManual(parseFloat((c.mCapm * 100).toFixed(1))); setUseMu(true); }}
                style={{ background: C.panel, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: sans, whiteSpace: "nowrap" }}>= CAPM ({pct(c.mCapm)})</button>
            </div>

            {tab === "dist" && renderDist()}
            {tab === "strike" && renderStrike()}
            {tab === "drift" && renderDrift()}
            {tab === "pnl" && renderPnl()}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>{caption[tab]}</div>
        </div>
      </div>
      </main>
    </div>
  );
}

export default OptionAnalyzer;
