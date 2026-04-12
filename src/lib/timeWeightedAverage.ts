import { differenceInDays, parseISO } from 'date-fns';
import { DepositEntry } from '@/types/deposits';

/**
 * Calculate time-weighted average balance.
 * Each balance level is weighted by the number of days it was held.
 */
export function calculateTimeWeightedAverage(
  startDate: Date,
  endDate: Date,
  initialValue: number,
  deposits: DepositEntry[]
): { average: number; totalDeposits: number } {
  const totalDays = differenceInDays(endDate, startDate);
  if (totalDays <= 0) return { average: initialValue, totalDeposits: 0 };

  // Filter and sort deposits in the period
  const depositsInPeriod = deposits
    .filter(d => {
      const date = parseISO(d.deposit_date);
      return date > startDate && date <= endDate;
    })
    .sort((a, b) => parseISO(a.deposit_date).getTime() - parseISO(b.deposit_date).getTime());

  const totalDeposits = depositsInPeriod.reduce((sum, d) => sum + d.amount, 0);

  if (depositsInPeriod.length === 0) {
    return { average: initialValue, totalDeposits: 0 };
  }

  // Time-weighted calculation
  let weightedSum = 0;
  let currentBalance = initialValue;
  let previousDate = startDate;

  for (const deposit of depositsInPeriod) {
    const depositDate = parseISO(deposit.deposit_date);
    const daysAtThisBalance = differenceInDays(depositDate, previousDate);

    weightedSum += currentBalance * daysAtThisBalance;
    currentBalance += deposit.amount;
    previousDate = depositDate;
  }

  // Final period (from last deposit to end date)
  const finalDays = differenceInDays(endDate, previousDate);
  weightedSum += currentBalance * finalDays;

  return { average: weightedSum / totalDays, totalDeposits };
}
