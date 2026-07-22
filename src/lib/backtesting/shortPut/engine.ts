/**
 * Motore di backtest "Short Put mensile su paniere".
 *
 * Invarianti:
 * - Nessun look-ahead: ogni decisione usa solo la catena EOD della data corrente.
 * - Fill su bid/ask secondo il modello configurato; commissioni su ogni gamba.
 * - Assegnazione modellata cash-settled a scadenza: se ITM, perdita
 *   (strike − spot) × 100 × contratti, registrata come evento esplicito.
 * - Posizioni per titolo indipendenti, cassa unica di portafoglio.
 * Priorità dei controlli giornalieri: scadenza → discesa → salita → time roll.
 * Il contatore roll si azzera quando il ciclo si chiude (scadenza) o quando la
 * posizione rientra sulla prima scadenza (roll_to_front / roll_up).
 */
import {
  daysBetween,
  frontMonthlyExpiry,
  monthlyExpiriesFrom,
} from './expiryCalendar';
import {
  createFillEngine,
  netPremiumPct,
  premiumPct,
  selectDownsideRoll,
  selectEntryStrike,
  selectRollToFront,
  selectSurvivalRoll,
  selectUpsideRollFront,
} from './strikeSelection';
import {
  PutQuote,
  ShortPutBacktestResult,
  ShortPutConfig,
  ShortPutEvent,
  ShortPutEquityPoint,
  ShortPutMarketDataProvider,
  ShortPutOpenPosition,
  ShortPutSymbolSummary,
} from './types';

const SHARES_PER_CONTRACT = 100;

interface SymbolState {
  symbol: string;
  contracts: number;
  position: ShortPutOpenPosition | null;
  maxRollsLogged: boolean;
  rollFailedLogged: boolean;
  entrySkippedLogged: boolean;
  /** Ultimo mid per azione della put in posizione (carry-forward per il MTM). */
  lastMarkPerShare: number | null;
  summary: ShortPutSymbolSummary;
}

function emptySummary(symbol: string, contracts: number): ShortPutSymbolSummary {
  return {
    symbol,
    contracts,
    grossPremiums: 0,
    closeCosts: 0,
    netPremiums: 0,
    commissions: 0,
    assignmentPL: 0,
    realizedPL: 0,
    entries: 0,
    rollsDown: 0,
    rollsUp: 0,
    rollsToFront: 0,
    timeRolls: 0,
    survivalRolls: 0,
    assignments: 0,
    expiredOtm: 0,
  };
}

function findQuote(chain: PutQuote[], expiration: string, strike: number): PutQuote | null {
  return chain.find((q) => q.expiration === expiration && Math.abs(q.strike - strike) < 1e-9) ?? null;
}

export function validateShortPutConfig(config: ShortPutConfig): string[] {
  const errors: string[] = [];
  if (config.basket.length === 0) errors.push('Il paniere deve contenere almeno un titolo.');
  for (const item of config.basket) {
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(item.symbol.trim().toUpperCase())) errors.push(`Ticker non valido: "${item.symbol}".`);
    if (!Number.isInteger(item.contracts) || item.contracts < 1) errors.push(`Contratti non validi per ${item.symbol}.`);
  }
  const symbols = config.basket.map((b) => b.symbol.trim().toUpperCase());
  if (new Set(symbols).size !== symbols.length) errors.push('Il paniere contiene ticker duplicati.');
  if (!config.startDate || !config.endDate || config.startDate >= config.endDate) errors.push('Intervallo date non valido.');
  if (!(config.initialCapital > 0)) errors.push('Capitale iniziale non valido.');
  if (config.entry.minDte < 0) errors.push('DTE minimo non valido.');
  if (config.entry.distancePct < 0 || config.entry.distancePct >= 100) errors.push('Distanza OTM non valida.');
  if (config.entry.premiumTolerancePct < 0) errors.push('Tolleranza premio di ingresso non valida.');
  if (config.downside.triggerDistancePct < 0) errors.push('Soglia trigger discesa non valida.');
  if (config.downside.rolls.length !== 4) errors.push('Servono esattamente 4 regole di roll in discesa.');
  for (const [i, rule] of config.downside.rolls.entries()) {
    if (rule.netPremiumTolerancePct < 0) errors.push(`Tolleranza roll ${i + 1} non valida.`);
  }
  if (config.downside.maxMonthsForward < 1 || config.downside.maxMonthsForward > 24) errors.push('Cap mesi roll non valido (1-24).');
  if (config.upside.triggerDistancePct <= 0) errors.push('Soglia trigger salita non valida.');
  if (config.upside.minDistancePct < 0 || config.upside.minDistancePct >= 100) errors.push('Distanza minima salita non valida.');
  if (config.execution.commissionPerContract < 0) errors.push('Commissione non valida.');
  return errors;
}

