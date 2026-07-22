import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKTEST_CONFIG, STRATEGY_CATALOG, getStrategyDefinition } from '@/lib/backtesting/strategyCatalog';
import { ENGINE_INVARIANTS, validateBacktestConfig } from '@/lib/backtesting/validation';

describe('backtesting foundation', () => {
  it('keeps the priority strategies in phase 1', () => {
    const phaseOne = STRATEGY_CATALOG.filter((strategy) => strategy.phase === 1).map((strategy) => strategy.id);

    expect(phaseOne).toEqual([
      'covered_call',
      'synthetic_covered_call',
      'de_risking_covered_call',
      'cash_secured_put',
      'wheel',
    ]);
  });

  it('marks replaceable legs without transforming the strategy', () => {
    const syntheticCc = getStrategyDefinition('synthetic_covered_call');
    const shortCall = syntheticCc.legs.find((leg) => leg.role === 'Call venduta');

    expect(shortCall?.required).toBe(true);
    expect(shortCall?.canBeTemporarilyMissing).toBe(true);
    expect(ENGINE_INVARIANTS.some((rule) => rule.includes('incomplete / da sostituire'))).toBe(true);
  });

  it('accepts the default configuration', () => {
    expect(validateBacktestConfig(DEFAULT_BACKTEST_CONFIG).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects lookalike invalid configuration values', () => {
    const invalid = {
      ...DEFAULT_BACKTEST_CONFIG,
      symbol: '',
      startDate: '2025-01-01',
      endDate: '2024-01-01',
      entry: { ...DEFAULT_BACKTEST_CONFIG.entry, minDte: 60, maxDte: 30, targetDelta: 1.2 },
    };

    const fields = validateBacktestConfig(invalid).filter((issue) => issue.severity === 'error').map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['symbol', 'dateRange', 'entry.dte', 'entry.targetDelta']));
  });
});
