import { describe, it, expect } from 'vitest';
import { canOpenStrategyWizard, canSaveStrategyConfig, shouldRecomputeAfterBatchSave } from '@/lib/strategyConfigGates';
import { autoClassify } from '@/components/derivatives/StrategyConfigWizard';
import { Position } from '@/types/portfolio';

describe('canOpenStrategyWizard', () => {
  it('bug camillodc: DR-CC solo azioni (UBER) senza derivati → wizard raggiungibile', () => {
    expect(canOpenStrategyWizard(0, 1)).toBe(true);
  });

  it('derivati presenti, nessuna config → wizard raggiungibile', () => {
    expect(canOpenStrategyWizard(3, 0)).toBe(true);
  });

  it('né derivati né config → niente da configurare', () => {
    expect(canOpenStrategyWizard(0, 0)).toBe(false);
  });
});

describe('shouldRecomputeAfterBatchSave', () => {
  it('rimozione dell\'ultima strategia (set vuoto) → ricalcolo snapshot', () => {
    expect(shouldRecomputeAfterBatchSave([])).toBe(true);
  });

  it('almeno una config automatica → ricalcolo', () => {
    expect(shouldRecomputeAfterBatchSave([{ config_locked: true }, { config_locked: false }])).toBe(true);
  });

  it('solo override → comportamento invariato (nessun ricalcolo)', () => {
    expect(shouldRecomputeAfterBatchSave([{ config_locked: true }])).toBe(false);
  });
});

describe('wizard senza derivati', () => {
  it('autoClassify con zero derivati non produce strategie (le DR-CC solo azioni vengono dalle config salvate)', () => {
    const uber = {
      id: 'uber', portfolio_id: 'p', description: 'UBER TECHNOLOGIES INC', isin: 'US90353T1007',
      asset_type: 'stock', quantity: 600, current_price: 69.89, currency: 'USD',
    } as unknown as Position;
    expect(autoClassify([], [uber])).toEqual([]);
  });
});

describe('canSaveStrategyConfig', () => {
  it('bug: eliminata l\'ultima strategia (DR-CC UBER) → salvataggio consentito per rimuoverla', () => {
    expect(canSaveStrategyConfig(0, 1)).toBe(true);
  });

  it('strategie presenti → salvataggio consentito', () => {
    expect(canSaveStrategyConfig(2, 0)).toBe(true);
  });

  it('nessuna strategia e nessuna config salvata → niente da salvare', () => {
    expect(canSaveStrategyConfig(0, 0)).toBe(false);
  });
});