export async function runShortPutBacktest(
  config: ShortPutConfig,
  provider: ShortPutMarketDataProvider,
  providerLabel: string,
): Promise<ShortPutBacktestResult> {
  const errors = validateShortPutConfig(config);
  if (errors.length > 0) throw new Error(`Configurazione non valida: ${errors.join(' ')}`);

  const fills = createFillEngine(config.execution);
  const commissionPer = config.execution.commissionPerContract;

  const states = new Map<string, SymbolState>();
  for (const item of config.basket) {
    const symbol = item.symbol.trim().toUpperCase();
    states.set(symbol, {
      symbol,
      contracts: item.contracts,
      position: null,
      maxRollsLogged: false,
      rollFailedLogged: false,
      entrySkippedLogged: false,
      lastMarkPerShare: null,
      summary: emptySummary(symbol, item.contracts),
    });
  }

  // Unione dei giorni di negoziazione di tutti i titoli.
  const tradingDaysBySymbol = new Map<string, Set<string>>();
  const allDays = new Set<string>();
  for (const symbol of states.keys()) {
    const days = await provider.getTradingDays(symbol, config.startDate, config.endDate);
    tradingDaysBySymbol.set(symbol, new Set(days));
    days.forEach((d) => allDays.add(d));
  }
  const calendar = [...allDays].sort();
  if (calendar.length === 0) throw new Error('Nessun giorno di negoziazione nel periodo richiesto.');

  let cash = config.initialCapital;
  const events: ShortPutEvent[] = [];
  const equityCurve: ShortPutEquityPoint[] = [];

  const pushEvent = (event: ShortPutEvent) => {
    events.push(event);
  };

  const tradeCommission = (contracts: number, legs: number) => commissionPer * contracts * legs;

  for (const date of calendar) {
    for (const state of states.values()) {
      if (!tradingDaysBySymbol.get(state.symbol)?.has(date)) continue;
      const spot = await provider.getSpot(state.symbol, date);
      const contracts = state.contracts;
      const multiplier = SHARES_PER_CONTRACT * contracts;

      // Esecuzione roll condivisa (intraday e a scadenza).
      // - roll_down incrementa il contatore; survival_roll lo lascia invariato;
      //   roll_up / roll_to_front / time_roll azzerano (ciclo pulito).
      // - commissionLegs: 2 per i roll intraday (chiudo+apro), 1 a scadenza
      //   (la vecchia gamba si estingue per settlement, non con un trade).
      const performRoll = (
        posArg: ShortPutOpenPosition,
        currentQuoteArg: PutQuote,
        newQuote: PutQuote,
        type: 'roll_down' | 'roll_up' | 'roll_to_front' | 'time_roll' | 'survival_roll',
        commissionLegs: number,
      ) => {
        const closeCost = fills.buyFill(currentQuoteArg) * multiplier;
        const openCredit = fills.sellFill(newQuote) * multiplier;
        const commissions = tradeCommission(contracts, commissionLegs);
        cash += openCredit - closeCost - commissions;
        state.summary.grossPremiums += openCredit;
        state.summary.closeCosts += closeCost;
        state.summary.netPremiums += openCredit - closeCost;
        state.summary.commissions += commissions;
        const netPct = netPremiumPct(fills.sellFill(newQuote), fills.buyFill(currentQuoteArg), newQuote.strike);
        const nextRollCount =
          type === 'roll_down' ? posArg.rollCount + 1 : type === 'survival_roll' ? posArg.rollCount : 0;
        state.position = { ...posArg, strike: newQuote.strike, expiration: newQuote.expiration, rollCount: nextRollCount };
        state.rollFailedLogged = false;
        if (nextRollCount === 0) state.maxRollsLogged = false;
        const verb =
          type === 'survival_roll' ? 'Roll orizzontale' : type === 'roll_down' ? 'Roll discesa' : 'Roll';
        pushEvent({
          date,
          symbol: state.symbol,
          type,
          description: `${verb} ${contracts}× PUT ${posArg.strike} scad. ${posArg.expiration} → ${newQuote.strike} scad. ${newQuote.expiration} (netto ${netPct.toFixed(2)}%)`,
          spot,
          cashFlow: openCredit - closeCost,
          commissions,
          rollCount: nextRollCount,
          from: { strike: posArg.strike, expiration: posArg.expiration },
          to: { strike: newQuote.strike, expiration: newQuote.expiration },
          premiumPct: netPct,
        });
      };

      // 1) Scadenza: settlement alla chiusura dell'ultimo giorno di negoziazione ≤ scadenza.
      if (state.position) {
        const pos = state.position;
        const dte = daysBetween(date, pos.expiration);
        // Settlement solo se la scadenza cade entro il periodo del backtest:
        // altrimenti l'assenza di giorni successivi (fine dati) forzerebbe una
        // chiusura anticipata di posizioni ancora vive. Quelle restano aperte
        // e sono riportate in openPositions.
        const isSettlementDay =
          dte <= 0 ||
          (pos.expiration <= config.endDate &&
            !hasTradingDayBetween(tradingDaysBySymbol.get(state.symbol)!, date, pos.expiration));
        if (isSettlementDay) {
          if (spot >= pos.strike) {
            state.summary.expiredOtm += 1;
            pushEvent({
              date,
              symbol: state.symbol,
              type: 'expired_otm',
              description: `PUT ${pos.strike} scad. ${pos.expiration} scaduta OTM`,
              spot,
              cashFlow: 0,
              commissions: 0,
              from: { strike: pos.strike, expiration: pos.expiration },
            });
            state.position = null;
            state.lastMarkPerShare = null;
            state.maxRollsLogged = false;
            state.rollFailedLogged = false;
            continue;
          }

          // ITM a scadenza: si rolla per non essere assegnati. A scadenza la
          // vecchia gamba vale l'intrinseco (bid = ask = strike − spot).
          const intrinsic = pos.strike - spot;
          const settlementQuote: PutQuote = { expiration: pos.expiration, strike: pos.strike, bid: intrinsic, ask: intrinsic };
          const laterExpiries = monthlyExpiriesFrom(date, 0, config.downside.maxMonthsForward).filter(
            (e) => e > pos.expiration,
          );
          const settlementChain =
            laterExpiries.length > 0 ? await provider.getPutChain(state.symbol, date, laterExpiries) : [];

          let rolled: PutQuote | null = null;
          let rollType: 'roll_down' | 'survival_roll' = 'survival_roll';
          if (pos.rollCount < config.downside.rolls.length && laterExpiries.length > 0) {
            // Ancora in fase gestita: preferisco il roll giù+avanti con premio target.
            const rule = config.downside.rolls[pos.rollCount];
            rolled = selectDownsideRoll(settlementChain, laterExpiries, settlementQuote, rule, fills);
            if (rolled) rollType = 'roll_down';
          }
          if (!rolled && laterExpiries.length > 0) {
            // Fase sopravvivenza (post roll 4, o roll gestito non disponibile):
            // roll orizzontale stesso strike sulla mensile successiva, anche a debito.
            rolled = selectSurvivalRoll(settlementChain, laterExpiries[0], settlementQuote, fills);
            if (rolled) rollType = 'survival_roll';
          }

          if (rolled) {
            performRoll(pos, settlementQuote, rolled, rollType, 1);
          } else {
            // Fallback tecnico: nessuna scadenza successiva nei dati → assegnazione.
            const loss = intrinsic * multiplier;
            cash -= loss;
            state.summary.assignmentPL -= loss;
            state.summary.assignments += 1;
            pushEvent({
              date,
              symbol: state.symbol,
              type: 'assignment',
              description: `Nessuna scadenza successiva disponibile: assegnazione PUT ${pos.strike} scad. ${pos.expiration} (perdita ${intrinsic.toFixed(2)} × ${multiplier})`,
              spot,
              cashFlow: -loss,
              commissions: 0,
              from: { strike: pos.strike, expiration: pos.expiration },
            });
            state.position = null;
            state.lastMarkPerShare = null;
            state.maxRollsLogged = false;
            state.rollFailedLogged = false;
          }
          continue;
        }
      }

      const expirationsToLoad = new Set<string>(monthlyExpiriesFrom(date, 0, config.downside.maxMonthsForward + 1));
      if (state.position) expirationsToLoad.add(state.position.expiration);
      const chain = await provider.getPutChain(state.symbol, date, [...expirationsToLoad].sort());

      // 2) Nessuna posizione → ingresso.
      if (!state.position) {
        const expiration = frontMonthlyExpiry(date, config.entry.minDte);
        const quote = selectEntryStrike(chain, expiration, spot, config.entry, fills);
        if (!quote) {
          if (!state.entrySkippedLogged) {
            state.entrySkippedLogged = true;
            pushEvent({
              date,
              symbol: state.symbol,
              type: 'entry_skipped',
              description: `Nessuno strike valido su ${expiration} (spot ${spot.toFixed(2)}): riprovo ai prossimi close`,
              spot,
              cashFlow: 0,
              commissions: 0,
            });
          }
          continue;
        }
        state.entrySkippedLogged = false;
        const sell = fills.sellFill(quote);
        const credit = sell * multiplier;
        const commissions = tradeCommission(contracts, 1);
        cash += credit - commissions;
        state.summary.grossPremiums += credit;
        state.summary.netPremiums += credit;
        state.summary.commissions += commissions;
        state.summary.entries += 1;
        state.position = {
          symbol: state.symbol,
          contracts,
          strike: quote.strike,
          expiration: quote.expiration,
          rollCount: 0,
          openDate: date,
        };
        pushEvent({
          date,
          symbol: state.symbol,
          type: 'entry',
          description: `Vendita ${contracts}× PUT ${quote.strike} scad. ${quote.expiration} @ ${sell.toFixed(2)}`,
          spot,
          cashFlow: credit,
          commissions,
          to: { strike: quote.strike, expiration: quote.expiration },
          premiumPct: premiumPct(sell, quote.strike),
        });
        continue;
      }

      const pos = state.position;
      const currentQuote = findQuote(chain, pos.expiration, pos.strike);
      if (!currentQuote) continue; // quote mancante: nessuna decisione senza dati

      // 3) Trigger discesa.
      const downsideTriggered = spot <= pos.strike * (1 + config.downside.triggerDistancePct / 100);
      if (downsideTriggered) {
        if (pos.rollCount >= config.downside.rolls.length) {
          if (!state.maxRollsLogged) {
            state.maxRollsLogged = true;
            pushEvent({
              date,
              symbol: state.symbol,
              type: 'max_rolls_reached',
              description: `Roll ${config.downside.rolls.length} gestiti esauriti: si mantiene fino a scadenza, poi roll orizzontale a ogni scadenza finché OTM`,
              spot,
              cashFlow: 0,
              commissions: 0,
              rollCount: pos.rollCount,
            });
          }
          // Nessun roll intraday: la gestione avviene a scadenza (roll orizzontale).
          continue;
        }
        const rule = config.downside.rolls[pos.rollCount];
        const laterExpiries = monthlyExpiriesFrom(date, 0, config.downside.maxMonthsForward).filter(
          (e) => e > pos.expiration,
        );
        const rolled = selectDownsideRoll(chain, laterExpiries, currentQuote, rule, fills);
        if (rolled) {
          performRoll(pos, currentQuote, rolled, 'roll_down', 2);
        } else if (!state.rollFailedLogged) {
          state.rollFailedLogged = true;
          pushEvent({
            date,
            symbol: state.symbol,
            type: 'roll_down_failed',
            description: `Trigger discesa attivo ma nessuno strike con premio netto ${rule.netPremiumTargetPct}±${rule.netPremiumTolerancePct}% entro ${config.downside.maxMonthsForward} mesi: riprovo ai prossimi close`,
            spot,
            cashFlow: 0,
            commissions: 0,
            rollCount: pos.rollCount,
          });
        }
        continue;
      }

      // 4) Trigger salita.
      const upsideDistance = ((spot - pos.strike) / spot) * 100;
      if (upsideDistance >= config.upside.triggerDistancePct) {
        const front = frontMonthlyExpiry(date, config.entry.minDte);
        if (pos.expiration <= front) {
          // Prima scadenza: roll al rialzo (stessa scadenza se ha ancora DTE sufficienti, altrimenti la front).
          const targetExpiry = daysBetween(date, pos.expiration) >= config.entry.minDte ? pos.expiration : front;
          const rolled = selectUpsideRollFront(chain, targetExpiry, spot, currentQuote, config.upside, fills);
          if (rolled) {
            performRoll(pos, currentQuote, rolled, 'roll_up', 2);
            continue;
          }
        } else {
          // Scadenza successiva alla prima: rientro sulla front.
          const rolled = selectRollToFront(chain, front, spot, currentQuote, config.upside, fills);
          if (rolled) {
            performRoll(pos, currentQuote, rolled, 'roll_to_front', 2);
            continue;
          }
        }
      }

      // 5) Time roll: sotto timeRollAtDte, senza trigger, si passa alla mensile successiva.
      const dte = daysBetween(date, pos.expiration);
      if (config.maintenance.timeRollAtDte > 0 && dte < config.maintenance.timeRollAtDte) {
        const nextExpiry = frontMonthlyExpiry(date, config.entry.minDte);
        if (nextExpiry > pos.expiration) {
          const quote = selectEntryStrike(chain, nextExpiry, spot, config.entry, fills);
          if (quote) {
            const netPct = netPremiumPct(fills.sellFill(quote), fills.buyFill(currentQuote), quote.strike);
            if (netPct >= 0) {
              performRoll(pos, currentQuote, quote, 'time_roll', 2);
              continue;
            }
          }
        }
      }
    }

    // Mark-to-market di fine giornata: equity = cassa − costo di chiusura (mid)
    // delle posizioni aperte. Se la quote manca o il titolo non negozia oggi,
    // carry-forward dell'ultimo mid noto con floor al valore intrinseco: una
    // quote assente non può mai azzerare una passività reale.
    let liabilities = 0;
    for (const state of states.values()) {
      if (!state.position) continue;
      const pos = state.position;
      const isTradingToday = tradingDaysBySymbol.get(state.symbol)?.has(date) ?? false;
      let markPerShare = state.lastMarkPerShare ?? 0;
      if (isTradingToday) {
        const spot = await provider.getSpot(state.symbol, date);
        const intrinsic = Math.max(pos.strike - spot, 0);
        const chain = await provider.getPutChain(state.symbol, date, [pos.expiration]);
        const quote = findQuote(chain, pos.expiration, pos.strike);
        markPerShare = quote ? Math.max((quote.bid + quote.ask) / 2, intrinsic) : Math.max(markPerShare, intrinsic);
        state.lastMarkPerShare = markPerShare;
      }
      liabilities += markPerShare * SHARES_PER_CONTRACT * pos.contracts;
    }
    equityCurve.push({ date, equity: cash - liabilities, cash });
  }

  // Conteggi eventi per tipo nel riepilogo.
  for (const event of events) {
    const summary = states.get(event.symbol)?.summary;
    if (!summary) continue;
    if (event.type === 'roll_down') summary.rollsDown += 1;
    if (event.type === 'roll_up') summary.rollsUp += 1;
    if (event.type === 'roll_to_front') summary.rollsToFront += 1;
    if (event.type === 'time_roll') summary.timeRolls += 1;
    if (event.type === 'survival_roll') summary.survivalRolls += 1;
  }
  for (const state of states.values()) {
    state.summary.realizedPL =
      state.summary.netPremiums + state.summary.assignmentPL - state.summary.commissions;
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? cash;
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  const summaries = [...states.values()].map((s) => s.summary);
  return {
    config,
    equityCurve,
    events,
    bySymbol: summaries,
    finalEquity,
    totalPL: finalEquity - config.initialCapital,
    totalPLPct: ((finalEquity - config.initialCapital) / config.initialCapital) * 100,
    maxDrawdownPct,
    totalCommissions: summaries.reduce((acc, s) => acc + s.commissions, 0),
    totalNetPremiums: summaries.reduce((acc, s) => acc + s.netPremiums, 0),
    openPositions: [...states.values()].flatMap((s) => (s.position ? [s.position] : [])),
    dataProviderLabel: providerLabel,
  };
}

/** True se esiste un giorno di negoziazione strettamente dopo `date` e ≤ `expiration`. */
function hasTradingDayBetween(tradingDays: Set<string>, date: string, expiration: string): boolean {
  for (const day of tradingDays) {
    if (day > date && day <= expiration) return true;
  }
  return false;
}
