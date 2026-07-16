/**
 * Risoluzione nome società → ticker, senza dipendenze Deno (testabile con Vitest).
 *
 * BUG STORICO (NOW → SNOW): la vecchia implementazione faceva match per
 * sottostringa grezza:
 *
 *     if (normalized.includes(key) || key.includes(normalized)) return ticker;
 *
 * Con normalized = "NOW", la chiave "SNOWFLAKE" contiene "NOW" ("S-NOW-FLAKE"),
 * e siccome SNOWFLAKE precede SERVICENOW nell'ordine di inserimento, ServiceNow
 * veniva risolto su SNOW. Il mapping sbagliato finiva poi in `underlying_mappings`
 * e avvelenava permanentemente frontend e cron.
 *
 * Qui il match è a confine di parola, con priorità deterministica:
 *   1. match esatto sul nome normalizzato
 *   2. l'input È già un ticker canonico noto (es. "NOW") → vince su tutto
 *   3. contenimento per sequenza di token, chiave più lunga (più specifica) vince
 */

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bINC\b/g, '')
    .replace(/\bCORP\b/g, '')
    .replace(/\bLTD\b/g, '')
    .replace(/\bLLC\b/g, '')
    .replace(/\bPLC\b/g, '')
    .replace(/\bCO\b/g, '')
    .replace(/\bTHE\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True se `keyTokens` compare come sequenza contigua di token dentro `tokens`. */
function containsTokenSequence(tokens: string[], keyTokens: string[]): boolean {
  if (keyTokens.length === 0 || keyTokens.length > tokens.length) return false;
  outer: for (let i = 0; i + keyTokens.length <= tokens.length; i++) {
    for (let j = 0; j < keyTokens.length; j++) {
      if (tokens[i + j] !== keyTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Risolve un nome/ticker sul mapping statico.
 * `mappings`: nome normalizzato → ticker canonico.
 */
export function resolveTickerFromName(
  name: string,
  mappings: Record<string, string>,
): string | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  // 1. Match esatto sul nome.
  if (mappings[normalized]) return mappings[normalized];

  // 2. L'input è già un ticker canonico del mapping (es. "NOW" per ServiceNow,
  //    "SNOW" per Snowflake). Ha priorità assoluta: nessuna euristica testuale
  //    deve poter riscrivere un ticker esatto in un altro titolo.
  const knownTickers = new Set(Object.values(mappings).map(t => t.toUpperCase()));
  const asTicker = normalized.replace(/\s+/g, '');
  if (knownTickers.has(asTicker)) return asTicker;

  // 3. Contenimento a confine di parola, in entrambe le direzioni.
  //    Vince la chiave più lunga (la più specifica).
  const tokens = normalized.split(' ').filter(Boolean);
  let best: { key: string; ticker: string } | null = null;
  for (const [key, ticker] of Object.entries(mappings)) {
    const keyTokens = key.split(' ').filter(Boolean);
    if (keyTokens.length === 0) continue;
    const hit =
      containsTokenSequence(tokens, keyTokens) || containsTokenSequence(keyTokens, tokens);
    if (hit && (!best || key.length > best.key.length)) {
      best = { key, ticker };
    }
  }
  return best ? best.ticker : null;
}

/**
 * Guardia anti-avvelenamento della cache `underlying_mappings`.
 *
 * Rifiuta di persistere un mapping che contraddice il mapping statico:
 * se `underlying` è di per sé un ticker canonico noto (o ha un match esatto
 * nel mapping statico) e il ticker risolto è diverso, la risoluzione è
 * sbagliata e non va scritta a DB.
 */
export function isMappingSafeToPersist(
  underlying: string,
  ticker: string,
  mappings: Record<string, string>,
): boolean {
  const normalized = normalizeName(underlying);
  if (!normalized || !ticker) return false;
  const upperTicker = ticker.toUpperCase();

  const exact = mappings[normalized];
  if (exact && exact.toUpperCase() !== upperTicker) return false;

  const knownTickers = new Set(Object.values(mappings).map(t => t.toUpperCase()));
  const asTicker = normalized.replace(/\s+/g, '');
  if (knownTickers.has(asTicker) && asTicker !== upperTicker) return false;

  return true;
}
