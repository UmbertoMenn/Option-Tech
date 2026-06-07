# Fix: il dialog di Riconciliazione Strategie omette i sottostanti completamente nuovi

## Diagnosi

Dopo il caricamento di un nuovo Excel, il dialog di riconciliazione strategie (`StrategyReconciliationDialog`) si apre automaticamente quando `reconcileConfigs(strategyConfigs, positions)` restituisce almeno un item (`src/pages/Derivatives.tsx:391-394, 446-456`).

La funzione `reconcileConfigs` (`src/lib/strategyReconciliation.ts`) gestisce correttamente due casi:

- **Sottostante con config esistente e leg cambiate/nuove** → emette `ReconciliationItem` con leg `missing`/`new`.
- **Sottostante con config invariata** → non emette nulla.

Ma il terzo caso — **derivati su un sottostante che NON ha alcuna configurazione salvata** — viene esplicitamente saltato (righe 262-266: *"This underlying has no config at all - skip, as these are handled by the wizard"*).

Conseguenza: se un upload introduce derivati su un ticker mai configurato prima, questi:
1. **Non** appaiono nel dialog di riconciliazione auto-aperto,
2. L'utente deve poi cliccare manualmente "Configura Strategie" per vederli.

L'utente vuole invece che **tutti** i derivati nuovi (sia su sottostanti esistenti che su sottostanti nuovi) compaiano subito nello stesso dialog.

## Soluzione

Estendere `reconcileConfigs` per emettere anche un `ReconciliationItem` "sintetico" per ogni sottostante con derivati attivi ma senza alcuna `StrategyConfiguration` corrispondente.

Il `StrategyReconciliationDialog` già gestisce naturalmente questi casi: raggruppa per underlying, costruisce `availablePositions` includendo tutti i derivati+stock non assegnati, e se non ci sono leg "present" non costruisce strategie pre-esistenti — esattamente il comportamento desiderato per un sottostante nuovo (l'utente compone da zero, come nel wizard).

### Dettagli tecnici

In `src/lib/strategyReconciliation.ts`, sostituire il blocco di righe 262-266 con:

```ts
for (const [underlyingKey, positions] of positionsByUnderlying) {
  if (configsByUnderlying.has(underlyingKey)) continue;
  if (positions.length === 0) continue;

  // Synthetic config item: all legs marked as 'new', no saved signatures
  const legs: LegStatus[] = positions.map(pos => ({
    signature: {
      option_type: pos.option_type || 'unknown',
      strike: pos.strike_price || 0,
      expiry: pos.expiry_date || '',
      quantity_sign: pos.quantity >= 0 ? 1 : -1,
    },
    label: formatPositionLabel(pos),
    status: 'new',
    position: pos,
  }));

  const syntheticConfig = {
    id: `__new__${underlyingKey}`,
    portfolio_id: '',
    underlying: positions[0].underlying || positions[0].description || underlyingKey,
    strategy_type: 'other',
    position_signatures: [],
    is_synthetic: false,
    linked_stock_id: null,
    linked_stock_slot_ids: [],
    sort_order: 9999,
    created_at: '',
    updated_at: '',
  } as StrategyConfiguration;

  items.push({
    config: syntheticConfig,
    underlying: syntheticConfig.underlying,
    strategyType: 'other',
    legs,
    hasChanges: true,
    isObsolete: false,
    isDegraded: false,
    missingCount: 0,
    totalSignatures: 0,
  });
}
```

Richiede l'import di `StrategyConfiguration` (già presente).

### Verifica downstream

Nel dialog (`StrategyReconciliationDialog.tsx:266-340`):
- `presentPositions` resta vuoto → `strategies: []` per questo gruppo,
- `missingLegs` resta vuoto,
- `availablePositions` include tutti i derivati+stock del sottostante non assegnati,
- L'utente compone strategie come nel wizard, dentro lo stesso dialog.

Il filtro `needsWizard` (Derivatives.tsx:413-435) non interferisce: il wizard auto-open è già condizionato da altre logiche e il dialog di riconciliazione ha precedenza (`!wizardOpen` alla riga 452).

### File modificato

- `src/lib/strategyReconciliation.ts` — solo questa funzione, nessuna altra modifica.

## Cosa NON cambia

- Comportamento per upload senza nuovi sottostanti: identico a prima.
- Wizard "Configura Strategie" manuale: invariato.
- Persistenza, cache strategie, alert: invariati (l'utente salva normalmente dal dialog).
