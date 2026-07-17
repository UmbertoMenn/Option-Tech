import { describe, it, expect } from 'vitest';
import { categorizeDerivatives } from '@/lib/derivativeStrategies';
import { computeMonitoring } from '@/lib/monitoringEngine';
import { buildDynamicAliasMap, canonicalKeyForPosition, canonicalKeyForText } from '@/lib/tickerIdentity';
import { Position } from '@/types/portfolio';

function pos(p: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2),
    portfolio_id: 'pf1',
    isin: null, ticker: null, description: '', asset_type: 'derivative',
    currency: 'USD', exchange_rate: 1, quantity: 0,
    current_price: null, avg_cost: null, market_value: null,
    profit_loss: null, profit_loss_pct: null, weight_pct: null,
    option_type: null, strike_price: null, expiry_date: null, underlying: null,
    snapshot_price: null, snapshot_market_value: null,
    created_at: '', updated_at: '',
    ...p,
  };
}

describe('computeMonitoring — archiviazione sottostante risolvibile solo via alias dinamico (underlying_mappings)', () => {
  it('azione archiviata NON compare in availableCallsToSell quando la sua chiave canonica dipende da un alias dinamico', () => {
    // Sottostante "piccola" non presente nella mappa statica di tickerIdentity né
    // risolvibile da underlyingPrices: l'unico modo per riconoscerla è l'alias
    // dinamico salvato in underlying_mappings (esattamente come accade in produzione
    // per titoli come "BANCA SELLA SPA CATEGORIA S" o "BIO ON").
    const dynamicAliases = buildDynamicAliasMap([
      { underlying: 'GENERIC SMALLCAP SPA', ticker: 'GSC' },
    ]);

    const stock = pos({
      asset_type: 'stock',
      ticker: null,
      description: 'GENERIC SMALLCAP SPA',
      quantity: 200,
      current_price: 10,
    });

    // Il wizard archivia salvando la CHIAVE CANONICA (stessa risoluzione di
    // canonicalKeyForPosition), non il testo grezzo.
    const archivedKey = canonicalKeyForPosition(stock, dynamicAliases);
    expect(archivedKey).toBe('GSC');

    const cats = categorizeDerivatives([], [stock], [], []);

    // underlyingPrices vuoto: senza l'alias dinamico non ci sarebbe alcun modo
    // legacy (resolveKey/getCanonicalKey statico) di riconoscere che questa
    // sottostante corrisponde alla chiave archiviata "GSC".
    const monitoring = computeMonitoring(cats, [stock], [stock], {}, [], [archivedKey], dynamicAliases);

    expect(monitoring.availableCallsToSell).toHaveLength(0);
  });

  it('senza dynamicAliases (comportamento legacy) la stessa azione NON viene esclusa — prova il bug che la fix risolve', () => {
    const stock = pos({
      asset_type: 'stock',
      ticker: null,
      description: 'GENERIC SMALLCAP SPA',
      quantity: 200,
      current_price: 10,
    });

    const dynamicAliases = buildDynamicAliasMap([
      { underlying: 'GENERIC SMALLCAP SPA', ticker: 'GSC' },
    ]);
    const archivedKey = canonicalKeyForPosition(stock, dynamicAliases); // 'GSC'

    const cats = categorizeDerivatives([], [stock], [], []);

    // Stessa chiamata ma SENZA passare dynamicAliases al motore di monitoraggio:
    // 'GSC' non combacia con nessuna euristica legacy (normalizeForMatching /
    // getCanonicalKey statico) per un testo come "GENERIC SMALLCAP SPA".
    const monitoring = computeMonitoring(cats, [stock], [stock], {}, [], [archivedKey]);

    expect(monitoring.availableCallsToSell).toHaveLength(1);
    expect(monitoring.availableCallsToSell[0].availableContracts).toBe(2);
  });

  it('canonicalKeyForText replica la stessa chiave sia per il wizard (in fase di archiviazione) sia per il motore di monitoraggio', () => {
    const dynamicAliases = buildDynamicAliasMap([
      { underlying: 'BANCA SELLA SPA CATEGORIA S', ticker: 'BSELLA' },
    ]);
    const key = canonicalKeyForText('BANCA SELLA SPA CATEGORIA S', dynamicAliases);
    expect(key).toBe('BSELLA');
    // La chiave già archiviata (canonica) deve normalizzare a se stessa.
    expect(canonicalKeyForText(key, dynamicAliases)).toBe('BSELLA');
  });
});
