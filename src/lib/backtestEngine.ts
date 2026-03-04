/**
 * Backtest engine for Covered Call strategy.
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
  closePrice?: number;
}

export interface AdjustmentLog {
  date: string;
  ruleName: string;
  description: string;
  legsRemoved: BacktestLeg[];
  legsAdded: BacktestLeg[];
  cost: number;
  underlyingPrice: number;
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
  stockPL: number;
  strategyPL: number;
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
  totalGrossPremiums: number;
  totalCommissions: number;
  totalNetPremiums: number;
  underlyingPL: number;
  strategyPL: number;
  tradeCount: number;
}

// ---- Engine ----

export function runBacktest(config: BacktestConfig): BacktestResult {
  const { priceData, ivSurface, riskFreeRate, ccRules } = config;
  const activeLegs = config.legs.map(l => ({ ...l, active: true }));

  const days: BacktestDayResult[] = [];
  const allAdjustments: AdjustmentLog[] = [];

  let initialValue = 0;
  let totalAdjustmentCost = 0;
  let totalGrossPremiums = 0;
  let tradeCount = 0;

  if (priceData.length === 0) {
    return {
      days: [], adjustmentLog: [], finalPL: 0, finalPLPct: 0,
      maxDrawdown: 0, maxProfit: 0, totalAdjustmentCost: 0, sharpeRatio: 0, winRate: 0,
      totalGrossPremiums: 0, totalCommissions: 0, totalNetPremiums: 0,
      underlyingPL: 0, strategyPL: 0, tradeCount: 0,
    };
  }

  let stockQty = 0;
  const initialStockPrice = priceData[0].close;

  for (const leg of activeLegs) {
    initialValue += leg.entryPrice * leg.quantity * (leg.type === 'stock' ? 1 : 100);
    tradeCount++;
    if (leg.type === 'stock') {
      stockQty = leg.quantity;
    } else if (leg.quantity < 0) {
      totalGrossPremiums += leg.entryPrice * Math.abs(leg.quantity) * 100;
    }
  }

  let maxPL = -Infinity;
  let maxDrawdown = 0;
  let maxProfit = -Infinity;

  const lastBarDate = new Date(priceData[priceData.length - 1].date);
  lastBarDate.setMonth(lastBarDate.getMonth() + 30);
  const allExpiries = getMonthlyExpiries(priceData[0].date.slice(0, 10), formatDate(lastBarDate));

  for (const bar of priceData) {
    const S = bar.close;
    const date = bar.date;
    const dayAdjustments: AdjustmentLog[] = [];

    const legResults: DayLegResult[] = [];
    let totalValue = 0;

    const legsSnapshot = activeLegs.filter(l => l.active);
    for (const leg of legsSnapshot) {
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
        price = leg.type === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
        delta = 0; gamma = 0; theta = 0; vega = 0;

        let expiryHandled = false;

        if (leg.active) {
          const adj = sellNewCallAfterExpiry(leg, S, date, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
          if (adj) {
            dayAdjustments.push(adj);
            allAdjustments.push(adj);
            totalAdjustmentCost += adj.cost;
            tradeCount += adj.legsRemoved.length + adj.legsAdded.length;
            for (const added of adj.legsAdded) {
              if (added.quantity < 0) totalGrossPremiums += added.entryPrice * Math.abs(added.quantity) * 100;
            }
            for (const removed of adj.legsRemoved) {
              if (removed.quantity < 0 && removed.closePrice != null) totalGrossPremiums -= removed.closePrice * Math.abs(removed.quantity) * 100;
            }
            expiryHandled = true;
          }
        }

        if (expiryHandled) {
          leg.active = false;
        }
      } else {
        price = bsPrice(S, leg.strike, T, riskFreeRate, iv, leg.type);
        delta = bsDelta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        gamma = bsGamma(S, leg.strike, T, riskFreeRate, iv);
        theta = bsTheta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        vega = bsVega(S, leg.strike, T, riskFreeRate, iv);

        // Check approach rule
        if (leg.type === 'call' && leg.quantity < 0 && leg.active) {
          if (S >= leg.strike * (1 - ccRules.approachRule.activationPct / 100)) {
            const adj = executeApproachRule(leg, S, date, price, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
            if (adj) {
              dayAdjustments.push(adj);
              allAdjustments.push(adj);
              totalAdjustmentCost += adj.cost;
              tradeCount += adj.legsRemoved.length + adj.legsAdded.length;
              for (const added of adj.legsAdded) {
                if (added.quantity < 0) totalGrossPremiums += added.entryPrice * Math.abs(added.quantity) * 100;
              }
              for (const removed of adj.legsRemoved) {
                if (removed.quantity < 0 && removed.closePrice != null) totalGrossPremiums -= removed.closePrice * Math.abs(removed.quantity) * 100;
              }
            }
          }
        }

        // Check profit rule
        if (leg.type === 'call' && leg.quantity < 0 && leg.active) {
          const gainPct = ((leg.entryPrice - price) / leg.entryPrice) * 100;
          if (gainPct >= ccRules.profitRule.profitPct) {
            const adj = executeProfitRule(leg, S, date, price, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries, allAdjustments);
            if (adj) {
              dayAdjustments.push(adj);
              allAdjustments.push(adj);
              totalAdjustmentCost += adj.cost;
              tradeCount += adj.legsRemoved.length + adj.legsAdded.length;
              for (const added of adj.legsAdded) {
                if (added.quantity < 0) totalGrossPremiums += added.entryPrice * Math.abs(added.quantity) * 100;
              }
              for (const removed of adj.legsRemoved) {
                if (removed.quantity < 0 && removed.closePrice != null) totalGrossPremiums -= removed.closePrice * Math.abs(removed.quantity) * 100;
              }
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

    const stockPL = (S - initialStockPrice) * stockQty;
    const currentCommissions = tradeCount * 10;
    const currentNetPremiums = totalGrossPremiums - currentCommissions;
    const strategyPL = stockPL + currentNetPremiums;

    days.push({
      date, underlyingPrice: S, totalValue,
      totalPL, plPct, adjustments: dayAdjustments,
      legs: legResults,
      totalDelta: totals.delta,
      totalGamma: totals.gamma,
      totalTheta: totals.theta,
      totalVega: totals.vega,
      stockPL,
      strategyPL,
    });
  }

  const dailyReturns = days.map((d, i) => i === 0 ? 0 : d.totalPL - days[i - 1].totalPL);
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / dailyReturns.length);
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;
  const winRate = (dailyReturns.filter(r => r > 0).length / Math.max(dailyReturns.length - 1, 1)) * 100;

  const last = days[days.length - 1];

  const totalCommissions = tradeCount * 10;
  const totalNetPremiums = totalGrossPremiums - totalCommissions;
  const finalStockPL = last ? (last.underlyingPrice - initialStockPrice) * stockQty : 0;
  const finalStrategyPL = finalStockPL + totalNetPremiums;

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
    totalGrossPremiums,
    totalCommissions,
    totalNetPremiums,
    underlyingPL: finalStockPL,
    strategyPL: finalStrategyPL,
    tradeCount,
  };
}

// ---- Approach Rule Execution ----

function executeApproachRule(
  leg: BacktestLeg, S: number, date: string, currentPrice: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const { approachRule, strikeStep } = ccRules;

  const futureExpiries = allExpiries.filter(e => e > leg.expiryDate.slice(0, 10));
  if (futureExpiries.length === 0) return null;

  const closeCost = -currentPrice * leg.quantity * 100;
  let newStrike = roundStrike(S * (1 + approachRule.rollUpMinDistancePct / 100), strikeStep);
  if (newStrike <= leg.strike) newStrike = leg.strike + strikeStep;

  const minRequiredPremium = S * (approachRule.minPremiumPct / 100);

  for (const candidateExpiry of futureExpiries) {
    const newT = yearsBetween(date, candidateExpiry);
    if (newT <= 0) continue;

    const newIV = ivSurface.getIV(newStrike, candidateExpiry, 'call');
    const newPrice = bsPrice(S, newStrike, newT, riskFreeRate, newIV, 'call');

    const netPremium = newPrice - currentPrice;
    if (netPremium < minRequiredPremium) continue;

    leg.active = false;
    const openCost = newPrice * leg.quantity * 100;
    const newLeg: BacktestLeg = {
      id: `${leg.id}_rollup_${date}`,
      type: 'call', strike: newStrike, quantity: leg.quantity,
      entryDate: date, expiryDate: candidateExpiry, entryPrice: newPrice, active: true,
    };
    activeLegs.push(newLeg);

    const removedLeg = { ...leg, closePrice: currentPrice };

    return {
      date, ruleName: 'Approccio barriera',
      description: `Roll up: ${leg.strike} → ${newStrike} (exp ${candidateExpiry})`,
      legsRemoved: [removedLeg], legsAdded: [{ ...newLeg }],
      cost: closeCost + openCost,
      underlyingPrice: S,
    };
  }

  return null;
}


function sellNewCallAfterExpiry(
  leg: BacktestLeg, S: number, date: string,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const nextExpiry = findNextExpiry(date, allExpiries);
  if (!nextExpiry) return null;

  const barrierPct = ccRules.approachRule.rollUpMinDistancePct;
  const newStrike = roundStrike(S * (1 + barrierPct / 100), ccRules.strikeStep);
  const newT = yearsBetween(date, nextExpiry);
  if (newT <= 0) return null;

  const newIV = ivSurface.getIV(newStrike, nextExpiry, 'call');
  const newPrice = bsPrice(S, newStrike, newT, riskFreeRate, newIV, 'call');

  const expiryClosePrice = leg.type === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);

  const newLeg: BacktestLeg = {
    id: `${leg.id}_renew_${date}`,
    type: 'call', strike: newStrike, quantity: -1,
    entryDate: date, expiryDate: nextExpiry, entryPrice: newPrice, active: true,
  };
  activeLegs.push(newLeg);

  const removedLeg = { ...leg, closePrice: expiryClosePrice };

  return {
    date, ruleName: 'Rinnovo post-scadenza',
    description: `Nuova call ${newStrike} (exp ${nextExpiry})`,
    legsRemoved: [removedLeg], legsAdded: [{ ...newLeg }],
    cost: newPrice * (-1) * 100,
    underlyingPrice: S,
  };
}

// ---- Profit Rule Execution ----

/**
 * Calculate annualized net premiums from the adjustment log (max 1 year lookback).
 * Returns annualized premium as % of average underlying price.
 */
