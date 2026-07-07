/**
 * OCCSPH — Margine strategy-based puro con gerarchia rigida (metodologia
 * "OCC Sphere" descritta nella spec ION/LIST per Centrico, Appendix 3).
 *
 * Pipeline deterministica, statica (nessuno scan di rivalutazione):
 *  0) PRE-PROCESSING: le azioni in portafoglio (escluse GP) coprono le call
 *     corte più ITM → quantità opzioni ridotte, margine 0 (covered positions).
 *  1) SPREAD: stessa scadenza, stesso tipo. Debit/net-long → 0;
 *     credit → (ampiezza strike − credito netto), mai negativo.
 *  2) STRADDLE: short call + short put, stessa scadenza, stesso strike →
 *     lato naked peggiore per intero + premio dell'altro lato.
 *  3) COMBINATION (Strangle/Guts): short call + short put, stessa scadenza,
 *     strike diversi → stessa formula dello straddle.
 *     Strangle: K_put < K_call (OTM) · Guts: K_call < K_put (ITM).
 *  4) BUTTERFLY: pattern residuo long/short/long stesso tipo e scadenza
 *     (di norma già consumato al passo 1 come coppia di verticali — la
 *     decomposizione in verticali produce lo stesso requisito).
 *  5) SINGLE-LEG: short residue → naked (premio + max(pct·U − OTM, floor 10%));
 *     long residue → 0 (pagate per intero).
 *
 * Ogni strategia identificata produce una riga di trace con la scomposizione
 * richiesta dalla spec: premium / minimum / additional margin.
 *
 * Consumo progressivo delle quantità: ogni contratto viene "speso" una sola
 * volta lungo la gerarchia (le quantità sono esplose in unità singole).
 *
 * Nessun riferimento a hooks/UI/DB: solo numeri in entrata e in uscita.
 */

import type { OptType, StressLeg, StressEquity, StressUnderlyingMap } from './stressLab';

/* ===========================================================================
 * TIPI
 * ========================================================================= */

export interface OccSphParams {
  /** Cambio EUR/USD (quanti USD per 1 EUR) per l'output in EUR */
  fxUSD: number;
  /**
   * Requisito di mantenimento sulle short nude (frazione del sottostante).
   * 0,20 = minimo regolamentare textbook; la banca lo alza sui nomi volatili.
   * È lo stesso parametro `nakedPct` del motore ibrido. Default 0,20.
   */
  nakedPct?: number;
}

export type OccSphKind =
  | 'covered_call'
  | 'vertical_debit'
  | 'vertical_credit'
  | 'straddle'
  | 'strangle'
  | 'guts'
  | 'butterfly'
  | 'naked'
  | 'long';

export interface OccSphTrace {
  /** Sottostante */
  u: string;
  /** Tipo di strategia riconosciuta */
  kind: OccSphKind;
  /** Descrizione leggibile delle gambe (es. "SC 150 2026-07-17 @2.35") */
  legs: string[];
  /** Componente premio (valore di mercato delle short a carico) — USD nativi */
  premium: number;
  /** Componente minimo (floor) quando vincolante — USD nativi */
  minimum: number;
  /** Componente aggiuntiva (pct·U − OTM, o max-loss di spread) — USD nativi */
  additional: number;
  /** Margine totale della strategia — USD nativi */
  margin: number;
}

export interface OccSphResult {
  /** Margine totale in EUR */
  total: number;
  /** Scomposizione totale in EUR: premium / minimum / additional */
  premium: number;
  minimum: number;
  additional: number;
  /** Margine per sottostante in EUR, ordinato decrescente */
  byUnderlying: { u: string; margin: number }[];
  /** Trace completa per strategia (valori in USD nativi) */
  trace: OccSphTrace[];
  /** Call corte coperte dalle azioni (contratti a margine 0) */
  nCov: number;
}

/** Gamba unitaria (quantità esplosa) usata internamente dalla pipeline */
interface Unit {
  cp: OptType;
  K: number;
  exp: string;
  px: number;
  mult: number;
  short: boolean;
  used: boolean;
}

/* ===========================================================================
 * FORMULE ELEMENTARI
 * ========================================================================= */

/**
 * Scomposizione del margine naked:
 *  premium = premio a mercato della short
 *  base    = pct·S − OTM
 *  floor   = 10%·S (call) o 10%·K (put)
 *  additional = base se base ≥ floor, altrimenti 0
 *  minimum    = floor se floor > base, altrimenti 0
 * Totale = premium + max(base, floor). Valori per contratto (già × mult).
 */
