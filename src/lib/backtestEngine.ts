/**
 * Backtest engine for Covered Call strategy.
 * Iterates bar-by-bar (hourly, 4h or daily), prices options with BS + static IV,
 * applies covered-call adjustment rules, and produces results.
 */
import { bsPrice, bsDelta, bsGamma, bsTheta, bsVega } from './blackScholes';
import { IVSurface } from './ivSurface';
import { CoveredCallRules, roundStrike } from './adjustmentRules';

// ---- Third Friday calculation ----
export function thirdFriday(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay();
  const firstFriday = 1 + ((5 - dayOfWeek + 7) % 7);
  return new Date(year, month, firstFriday + 14);
}

export function getMonthlyExpiries(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const expiries: string[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  while (true) {
    const tf = thirdFriday(y, m);
    if (tf > end) break;
    if (tf >= start) {
      expiries.push(formatDate(tf));
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return expiries;
}

// ---- Interfaces ----

export interface BacktestLeg {
  id: string;
  type: 'call' | 'put' | 'stock';
  strike: number;
  quantity: number;
  entryDate: string;
  expiryDate: string;
  entryPrice: number;
  active: boolean;
}

export interface AdjustmentLog {
  date: string;
  ruleName: string;
  description: string;
  legsRemoved: BacktestLeg[];
  legsAdded: BacktestLeg[];
  cost: number;
}

export interface DayLegResult {
  legId: string;
  type: 'call' | 'put' | 'stock';
  strike: number;
  quantity: number;
  price: number;
  value: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
}

export interface BacktestDayResult {
  date: string;
  underlyingPrice: number;
  totalValue: number;
  totalPL: number;
  plPct: number;
  adjustments: AdjustmentLog[];
  legs: DayLegResult[];
  totalDelta: number;
  totalGamma: number;
  totalTheta: number;
  totalVega: number;
}

export interface BacktestConfig {
  legs: BacktestLeg[];
  priceData: { date: string; close: number }[];
  ivSurface: IVSurface;
  riskFreeRate: number;
  ccRules: CoveredCallRules;
}

export interface BacktestResult {
  days: BacktestDayResult[];
  adjustmentLog: AdjustmentLog[];
  finalPL: number;
  finalPLPct: number;
  maxDrawdown: number;
  maxProfit: number;
  totalAdjustmentCost: number;
  sharpeRatio: number;
  winRate: number;
}

// ---- Engine ----

export function runBacktest(config: BacktestConfig): BacktestResult {
  const { priceData, ivSurface, riskFreeRate, ccRules } = config;
  const activeLegs = config.legs.map(l => ({ ...l, active: true }));

  const days: BacktestDayResult[] = [];
  const allAdjustments: AdjustmentLog[] = [];

  let initialValue = 0;
  let totalAdjustmentCost = 0;

  if (priceData.length === 0) {
    return {
      days: [], adjustmentLog: [], finalPL: 0, finalPLPct: 0,
      maxDrawdown: 0, maxProfit: 0, totalAdjustmentCost: 0, sharpeRatio: 0, winRate: 0,
    };
  }

  for (const leg of activeLegs) {
    initialValue += leg.entryPrice * leg.quantity * (leg.type === 'stock' ? 1 : 100);
  }

  let maxPL = -Infinity;
  let maxDrawdown = 0;
  let maxProfit = -Infinity;

  // Pre-compute all available monthly expiries in the date range
  const allExpiries = getMonthlyExpiries(priceData[0].date.slice(0, 10), priceData[priceData.length - 1].date.slice(0, 10));

  for (const bar of priceData) {
    const S = bar.close;
    const date = bar.date;
    const dayAdjustments: AdjustmentLog[] = [];

    // Price all legs
    const legResults: DayLegResult[] = [];
    let totalValue = 0;

    for (const leg of activeLegs) {
      if (!leg.active) continue;

      if (leg.type === 'stock') {
        const value = S * leg.quantity;
        totalValue += value;
        legResults.push({
          legId: leg.id, type: 'stock', strike: 0, quantity: leg.quantity,
          price: S, value, delta: leg.quantity, gamma: 0, theta: 0, vega: 0, iv: 0,
        });
        continue;
      }

      const T = yearsBetween(date, leg.expiryDate);
      const iv = ivSurface.getIV(leg.strike, leg.expiryDate, leg.type);

      let price: number, delta: number, gamma: number, theta: number, vega: number;

      if (T <= 0) {
        // Option expired
        price = leg.type === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
        delta = 0; gamma = 0; theta = 0; vega = 0;

        // Handle expiry logic for approach rule do_nothing
        if (ccRules.approachRule.enabled && ccRules.approachRule.action === 'do_nothing') {
          const adj = handleExpiryDoNothing(leg, S, date, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
          if (adj) {
            dayAdjustments.push(adj);
            allAdjustments.push(adj);
            totalAdjustmentCost += adj.cost;
          }
        } else if (leg.active) {
          // Default: sell new call at same barrier after expiry
          const adj = sellNewCallAfterExpiry(leg, S, date, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
          if (adj) {
            dayAdjustments.push(adj);
            allAdjustments.push(adj);
            totalAdjustmentCost += adj.cost;
          }
        }

        leg.active = false;
      } else {
        price = bsPrice(S, leg.strike, T, riskFreeRate, iv, leg.type);
        delta = bsDelta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        gamma = bsGamma(S, leg.strike, T, riskFreeRate, iv);
        theta = bsTheta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        vega = bsVega(S, leg.strike, T, riskFreeRate, iv);

        // Check approach rule (price near sold call)
        if (ccRules.approachRule.enabled && leg.type === 'call' && leg.quantity < 0 && leg.active) {
          const dist = Math.abs(S - leg.strike) / leg.strike * 100;
          if (dist <= ccRules.approachRule.activationPct && S >= leg.strike * (1 - ccRules.approachRule.activationPct / 100)) {
            const adj = executeApproachRule(leg, S, date, price, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
            if (adj) {
              dayAdjustments.push(adj);
              allAdjustments.push(adj);
              totalAdjustmentCost += adj.cost;
            }
          }
        }

        // Check profit rule (option gaining value for seller)
        if (ccRules.profitRule.enabled && leg.type === 'call' && leg.quantity < 0 && leg.active) {
          const gainPct = ((leg.entryPrice - price) / leg.entryPrice) * 100;
          if (gainPct >= ccRules.profitRule.profitPct) {
            const adj = executeProfitRule(leg, S, date, price, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
            if (adj) {
              dayAdjustments.push(adj);
              allAdjustments.push(adj);
              totalAdjustmentCost += adj.cost;
            }
          }
        }
      }

      const value = price * leg.quantity * 100;
      totalValue += value;

      legResults.push({
        legId: leg.id, type: leg.type, strike: leg.strike, quantity: leg.quantity,
        price, value,
        delta: delta * leg.quantity * 100,
        gamma: gamma * leg.quantity * 100,
        theta: theta * leg.quantity * 100,
        vega: vega * leg.quantity * 100,
        iv,
      });
    }

    const totalPL = totalValue - initialValue - totalAdjustmentCost;
    const plPct = initialValue !== 0 ? (totalPL / Math.abs(initialValue)) * 100 : 0;

    if (totalPL > maxPL) maxPL = totalPL;
    const dd = maxPL - totalPL;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (totalPL > maxProfit) maxProfit = totalPL;

    const totals = legResults.reduce(
      (acc, l) => ({
        delta: acc.delta + l.delta,
        gamma: acc.gamma + l.gamma,
        theta: acc.theta + l.theta,
        vega: acc.vega + l.vega,
      }),
      { delta: 0, gamma: 0, theta: 0, vega: 0 }
    );

    days.push({
      date, underlyingPrice: S, totalValue,
      totalPL, plPct, adjustments: dayAdjustments,
      legs: legResults,
      totalDelta: totals.delta,
      totalGamma: totals.gamma,
      totalTheta: totals.theta,
      totalVega: totals.vega,
    });
  }

  const dailyReturns = days.map((d, i) => i === 0 ? 0 : d.totalPL - days[i - 1].totalPL);
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / dailyReturns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  const winRate = (dailyReturns.filter(r => r > 0).length / Math.max(dailyReturns.length - 1, 1)) * 100;

  const last = days[days.length - 1];

  return {
    days,
    adjustmentLog: allAdjustments,
    finalPL: last?.totalPL ?? 0,
    finalPLPct: last?.plPct ?? 0,
    maxDrawdown,
    maxProfit,
    totalAdjustmentCost,
    sharpeRatio,
    winRate,
  };
}

// ---- Approach Rule Execution ----

function executeApproachRule(
  leg: BacktestLeg, S: number, date: string, currentPrice: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const { approachRule, strikeStep } = ccRules;

  if (approachRule.action === 'do_nothing') return null; // handled at expiry

  // Close current call
  const closeCost = -currentPrice * leg.quantity * 100;
  leg.active = false;

  // New strike: higher, on next expiry
  const nextExpiry = findNextExpiry(leg.expiryDate, allExpiries);
  if (!nextExpiry) return null;

  const newStrike = roundStrike(S * (1 + approachRule.activationPct / 100), strikeStep);
  const newT = yearsBetween(date, nextExpiry);
  if (newT <= 0) return null;

  const newIV = ivSurface.getIV(newStrike, nextExpiry, 'call');
  const newPrice = bsPrice(S, newStrike, newT, riskFreeRate, newIV, 'call');

  if (approachRule.action === 'roll_up_positive') {
    const netPremium = newPrice - currentPrice;
    const meetsUsd = netPremium >= approachRule.minPremiumUsd;
    const meetsPct = netPremium >= S * (approachRule.minPremiumPct / 100);
    if (!meetsUsd && !meetsPct) {
      leg.active = true; // revert
      return null;
    }
  }

  const openCost = newPrice * leg.quantity * 100;
  const newLeg: BacktestLeg = {
    id: `${leg.id}_rollup_${date}`,
    type: 'call', strike: newStrike, quantity: leg.quantity,
    entryDate: date, expiryDate: nextExpiry, entryPrice: newPrice, active: true,
  };
  activeLegs.push(newLeg);

  return {
    date, ruleName: 'Approccio barriera',
    description: `Roll up: ${leg.strike} → ${newStrike} (exp ${nextExpiry})`,
    legsRemoved: [{ ...leg }], legsAdded: [{ ...newLeg }],
    cost: closeCost + openCost,
  };
}

// ---- Expiry handling for do_nothing ----

function handleExpiryDoNothing(
  leg: BacktestLeg, S: number, date: string,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const { approachRule, strikeStep } = ccRules;
  const isOTM = S < leg.strike;

  const nextExpiry = findNextExpiry(date, allExpiries);
  if (!nextExpiry) return null;

  const newStrike = roundStrike(S * (1 + approachRule.newCallBarrierPct / 100), strikeStep);
  const newT = yearsBetween(date, nextExpiry);
  if (newT <= 0) return null;

  const newIV = ivSurface.getIV(newStrike, nextExpiry, 'call');
  const newPrice = bsPrice(S, newStrike, newT, riskFreeRate, newIV, 'call');

  const newLeg: BacktestLeg = {
    id: `${leg.id}_expiry_${date}`,
    type: 'call', strike: newStrike, quantity: -1,
    entryDate: date, expiryDate: nextExpiry, entryPrice: newPrice, active: true,
  };
  activeLegs.push(newLeg);

  const desc = isOTM
    ? `Scadenza OTM: nuova call ${newStrike} (exp ${nextExpiry})`
    : `Scadenza ITM: ricompra + nuova call ${newStrike} (exp ${nextExpiry})`;

  return {
    date, ruleName: 'Scadenza do_nothing',
    description: desc,
    legsRemoved: [{ ...leg }], legsAdded: [{ ...newLeg }],
    cost: newPrice * (-1) * 100, // premium received
  };
}

function sellNewCallAfterExpiry(
  leg: BacktestLeg, S: number, date: string,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const nextExpiry = findNextExpiry(date, allExpiries);
  if (!nextExpiry) return null;

  const newStrike = roundStrike(S * 1.05, ccRules.strikeStep); // default 5% barrier
  const newT = yearsBetween(date, nextExpiry);
  if (newT <= 0) return null;

  const newIV = ivSurface.getIV(newStrike, nextExpiry, 'call');
  const newPrice = bsPrice(S, newStrike, newT, riskFreeRate, newIV, 'call');

  const newLeg: BacktestLeg = {
    id: `${leg.id}_renew_${date}`,
    type: 'call', strike: newStrike, quantity: -1,
    entryDate: date, expiryDate: nextExpiry, entryPrice: newPrice, active: true,
  };
  activeLegs.push(newLeg);

  return {
    date, ruleName: 'Rinnovo post-scadenza',
    description: `Nuova call ${newStrike} (exp ${nextExpiry})`,
    legsRemoved: [{ ...leg }], legsAdded: [{ ...newLeg }],
    cost: newPrice * (-1) * 100,
  };
}

// ---- Profit Rule Execution ----

function executeProfitRule(
  leg: BacktestLeg, S: number, date: string, currentPrice: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const { profitRule, strikeStep } = ccRules;

  if (profitRule.action === 'wait_and_sell') return null; // handled at expiry

  const closeCost = -currentPrice * leg.quantity * 100;

  if (profitRule.action === 'roll_down') {
    const firstExpiry = allExpiries.find(e => e >= date.slice(0, 10));
    if (firstExpiry && leg.expiryDate === firstExpiry) {
      // First expiry: roll down lower strike, same expiry
      const newStrike = roundStrike(S * (1 + 3 / 100), strikeStep);
      const T = yearsBetween(date, leg.expiryDate);
      if (T <= 0) return null;

      const newIV = ivSurface.getIV(newStrike, leg.expiryDate, 'call');
      const newPrice = bsPrice(S, newStrike, T, riskFreeRate, newIV, 'call');
      const netPremium = newPrice - currentPrice;

      const meetsUsd = netPremium >= profitRule.minPremiumUsd;
      const meetsPct = netPremium >= S * (profitRule.minPremiumPct / 100);
      if (!meetsUsd && !meetsPct) return null;

      leg.active = false;
      const newLeg: BacktestLeg = {
        id: `${leg.id}_rolldown_${date}`,
        type: 'call', strike: newStrike, quantity: leg.quantity,
        entryDate: date, expiryDate: leg.expiryDate, entryPrice: newPrice, active: true,
      };
      activeLegs.push(newLeg);

      return {
        date, ruleName: 'Profitto: roll down',
        description: `Roll down: ${leg.strike} → ${newStrike} (stessa scadenza)`,
        legsRemoved: [{ ...leg }], legsAdded: [{ ...newLeg }],
        cost: closeCost + newPrice * leg.quantity * 100,
      };
    } else {
      // Later expiries: search best option
      const minStrike = roundStrike(S * (1 + profitRule.minDistancePct / 100), strikeStep);

      for (const expiry of allExpiries.filter(e => e >= date.slice(0, 10))) {
        const T = yearsBetween(date, expiry);
        if (T <= 0) continue;

        for (let strike = minStrike; strike <= S * 1.3; strike += strikeStep) {
          const iv = ivSurface.getIV(strike, expiry, 'call');
          const price = bsPrice(S, strike, T, riskFreeRate, iv, 'call');
          const netPremium = price - currentPrice;

          const meetsUsd = netPremium >= profitRule.rollDownMinPremiumUsd;
          const meetsPct = currentPrice > 0 && netPremium >= currentPrice * (profitRule.rollDownMinPremiumPct / 100);

          if (meetsUsd || meetsPct) {
            leg.active = false;
            const newLeg: BacktestLeg = {
              id: `${leg.id}_rollany_${date}`,
              type: 'call', strike, quantity: leg.quantity,
              entryDate: date, expiryDate: expiry, entryPrice: price, active: true,
            };
            activeLegs.push(newLeg);

            return {
              date, ruleName: 'Profitto: roll scadenza',
              description: `Roll: ${leg.strike} → ${strike} (exp ${expiry})`,
              legsRemoved: [{ ...leg }], legsAdded: [{ ...newLeg }],
              cost: closeCost + price * leg.quantity * 100,
            };
          }
        }
      }
    }
  }

  return null;
}

// ---- Utility ----

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yearsBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function findNextExpiry(afterDate: string, allExpiries: string[]): string | undefined {
  const dateStr = afterDate.slice(0, 10);
  return allExpiries.find(e => e > dateStr);
}