function calcAnnualizedPremiumPct(
  date: string,
  adjustmentLog: AdjustmentLog[]
): number {
  const now = new Date(date);
  const oneYearAgo = new Date(date);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let totalNetPremium = 0;
  let sumUnderlyingPrice = 0;
  let count = 0;

  for (const adj of adjustmentLog) {
    const adjDate = new Date(adj.date);
    if (adjDate < oneYearAgo || adjDate > now) continue;

    // Net premium from each adjustment: premiums received minus premiums paid
    for (const added of adj.legsAdded) {
      if (added.quantity < 0 && added.type !== 'stock') {
        totalNetPremium += added.entryPrice * Math.abs(added.quantity) * 100;
      }
    }
    for (const removed of adj.legsRemoved) {
      if (removed.quantity < 0 && removed.closePrice != null && removed.type !== 'stock') {
        totalNetPremium -= removed.closePrice * Math.abs(removed.quantity) * 100;
      }
    }

    sumUnderlyingPrice += adj.underlyingPrice;
    count++;
  }

  if (count === 0 || sumUnderlyingPrice === 0) return 0;

  const avgUnderlying = sumUnderlyingPrice / count;
  const daysDiff = (now.getTime() - oneYearAgo.getTime()) / (1000 * 60 * 60 * 24);
  const actualDays = Math.min(daysDiff, 365);

  // Annualize: (totalNetPremium / avgUnderlying / 100) * (365 / actualDays) * 100
  // Per 100 shares basis
  const premiumPctRaw = (totalNetPremium / (avgUnderlying * 100)) * 100;
  const annualized = premiumPctRaw * (365 / actualDays);

  return annualized;
}

