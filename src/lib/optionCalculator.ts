import { DerivativePosition, OptionPayoffPoint } from '@/types/portfolio';

export function calculateOptionPayoff(
  positions: DerivativePosition[],
  underlyingPrice: number,
  priceRange: { min: number; max: number }
): OptionPayoffPoint[] {
  const points: OptionPayoffPoint[] = [];
  const steps = 100;
  const step = (priceRange.max - priceRange.min) / steps;
  
  for (let i = 0; i <= steps; i++) {
    const price = priceRange.min + i * step;
    let totalPayoff = 0;
    
    for (const position of positions) {
      const contractMultiplier = 100; // Standard options multiplier
      const premium = (position.avg_cost || position.current_price || 0) * contractMultiplier;
      const isLong = position.quantity > 0;
      const quantity = Math.abs(position.quantity);
      
      let intrinsicValue = 0;
      
      if (position.option_type === 'call') {
        intrinsicValue = Math.max(0, price - position.strike_price) * contractMultiplier;
      } else {
        intrinsicValue = Math.max(0, position.strike_price - price) * contractMultiplier;
      }
      
      let payoff: number;
      if (isLong) {
        // Long position: we paid the premium
        payoff = (intrinsicValue - premium) * quantity;
      } else {
        // Short position: we received the premium
        payoff = (premium - intrinsicValue) * quantity;
      }
      
      totalPayoff += payoff;
    }
    
    points.push({ price, payoff: totalPayoff });
  }
  
  return points;
}

export function findBreakevenPoints(payoffPoints: OptionPayoffPoint[]): number[] {
  const breakevens: number[] = [];
  
  for (let i = 1; i < payoffPoints.length; i++) {
    const prev = payoffPoints[i - 1];
    const curr = payoffPoints[i];
    
    // Check if payoff crosses zero
    if ((prev.payoff <= 0 && curr.payoff >= 0) || (prev.payoff >= 0 && curr.payoff <= 0)) {
      // Linear interpolation
      const ratio = Math.abs(prev.payoff) / (Math.abs(prev.payoff) + Math.abs(curr.payoff));
      const breakeven = prev.price + ratio * (curr.price - prev.price);
      breakevens.push(breakeven);
    }
  }
  
  return breakevens;
}

export function calculateMaxProfit(payoffPoints: OptionPayoffPoint[]): number {
  return Math.max(...payoffPoints.map(p => p.payoff));
}

export function calculateMaxLoss(payoffPoints: OptionPayoffPoint[]): number {
  return Math.min(...payoffPoints.map(p => p.payoff));
}

export function getPriceRangeForPositions(positions: DerivativePosition[]): { min: number; max: number } {
  if (positions.length === 0) {
    return { min: 0, max: 200 };
  }
  
  const strikes = positions.map(p => p.strike_price);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  
  const range = maxStrike - minStrike;
  const padding = Math.max(range * 0.5, minStrike * 0.3);
  
  return {
    min: Math.max(0, minStrike - padding),
    max: maxStrike + padding,
  };
}