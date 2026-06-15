# Snapshot storico sempre allineato alle strategie configurate

## Problema

Oggi, dopo l'upload Excel, lo snapshot in `historical_data` viene scritto **prima** che l'utente riconcili / riconfiguri le strategie. Risultato: se ci sono nuovi derivati non ancora mappati in `strategy_configurations`, `categorizeDerivatives` li droppa (regola "unmapped dropped"), il netting risulta sottostimato e l'equity_exposure sovrastimato. Lo snapshot per quella data resta sbagliato fino al prossimo upload.

## Soluzione scelta: snapshot all'upload + ricalcolo al salvataggio config

Mantengo lo snapshot immediato (evita buchi nel grafico) e aggiungo un ricalcolo automatico ogni volta che `strategy_configurations` viene modificata, per la `snapshot_date` corrente del portfolio.

## Cambi previsti

### 1. `src/lib/uploadSnapshot.ts`
Estrai la logica di upsert in una funzione riutilizzabile:
- Mantieni `upsertUploadSnapshot({ portfolioId, snapshotDate, cashValue })` come oggi.
- Aggiungi `recomputeLatestSnapshot(portfolioId)`: legge `portfolios.snapshot_date` e `portfolios.cash_value`, e se la `snapshot_date` esiste richiama la stessa pipeline (positions → overrides → configs → categorize → netting → equity_exposure → upsert in `historical_data` con `onConflict`). No-op se manca la snapshot_date.

### 2. `src/hooks/useStrategyConfigurations.ts`
Dopo ogni mutation che modifica `strategy_configurations` per un portfolio (upsert singolo, upsertBatch, delete), chiama `recomputeLatestSnapshot(portfolioId)` in fire-and-forget nell'`onSuccess`, e invalida `['historical-data']` per aggiornare grafici e card.

### 3. `src/components/dashboard/FileUploader.tsx`
Nessun cambio strutturale: lo snapshot all'upload resta com'è. Il successivo salvataggio del wizard / `StrategyReconciliationDialog` farà partire il ricalcolo automatico.

## Considerazioni

- Il ricalcolo è idempotente perché l'upsert usa `onConflict: 'portfolio_id,snapshot_date'`.
- Si ricalcola SOLO lo snapshot della snapshot_date corrente del portfolio: gli snapshot storici precedenti non vengono toccati (le strategie passate erano valide per quei giorni).
- Fire-and-forget: errori loggati ma non bloccano la UX del wizard.
- Nessuna migration: solo modifiche di codice frontend.

## Out of scope

- Ricalcolo retroattivo di snapshot vecchi.
- Cambi all'AGGREGATED snapshot (non viene scritto a DB).
- Modifiche ai cron job di pricing.
