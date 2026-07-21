import { describe, expect, it } from 'vitest';
import {
  getEffectiveUploadUserId,
  getPortfolioParseOptions,
  shouldRefreshGpSnapshot,
  shouldRefreshPositionsSnapshot,
  filterSupportedUploadFiles,
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

  describe('portfolio positions refresh', () => {
    it('sostituisce le posizioni quando la sorgente ordinaria resta vuota dopo i filtri', () => {
      expect(shouldRefreshPositionsSnapshot([{
        positionsSnapshotPresent: true,
      }])).toBe(true);
    });
  });

  it('applica le esclusioni BIO ON soltanto allo username silvias', () => {
    const silviaOptions = getPortfolioParseOptions('silvia-id', 'SilviaS');
    expect(silviaOptions.excludedPositionIsins).toEqual(['IT0005056236']);
    expect(silviaOptions.excludedPositionDescriptions).toContain('BIO ON SPA');
    expect(silviaOptions.includeGpCashInCash).toBe(true);

    const otherOptions = getPortfolioParseOptions('other-id', 'other');
    expect(otherOptions.excludedPositionIsins).toBeUndefined();
    expect(otherOptions.excludedPositionDescriptions).toBeUndefined();
    expect(otherOptions.includeGpCashInCash).toBeUndefined();
  });
});

describe('filterSupportedUploadFiles (paste da appunti)', () => {
  const file = (name: string) => new File(['contenuto'], name, { type: '' });

  it('mantiene i file con estensione supportata (csv/xlsx/xls)', () => {
    const files = [file('FlussoSaldiContiCash.csv'), file('estratto.xlsx'), file('vecchio.xls')];
    expect(filterSupportedUploadFiles(files)).toEqual(files);
  });

  it('in modalità CSV accetta solo i flussi CSV', () => {
    const csv = file('FlussoSaldiContiTitoli.csv');
    expect(filterSupportedUploadFiles([csv, file('portafoglio.xlsx'), file('gp.xls')], 'csv')).toEqual([csv]);
  });

  it('in modalità legacy accetta solo Excel, incluso il file GP', () => {
    const portfolio = file('portafoglio.xlsx');
    const gp = file('gestione-patrimoniale.xls');
    expect(filterSupportedUploadFiles([file('saldi.csv'), portfolio, gp], 'legacy')).toEqual([portfolio, gp]);
  });

  it('scarta le estensioni non supportate (es. allegato PDF/immagine copiato per errore)', () => {
    const csv = file('FlussoMovContiCash.csv');
    const result = filterSupportedUploadFiles([csv, file('nota.pdf'), file('logo.png')]);
    expect(result).toEqual([csv]);
  });

  it('è case-insensitive sull’estensione', () => {
    expect(filterSupportedUploadFiles([file('SALDI.CSV')])).toHaveLength(1);
  });

  it('ritorna vuoto se nessun file ha un’estensione riconosciuta', () => {
    expect(filterSupportedUploadFiles([file('nota.txt'), file('foto.jpg')])).toEqual([]);
  });

  it('ritorna vuoto su lista vuota', () => {
    expect(filterSupportedUploadFiles([])).toEqual([]);
  });
});