function executeProfitRule(
  leg: BacktestLeg, S: number, date: string, currentPrice: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[],
  adjustmentLog: AdjustmentLog[]
): AdjustmentLog | null {
  const { profitRule, strikeStep } = ccRules;

  const closeCost = -currentPrice * leg.quantity * 100;
  const firstExpiry = allExpiries.find(e => e >= date.slice(0, 10));

  // ── First expiry: roll down on same expiry (shared logic) ──
  if (firstExpiry && leg.expiryDate === firstExpiry) {
    const newStrike = roundStrike(S * (1 + profitRule.firstExpiryMinDistancePct / 100), strikeStep);
    const T = yearsBetween(date, leg.expiryDate);
    if (T <= 0) return null;

    const newIV = ivSurface.getIV(newStrike, leg.expiryDate, 'call');
    const newPrice = bsPrice(S, newStrike, T, riskFreeRate, newIV, 'call');
    const netPremium = newPrice - currentPrice;

    const minRequired = S * (profitRule.firstExpiryMinPremiumPct / 100);
    if (netPremium < minRequired) return null;

    leg.active = false;
    const newLeg: BacktestLeg = {
      id: `${leg.id}_rolldown_${date}`,
      type: 'call', strike: newStrike, quantity: leg.quantity,
      entryDate: date, expiryDate: leg.expiryDate, entryPrice: newPrice, active: true,
    };
    activeLegs.push(newLeg);

    const removedLeg = { ...leg, closePrice: currentPrice };

    return {
      date, ruleName: 'Profitto: roll down',
      description: `Roll down: ${leg.strike} → ${newStrike} (stessa scadenza)`,
      legsRemoved: [removedLeg], legsAdded: [{ ...newLeg }],
      cost: closeCost + newPrice * leg.quantity * 100,
      underlyingPrice: S,
    };
  }

  // ── Later expiries ──
  if (profitRule.action === 'dynamic') {
    return executeDynamicRolling(leg, S, date, currentPrice, closeCost, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries, adjustmentLog);
  } else {
    return executeStaticRolling(leg, S, date, currentPrice, closeCost, ccRules, ivSurface, riskFreeRate, activeLegs, allExpiries);
  }
}

