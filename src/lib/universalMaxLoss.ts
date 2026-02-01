import { Position } from '@/types/portfolio';

// ============= INTERFACES =============

export interface OptionLeg {
  type: 'call' | 'put';
  strike: number;
  quantity: number;      // + = comprato (long), - = venduto (short)
  avgCost: number;       // premio per contratto
}

export interface MaxLossResult {
  maxLoss: number;
  worstPrice: number;
  calculation: string;
  isUnlimited: boolean;
}

// ============= CORE FUNCTIONS =============

/**
 * Calculate payoff for a single option leg at a given underlying price.
 */
function calculateLegPayoff(leg: OptionLeg, price: number): number {
  const contracts = Math.abs(leg.quantity);
  const isLong = leg.quantity > 0;
  const multiplier = 100;
  
  // Intrinsic value at expiration
  let intrinsic: number;
  if (leg.type === 'call') {
    intrinsic = Math.max(0, price - leg.strike);
  } else {
    intrinsic = Math.max(0, leg.strike - price);
  }
  
  // Option value at expiration
  const intrinsicValue = intrinsic * multiplier * contracts;
  
  // Premium paid or received
  const premium = leg.avgCost * multiplier * contracts;
  
  if (isLong) {
    // Long: gain intrinsic - premium paid
    return intrinsicValue - premium;
  } else {
    // Short: premium received - intrinsic loss
    return premium - intrinsicValue;
  }
}

/**
 * Calculate total payoff for all legs at a given underlying price.
 */
export function calculatePayoffAtPrice(legs: OptionLeg[], price: number): number {
  return legs.reduce((total, leg) => total + calculateLegPayoff(leg, price), 0);
}

/**
 * Detect if strategy has unlimited risk (naked short calls).
 */
function hasUnlimitedRisk(legs: OptionLeg[]): boolean {
  const soldCalls = legs.filter(l => l.type === 'call' && l.quantity < 0);
  const boughtCalls = legs.filter(l => l.type === 'call' && l.quantity > 0);
  
  if (soldCalls.length === 0) return false;
  
  // Check if sold calls are fully covered by bought calls at higher strikes
  const totalSoldCallContracts = soldCalls.reduce((sum, l) => sum + Math.abs(l.quantity), 0);
  const totalBoughtCallContracts = boughtCalls.reduce((sum, l) => sum + l.quantity, 0);
  
  // If we have more sold calls than bought calls, we have unlimited risk
  return totalSoldCallContracts > totalBoughtCallContracts;
}

/**
 * Apply sanity checks and adjust max loss if needed.
 */
function validateMaxLoss(legs: OptionLeg[], calculatedMaxLoss: number): number {
  const soldPuts = legs.filter(l => l.type === 'put' && l.quantity < 0);
  const boughtPuts = legs.filter(l => l.type === 'put' && l.quantity > 0);
  const soldCalls = legs.filter(l => l.type === 'call' && l.quantity < 0);
  const boughtCalls = legs.filter(l => l.type === 'call' && l.quantity > 0);
  
  // Calculate net premium received/paid
  const netPremium = legs.reduce((sum, l) => {
    // For shorts (qty < 0), we receive premium: -qty * avgCost is positive
    // For longs (qty > 0), we pay premium: -qty * avgCost is negative
    return sum + (-l.quantity * l.avgCost * 100);
  }, 0);
  
  // Backup 1: PUT spread - max loss is spread width minus net credit
  if (boughtPuts.length > 0 && soldPuts.length > 0) {
    const soldStrike = Math.max(...soldPuts.map(l => l.strike));
    const boughtStrike = Math.min(...boughtPuts.map(l => l.strike));
    const spreadWidth = Math.max(0, soldStrike - boughtStrike);
    const totalPutContracts = soldPuts.reduce((s, l) => s + Math.abs(l.quantity), 0);
    const maxSpreadLoss = spreadWidth * 100 * totalPutContracts - Math.max(0, netPremium);
    
    if (maxSpreadLoss > 0 && maxSpreadLoss < calculatedMaxLoss) {
      return Math.max(0, maxSpreadLoss);
    }
  }
  
  // Backup 2: CALL spread - max loss is spread width minus net credit
  if (boughtCalls.length > 0 && soldCalls.length > 0) {
    const soldStrike = Math.min(...soldCalls.map(l => l.strike));
    const boughtStrike = Math.max(...boughtCalls.map(l => l.strike));
    const spreadWidth = Math.max(0, boughtStrike - soldStrike);
    const totalCallContracts = soldCalls.reduce((s, l) => s + Math.abs(l.quantity), 0);
    const maxSpreadLoss = spreadWidth * 100 * totalCallContracts - Math.max(0, netPremium);
    
    if (maxSpreadLoss > 0 && maxSpreadLoss < calculatedMaxLoss) {
      return Math.max(0, maxSpreadLoss);
    }
  }
  
  return calculatedMaxLoss;
}

