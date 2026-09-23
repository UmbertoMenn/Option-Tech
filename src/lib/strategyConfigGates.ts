/**
 * Regole di visibilità/aggiornamento legate alle configurazioni strategie.
 * Pure, testabili senza React né Supabase.
 */

/**
 * Il wizard strategie va raggiungibile se ci sono derivati da classificare
 * OPPURE configurazioni salvate da gestire. Una Covered Call / De-Risking CC
 * con la sola gamba azionaria (call scadute/chiuse, in attesa di rivendita)
 * resta in pagina anche senza alcun derivato in portafoglio: senza il tasto
 * non sarebbe né modificabile né rimovibile.
 */
export function canOpenStrategyWizard(derivativesCount: number, configsCount: number): boolean {
  return derivativesCount > 0 || configsCount > 0;
}

/**
 * Dopo un salvataggio batch (sostituzione completa) lo snapshot del giorno va
 * ricalcolato se c'è almeno una config automatica, oppure se il set è vuoto:
 * rimuovere l'ultima strategia cambia lo snapshot quanto aggiungerne una.
 */
export function shouldRecomputeAfterBatchSave(configs: { config_locked?: boolean }[]): boolean {
  return configs.length === 0 || configs.some(config => !config.config_locked);
}

/**
 * "Salva Configurazione" nel wizard: abilitato se c'è almeno una strategia
 * OPPURE se esistono config salvate. Con zero strategie e config esistenti il
 * salvataggio è la rimozione di tutte le strategie (es. eliminare l'ultima
 * DR-CC solo azioni): va consentito. Senza strategie né config è un no-op.
 */
export function canSaveStrategyConfig(strategiesCount: number, existingConfigsCount: number): boolean {
  return strategiesCount > 0 || existingConfigsCount > 0;
}
