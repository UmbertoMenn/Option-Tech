/**
 * Logica di ripresa del wizard strategie.
 *
 * Il marker `strategyConfigWizardActive:<portfolioId>` in sessionStorage esiste
 * per un solo motivo: se l'utente ricarica la pagina (F5 / crash / deploy Lovable)
 * mentre il wizard è aperto, il wizard deve riaprirsi con il draft in corso.
 *
 * NON deve invece riaprirsi quando l'utente naviga via dalla pagina (SPA) e poi
 * torna: in quel caso il cleanup di unmount rimuove il marker (React non esegue
 * i cleanup su un reload vero, quindi i due casi restano distinguibili).
 */

export const WIZARD_ACTIVE_KEY_PREFIX = 'strategyConfigWizardActive';
export const WIZARD_DRAFT_KEY_PREFIX = 'strategyConfigWizardDraft';

/** Marker legacy globale (non scoped per portafoglio) — va solo ripulito. */
export const LEGACY_WIZARD_ACTIVE_KEY = 'strategyConfigWizardActive';

/** TTL del marker: serve solo a sopravvivere a un reload, non a giornate intere. */
export const WIZARD_RESUME_TTL_MS = 30 * 60 * 1000;

export function wizardActiveKey(portfolioKey: string): string {
  return `${WIZARD_ACTIVE_KEY_PREFIX}:${portfolioKey}`;
}

export function wizardDraftKey(portfolioKey: string): string {
  return `${WIZARD_DRAFT_KEY_PREFIX}:${portfolioKey}`;
}

export interface ResumeDecision {
  /** Riaprire il wizard? */
  resume: boolean;
  /** Rimuovere il marker orfano da sessionStorage? */
  clearMarker: boolean;
}

/**
 * Decide se riaprire il wizard al mount della pagina.
 * Riapre solo se il marker esiste, è fresco E c'è un draft non salvato
 * per lo stesso portafoglio.
 */
export function decideWizardResume(
  rawMarker: string | null,
  hasDraft: boolean,
  now: number = Date.now(),
): ResumeDecision {
  if (rawMarker == null) return { resume: false, clearMarker: false };

  let ts: number | undefined;
  try {
    ts = (JSON.parse(rawMarker) as { ts?: number })?.ts;
  } catch {
    return { resume: false, clearMarker: true };
  }

  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { resume: false, clearMarker: true };
  }
  if (now - ts >= WIZARD_RESUME_TTL_MS || now - ts < 0) {
    return { resume: false, clearMarker: true };
  }
  if (!hasDraft) {
    return { resume: false, clearMarker: true };
  }
  return { resume: true, clearMarker: false };
}
