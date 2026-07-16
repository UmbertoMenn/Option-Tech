import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  resolveTickerFromName,
  isMappingSafeToPersist,
} from '../../supabase/functions/fetch-underlying-prices/tickerNameResolution';
import { buildDynamicAliasMap, getCanonicalTickerKey } from '@/lib/tickerIdentity';

// Ordine di inserimento identico a quello reale: SNOWFLAKE precede SERVICENOW.
const MAPPINGS: Record<string, string> = {
  NVIDIA: 'NVDA',
  APPLE: 'AAPL',
  META: 'META',
  'META PLATFORMS': 'META',
  ENI: 'ENI.MI',
  'ENI SPA': 'ENI.MI',
  SNOWFLAKE: 'SNOW',
  'SNOWFLAKE INC': 'SNOW',
  SERVICENOW: 'NOW',
  'MERCEDES BENZ': 'MBG.DE',
  'MERCEDES BENZ GROUP': 'MBG.DE',
  // "NTES" ⊂ "INTESA", "SOL" ⊂ "FIRST SOLAR": stessi falsi positivi trovati a DB.
  'INTESA SANPAOLO': 'ISP.MI',
  INTESA: 'ISP.MI',
  NETEASE: 'NTES',
  SOL: 'SOL.MI',
  'FIRST SOLAR': 'FSLR',
};

describe('resolveTickerFromName', () => {
  it('REGRESSIONE: "NOW" non deve risolvere su SNOW (SNOWFLAKE contiene NOW)', () => {
    expect(resolveTickerFromName('NOW', MAPPINGS)).toBe('NOW');
  });

  it('risolve ServiceNow per nome', () => {
    expect(resolveTickerFromName('SERVICENOW', MAPPINGS)).toBe('NOW');
    expect(resolveTickerFromName('ServiceNow Inc', MAPPINGS)).toBe('NOW');
  });

  it('risolve Snowflake correttamente', () => {
    expect(resolveTickerFromName('SNOW', MAPPINGS)).toBe('SNOW');
    expect(resolveTickerFromName('Snowflake Inc', MAPPINGS)).toBe('SNOW');
  });

  it('nessun match per sottostringa interna a una parola', () => {
    // "ENI" è dentro "GENIE" ma non è un token: niente ENI.MI
    expect(resolveTickerFromName('GENIE ENERGY', MAPPINGS)).toBeNull();
    // "META" è dentro "METALS"
    expect(resolveTickerFromName('METALS EXPLORATION', MAPPINGS)).toBeNull();
  });

  it('vince la chiave più lunga (più specifica)', () => {
    expect(resolveTickerFromName('Mercedes Benz Group AG', MAPPINGS)).toBe('MBG.DE');
  });

  it('contenimento a confine di parola in entrambe le direzioni', () => {
    expect(resolveTickerFromName('META PLATFORMS INC', MAPPINGS)).toBe('META');
    expect(resolveTickerFromName('NVIDIA CORP', MAPPINGS)).toBe('NVDA');
  });

  it('REGRESSIONE: "NTES" non deve risolvere su ISP.MI (INTESA contiene NTES)', () => {
    expect(resolveTickerFromName('NTES', MAPPINGS)).toBe('NTES');
    expect(resolveTickerFromName('NetEase Inc', MAPPINGS)).toBe('NTES');
  });

  it('REGRESSIONE: "FIRST SOLAR" non deve risolvere su SOL.MI', () => {
    expect(resolveTickerFromName('FIRST SOLAR', MAPPINGS)).toBe('FSLR');
    expect(resolveTickerFromName('First Solar Inc', MAPPINGS)).toBe('FSLR');
    // SOL (SOL SpA) continua a funzionare
    expect(resolveTickerFromName('SOL', MAPPINGS)).toBe('SOL.MI');
  });

  it('Intesa continua a risolvere correttamente', () => {
    expect(resolveTickerFromName('Intesa Sanpaolo SPA', MAPPINGS)).toBe('ISP.MI');
  });

  it('nome sconosciuto → null', () => {
    expect(resolveTickerFromName('AZIENDA IGNOTA SPA', MAPPINGS)).toBeNull();
    expect(resolveTickerFromName('', MAPPINGS)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('rimuove suffissi societari e punteggiatura', () => {
    expect(normalizeName('ServiceNow, Inc.')).toBe('SERVICENOW');
    expect(normalizeName('Crowdstrike Holdings Inc')).toBe('CROWDSTRIKE HOLDINGS');
  });
});

describe('isMappingSafeToPersist', () => {
  it('rifiuta il mapping avvelenato NOW -> SNOW', () => {
    expect(isMappingSafeToPersist('NOW', 'SNOW', MAPPINGS)).toBe(false);
  });

  it('rifiuta un mapping che contraddice un match esatto statico', () => {
    expect(isMappingSafeToPersist('SERVICENOW', 'SNOW', MAPPINGS)).toBe(false);
  });

  it('accetta mapping coerenti', () => {
    expect(isMappingSafeToPersist('NOW', 'NOW', MAPPINGS)).toBe(true);
    expect(isMappingSafeToPersist('SERVICENOW', 'NOW', MAPPINGS)).toBe(true);
  });

  it('accetta nomi non presenti nel mapping statico', () => {
    expect(isMappingSafeToPersist('ASTERA LABS', 'ALAB', MAPPINGS)).toBe(true);
  });

  it('rifiuta input vuoti', () => {
    expect(isMappingSafeToPersist('', 'NOW', MAPPINGS)).toBe(false);
    expect(isMappingSafeToPersist('NOW', '', MAPPINGS)).toBe(false);
  });
});

describe('buildDynamicAliasMap — difesa in profondità', () => {
  it('scarta una riga DB che rimappa un ticker canonico su un altro titolo', () => {
    const map = buildDynamicAliasMap([
      { underlying: 'NOW', ticker: 'SNOW' },
      { underlying: 'SERVICENOW INC', ticker: 'NOW' },
    ]);
    expect(map.has('NOW')).toBe(false);
    expect(map.get('SERVICENOW')).toBe('NOW');
  });

  it('mantiene gli alias dinamici legittimi', () => {
    const map = buildDynamicAliasMap([
      { underlying: 'Constellation Energy Corp', ticker: 'CEG' },
      { underlying: 'SNOW', ticker: 'SNOW' },
    ]);
    expect(map.get('CONSTELLATION ENERGY')).toBe('CEG');
    expect(map.get('SNOW')).toBe('SNOW');
  });

  it("l'opzione ServiceNow con underlying 'NOW' resta su NOW anche con la riga avvelenata", () => {
    const dynamicAliases = buildDynamicAliasMap([{ underlying: 'NOW', ticker: 'SNOW' }]);
    const key = getCanonicalTickerKey(
      { underlyingName: 'NOW', description: '[NOW][07/26][P][95]' },
      { dynamicAliases },
    );
    expect(key).toBe('NOW');
  });
});
