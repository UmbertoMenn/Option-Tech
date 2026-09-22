/**
 * Chiave con cui si salvano i premi di una covered call senza call in
 * portafoglio (call ricomprata, scaduta o assegnata e non ancora rivenduta).
 * È distinta dai record delle call attive (`C{strike}_{scadenza}`): quando la
 * nuova call viene venduta, la sua calcolatrice propone di importare questo
 * storico, e viceversa qui si può importare lo storico della call precedente.
 */
export function resellCallOptionSymbol(ticker: string): string {
  return `RIV_${ticker.trim().toUpperCase()}`;
}
