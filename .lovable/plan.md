## Problema

Per SilviaS la card "Netting ex CC e NP" e il punto odierno sul grafico mostrano valori diversi perché lo snapshot in `historical_data` viene salvato anche quando si carica solo la **Gestione Patrimoniale (GP)**, mentre il portafoglio "vero" (file Excel principale) non è stato ricaricato. Il risultato:

- la card ricalcola live sui dati attuali del portafoglio,
- il grafico legge lo snapshot salvato dall'upload GP, che è disallineato rispetto al portafoglio principale.

## Regola desiderata

1. Lo snapshot in `historical_data` deve essere salvato **solo** quando viene caricato un nuovo file Portafoglio (non GP).
2. Quando si carica solo la GP, lo snapshot **non** deve essere creato/aggiornato.
3. Se l'utente carica per prima la GP (e non c'è un portafoglio principale recente per quella data), mostrare un banner/alert che avvisa: "Lo snapshot storico non verrà aggiornato finché non carichi un nuovo file Portafoglio".

## Modifiche

### 1. `src/components/dashboard/FileUploader.tsx`

**Rimuovere** la chiamata a `upsertUploadSnapshot` dal blocco `onDropGP`:

- Eliminare le righe che invocano `upsertUploadSnapshot` dopo il caricamento GP (incluso il refetch di `historical-data`).
- Mantenere invece l'aggiornamento di `gp_total_value` / `gp_cash_value` e l'invalidate di `gp-holdings`/`portfolios`.

Il caricamento Portafoglio (`onDropPortfolio`) continua a chiamare `upsertUploadSnapshot` come oggi: lo snapshot resta legato esclusivamente all'upload del portafoglio principale.

### 2. Banner di avviso post-upload GP

Dopo un caricamento GP riuscito, valutare se mostrare un banner persistente:

- Condizione: esiste almeno un record GP per il portafoglio ma **non** esiste un record `historical_data` con `snapshot_date == portfolios.snapshot_date`, **oppure** il `portfolios.snapshot_date` è più vecchio della data più recente di aggiornamento GP.
- Aggiungere un nuovo componente `GpSnapshotMissingBanner` (in `src/components/dashboard/`) che:
  - mostri un `Alert` (variant warning) sopra la sezione "Carica Portfolio" nella `Dashboard`,
  - testo: "Hai caricato una Gestione Patrimoniale, ma lo snapshot storico verrà aggiornato solo dopo aver caricato un nuovo file Portafoglio."
  - sia chiudibile per sessione (state locale, niente persistenza DB).
- Integrare il banner in `src/components/dashboard/Dashboard.tsx` nella colonna destra della grid principale, sopra `FileUploader`.

In aggiunta, mostrare un `toast.warning` immediato dopo l'upload GP riuscito con lo stesso messaggio breve, così l'utente non lo manca.

### 3. Nessuna modifica a `uploadSnapshot.ts`

La funzione resta invariata. Cambia solo chi la chiama.

### 4. Verifica manuale

Per SilviaS, dopo il deploy:

1. Ricaricare il portafoglio principale → la card e il punto odierno del grafico devono coincidere (lo snapshot viene riallineato).
2. Caricare solo la GP → nessuna scrittura su `historical_data`, banner visibile, card e grafico restano coerenti tra loro (entrambi basati sul vecchio snapshot del portafoglio principale, finché non se ne carica uno nuovo).

## File toccati

- `src/components/dashboard/FileUploader.tsx` (rimozione chiamata snapshot in GP, toast warning)
- `src/components/dashboard/Dashboard.tsx` (inserimento banner)
- `src/components/dashboard/GpSnapshotMissingBanner.tsx` (nuovo)

Nessuna modifica a DB/RLS.
