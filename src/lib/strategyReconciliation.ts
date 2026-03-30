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
  // Compare expiry by date string (YYYY-MM-DD)
  const posExpiry = pos.expiry_date || '';
  const sigExpiry = sig.expiry || '';
  if (posExpiry !== sigExpiry) return false;
  // Compare quantity sign
  const posSign = pos.quantity >= 0 ? 1 : -1;
  if (posSign !== sig.quantity_sign) return false;
  return true;
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

      // Check each saved signature against current positions
      for (const sig of signatures) {
        const matchingPos = currentPositionsForUnderlying.find(
          p => !matchedPositionIds.has(p.id) && signaturesMatch(sig, p)
        );
        if (matchingPos) {
          matchedPositionIds.add(matchingPos.id);
          legs.push({
            signature: sig,
            label: formatSigLabel(sig),
            status: 'present',
            position: matchingPos,
          });
        } else {
          legs.push({
            signature: sig,
            label: formatSigLabel(sig),
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
