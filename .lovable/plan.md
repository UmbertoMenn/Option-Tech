# Causa dell'errore

Caricando il file `PortafoglioT0 (10).xls` il parser estrae correttamente 10 posizioni (1 bond + 9 opzioni) e la liquidità (€35.853,80). L'errore arriva nello **STEP 1 (insert)** del salvataggio su database, non nel parser.

Lo schema della tabella `positions` ha:

| Colonna | Tipo | Valore massimo |
|---|---|---|
| `weight_pct` | `numeric(6,4)` | **±99,9999** |
| `profit_loss_pct` | `numeric(8,4)` | ±9.999,9999 |

Il file contiene il **BOT ANNUALE 14/05/2027** con `% PATR = 106,55`. Quando il client tenta di inserire `weight_pct = 106.55` in una colonna `numeric(6,4)` (max 99.9999), Postgres rifiuta l'INSERT con:

```
numeric field overflow
A field with precision 6, scale 4 must round to an absolute value less than 10^2.
```

Tutta la transazione fallisce (delete + insert) e la UI mostra il toast generico "Errore elaborazione file".

Nota: il bond pesa >100% del controvalore titoli perché il titolo (68k €) è > del controvalore titoli amministrato escludendo la liquidità — è un dato legittimo della banca, non un bug del parser. Lo schema è semplicemente troppo stretto.

# Soluzione

Migrazione che amplia la precisione delle colonne percentuali di `positions` per accettare valori sopra il 100%:

```sql
ALTER TABLE public.positions
  ALTER COLUMN weight_pct      TYPE numeric(10,4),
  ALTER COLUMN profit_loss_pct TYPE numeric(10,4);
```

Nessuna modifica al codice TypeScript: il parser produce già numeri corretti, e tutti i consumatori trattano la colonna come `number`. La modifica è retro-compatibile (allarga il range, non cambia la scala).

# Verifica

Dopo la migrazione, ricaricare il file Portafoglio: l'INSERT delle 10 posizioni va a buon fine e compare il toast "Portfolio caricato! 10 posizioni importate".
