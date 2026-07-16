# Piano — Unificazione identità sottostante e configuratore strategie

Prima di iniziare l'implementazione (grossa, rischiosa e con migration su dati di produzione) allineiamoci sulla strategia. La superficie è ampia: `tickerIdentity.ts`, `derivativeStrategies.ts`, `StrategyConfigWizard.tsx` (1681 righe), `Derivatives.tsx` (3150 righe), `strategyReconciliation.ts`, `strategyAutoReconcile.ts`, `monitoringEngine.ts`, più migration SQL idempotente e nuovi test.

## 1. `src/lib/tickerIdentity.ts` — potenziamento resolver unico

- Alias:
  - `ADBE`: aggiungere `ADOBE SYSTEMS INC` (già presente `ADOBE INC`), verificare completezza.
  - `CRDO`: nuovo canonico con alias `CRDO`, `CREDO`, `CREDO TECHNOLOGY`, `CREDO TECHNOLOGY GRP`, `CREDO TECHNOLOGY GROUP`, `CREDO TECHNOLOGY GROUP HOLDING`, `CREDO TECHNOLOGY GROUP HOLDING LTD`.
  - `MBG`: aggiungere alias storici `DAIMLER`, `DAIMLER AG`, `DAI` e mappare `DAI.DE`, `DAI.F` in `EXCHANGE_TICKER_TO_CANONICAL`.
- Ticker raw brevi ambigui: aggiungere override esplicito in `resolveUnderlyingIdentity` così che `rawTicker="DAI"` restituisca `MBG` (via alias) invece di trattarlo come plain ticker `DAI`. Meccanismo: dopo `normalizeTickerCandidate`, se il candidato è una chiave dichiarata come alias di un canonico diverso, usa il canonico. (Già succede via `ALIAS_TO_TICKER.get(candidate)` se `DAI` è alias di `MBG`; basta aggiungerlo).
- Nuova mappa `ISIN_TO_CANONICAL`:
  ```
  US00724F1012 → ADBE
  KYG254571055 → CRDO
  DE0007100000 → MBG
  ```
- Priorità ISIN: applicato **subito dopo** `linkedStock` autoritativo con ticker pulito, **prima** di ogni risoluzione basata su testo. Un ISIN valido non può essere contraddetto da nome/rawTicker.

## 2. Wizard — rimozione resolver legacy

`StrategyConfigWizard.tsx`:

- Prop nuova `dynamicAliases?: Map<string,string>`.
- Sostituire ogni uso di `getCanonicalKey`/`normalizeForMatching` con `getCanonicalTickerKey({...}, { dynamicAliases })`:
  - stock: `{ rawTicker: stock.ticker, description: stock.description, isin: stock.isin }`
  - derivati: `{ rawTicker: d.underlying || d.ticker, underlyingName: d.underlying, description: d.description }`
  - config esistenti: `{ underlyingName: cfg.underlying }`
- `buildConfigsFromStrategies` e `handleSave`: campo `underlying` salvato = ticker canonico.
- `autoClassify(derivatives, positions, archivedKeys, dynamicAliases)`: la firma cambia; internamente delega a `categorizeDerivatives` passando `{ dynamicAliases }`.
- `matchesAutoClassify`, `filterUnderlyings`, `archivedKeys` confrontano chiavi canoniche.

`Derivatives.tsx`:

- Passa `dynamicAliases` (dal hook `useUnderlyingMappings`, già disponibile) al wizard.
- Gate su `allMappings.isLoading` prima dell'auto-classificazione iniziale e prima di scrivere config auto.
- `archivedKeysList` derivato via `getCanonicalTickerKey`.

## 3. Migration SQL di riparazione (idempotente)

`supabase/migrations/<ts>_strategy_configurations_canonicalize.sql`:

