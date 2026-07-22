/** Calendario scadenze mensili (terzo venerdì) — funzioni pure, date YYYY-MM-DD in UTC. */

export function parseDateUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarDays(date: string, days: number): string {
  const d = parseDateUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

/** Giorni di calendario tra due date (expiry − date). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateUTC(to).getTime() - parseDateUTC(from).getTime()) / 86_400_000);
}

/** Terzo venerdì del mese (month 0-based). */
export function thirdFridayUTC(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay();
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  return formatDateUTC(new Date(Date.UTC(year, month, firstFriday + 14)));
}

/**
 * Scadenze mensili (terzo venerdì) con DTE ≥ minDte rispetto a fromDate,
 * ordinate, entro maxMonthsForward mesi.
 */
export function monthlyExpiriesFrom(fromDate: string, minDte: number, maxMonthsForward: number): string[] {
  const from = parseDateUTC(fromDate);
  const expiries: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  for (let i = 0; i <= maxMonthsForward + 1; i++) {
    const expiry = thirdFridayUTC(y, m);
    if (daysBetween(fromDate, expiry) >= minDte && daysBetween(fromDate, expiry) <= maxMonthsForward * 31 + 21) {
      expiries.push(expiry);
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return expiries;
}

/** Prima scadenza mensile con DTE ≥ minDte ("scadenza mensile più vicina"). */
export function frontMonthlyExpiry(fromDate: string, minDte: number): string {
  const expiries = monthlyExpiriesFrom(fromDate, minDte, 3);
  if (expiries.length === 0) throw new Error(`Nessuna scadenza mensile trovata da ${fromDate}`);
  return expiries[0];
}
