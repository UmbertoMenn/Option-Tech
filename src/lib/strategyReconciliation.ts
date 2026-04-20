import { Position } from '@/types/portfolio';
import { StrategyConfiguration, PositionSignature } from '@/hooks/useStrategyConfigurations';
import { normalizeForMatching, getCanonicalKey } from '@/lib/derivativeStrategies';

export interface LegStatus {
  signature: PositionSignature;
  label: string;
  status: 'present' | 'missing' | 'new';
  position?: Position; // the actual position (for present/new)
}

export interface ReconciliationItem {
  config: StrategyConfiguration;
  underlying: string;
  strategyType: string;
  legs: LegStatus[];
  hasChanges: boolean;
  /**
   * True quando la configurazione è obsoleta:
   * tutte le firme originali sono ora "missing" (la strategia non esiste più
   * nel portafoglio). Esempio: IC META con 4 gambe → upload con 3 gambe.
   */
  isObsolete?: boolean;
  /**
   * True quando la configurazione è degradata: numero di leg presenti
   * inferiore a quello atteso dal tipo di strategia (es. iron_condor con
   * solo 3 gambe presenti su 4).
   */
  isDegraded?: boolean;
  /** Numero di firme "missing" su totale */
  missingCount?: number;
  totalSignatures?: number;
}

/** Numero di gambe "essenziali" attese per ogni strategia */
const EXPECTED_LEG_COUNTS: Record<string, number> = {
  iron_condor: 4,
  double_diagonal: 4,
  put_spread: 2,
  diagonal_put_spread: 2,
  derisking_covered_call: 2,
  covered_call: 1,
  naked_put: 1,
  leap_call: 1,
  other: 1,
};

function normalizeUnderlying(text: string): string {
  return getCanonicalKey(text) || normalizeForMatching(text);
}

function signaturesMatch(sig: PositionSignature, pos: Position): boolean {
  if (pos.asset_type !== 'derivative') return false;
  const optType = (pos.option_type || '').toLowerCase();
  const sigType = (sig.option_type || '').toLowerCase();
  if (optType !== sigType) return false;
  if (Math.abs((pos.strike_price || 0) - sig.strike) > 0.01) return false;
  const posExpiry = pos.expiry_date || '';
  const sigExpiry = sig.expiry || '';
  if (posExpiry !== sigExpiry) return false;
  const posSign = pos.quantity >= 0 ? 1 : -1;
  if (posSign !== sig.quantity_sign) return false;
  return true;
}

/**
 * Match a signature against positions, consuming up to quantity_abs contracts.
 * A single position row with |quantity| >= needed counts as a full match.
 * usedQuantity tracks how many contracts have been consumed per position.
 */
function matchSignatureMulti(
  sig: PositionSignature,
  pool: Position[],
  matchedSet: Set<string>,
  usedQuantity: Map<string, number>,
): { matched: Position[]; matchedCount: number } {
  const needed = sig.quantity_abs || 1;
  let remaining = needed;
  const matched: Position[] = [];

  for (const p of pool) {
    if (remaining <= 0) break;
    if (matchedSet.has(p.id)) continue;
    if (!signaturesMatch(sig, p)) continue;

    const totalAvail = Math.abs(p.quantity);
    const alreadyUsed = usedQuantity.get(p.id) || 0;
    const available = totalAvail - alreadyUsed;
    if (available <= 0) continue;

    const take = Math.min(available, remaining);
    usedQuantity.set(p.id, alreadyUsed + take);
    remaining -= take;
    matched.push(p);

    // Mark fully consumed positions
    if (alreadyUsed + take >= totalAvail) {
      matchedSet.add(p.id);
    }
  }

  return { matched, matchedCount: needed - remaining };
}

function formatSigLabel(sig: PositionSignature): string {
  const side = sig.quantity_sign < 0 ? 'V' : 'A';
  const type = (sig.option_type || '?').toUpperCase();
  const strike = sig.strike || '?';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  let expiryStr = '-';
  if (sig.expiry) {
    const d = new Date(sig.expiry);
    expiryStr = `${months[d.getMonth()]}/${d.getFullYear().toString().slice(-2)}`;
  }
  return `${side} ${type} ${strike} ${expiryStr}`;
}

function formatPositionLabel(p: Position): string {
  const side = p.quantity < 0 ? 'V' : 'A';
  const type = (p.option_type || '?').toUpperCase();
  const strike = p.strike_price || '?';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  let expiryStr = '-';
  if (p.expiry_date) {
    const d = new Date(p.expiry_date);
    expiryStr = `${months[d.getMonth()]}/${d.getFullYear().toString().slice(-2)}`;
  }
  return `${side} ${type} ${strike} ${expiryStr}`;
}

