import { describe, expect, it } from 'vitest';
import {
  getEffectiveUploadUserId,
  getPortfolioParseOptions,
  shouldRefreshGpSnapshot,
} from '@/lib/portfolioUpload';

describe('portfolio upload GP refresh', () => {
  it('aggiorna la GP quando la sorgente titoli è presente ma tutte le holdings sono filtrate', () => {
    expect(shouldRefreshGpSnapshot([{
      gpSnapshotPresent: true,
      gpHoldings: [],
      gpCashAccounts: [],
    }])).toBe(true);
  });

  it('non aggiorna la GP senza alcuna sorgente GP', () => {
    expect(shouldRefreshGpSnapshot([{
      gpSnapshotPresent: false,
      gpHoldings: [],
      gpCashAccounts: [],
    }])).toBe(false);
  });
});

describe('portfolio upload user options', () => {
  it('usa l’utente autenticato in modalità diretta e quello visualizzato in modalità admin', () => {
    expect(getEffectiveUploadUserId(false, undefined, 'silvia-id')).toBe('silvia-id');
    expect(getEffectiveUploadUserId(true, 'silvia-id', 'admin-id')).toBe('silvia-id');
  });

  it('applica le esclusioni BION soltanto allo username silvias', () => {
    const silviaOptions = getPortfolioParseOptions('silvia-id', 'SilviaS');
    expect(silviaOptions.excludedPositionIsins).toEqual(['US09075V1026']);
    expect(silviaOptions.includeGpCashInCash).toBe(true);

    const otherOptions = getPortfolioParseOptions('other-id', 'other');
    expect(otherOptions.excludedPositionIsins).toBeUndefined();
    expect(otherOptions.excludedPositionDescriptions).toBeUndefined();
    expect(otherOptions.includeGpCashInCash).toBeUndefined();
  });
});