/**
 * Universal max loss calculation for any option strategy.
 * 
 * This function calculates the theoretical maximum loss by:
 * 1. Identifying all critical price points (0, strikes, extreme values)
 * 2. Calculating the payoff at each price point
 * 3. Finding the worst (most negative) payoff
 * 4. Applying sanity checks for verification
 */
export function calculateUniversalMaxLoss(legs: OptionLeg[]): MaxLossResult {
  if (legs.length === 0) {
    return {
      maxLoss: 0,
      worstPrice: 0,
      calculation: 'Nessuna gamba',
      isUnlimited: false
    };
  }
  
  // Check for unlimited risk (naked short calls)
  const unlimited = hasUnlimitedRisk(legs);
  
  // Get all strike prices
  const strikes = legs.map(l => l.strike).filter(s => s > 0);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  
  // Test points: 0, all strikes, and extreme high values
  // For strategies with sold calls, we need to test very high prices
  const testPrices = [
    0,
    ...strikes,
    ...strikes.map(s => s - 0.01), // Just below each strike
    ...strikes.map(s => s + 0.01), // Just above each strike
    maxStrike * 1.5,
    maxStrike * 2,
    maxStrike * 3,
    maxStrike * 5,
    maxStrike * 10 // For unlimited risk estimation
  ].filter(p => p >= 0);
  
  // Remove duplicates and sort
  const uniquePrices = [...new Set(testPrices)].sort((a, b) => a - b);
  
  let worstPayoff = Infinity;
  let worstPrice = 0;
  
  for (const price of uniquePrices) {
    const payoff = calculatePayoffAtPrice(legs, price);
    if (payoff < worstPayoff) {
      worstPayoff = payoff;
      worstPrice = price;
    }
  }
  
  // Max loss is the absolute value of the worst (negative) payoff
  let maxLoss = Math.max(0, -worstPayoff);
  
  // Apply sanity checks
  maxLoss = validateMaxLoss(legs, maxLoss);
  
  // Build calculation description
  const calculation = buildCalculationDescription(legs, worstPrice, worstPayoff, maxLoss);
  
  return {
    maxLoss,
    worstPrice,
    calculation,
    isUnlimited: unlimited
  };
}

/**
 * Build a human-readable description of the calculation.
 */
function buildCalculationDescription(
  legs: OptionLeg[], 
  worstPrice: number, 
  worstPayoff: number,
  maxLoss: number
): string {
  // Calculate net premium
  const netPremium = legs.reduce((sum, l) => sum + (-l.quantity * l.avgCost * 100), 0);
  const premiumText = netPremium >= 0 
    ? `GP: ${netPremium.toFixed(0)}` 
    : `Debito: ${Math.abs(netPremium).toFixed(0)}`;
  
  // Identify spread widths if applicable
  const soldPuts = legs.filter(l => l.type === 'put' && l.quantity < 0);
  const boughtPuts = legs.filter(l => l.type === 'put' && l.quantity > 0);
  const soldCalls = legs.filter(l => l.type === 'call' && l.quantity < 0);
  const boughtCalls = legs.filter(l => l.type === 'call' && l.quantity > 0);
  
  const parts: string[] = [];
  
  if (soldPuts.length > 0 && boughtPuts.length > 0) {
    const soldStrike = Math.max(...soldPuts.map(l => l.strike));
    const boughtStrike = Math.min(...boughtPuts.map(l => l.strike));
    parts.push(`PUT ${boughtStrike}/${soldStrike}`);
  }
  
  if (soldCalls.length > 0 && boughtCalls.length > 0) {
    const soldStrike = Math.min(...soldCalls.map(l => l.strike));
    const boughtStrike = Math.max(...boughtCalls.map(l => l.strike));
    parts.push(`CALL ${soldStrike}/${boughtStrike}`);
  }
  
  const spreadInfo = parts.length > 0 ? parts.join(' + ') + ' | ' : '';
  
  return `${spreadInfo}${premiumText} | ML @ $${worstPrice.toFixed(0)} = ${maxLoss.toFixed(0)}`;
}

/**
 * Convert Position objects to OptionLeg format for universal calculation.
 */
export function positionsToLegs(positions: Position[]): OptionLeg[] {
  return positions
    .filter(p => p.option_type && p.strike_price != null)
    .map(p => ({
      type: p.option_type as 'call' | 'put',
      strike: p.strike_price!,
      quantity: p.quantity,
      avgCost: p.avg_cost || 0
    }));
}

/**
 * Calculate max loss for a group of positions.
 */
export function calculatePositionsMaxLoss(positions: Position[]): MaxLossResult {
  const legs = positionsToLegs(positions);
  return calculateUniversalMaxLoss(legs);
}
