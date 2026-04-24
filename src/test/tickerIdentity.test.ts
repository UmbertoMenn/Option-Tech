import { describe, it, expect } from 'vitest';
import { resolveUnderlyingIdentity } from '@/lib/tickerIdentity';

describe('resolveUnderlyingIdentity — canonical ticker resolution', () => {
  it('LULU stock and LULULEMON ATHLETICA derivative converge to LULU', () => {
    const stock = resolveUnderlyingIdentity({
      rawTicker: 'LULU',
      rawName: 'LULULEMON ATHLETICA INC',
      description: 'LULULEMON ATHLETICA INC',
    });
    const deriv = resolveUnderlyingIdentity({
      rawTicker: null,
      underlyingName: 'LULULEMON ATHLETICA',
      description: 'LULU PUT 250 DEC25',
    });
    expect(stock.tickerKey).toBe('LULU');
    expect(deriv.tickerKey).toBe('LULU');
  });

  it('GOOGLE / ALPHABET / GOOGL all map to GOOGL', () => {
    expect(resolveUnderlyingIdentity({ rawName: 'ALPHABET INC CLASS A' }).tickerKey).toBe('GOOGL');
    expect(resolveUnderlyingIdentity({ rawTicker: 'GOOG' }).tickerKey).toBe('GOOGL');
    expect(resolveUnderlyingIdentity({ rawTicker: 'GOOGL' }).tickerKey).toBe('GOOGL');
    expect(resolveUnderlyingIdentity({ underlyingName: 'GOOGLE' }).tickerKey).toBe('GOOGL');
  });

  it('ORACLE / ORCL converge to ORCL', () => {
    expect(resolveUnderlyingIdentity({ rawName: 'ORACLE CORP' }).tickerKey).toBe('ORCL');
    expect(resolveUnderlyingIdentity({ rawTicker: 'ORCL' }).tickerKey).toBe('ORCL');
  });

  it('WESTERN DIGITAL / WDC converge to WDC', () => {
    expect(resolveUnderlyingIdentity({ rawName: 'WESTERN DIGITAL CORP' }).tickerKey).toBe('WDC');
    expect(resolveUnderlyingIdentity({ rawTicker: 'WDC' }).tickerKey).toBe('WDC');
  });

  it('ALIBABA / BABA converge to BABA', () => {
    expect(resolveUnderlyingIdentity({ rawName: 'ALIBABA GROUP HOLDING' }).tickerKey).toBe('BABA');
    expect(resolveUnderlyingIdentity({ rawTicker: 'BABA' }).tickerKey).toBe('BABA');
  });

  it('strips broker prefix and exchange suffixes', () => {
    expect(resolveUnderlyingIdentity({ rawTicker: 'AZ.LULU' }).tickerKey).toBe('LULU');
    expect(resolveUnderlyingIdentity({ rawTicker: 'LULU:US' }).tickerKey).toBe('LULU');
    expect(resolveUnderlyingIdentity({ rawTicker: 'LULU.US' }).tickerKey).toBe('LULU');
  });

  it('falls back deterministically when ticker is unknown', () => {
    const r = resolveUnderlyingIdentity({ rawName: 'SOME UNKNOWN COMPANY XYZ' });
    expect(r.tickerKey.startsWith('NAME:')).toBe(true);
    expect(r.source).toBe('fallback_name');
    // Same input → same key
    const r2 = resolveUnderlyingIdentity({ rawName: 'SOME UNKNOWN COMPANY XYZ' });
    expect(r2.tickerKey).toBe(r.tickerKey);
  });

  it('linkedStock identity wins over noisy option ticker', () => {
    const fakeStock = {
      ticker: 'LULU',
      description: 'LULULEMON ATHLETICA INC',
    } as any;
    const r = resolveUnderlyingIdentity({
      rawTicker: 'LULU240119P00250000', // noisy option contract
      underlyingName: 'LULULEMON ATHLETICA',
      linkedStock: fakeStock,
    });
    expect(r.tickerKey).toBe('LULU');
    expect(r.source).toBe('linked_stock');
  });

  it('European / HK exchange-suffixed tickers map to canonical', () => {
    expect(resolveUnderlyingIdentity({ rawTicker: '1211.HK', rawName: 'BYD CO LTD' }).tickerKey).toBe('BYD');
    expect(resolveUnderlyingIdentity({ rawTicker: '9PDA.SG', rawName: 'PDD HOLDINGS INC' }).tickerKey).toBe('PDD');
    expect(resolveUnderlyingIdentity({ rawTicker: 'RACE.MI', rawName: 'FERRARI NV' }).tickerKey).toBe('RACE');
    expect(resolveUnderlyingIdentity({ rawTicker: 'SAP.DE', rawName: 'SAP SE' }).tickerKey).toBe('SAP');
  });

  it('Name-only resolution for European stocks without ticker', () => {
    expect(resolveUnderlyingIdentity({ rawName: 'MERCEDES-BENZ GROUP AG' }).tickerKey).toBe('MBG');
    expect(resolveUnderlyingIdentity({ rawName: 'FORTINET INC' }).tickerKey).toBe('FTNT');
    expect(resolveUnderlyingIdentity({ rawName: 'AZ.FORTINET INC' }).tickerKey).toBe('FTNT');
    expect(resolveUnderlyingIdentity({ rawName: 'STELLANTIS' }).tickerKey).toBe('STLA');
    expect(resolveUnderlyingIdentity({ rawName: 'DEUTSCHE POST AG' }).tickerKey).toBe('DPW');
    expect(resolveUnderlyingIdentity({ rawName: 'DIR-TELECOM ITALIA SPA' }).tickerKey).toBe('TIT');
  });

  it('Dynamic backend mapping resolves Celestica/CEG/APP/RDDT', () => {
    const { buildDynamicAliasMap } = require('@/lib/tickerIdentity');
    const dyn = buildDynamicAliasMap([
      { underlying: 'Celestica Inc', ticker: 'CLS' },
      { underlying: 'Constellation Energy Corporation', ticker: 'CEG' },
      { underlying: 'AppLovin Corp', ticker: 'APP' },
      { underlying: 'Redditi INC', ticker: 'RDDT' },
    ]);
    expect(resolveUnderlyingIdentity({ rawName: 'Celestica Inc' }, { dynamicAliases: dyn }).tickerKey).toBe('CLS');
    expect(resolveUnderlyingIdentity({ underlyingName: 'Constellation Energy Corporation' }, { dynamicAliases: dyn }).tickerKey).toBe('CEG');
    expect(resolveUnderlyingIdentity({ rawName: 'AppLovin Corp' }, { dynamicAliases: dyn }).tickerKey).toBe('APP');
    expect(resolveUnderlyingIdentity({ description: 'Redditi INC OPTION PUT 195 SEP/26' }, { dynamicAliases: dyn }).tickerKey).toBe('RDDT');
  });

  it('Dynamic mapping wins over fallback even when name is unknown to static map', () => {
    const { buildDynamicAliasMap } = require('@/lib/tickerIdentity');
    const dyn = buildDynamicAliasMap([
      { underlying: 'Some Brand New Company', ticker: 'SBNC' },
    ]);
    const r = resolveUnderlyingIdentity({ rawName: 'Some Brand New Company' }, { dynamicAliases: dyn });
    expect(r.tickerKey).toBe('SBNC');
    expect(r.source).toBe('alias_map');
  });
});
