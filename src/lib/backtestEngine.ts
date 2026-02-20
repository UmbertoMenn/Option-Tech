/**
 * Backtest engine: iterates day-by-day, prices options with BS + IV surface,
 * applies adjustment rules, and produces daily results.
 */
import { bsPrice, bsDelta, bsGamma, bsTheta, bsVega } from './blackScholes';
import { IVSurface } from './ivSurface';
import { AdjustmentRule } from './adjustmentRules';

// ---- Third Friday calculation (reused from optionStratUrl logic) ----
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
  quantity: number; // positive = long, negative = short
  entryDate: string;
  expiryDate: string;
  entryPrice: number; // per-unit price at entry
  active: boolean;
}

export interface AdjustmentLog {
  date: string;
  ruleName: string;
  description: string;
  legsRemoved: BacktestLeg[];
  legsAdded: BacktestLeg[];
  cost: number; // net cost of adjustment
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
  adjustmentRules: AdjustmentRule[];
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

// ---- Rule trigger tracking ----
interface RuleTriggerState {
  triggerCount: number;
  lastTriggerDate: string | null;
}

// ---- Engine ----

export function runBacktest(config: BacktestConfig): BacktestResult {
  const { priceData, ivSurface, riskFreeRate, adjustmentRules } = config;
  const activeLegs = config.legs.map(l => ({ ...l, active: true }));
  
  const days: BacktestDayResult[] = [];
  const allAdjustments: AdjustmentLog[] = [];
  const ruleStates = new Map<string, RuleTriggerState>();

  // Initialize rule states
  for (const rule of adjustmentRules) {
    ruleStates.set(rule.id, { triggerCount: 0, lastTriggerDate: null });
  }

  // Calculate initial portfolio value on entry date
  let initialValue = 0;
  let totalAdjustmentCost = 0;

  if (priceData.length === 0) {
    return {
      days: [], adjustmentLog: [], finalPL: 0, finalPLPct: 0,
      maxDrawdown: 0, maxProfit: 0, totalAdjustmentCost: 0, sharpeRatio: 0, winRate: 0,
    };
  }

  // Entry values
  for (const leg of activeLegs) {
    initialValue += leg.entryPrice * leg.quantity * (leg.type === 'stock' ? 1 : 100);
  }

  let maxPL = -Infinity;
  let maxDrawdown = 0;
  let maxProfit = -Infinity;

  for (const bar of priceData) {
    const S = bar.close;
    const date = bar.date;
    const dayAdjustments: AdjustmentLog[] = [];

    // Price all active legs
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
        // Expired: intrinsic value
        price = leg.type === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
        delta = 0; gamma = 0; theta = 0; vega = 0;
        leg.active = false; // expire the leg
      } else {
        price = bsPrice(S, leg.strike, T, riskFreeRate, iv, leg.type);
        delta = bsDelta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        gamma = bsGamma(S, leg.strike, T, riskFreeRate, iv);
        theta = bsTheta(S, leg.strike, T, riskFreeRate, iv, leg.type);
        vega = bsVega(S, leg.strike, T, riskFreeRate, iv);
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

    // Check adjustment rules
    for (const rule of adjustmentRules.sort((a, b) => a.priority - b.priority)) {
      const state = ruleStates.get(rule.id)!;

      // Check max triggers
      if (rule.maxTriggers > 0 && state.triggerCount >= rule.maxTriggers) continue;

      // Check cooldown
      if (state.lastTriggerDate && rule.cooldownDays > 0) {
        const daysSince = daysBetween(state.lastTriggerDate, date);
        if (daysSince < rule.cooldownDays) continue;
      }

      // Evaluate condition
      if (evaluateCondition(rule.condition, S, legResults, date, activeLegs, plPct)) {
        const adjustment = executeAction(rule, S, date, activeLegs, ivSurface, riskFreeRate);
        if (adjustment) {
          dayAdjustments.push(adjustment);
          allAdjustments.push(adjustment);
          totalAdjustmentCost += adjustment.cost;
          state.triggerCount++;
          state.lastTriggerDate = date;
        }
      }
    }

    // Track drawdown
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

  // Calculate stats
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

// ---- Condition evaluation ----

function evaluateCondition(
  condition: AdjustmentRule['condition'],
  S: number,
  legResults: DayLegResult[],
  date: string,
  activeLegs: BacktestLeg[],
  plPct: number
): boolean {
  switch (condition.type) {
    case 'price_near_barrier': {
      const targetLegs = activeLegs.filter(l => {
        if (!l.active) return false;
        if (condition.legType === 'sold_put') return l.type === 'put' && l.quantity < 0;
        if (condition.legType === 'sold_call') return l.type === 'call' && l.quantity < 0;
        if (condition.legType === 'bought_put') return l.type === 'put' && l.quantity > 0;
        if (condition.legType === 'bought_call') return l.type === 'call' && l.quantity > 0;
        return false;
      });

      for (const leg of targetLegs) {
        const dist = Math.abs(S - leg.strike) / leg.strike * 100;
        if (condition.direction === 'breached') {
          if (leg.type === 'put' && S < leg.strike) return true;
          if (leg.type === 'call' && S > leg.strike) return true;
        } else {
          if (dist <= (condition.distancePct ?? 5)) return true;
        }
      }
      return false;
    }

    case 'delta_threshold': {
      const totalDelta = legResults.reduce((acc, l) => acc + l.delta, 0);
      if (condition.deltaMin !== undefined && totalDelta < condition.deltaMin) return true;
      if (condition.deltaMax !== undefined && totalDelta > condition.deltaMax) return true;
      return false;
    }

    case 'days_to_expiry': {
      for (const leg of activeLegs) {
        if (!leg.active || leg.type === 'stock') continue;
        const daysLeft = daysBetween(date, leg.expiryDate);
        if (daysLeft <= (condition.maxDays ?? 5)) return true;
      }
      return false;
    }

    case 'pl_threshold': {
      const threshold = condition.plPct ?? 0;
      if (threshold < 0 && plPct <= threshold) return true;
      if (threshold > 0 && plPct >= threshold) return true;
      return false;
    }

    default:
      return false;
  }
}

// ---- Action execution ----

function executeAction(
  rule: AdjustmentRule,
  S: number,
  date: string,
  activeLegs: BacktestLeg[],
  ivSurface: IVSurface,
  riskFreeRate: number
): AdjustmentLog | null {
  const { action } = rule;

  switch (action.type) {
    case 'close_all': {
      const removed = activeLegs.filter(l => l.active);
      let cost = 0;
      for (const leg of removed) {
        if (leg.type === 'stock') {
          cost -= S * leg.quantity;
        } else {
          const legType = leg.type as 'call' | 'put';
          const T = yearsBetween(date, leg.expiryDate);
          const iv = ivSurface.getIV(leg.strike, leg.expiryDate, legType);
          const price = T > 0 ? bsPrice(S, leg.strike, T, riskFreeRate, iv, legType) : 
            (legType === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0));
          cost -= price * leg.quantity * 100; // closing = opposite sign
        }
        leg.active = false;
      }
      return {
        date, ruleName: rule.name,
        description: `Chiuse tutte le posizioni (${rule.name})`,
        legsRemoved: removed.map(l => ({ ...l })), legsAdded: [], cost,
      };
    }

    case 'roll_strike': {
      // Find the relevant sold legs to roll
      const targetType = rule.condition.legType;
      const legsToRoll = activeLegs.filter(l => {
        if (!l.active || l.type === 'stock') return false;
        if (targetType === 'sold_put') return l.type === 'put' && l.quantity < 0;
        if (targetType === 'sold_call') return l.type === 'call' && l.quantity < 0;
        return false;
      });

      if (legsToRoll.length === 0) return null;

      let totalCost = 0;
      const removed: BacktestLeg[] = [];
      const added: BacktestLeg[] = [];

      for (const leg of legsToRoll) {
        // Close old leg
        const legType = leg.type as 'call' | 'put';
        const T = yearsBetween(date, leg.expiryDate);
        const oldIV = ivSurface.getIV(leg.strike, leg.expiryDate, legType);
        const oldPrice = T > 0 ? bsPrice(S, leg.strike, T, riskFreeRate, oldIV, legType) : 0;
        const closeCost = -oldPrice * leg.quantity * 100;
        totalCost += closeCost;
        leg.active = false;
        removed.push({ ...leg });

        // Open new leg with rolled strike
        const rollPct = action.rollDistancePct ?? 0;
        const newStrike = Math.round(leg.strike * (1 + rollPct / 100) * 100) / 100;
        const expiry = action.keepSameExpiry ? leg.expiryDate : nextMonthlyExpiry(date);
        const newT = yearsBetween(date, expiry);
        const newIV = ivSurface.getIV(newStrike, expiry, legType);
        const newPrice = newT > 0 ? bsPrice(S, newStrike, newT, riskFreeRate, newIV, legType) : 0;
        const openCost = newPrice * leg.quantity * 100;
        totalCost += openCost;

        const newLeg: BacktestLeg = {
          id: `${leg.id}_rolled_${date}`,
          type: leg.type, strike: newStrike, quantity: leg.quantity,
          entryDate: date, expiryDate: expiry, entryPrice: newPrice, active: true,
        };
        activeLegs.push(newLeg);
        added.push({ ...newLeg });
      }

      return {
        date, ruleName: rule.name,
        description: `Rollato ${targetType}: strike da ${removed.map(l => l.strike).join(',')} a ${added.map(l => l.strike).join(',')}`,
        legsRemoved: removed, legsAdded: added, cost: totalCost,
      };
    }

    case 'roll_expiry': {
      const optionLegs = activeLegs.filter(l => l.active && l.type !== 'stock');
      if (optionLegs.length === 0) return null;

      let totalCost = 0;
      const removed: BacktestLeg[] = [];
      const added: BacktestLeg[] = [];

      for (const leg of optionLegs) {
        const legType = leg.type as 'call' | 'put';
        const T = yearsBetween(date, leg.expiryDate);
        const oldIV = ivSurface.getIV(leg.strike, leg.expiryDate, legType);
        const oldPrice = T > 0 ? bsPrice(S, leg.strike, T, riskFreeRate, oldIV, legType) : 0;
        totalCost += -oldPrice * leg.quantity * 100;
        leg.active = false;
        removed.push({ ...leg });

        const newExpiry = nextMonthlyExpiry(leg.expiryDate, action.rollMonths ?? 1);
        const newT = yearsBetween(date, newExpiry);
        const newIV = ivSurface.getIV(leg.strike, newExpiry, legType);
        const newPrice = newT > 0 ? bsPrice(S, leg.strike, newT, riskFreeRate, newIV, legType) : 0;
        totalCost += newPrice * leg.quantity * 100;

        const newLeg: BacktestLeg = {
          id: `${leg.id}_exp_${date}`,
          type: leg.type, strike: leg.strike, quantity: leg.quantity,
          entryDate: date, expiryDate: newExpiry, entryPrice: newPrice, active: true,
        };
        activeLegs.push(newLeg);
        added.push({ ...newLeg });
      }

      return {
        date, ruleName: rule.name,
        description: `Rollato scadenza: ${removed[0]?.expiryDate} → ${added[0]?.expiryDate}`,
        legsRemoved: removed, legsAdded: added, cost: totalCost,
      };
    }

    case 'compound': {
      // Execute sub-actions sequentially
      let totalCost = 0;
      const allRemoved: BacktestLeg[] = [];
      const allAdded: BacktestLeg[] = [];

      for (const subAction of action.subActions || []) {
        const subRule: AdjustmentRule = { ...rule, action: subAction };
        const result = executeAction(subRule, S, date, activeLegs, ivSurface, riskFreeRate);
        if (result) {
          totalCost += result.cost;
          allRemoved.push(...result.legsRemoved);
          allAdded.push(...result.legsAdded);
        }
      }

      if (allRemoved.length === 0 && allAdded.length === 0) return null;

      return {
        date, ruleName: rule.name,
        description: `Aggiustamento composto: ${rule.name}`,
        legsRemoved: allRemoved, legsAdded: allAdded, cost: totalCost,
      };
    }

    default:
      return null;
  }
}

// ---- Utility ----

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yearsBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function daysBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
}

function nextMonthlyExpiry(afterDate: string, monthsAhead: number = 1): string {
  const d = new Date(afterDate);
  let m = d.getMonth() + monthsAhead;
  let y = d.getFullYear();
  while (m > 11) { m -= 12; y++; }
  const tf = thirdFriday(y, m);
  return formatDate(tf);
}
