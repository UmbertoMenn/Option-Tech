/**
 * Gambe filtrabili (PUT/CALL ITM/OTM, scadenza) delle strategie derivati.
 * Lo spot è risolto con la STESSA chiave usata dalle pagine per lo stato ITM/OTM
 * (underlyingPrices[option.underlying] per le gambe singole,
 * underlyingPrices[strategy.underlying] per IC/DD/gruppi), così il filtro non
 * contraddice mai il badge mostrato a fianco della riga.
 */
import type {
  CoveredCallPosition,
  DeRiskingCoveredCallPosition,
  DoubleDiagonalPosition,
  GroupedOtherStrategy,
  IncompleteStrategyPosition,
  IronCondorPosition,
  LeapCallPosition,
  LongPutPosition,
  NakedPutPosition,
} from '@/lib/derivativeStrategies';
import { optionPositionsToLegs, type FilterableLeg } from '@/lib/optionLegFilter';

export type PriceMap = Record<string, { price?: number | null } | undefined>;

export function spotFromPrices(prices: PriceMap | undefined, key: string | null | undefined): number | null {
  if (!prices || !key) return null;
  const px = Number(prices[key]?.price ?? 0);
  return Number.isFinite(px) && px > 0 ? px : null;
}

export function coveredCallLegs(cc: CoveredCallPosition, prices: PriceMap): FilterableLeg[] {
  return optionPositionsToLegs(
    [cc.option, cc.syntheticCall, cc.syntheticPut],
    spotFromPrices(prices, cc.option.underlying),
  );
}

export function deRiskingCoveredCallLegs(dr: DeRiskingCoveredCallPosition, prices: PriceMap): FilterableLeg[] {
  const cc = dr.coveredCall;
  return optionPositionsToLegs(
    [cc.option, dr.protectionPut, dr.syntheticPut ?? cc.syntheticPut, dr.syntheticCall ?? cc.syntheticCall],
    spotFromPrices(prices, cc.option.underlying),
  );
}

export function ironCondorLegs(ic: IronCondorPosition, prices: PriceMap): FilterableLeg[] {
  return optionPositionsToLegs([ic.soldPut, ic.boughtPut, ic.soldCall, ic.boughtCall], spotFromPrices(prices, ic.underlying));
}

export function doubleDiagonalLegs(dd: DoubleDiagonalPosition, prices: PriceMap): FilterableLeg[] {
  return optionPositionsToLegs([dd.soldPut, dd.boughtPut, dd.soldCall, dd.boughtCall], spotFromPrices(prices, dd.underlying));
}

export function singleOptionLegs(
  item: NakedPutPosition | LeapCallPosition | LongPutPosition,
  prices: PriceMap,
): FilterableLeg[] {
  return optionPositionsToLegs([item.option], spotFromPrices(prices, item.option.underlying));
}

export function groupedStrategyLegs(group: GroupedOtherStrategy, prices: PriceMap): FilterableLeg[] {
  return optionPositionsToLegs(group.options.map((o) => o.option), spotFromPrices(prices, group.underlying));
}

/** Strategia incompleta: lo spot è quello già risolto dall'intestazione della riga (può mancare). */
export function incompleteStrategyLegs(inc: IncompleteStrategyPosition, spot: number | null): FilterableLeg[] {
  return optionPositionsToLegs(inc.presentLegs, spot);
}
