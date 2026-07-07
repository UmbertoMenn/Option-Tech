import { describe, it, expect } from 'vitest';
import {
  thirdFriday,
  easterSunday,
  isUSMarketHoliday,
  getOptionExpirationDate,
  getOptionExpirationDateISO,
} from '@/lib/optionExpiry';

describe('thirdFriday', () => {
  it('calcola il terzo venerdì per un mese che inizia di lunedì', () => {
    // Dicembre 2025 inizia di lunedì -> primo venerdì 5/12, terzo 19/12
    const d = thirdFriday(2025, 11);
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(19);
  });

  it('calcola il terzo venerdì per un mese che inizia di sabato (caso limite: cade il 21)', () => {
    // Marzo 2025 inizia di sabato -> primo venerdì 7/3, terzo 21/3
    const d = thirdFriday(2025, 2);
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(21);
  });

  it('calcola il terzo venerdì per un mese che inizia di domenica (cade il 15)', () => {
    // Giugno 2025 inizia di domenica -> primo venerdì 6/6, terzo 20/6... verifichiamo un caso col 15
    // Settembre 2024 inizia di domenica -> primo venerdì 6/9, terzo 20/9
    // Usiamo un mese che garantisce il 15: il mese deve iniziare di sabato -> primo ven=7, terzo=21 (già testato)
    // Per il 15 serve inizio lunedì+... in realtà il minimo possibile è 15 quando il 1° è venerdì.
    // Gennaio 2027 inizia di venerdì -> primo venerdì = 1, terzo = 15
    const d = thirdFriday(2027, 0);
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(15);
  });
});

describe('easterSunday', () => {
  it('calcola correttamente Pasqua 2025 (20 aprile)', () => {
    const e = easterSunday(2025);
    expect(e.getMonth()).toBe(3); // aprile
    expect(e.getDate()).toBe(20);
  });

  it('calcola correttamente Pasqua 2026 (5 aprile)', () => {
    const e = easterSunday(2026);
    expect(e.getMonth()).toBe(3);
    expect(e.getDate()).toBe(5);
  });
});

describe('isUSMarketHoliday', () => {
  it('riconosce il Good Friday 2025 (18 aprile)', () => {
    expect(isUSMarketHoliday(new Date(2025, 3, 18))).toBe(true);
  });

  it('riconosce il Natale osservato quando cade di sabato (es. 2027, osservato venerdì 24/12)', () => {
    // 25/12/2027 è sabato -> osservato venerdì 24/12
    expect(isUSMarketHoliday(new Date(2027, 11, 24))).toBe(true);
    expect(isUSMarketHoliday(new Date(2027, 11, 25))).toBe(false);
  });

  it('non segnala un normale giorno feriale come festivo', () => {
    expect(isUSMarketHoliday(new Date(2025, 5, 10))).toBe(false);
  });
});

describe('getOptionExpirationDate - casi reali di collisione con Good Friday', () => {
  it('2025-04: il terzo venerdì (18/4) è Good Friday -> scadenza slitta a giovedì 17/4', () => {
    const exp = getOptionExpirationDate(2025, 3);
    expect(exp.getFullYear()).toBe(2025);
    expect(exp.getMonth()).toBe(3);
    expect(exp.getDate()).toBe(17);
    expect(exp.getDay()).toBe(4); // giovedì
  });

  it('2022-04: il terzo venerdì (15/4) è Good Friday -> scadenza slitta a giovedì 14/4', () => {
    const exp = getOptionExpirationDate(2022, 3);
    expect(exp.getDate()).toBe(14);
    expect(exp.getDay()).toBe(4);
  });

  it('2019-04: il terzo venerdì (19/4) è Good Friday -> scadenza slitta a giovedì 18/4', () => {
    const exp = getOptionExpirationDate(2019, 3);
    expect(exp.getDate()).toBe(18);
  });
});

describe('getOptionExpirationDate - mese senza festività sul terzo venerdì', () => {
  it('2025-12: nessuna collisione, scadenza = terzo venerdì (19/12)', () => {
    const exp = getOptionExpirationDate(2025, 11);
    expect(exp.getDate()).toBe(19);
    expect(exp.getDay()).toBe(5);
  });

  it('2027-01: nessuna collisione, scadenza = terzo venerdì (15/1)', () => {
    const exp = getOptionExpirationDate(2027, 0);
    expect(exp.getDate()).toBe(15);
  });
});

describe('getOptionExpirationDateISO', () => {
  it('formatta correttamente in YYYY-MM-DD', () => {
    expect(getOptionExpirationDateISO(2025, 11)).toBe('2025-12-19');
  });

  it('formatta correttamente un caso con holiday-shift (2025-04 -> 2025-04-17)', () => {
    expect(getOptionExpirationDateISO(2025, 3)).toBe('2025-04-17');
  });

  it('pad corretto per mesi a singola cifra', () => {
    expect(getOptionExpirationDateISO(2027, 0)).toBe('2027-01-15');
  });
});