function nakedParts(
  un: Unit,
  S: number,
  pct: number,
): { premium: number; additional: number; minimum: number; margin: number } {
  const otm = un.cp === 'C' ? Math.max(0, un.K - S) : Math.max(0, S - un.K);
  const base = (pct * S - otm) * un.mult;
  const floorV = 0.1 * (un.cp === 'C' ? S : un.K) * un.mult;
  const premium = un.px * un.mult;
  const useFloor = floorV > base;
  const additional = useFloor ? 0 : Math.max(0, base);
  const minimum = useFloor ? floorV : 0;
  return { premium, additional, minimum, margin: premium + Math.max(base, floorV) };
}

/**
 * Requisito di uno spread verticale (short s, long l, stesso tipo/scadenza):
 * debit/net-long → 0; credit → ampiezza − credito netto, mai negativo.
 */
function spreadReq(s: Unit, l: Unit): number {
  if (s.cp === 'C') {
    if (l.K <= s.K) return 0;
    return Math.max(0, (l.K - s.K) * s.mult - (s.px - l.px) * s.mult);
  }
  if (l.K >= s.K) return 0;
  return Math.max(0, (s.K - l.K) * s.mult - (s.px - l.px) * s.mult);
}

const legDesc = (u: Unit): string =>
  `${u.short ? 'S' : 'L'}${u.cp} ${u.K} ${u.exp} @${u.px.toFixed(2)}`;

/* ===========================================================================
 * PIPELINE PRINCIPALE
 * ========================================================================= */

