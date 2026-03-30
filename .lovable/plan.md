

## Ripristino configurazioni salvate nel Wizard

### Problema
Quando si apre "Riconfigura strategie", il wizard resetta sempre `strategies` a `[]` (riga 408 di `StrategyConfigWizard.tsx`). Le configurazioni salvate in `existingConfigs` vengono ignorate, costringendo l'utente a riconfigurare tutto da zero.

### Soluzione
All'apertura del wizard, ricostruire le `WizardStrategy[]` dalle `existingConfigs` salvate, associando ogni `PositionSignature` alla posizione corrente corrispondente (matching per option_type, strike, expiry, quantity_sign). Le posizioni matchate vengono assegnate alle strategie; quelle non matchate restano nel pool disponibile.

### Modifiche a `src/components/derivatives/StrategyConfigWizard.tsx`

1. **Nuova funzione `restoreFromConfigs`**: per ogni config in `existingConfigs`, scorre le `position_signatures` e cerca la posizione corrente corrispondente in `allAvailable` (stessa logica di `signaturesMatch` del reconciliation). Per le config con `linked_stock_id`, cerca anche lo slot stock corrispondente. Costruisce un array di `WizardStrategy` con le posizioni trovate.

2. **Aggiornare `handleOpenChange`** (riga 407-413): invece di `setStrategies([])`, chiamare `restoreFromConfigs()` che popola `strategies` con le configurazioni salvate e le posizioni attuali associate.

Logica di matching per ogni signature:
```text
Per ogni config in existingConfigs:
  Per ogni signature in config.position_signatures:
    Cerca in allAvailable (stessa underlying key) una posizione dove:
      - option_type === signature.option_type
      - strike_price === signature.strike
      - expiry_date === signature.expiry
      - sign(quantity) === signature.quantity_sign
      - non già assegnata ad altra strategia
  Se linked_stock_id → cerca stock slot corrispondente
  Crea WizardStrategy con posizioni trovate, strategyType da config
```

### Nessuna modifica ad altri file
Il wizard ha già accesso a `existingConfigs` e `allAvailable` — serve solo la logica di restore.

