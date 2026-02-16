

## Fix: Errore salvataggio premi Covered Call

### Problema

La migrazione precedente ha tentato di rimuovere il vecchio vincolo univoco con:
```sql
DROP INDEX IF EXISTS covered_call_premiums_portfolio_id_ticker_key;
```

Ma il nome reale dell'indice nel database e' `covered_call_premiums_portfolio_ticker_key` (senza `_id_`). Di conseguenza, entrambi gli indici coesistono:

- `covered_call_premiums_portfolio_ticker_key` (portfolio_id, ticker) -- il vecchio, ancora attivo
- `covered_call_premiums_portfolio_ticker_symbol_key` (portfolio_id, ticker, option_symbol) -- il nuovo

L'upsert fallisce perche' il vecchio vincolo a 2 colonne viene violato prima che il nuovo a 3 colonne possa essere usato.

### Soluzione

Una singola migrazione SQL per eliminare il vecchio indice con il nome corretto.

### Dettaglio tecnico

**Migrazione database:**

```sql
DROP INDEX IF EXISTS covered_call_premiums_portfolio_ticker_key;
```

Nessuna modifica al codice TypeScript. Il vincolo corretto `covered_call_premiums_portfolio_ticker_symbol_key` e' gia' presente e funzionante.
