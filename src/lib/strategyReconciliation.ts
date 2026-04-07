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
}

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
 * Match a signature against positions, consuming up to quantity_abs matches.
 * Returns matched positions (removed from pool via matchedSet).
 */
function matchSignatureMulti(
  sig: PositionSignature,
  pool: Position[],
  matchedSet: Set<string>,
): Position[] {
  const needed = sig.quantity_abs || 1;
  const results: Position[] = [];
  for (const p of pool) {
    if (results.length >= needed) break;
    if (matchedSet.has(p.id)) continue;
    if (signaturesMatch(sig, p)) {
      matchedSet.add(p.id);
      results.push(p);
    }
  }
  return results;
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

      // Check each saved signature against current positions (respecting quantity_abs)
      for (const sig of signatures) {
        const matched = matchSignatureMulti(sig, currentPositionsForUnderlying, matchedPositionIds);
        if (matched.length >= (sig.quantity_abs || 1)) {
          // All contracts found
          legs.push({
            signature: sig,
            label: formatSigLabel(sig) + (matched.length > 1 ? ` ×${matched.length}` : ''),
            status: 'present',
            position: matched[0],
          });
        } else if (matched.length > 0) {
          // Partial match — mark present for what we found, missing for the rest
          legs.push({
            signature: { ...sig, quantity_abs: matched.length },
            label: formatSigLabel(sig) + ` ×${matched.length}`,
            status: 'present',
            position: matched[0],
          });
          legs.push({
            signature: { ...sig, quantity_abs: (sig.quantity_abs || 1) - matched.length },
            label: formatSigLabel(sig) + ` ×${(sig.quantity_abs || 1) - matched.length}`,
            status: 'missing',
          });
        } else {
          legs.push({
            signature: sig,
            label: formatSigLabel(sig) + ((sig.quantity_abs || 1) > 1 ? ` ×${sig.quantity_abs}` : ''),
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