- Funzione PL/pgSQL `_canonicalize_underlying(text) → text` con la stessa mappa alias/ISIN riscritta lato SQL (regex + `CASE`). Per sicurezza copre solo i canonici noti; ciò che non riconosce resta invariato.
- `UPDATE strategy_configurations SET underlying = _canonicalize_underlying(underlying) WHERE _canonicalize_underlying(underlying) <> underlying;`
- Dedup: per ogni `(portfolio_id, underlying_canonico, strategy_type, is_synthetic, linked_stock_id, hash(linked_stock_slot_ids), hash(position_signatures))` mantieni la più vecchia (`MIN(created_at)`), elimina le altre. Nessuna fusione fra strategy diverse: dedup solo su match esatto normalizzato.
- Reset `config_locked = false` sulle configurazioni che coincidono con l'auto-classificazione: **non lo faccio in SQL** (troppo complesso replicare `categorizeDerivatives` lato DB). Lo faccio nel wizard: al mount, se `matchesAutoClassify(config)` allora chiama `cancelOverride` una tantum. Aggiungo flag `override_canceled_at IS NULL AND config_locked = true` come guard, così è idempotente.
- La funzione `_canonicalize_underlying` viene droppata alla fine della migration per non lasciare artefatti.

## 4. Legacy cleanup

- `getCanonicalKey`/`normalizeForMatching` restano esportate: usate ancora da `callBuybacks`, `monitoringEngine`. Aggiungo JSDoc `@deprecated` che punta a `tickerIdentity`.
- `monitoringEngine` e `callBuybacks` **non** rientrano in questa PR (fuori scope: motore di monitoraggio ha una sua semantica separata).

## 5. Test nuovi/aggiornati

`src/test/tickerIdentity.test.ts`:
- ADBE via ticker/nome/ISIN `US00724F1012`.
- CRDO via ticker/nome breve/nome esteso/ISIN `KYG254571055`.
- MBG via `DAI`, `Mercedes-Benz Group`, `MBG`, ISIN `DE0007100000`.

`src/test/strategyWizardUtils.test.ts` (o nuovo):
- `autoClassify` ADBE: stock + short call = CC, long call separata = LEAP, un solo gruppo `ADBE`.
- `autoClassify` CRDO: stock + short call + long put = DRCC.
- `autoClassify` MBG: stock MERCEDES + short call underlying `DAI` = CC.
- `buildConfigsFromStrategies` → `underlying` sempre canonico.
- Nessun falso override alla riapertura.

`src/test/strategyConfigCanonical.test.ts` (nuovo):
- Simula riapertura wizard con config legacy `underlying="Adobe Inc"` e derivati `underlying="ADBE"`: dedup logico, badge Auto, no override.

## 6. Ordine di esecuzione

1. Estendo `tickerIdentity.ts` (alias + ISIN + regressione test).
2. Modifico wizard + Derivatives (con `dynamicAliases`).
3. Aggiungo test e li faccio girare.
4. Genero migration SQL di riparazione.
5. Build finale + riepilogo.

## Dettagli tecnici / rischi

- **Rischio dati**: dedup della migration usa hash su `position_signatures` (JSONB). Uso `md5(position_signatures::text)` dopo normalizzazione con `jsonb_strip_nulls` per stabilità.
- **Rischio matching**: `linked_stock_slot_ids` è array; per il dedup lo ordino con `array(select unnest(x) order by 1)`.
- **Rischio "Adobe" ambiguo**: `_canonicalize_underlying` in SQL riconosce solo pattern espliciti per ADBE/CRDO/MBG (i tre casi documentati) più i 30+ già in mappa statica. Meglio conservativo che rischiare fusioni sbagliate.
- **Nessun tocco a `positions.underlying`**: non richiesto e rischioso. Solo `strategy_configurations`.

Confermi il piano? In particolare: (a) migration limitata a `strategy_configurations` senza toccare `positions`; (b) reset di `config_locked` gestito lato wizard al mount invece che in SQL; (c) `monitoringEngine`/`callBuybacks` fuori scope.
