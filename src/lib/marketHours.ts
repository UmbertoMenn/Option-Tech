// Suffissi ticker europei (riuso logica edge function)
const EU_SUFFIXES = ['.MI', '.DE', '.SW', '.PA', '.AS', '.L', '.MC', '.BR', '.VI', '.CO', '.HE', '.ST', '.OL', '.LS'];

export function isEuropeanTicker(ticker: string): boolean {
  return EU_SUFFIXES.some(suffix => ticker.toUpperCase().endsWith(suffix));
}

// Helper per gestire ora legale CET/CEST
function getCETOffset(date: Date): number {
  // CET = UTC+1, CEST = UTC+2
  // L'ora legale inizia l'ultima domenica di marzo e finisce l'ultima domenica di ottobre
  const month = date.getUTCMonth(); // 0-11
  if (month >= 3 && month < 9) return 2; // CEST (Apr-Sep)
  if (month === 2) {
    // Marzo - calcola l'ultima domenica
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), 3, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    return date.getUTCDate() >= lastSunday ? 2 : 1;
  }
  if (month === 9) {
    // Ottobre - calcola l'ultima domenica
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), 10, 0));
    const lastSunday = lastDay.getUTCDate() - lastDay.getUTCDay();
    return date.getUTCDate() >= lastSunday ? 1 : 2;
  }
  return 1; // CET (Nov-Feb)
}

export function isMarketOpen(ticker: string): boolean {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  
  // Weekend - tutti i mercati chiusi
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  
  // Get current time in CET/CEST
  const cetOffset = getCETOffset(now);
  const cetHour = (now.getUTCHours() + cetOffset) % 24;
  const cetMinutes = now.getUTCMinutes();
  const cetTime = cetHour * 60 + cetMinutes;
  
  if (isEuropeanTicker(ticker)) {
    // EU: 09:00-17:30 CET
    const euOpen = 9 * 60;        // 540
    const euClose = 17 * 60 + 30; // 1050
    return cetTime >= euOpen && cetTime < euClose;
  } else {
    // US: 15:30-22:00 CET (09:30-16:00 ET)
    const usOpen = 15 * 60 + 30;  // 930
    const usClose = 22 * 60;      // 1320
    return cetTime >= usOpen && cetTime < usClose;
  }
}
