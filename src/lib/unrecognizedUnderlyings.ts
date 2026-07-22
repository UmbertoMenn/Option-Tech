import { Position } from '@/types/portfolio';
import {
  DynamicAliases,
  canonicalKeyForPosition,
  resolveUnderlyingIdentity,
} from './tickerIdentity';

export interface UnlinkedUnderlying {
  /** Testo grezzo del sottostante dell'opzione: è ciò che verrà mappato. */
  code: string;
  /** Descrizione di esempio per la UI. */
  sampleDescription: string;
  /** Chiave canonica attualmente risolta (bassa affidabilità). */
  optionKey: string;
  /** Contratti short coinvolti (per priorità/visualizzazione). */
  contractCount: number;
}

/**
 * Trova le SHORT CALL il cui sottostante non è riconosciuto: la risoluzione è a
 * bassa affidabilità (codice grezzo o fallback NAME:, non canonico/ISIN/alias)
 * E non esiste un'azione in portafoglio con la stessa chiave canonica.
 *
 * Sono esattamente i casi da collegare a mano (covered call su titolo europeo
 * il cui codice di banca non è mappato). Le put naked e le call già coperte o
 * su ticker riconosciuti NON vengono segnalate.
 *
 * Funzione pura: risoluzione identica a quella del motore di categorizzazione
 * (`resolveUnderlyingKey`), così la chiave combacia con quella usata per il match.
 */
export function findUnlinkedShortCalls(
  derivatives: Position[],
  stocks: Position[],
  dynamicAliases: DynamicAliases,
): UnlinkedUnderlying[] {
  const stockKeys = new Set(
    stocks
      .filter(s => (s.asset_type === 'stock' || s.asset_type === 'etf') && Number(s.quantity) > 0)
      .map(s => canonicalKeyForPosition(s, dynamicAliases)),
  );

  const byCode = new Map<string, UnlinkedUnderlying>();
  for (const d of derivatives) {
    if (d.asset_type !== 'derivative') continue;
    if (d.option_type !== 'call' || Number(d.quantity) >= 0) continue; // solo short call

    const text = d.underlying || d.description || '';
    if (!text.trim()) continue;
    // Stessa risoluzione del motore (resolveUnderlyingKey): rawTicker + rawName = text.
    const identity = resolveUnderlyingIdentity({ rawTicker: text, rawName: text }, { dynamicAliases });

    if (identity.confidence === 'high') continue;      // riconosciuto con certezza
    if (stockKeys.has(identity.tickerKey)) continue;   // già combacia con un'azione posseduta

    const code = (d.underlying || d.description || '').trim();
    const contracts = Math.abs(Number(d.quantity) || 0);
    const existing = byCode.get(code);
    if (existing) {
      existing.contractCount += contracts;
    } else {
      byCode.set(code, {
        code,
        sampleDescription: d.description || code,
        optionKey: identity.tickerKey,
        contractCount: contracts,
      });
    }
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
