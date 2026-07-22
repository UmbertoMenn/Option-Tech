import { BacktestConfig, BacktestValidationIssue } from './types';
import { getStrategyDefinition } from './strategyCatalog';

export function validateBacktestConfig(config: BacktestConfig): BacktestValidationIssue[] {
  const issues: BacktestValidationIssue[] = [];
  const error = (field: string, message: string) => issues.push({ field, message, severity: 'error' as const });
  const warning = (field: string, message: string) => issues.push({ field, message, severity: 'warning' as const });

  getStrategyDefinition(config.strategyId);

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(config.symbol.trim().toUpperCase())) {
    error('symbol', 'Inserisci un ticker valido.');
  }
  if (!config.startDate || !config.endDate || config.startDate > config.endDate) {
    error('dateRange', 'La data iniziale deve precedere la data finale.');
  }
  if (!Number.isFinite(config.initialCapital) || config.initialCapital <= 0) {
    error('initialCapital', 'Il capitale iniziale deve essere maggiore di zero.');
  }
  if (!Number.isInteger(config.contracts) || config.contracts < 1) {
    error('contracts', 'Il numero di contratti deve essere un intero positivo.');
  }
  if (config.entry.minDte < 0 || config.entry.maxDte < config.entry.minDte) {
    error('entry.dte', 'La finestra DTE non è valida.');
  }
  if (config.entry.selectionMode === 'delta' && (config.entry.targetDelta <= 0 || config.entry.targetDelta >= 1)) {
    error('entry.targetDelta', 'Il delta target deve essere compreso tra 0 e 1.');
  }
  if (config.entry.maxBidAskSpreadPct <= 0 || config.entry.maxBidAskSpreadPct > 100) {
    error('entry.maxBidAskSpreadPct', 'Lo spread bid/ask massimo deve essere compreso tra 0 e 100%.');
  }
  if (config.management.takeProfitPct <= 0 || config.management.takeProfitPct > 100) {
    error('management.takeProfitPct', 'Il take profit deve essere compreso tra 0 e 100%.');
  }
  if (config.management.rollAtDte > config.entry.maxDte) {
    warning('management.rollAtDte', 'Il roll DTE è oltre la finestra di ingresso: verifica che sia intenzionale.');
  }
  if (config.execution.fillPriceModel === 'mid' && config.execution.slippagePctOfSpread > 0) {
    warning('execution.slippagePctOfSpread', 'Lo slippage viene ignorato quando il modello di fill è MID puro.');
  }
  if (config.risk.maxCapitalPerTradePct <= 0 || config.risk.maxCapitalPerTradePct > 100) {
    error('risk.maxCapitalPerTradePct', 'Il capitale massimo per trade deve essere compreso tra 0 e 100%.');
  }
  if (config.risk.allowNakedOptions) {
    warning('risk.allowNakedOptions', 'Le opzioni naked aumentano il rischio e richiedono un modello di margine dedicato.');
  }
  if (config.barSize === '1m') {
    warning('barSize', 'Le richieste intraday sono più pesanti; la prima fase viene validata su dati EOD.');
  }

  return issues;
}

export const ENGINE_INVARIANTS = [
  'Nessun look-ahead: una decisione usa solo quote disponibili alla data/ora corrente.',
  'Le opzioni sono valorizzate su bid/ask reali; il last non è un fill implicito.',
  'Commissioni e slippage sono applicati a ogni gamba e a ogni roll.',
  'Le gambe mancanti restano incomplete / da sostituire finché payoff e finalità non cambiano.',
  'Assegnazione, esercizio e scadenza generano eventi contabili espliciti.',
  'La strategia viene trasformata solo se cambia il profilo economico o l’intento di gestione.',
] as const;
