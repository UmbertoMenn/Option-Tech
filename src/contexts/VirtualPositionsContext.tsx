/**
 * VirtualPositionsContext — sostituisce le posizioni restituite da usePortfolio() per
 * tutto il sottoalbero (pagina Portafoglio virtuale). Fuori dal provider il contesto è
 * null e usePortfolio() resta invariato: nessun altro schermo vede le posizioni virtuali.
 */
import { createContext, useContext } from 'react';
import { Position } from '@/types/portfolio';

export interface VirtualPositionsValue {
  positions: Position[];
}

export const VirtualPositionsContext = createContext<VirtualPositionsValue | null>(null);

export const useVirtualPositionsOverride = () => useContext(VirtualPositionsContext);