/**
 * Compare saved strategy configurations against current positions.
 * Returns only items with changes (missing or new legs).
 */
export function reconcileConfigs(
  configs: StrategyConfiguration[],
  currentPositions: Position[],
): ReconciliationItem[] {
  const derivativePositions = currentPositions.filter(p => p.asset_type === 'derivative');
  const items: ReconciliationItem[] = [];

  // Group configs by underlying (normalized)
  const configsByUnderlying = new Map<string, StrategyConfiguration[]>();
  for (const config of configs) {
    const key = normalizeUnderlying(config.underlying);
    if (!configsByUnderlying.has(key)) configsByUnderlying.set(key, []);
    configsByUnderlying.get(key)!.push(config);
  }

  // Group current derivative positions by normalized underlying
  const positionsByUnderlying = new Map<string, Position[]>();
  for (const pos of derivativePositions) {
    const raw = pos.underlying || pos.description || '';
    const key = normalizeUnderlying(raw);
    if (!positionsByUnderlying.has(key)) positionsByUnderlying.set(key, []);
    positionsByUnderlying.get(key)!.push(pos);
  }

  // For each config, check legs
  for (const [underlyingKey, cfgs] of configsByUnderlying) {
    const currentPositionsForUnderlying = positionsByUnderlying.get(underlyingKey) || [];
    
    for (const config of cfgs) {
      const signatures = (config.position_signatures as unknown as PositionSignature[]) || [];
      if (signatures.length === 0) continue;

      const legs: LegStatus[] = [];
      const matchedPositionIds = new Set<string>();
      const usedQuantity = new Map<string, number>();

      // Check each saved signature against current positions (respecting quantity_abs)
      for (const sig of signatures) {
        const needed = sig.quantity_abs || 1;
        const { matched, matchedCount } = matchSignatureMulti(sig, currentPositionsForUnderlying, matchedPositionIds, usedQuantity);
        if (matchedCount >= needed) {
          // All contracts found
          legs.push({
            signature: sig,
            label: formatSigLabel(sig) + (needed > 1 ? ` ×${needed}` : ''),
            status: 'present',
            position: matched[0],
          });
        } else if (matchedCount > 0) {
          // Partial match — mark present for what we found, missing for the rest
          legs.push({
            signature: { ...sig, quantity_abs: matchedCount },
            label: formatSigLabel(sig) + ` ×${matchedCount}`,
            status: 'present',
            position: matched[0],
          });
          legs.push({
            signature: { ...sig, quantity_abs: needed - matchedCount },
            label: formatSigLabel(sig) + ` ×${needed - matchedCount}`,
            status: 'missing',
          });
        } else {
          legs.push({
            signature: sig,
            label: formatSigLabel(sig) + (needed > 1 ? ` ×${needed}` : ''),
            status: 'missing',
          });
        }
      }

      // Find new positions not covered by any signature in any config for this underlying
      const allSignaturesForUnderlying = cfgs.flatMap(
        c => (c.position_signatures as unknown as PositionSignature[]) || []
      );
      
      for (const pos of currentPositionsForUnderlying) {
        if (matchedPositionIds.has(pos.id)) continue;
        // Check if this position is matched by any other config's signature
        const coveredByOtherConfig = cfgs.some(c => {
          if (c.id === config.id) return false;
          const otherSigs = (c.position_signatures as unknown as PositionSignature[]) || [];
          return otherSigs.some(s => signaturesMatch(s, pos));
        });
        if (coveredByOtherConfig) continue;
        
        // Only add as new if not matched by any signature in this underlying group
        const matchedByAnySig = allSignaturesForUnderlying.some(s => signaturesMatch(s, pos));
        if (!matchedByAnySig) {
          legs.push({
            signature: {
              option_type: pos.option_type || 'unknown',
              strike: pos.strike_price || 0,
              expiry: pos.expiry_date || '',
              quantity_sign: pos.quantity >= 0 ? 1 : -1,
            },
            label: formatPositionLabel(pos),
            status: 'new',
            position: pos,
          });
        }
      }

      const hasChanges = legs.some(l => l.status === 'missing' || l.status === 'new');
      if (hasChanges) {
        items.push({
          config,
          underlying: config.underlying,
          strategyType: config.strategy_type,
          legs,
          hasChanges,
        });
      }
    }
  }

  // Also check for completely new underlyings (positions with no config at all)
  for (const [underlyingKey, positions] of positionsByUnderlying) {
    if (configsByUnderlying.has(underlyingKey)) continue;
    // This underlying has no config at all - skip, as these are handled by the wizard
  }

  return items;
}
