import { describe, it, expect } from 'vitest';
import {
  decideWizardResume,
  wizardActiveKey,
  wizardDraftKey,
  WIZARD_RESUME_TTL_MS,
} from '@/lib/strategyWizardResume';

const NOW = 1_700_000_000_000;
const marker = (ts: number) => JSON.stringify({ ts });

describe('decideWizardResume', () => {
  it('non riapre se non esiste marker', () => {
    expect(decideWizardResume(null, true, NOW)).toEqual({ resume: false, clearMarker: false });
  });

  it('riapre con marker fresco e draft presente (reload della pagina)', () => {
    expect(decideWizardResume(marker(NOW - 1000), true, NOW)).toEqual({
      resume: true,
      clearMarker: false,
    });
  });

  it('non riapre se il marker è fresco ma il draft non esiste (marker orfano)', () => {
    expect(decideWizardResume(marker(NOW - 1000), false, NOW)).toEqual({
      resume: false,
      clearMarker: true,
    });
  });

  it('non riapre oltre il TTL', () => {
    expect(decideWizardResume(marker(NOW - WIZARD_RESUME_TTL_MS), true, NOW)).toEqual({
      resume: false,
      clearMarker: true,
    });
  });

  it('riapre appena entro il TTL', () => {
    expect(decideWizardResume(marker(NOW - WIZARD_RESUME_TTL_MS + 1), true, NOW).resume).toBe(true);
  });

  it('scarta marker malformato', () => {
    expect(decideWizardResume('{non-json', true, NOW)).toEqual({ resume: false, clearMarker: true });
    expect(decideWizardResume('{}', true, NOW)).toEqual({ resume: false, clearMarker: true });
    expect(decideWizardResume(marker(NaN), true, NOW)).toEqual({ resume: false, clearMarker: true });
  });

  it('scarta marker con timestamp nel futuro', () => {
    expect(decideWizardResume(marker(NOW + 60_000), true, NOW)).toEqual({
      resume: false,
      clearMarker: true,
    });
  });

  it('le chiavi sono scoped per portafoglio e allineate al draft del wizard', () => {
    expect(wizardActiveKey('abc')).toBe('strategyConfigWizardActive:abc');
    expect(wizardDraftKey('abc')).toBe('strategyConfigWizardDraft:abc');
    expect(wizardActiveKey('abc')).not.toBe(wizardActiveKey('def'));
  });
});
