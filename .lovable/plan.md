

## Problema: Prezzo opzioni EUREX/IDEM preso dal mercato USA

### Diagnosi

La call SAP 185 marzo mostra `current_price = 19.10` invece del valore corretto dall'Excel (`snapshot_price = 2.03`).

Il cron `update-option-prices-cron` risolve SAP → `SAP.DE`, ma Yahoo Finance restituisce la option chain delle opzioni **americane** SAP (non EUREX). Il simbolo OCC `SAP260320C00185000` corrisponde a un contratto US, non europeo. Il prezzo 19.10 USD è completamente sbagliato.

Stesso problema per tutte le opzioni EUREX/IDEM (SAP, FERRARI, TELECOM ITALIA, etc.): Yahoo non supporta le option chain europee.

### Soluzione

Modificare `update-option-prices-cron` per **escludere le opzioni EUREX/IDEM** dall'aggiornamento prezzi, mantenendo il prezzo snapshot dall'Excel come unica fonte affidabile.

**File: `supabase/functions/update-option-prices-cron/index.ts`**

1. Nella query iniziale (Step 1), recuperare anche il campo `description` per ogni derivato
2. Dopo aver ottenuto i derivati, filtrare via tutte le posizioni la cui `description` inizia con `EUREX,` o `IDEM,` — queste opzioni europee non hanno chain su Yahoo
3. Loggare quante posizioni EUREX/IDEM sono state saltate
4. Per le posizioni saltate, **non toccare** `current_price` (rimane il valore snapshot dall'Excel)

### Risultato

- Le opzioni US continuano ad essere aggiornate via Yahoo (funziona correttamente)
- Le opzioni EUREX/IDEM mantengono il prezzo Excel (`snapshot_price`) senza sovrascritture errate
- La call SAP 185 marzo mostrerà 2.03 EUR (dal file) invece di 19.10 USD (sbagliato)

### Correzione immediata dati

Dopo il deploy, eseguire una migration SQL per ripristinare `current_price = snapshot_price` su tutte le posizioni EUREX/IDEM attualmente corrotte.

### File modificati
- `supabase/functions/update-option-prices-cron/index.ts` — filtro EUREX/IDEM + select description