export function occSphMargin(
  legs: StressLeg[],
  eq: StressEquity[],
  unders: StressUnderlyingMap,
  prm: OccSphParams,
): OccSphResult {
  const pct = prm.nakedPct ?? 0.2;
  const fx = prm.fxUSD || 1;

  /* ----- Gambe per sottostante, esplose in unità singole ----- */
  const byU: Record<string, Unit[]> = {};
  legs.forEach((l) => {
    const n = Math.round(Math.abs(l.q));
    if (!n) return;
    const arr = (byU[l.u] = byU[l.u] || []);
    for (let t = 0; t < n; t++)
      arr.push({
        cp: l.cp,
        K: l.K,
        exp: l.exp,
        px: Math.max(0, l.px),
        mult: l.mult,
        short: l.q < 0,
        used: false,
      });
  });

  /* ----- Azioni disponibili come copertura (escluse GP) ----- */
  const sharesByU: Record<string, number> = {};
  eq.forEach((s) => {
    if (s.gp) return;
    if (s.tick && unders[s.tick]) sharesByU[s.tick] = (sharesByU[s.tick] || 0) + s.q;
  });

  const trace: OccSphTrace[] = [];
  const byUnderlying: { u: string; margin: number }[] = [];
  let nCov = 0;
  let totPremium = 0;
  let totMinimum = 0;
  let totAdditional = 0;
  let total = 0;

  const push = (t: OccSphTrace) => {
    trace.push(t);
    totPremium += t.premium / fx;
    totMinimum += t.minimum / fx;
    totAdditional += t.additional / fx;
  };

  for (const u of Object.keys(byU)) {
    const und = unders[u];
    if (!und) continue;
    const S = und.S;
    const units = byU[u];
    let uMar = 0;

    const shorts = (cp: OptType) => units.filter((x) => x.short && !x.used && x.cp === cp);
    const longs = (cp: OptType) => units.filter((x) => !x.short && !x.used && x.cp === cp);

    /* ---- 0) PRE-PROCESSING: covered call (azioni → call corte più ITM) ---- */
    {
      const mult = units[0]?.mult ?? 100;
      let cap = Math.floor((sharesByU[u] || 0) / mult);
      if (cap > 0) {
        const sc = shorts('C').sort((a, b) => a.K - b.K);
        for (const x of sc) {
          if (cap <= 0) break;
          x.used = true;
          cap -= 1;
          nCov += 1;
          push({ u, kind: 'covered_call', legs: [legDesc(x)], premium: 0, minimum: 0, additional: 0, margin: 0 });
        }
      }
    }

    /* ---- 1) SPREAD: stessa scadenza, stesso tipo, pairing greedy max-beneficio ---- */
    (['C', 'P'] as OptType[]).forEach((cp) => {
      // Ricalcola finché esistono coppie con beneficio positivo
      let go = true;
      while (go) {
        go = false;
        const sx = shorts(cp);
        const lx = longs(cp);
        let best: { s: Unit; l: Unit; req: number; ben: number } | null = null;
        for (const s of sx) {
          const nk = nakedParts(s, S, pct).margin;
          for (const l of lx) {
            if (l.exp !== s.exp) continue; // spread = stessa scadenza (gerarchia OCCSPH)
            const req = spreadReq(s, l);
            const ben = nk - req;
            if (ben > 0 && (!best || ben > best.ben)) best = { s, l, req, ben };
          }
        }
        if (best) {
          best.s.used = true;
          best.l.used = true;
          const debit =
            best.s.cp === 'C' ? best.l.K <= best.s.K : best.l.K >= best.s.K;
          uMar += best.req;
          push({
            u,
            kind: debit ? 'vertical_debit' : 'vertical_credit',
            legs: [legDesc(best.s), legDesc(best.l)],
            premium: 0,
            minimum: 0,
            additional: best.req,
            margin: best.req,
          });
          go = true;
        }
      }
    });

    /* ---- 2–3) STRADDLE e COMBINATION (Strangle/Guts) ----
     * Short C + short P, stessa scadenza. Requisito = lato naked peggiore per
     * intero + premio dell'altro lato. Prima gli straddle (stesso strike),
     * poi le combination, sempre a massimo risparmio. */
    {
      const comboStep = (sameStrike: boolean) => {
        let go = true;
        while (go) {
          go = false;
          const scs = shorts('C');
          const sps = shorts('P');
          let best: { c: Unit; p: Unit; save: number } | null = null;
          for (const c of scs) {
            for (const p of sps) {
              if (p.exp !== c.exp) continue;
              if (sameStrike !== (Math.abs(p.K - c.K) < 1e-9)) continue;
              const nc = nakedParts(c, S, pct);
              const np = nakedParts(p, S, pct);
              // separati: nc + np · combinati: max + premio dell'altro lato
              const save =
                Math.min(nc.margin, np.margin) -
                (nc.margin >= np.margin ? np.premium : nc.premium);
              if (save > 0 && (!best || save > best.save)) best = { c, p, save };
            }
          }
          if (best) {
            best.c.used = true;
            best.p.used = true;
            const nc = nakedParts(best.c, S, pct);
            const np = nakedParts(best.p, S, pct);
            const worst = nc.margin >= np.margin ? nc : np;
            const otherPrem = nc.margin >= np.margin ? np.premium : nc.premium;
            const kind: OccSphKind = sameStrike
              ? 'straddle'
              : best.p.K < best.c.K
                ? 'strangle'
                : 'guts';
            const margin = worst.margin + otherPrem;
            uMar += margin;
            push({
              u,
              kind,
              legs: [legDesc(best.c), legDesc(best.p)],
              premium: worst.premium + otherPrem,
              minimum: worst.minimum,
              additional: worst.additional,
              margin,
            });
            go = true;
          }
        }
      };
      comboStep(true); // straddle
      comboStep(false); // strangle / guts
    }

    /* ---- 4) BUTTERFLY: pattern residuo L/S/L stesso tipo e scadenza ----
     * (di norma già consumato come verticali al passo 1; se il pattern
     * sopravvive — es. short senza beneficio di spread — lo si traccia). */
    (['C', 'P'] as OptType[]).forEach((cp) => {
      let go = true;
      while (go) {
        go = false;
        const sx = shorts(cp);
        for (const s of sx) {
          const lo = longs(cp).filter((l) => l.exp === s.exp && l.K < s.K);
          const hi = longs(cp).filter((l) => l.exp === s.exp && l.K > s.K);
          if (!lo.length || !hi.length) continue;
          const lw = lo.sort((a, b) => b.K - a.K)[0]; // ala bassa più vicina
          const hw = hi.sort((a, b) => a.K - b.K)[0]; // ala alta più vicina
          // Requisito = verticale credit peggiore tra le due decomposizioni
          const req = Math.max(spreadReq(s, lw), spreadReq(s, hw));
          s.used = true;
          lw.used = true;
          hw.used = true;
          uMar += req;
          push({
            u,
            kind: 'butterfly',
            legs: [legDesc(lw), legDesc(s), legDesc(hw)],
            premium: 0,
            minimum: 0,
            additional: req,
            margin: req,
          });
          go = true;
          break;
        }
      }
    });

    /* ---- 5) SINGLE-LEG: short residue naked, long residue a costo zero ---- */
    units
      .filter((x) => !x.used && x.short)
      .forEach((x) => {
        const p = nakedParts(x, S, pct);
        x.used = true;
        uMar += p.margin;
        push({ u, kind: 'naked', legs: [legDesc(x)], ...p });
      });
    units
      .filter((x) => !x.used)
      .forEach((x) => {
        x.used = true;
        push({ u, kind: 'long', legs: [legDesc(x)], premium: 0, minimum: 0, additional: 0, margin: 0 });
      });

    if (uMar > 0) byUnderlying.push({ u, margin: uMar / fx });
    total += uMar / fx;
  }

  byUnderlying.sort((a, b) => b.margin - a.margin);
  return {
    total,
    premium: totPremium,
    minimum: totMinimum,
    additional: totAdditional,
    byUnderlying,
    trace,
    nCov,
  };
}
