/**
 * Calcolo della scadenza reale delle opzioni mensili USA/EUREX-IDEM:
 * terzo venerdì del mese, corretto per le festività del mercato USA
 * (es. Good Friday, che può cadere sul terzo venerdì di marzo/aprile).
 *
 * Regola OCC: se il terzo venerdì è festivo, la scadenza si sposta al
 * giorno di negoziazione precedente (giovedì); nel raro caso in cui
 * anche il giovedì sia festivo, si sposta al lunedì successivo.
 *
 * Estratto da optionStratUrl.ts (era privato, usato solo per generare
 * URL OptionStrat) per essere condiviso da excelParser.ts, flussiCsvParser.ts
 * e ovunque serva la data di scadenza reale.
 */

/** Terzo venerdì di un mese dato (month: 0-based, come Date). */
export function thirdFriday(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay();
  const firstFriday = 1 + ((5 - dayOfWeek + 7) % 7);
  return new Date(year, month, firstFriday + 14);
}

/** Domenica di Pasqua (algoritmo di Gauss/Anonymous Gregorian - Computus). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/** Data osservata di una festività fissa: venerdì se cade di sabato, lunedì se cade di domenica. */
function observedDate(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(day - 1); // Sabato -> Venerdì
  if (dow === 0) d.setDate(day + 1); // Domenica -> Lunedì
  return d;
}

/** Verifica se una data è festività del mercato azionario USA (NYSE/Nasdaq). */
export function isUSMarketHoliday(date: Date): boolean {
  const year = date.getFullYear();

  const holidays: Date[] = [
    observedDate(year, 0, 1),   // Capodanno
    observedDate(year, 5, 19),  // Juneteenth
    observedDate(year, 6, 4),   // Independence Day
    observedDate(year, 11, 25), // Natale
  ];

  // Good Friday (2 giorni prima della Domenica di Pasqua)
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  holidays.push(goodFriday);

  // Thanksgiving: 4° giovedì di novembre
  const nov1 = new Date(year, 10, 1);
  const nov1Dow = nov1.getDay();
  const firstThu = 1 + ((4 - nov1Dow + 7) % 7);
  holidays.push(new Date(year, 10, firstThu + 21));

  // MLK Day: 3° lunedì di gennaio
  const jan1 = new Date(year, 0, 1);
  const firstMonJan = 1 + ((1 - jan1.getDay() + 7) % 7);
  holidays.push(new Date(year, 0, firstMonJan + 14));

  // Presidents' Day: 3° lunedì di febbraio
  const feb1 = new Date(year, 1, 1);
  const firstMonFeb = 1 + ((1 - feb1.getDay() + 7) % 7);
  holidays.push(new Date(year, 1, firstMonFeb + 14));

  // Memorial Day: ultimo lunedì di maggio
  const may31 = new Date(year, 4, 31);
  const lastMonMay = 31 - ((may31.getDay() - 1 + 7) % 7);
  holidays.push(new Date(year, 4, lastMonMay));

  // Labor Day: 1° lunedì di settembre
  const sep1 = new Date(year, 8, 1);
  const firstMonSep = 1 + ((1 - sep1.getDay() + 7) % 7);
  holidays.push(new Date(year, 8, firstMonSep));

  return holidays.some(h =>
    h.getFullYear() === date.getFullYear() &&
    h.getMonth() === date.getMonth() &&
    h.getDate() === date.getDate()
  );
}

/**
 * Data di scadenza reale dell'opzione mensile (terzo venerdì, holiday-adjusted).
 * `month` è 0-based (0 = gennaio), come da convenzione Date nativa.
 */
export function getOptionExpirationDate(year: number, month: number): Date {
  const tf = thirdFriday(year, month);

  if (isUSMarketHoliday(tf)) {
    const thursday = new Date(tf);
    thursday.setDate(tf.getDate() - 1);
    if (isUSMarketHoliday(thursday)) {
      // Sia giovedì che venerdì festivi -> lunedì successivo
      const monday = new Date(tf);
      monday.setDate(tf.getDate() + 3);
      return monday;
    }
    return thursday;
  }
  return tf;
}

/**
 * Come getOptionExpirationDate, ma restituisce direttamente la stringa
 * 'YYYY-MM-DD' pronta per il campo expiry_date.
 */
export function getOptionExpirationDateISO(year: number, month: number): string {
  const d = getOptionExpirationDate(year, month);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