/**
 * Rolling Dinamico: if annualized premiums exceed threshold, roll back to first
 * available expiry even at a loss, with min strike distance.
 */
function executeDynamicRolling(
  leg: BacktestLeg, S: number, date: string, currentPrice: number, closeCost: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[],
  adjustmentLog: AdjustmentLog[]
): AdjustmentLog | null {
  const { profitRule, strikeStep } = ccRules;

  // Check annualized premium threshold
  const annualizedPct = calcAnnualizedPremiumPct(date, adjustmentLog);
  if (annualizedPct < profitRule.dynamicAnnualizedPremiumPct) return null;

  // Roll back to first available expiry
  const firstExpiry = allExpiries.find(e => e >= date.slice(0, 10));
  if (!firstExpiry) return null;

  const minStrike = roundStrike(S * (1 + profitRule.dynamicMinDistancePct / 100), strikeStep);
  const T = yearsBetween(date, firstExpiry);
  if (T <= 0) return null;

  const newIV = ivSurface.getIV(minStrike, firstExpiry, 'call');
  const newPrice = bsPrice(S, minStrike, T, riskFreeRate, newIV, 'call');

  // Roll even at a loss (no net premium check)
  leg.active = false;
  const newLeg: BacktestLeg = {
    id: `${leg.id}_rolldyn_${date}`,
    type: 'call', strike: minStrike, quantity: leg.quantity,
    entryDate: date, expiryDate: firstExpiry, entryPrice: newPrice, active: true,
  };
  activeLegs.push(newLeg);

  const removedLeg = { ...leg, closePrice: currentPrice };

  return {
    date, ruleName: 'Profitto: rolling dinamico',
    description: `Roll dinamico: ${leg.strike} → ${minStrike} (exp ${firstExpiry}, ann. ${annualizedPct.toFixed(1)}%)`,
    legsRemoved: [removedLeg], legsAdded: [{ ...newLeg }],
    cost: closeCost + newPrice * leg.quantity * 100,
    underlyingPrice: S,
  };
}

/**
 * Rolling Statico: roll back to first available expiry with min distance and
 * positive net premium >= staticMinPremiumPct% of S.
 */
function executeStaticRolling(
  leg: BacktestLeg, S: number, date: string, currentPrice: number, closeCost: number,
  ccRules: CoveredCallRules, ivSurface: IVSurface, riskFreeRate: number,
  activeLegs: BacktestLeg[], allExpiries: string[]
): AdjustmentLog | null {
  const { profitRule, strikeStep } = ccRules;

  const minStrike = roundStrike(S * (1 + profitRule.staticMinDistancePct / 100), strikeStep);
  const minPremium = S * (profitRule.staticMinPremiumPct / 100);

  for (const expiry of allExpiries.filter(e => e >= date.slice(0, 10))) {
    const T = yearsBetween(date, expiry);
    if (T <= 0) continue;

    for (let strike = minStrike; strike <= S * 1.3; strike += strikeStep) {
      const iv = ivSurface.getIV(strike, expiry, 'call');
      const price = bsPrice(S, strike, T, riskFreeRate, iv, 'call');
      const netPremium = price - currentPrice;

      if (netPremium >= minPremium) {
        leg.active = false;
        const newLeg: BacktestLeg = {
          id: `${leg.id}_rollstat_${date}`,
          type: 'call', strike, quantity: leg.quantity,
          entryDate: date, expiryDate: expiry, entryPrice: price, active: true,
        };
        activeLegs.push(newLeg);

        const removedLeg = { ...leg, closePrice: currentPrice };

        return {
          date, ruleName: 'Profitto: rolling statico',
          description: `Roll statico: ${leg.strike} → ${strike} (exp ${expiry})`,
          legsRemoved: [removedLeg], legsAdded: [{ ...newLeg }],
          cost: closeCost + price * leg.quantity * 100,
          underlyingPrice: S,
        };
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
