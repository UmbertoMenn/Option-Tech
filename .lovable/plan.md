

## Fix: SAP underlying risolve al ticker US invece che a SAP.DE

### Problema

Nella tabella `underlying_mappings` esiste questa riga:

| underlying | ticker | source |
|------------|--------|--------|
| `SAP` | `SAP` | fetch-underlying-prices |

Le opzioni EUREX su SAP hanno `underlying = 'SAP'`, quindi il sistema risolve al ticker `SAP` (ADR USA, $196.71 USD) invece di `SAP.DE` (Xetra, €165.02 EUR).

Le descrizioni lunghe EUREX (es. `EUREX, SAP, MAR26, 150, PUT...`) sono gia mappate correttamente a `SAP.DE` tramite override manuali, ma il campo `underlying` delle posizioni contiene semplicemente `"SAP"`, che matcha la riga sbagliata.

### Soluzione

Aggiornare il mapping esistente nella tabella `underlying_mappings`:

```sql
UPDATE underlying_mappings
SET ticker = 'SAP.DE', source = 'admin-override', updated_at = now()
WHERE underlying = 'SAP' AND ticker = 'SAP';
```

Singola query SQL, nessun codice da modificare. Il prezzo corretto (SAP.DE, €165.02) verra usato automaticamente da `useUnderlyingPrices` per tutte le posizioni con `underlying = 'SAP'`.

### Verifica

Dopo la modifica, nella tabella `underlying_prices` esistono gia entrambi i prezzi:
- `SAP` → $196.71 USD (ADR, non piu usato)
- `SAP.DE` → €165.02 EUR (corretto)

Il sistema prendera automaticamente il prezzo giusto.

