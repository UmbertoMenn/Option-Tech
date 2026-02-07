

## Obiettivo
Correggere definitivamente la lettura dei prezzi con virgola (formato italiano) nel file Excel `.xls` allegato, così da ottenere:
- **Netto Unitario** corretto (es. ~13,xx e non 1.124,50)
- **Rendimento %** e **Rendimento % annualizzato** sempre valorizzati quando disponibili
- **Prima operazione** mostrata anche sotto ai rendimenti (già presente, ma va resa robusta quando si rimuovono righe)
- Rimozione singole operazioni senza “rompere” data/annualizzato

---

## Diagnosi (basata sul file OrderStatus_35.xls e screenshot)
1) Nel file i numeri sono nel formato **italiano**: `8,4`, `14,95`, `2,12`, ecc.
2) Se il parsing passa tramite `XLSX.utils.sheet_to_json(..., { raw: true })` (default), la libreria può convertire alcune celle in **number già “rovinati”** (es. `14,95` → `1495`), e la nostra `parseNumber()` non può più ricostruire la virgola perché vede un `number` e lo ritorna “as-is”.
3) Quando rimuovi un’operazione, la UI ricalcola la “prima operazione” con una regex interna che **non rimuove l’apostrofo** e **non riusa** la stessa logica del parser. Questo può riportare `firstOperationDate = null` e quindi **annualizzato = 0** dopo una rimozione, anche se prima era corretto.

---

## Strategia di Fix (robusta per questo tipo di .xls)
### A) Rendere il parsing numerico indipendente dalla coercizione di XLSX
**Cambiamento chiave**: quando convertiamo i fogli in matrice (`sheet_to_json`), forzare l’output in **testo formattato** invece che “raw number”.

- In `src/lib/orderFileParser.ts`:
  - Cambiare tutte le chiamate a:
    - `XLSX.utils.sheet_to_json(ws, { header: 1 })`
  - in:
    - `XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })`

Motivo: con `raw: false`, la libreria tende a restituire il valore **come lo vedi in Excel** (es. `"14,95"`), così `parseNumber()` può gestire la virgola correttamente.

**Risultato atteso**: `avgPrice` torna a essere `14.95` e non `1495`, quindi `orderValue = qty * avgPrice * 100` non esplode.

---

### B) Rafforzare ulteriormente `parseNumber()` per i casi “sporchi”
In `src/lib/orderFileParser.ts`:
- Prima di lavorare sulla stringa, normalizzare:
  - spazi normali + non-breaking space
  - apostrofi iniziali
  - eventuali simboli valuta

Esempio di normalizzazione (concetto):
- `cleaned = cleaned.replace(/\u00A0/g, '').replace(/^'+/, '')`
- mantenere la logica `.` migliaia e `,` decimali già presente

Obiettivo: gestire bene valori come `"'8,4"` o ` " 14,95 "`.

---

### C) Migliorare il rilevamento “HTML-based .xls” e l’encoding (se necessario)
Senza cambiare il requisito “devo caricare esattamente questo file”, rendiamo più affidabile il ramo HTML:
- Ampliare `isHtmlFile` per riconoscere anche file che non iniziano con `<html>` ma contengono `<table`, `<tr`, `xmlns:x=...`, `<frameset`, ecc.
- Opzionale (se vediamo header corrotti tipo `QtÃ `): tentare decode alternativo con `TextDecoder('windows-1252')` quando l’UTF-8 mostra molte sequenze “Ã”.

Questo non è il fix principale dei numeri, ma evita regressioni su export diversi.

---

## Fix “Annualizzato non carica” (dopo rimozione righe)
### D) Unificare la logica di parsing date tra parser e UI
Problema: `recalculateMetrics()` in `CallPremiumCalculatorDialog.tsx` ricalcola la `firstOperationDate` con regex ad-hoc, diversa dal parser (e non rimuove apostrofi).

Soluzione:
1) In `src/lib/orderFileParser.ts` creare ed esportare una utility unica, ad esempio:
   - `export function toIsoDateFromIT(value: string): string | null`
   - `export function findFirstOperationDate(validityDates: (string | undefined)[]): string | null`
2) Usare questa utility:
   - in `filterAndCalculateCallPremiums` (al posto della logica locale)
   - in `CallPremiumCalculatorDialog.tsx` dentro `recalculateMetrics()` (al posto del blocco regex)

Risultato: rimuovendo righe, la “Prima operazione” resta corretta, e l’**annualizzato** continua a calcolarsi.

---

## UI: Data prima operazione sotto i rendimenti (richiesta utente)
### E) Rendere la riga “Prima operazione” sempre coerente e “piccola”
Hai già la riga sotto i rendimenti (dal diff). La sistemiamo così:
- Mostrare:
  - `Prima operazione: DD/MM/YYYY`
  - opzionale: `Giorni: N` (utile per capire l’annualizzato), in piccolo
- Se `firstOperationDate` è `null`, mostrare:
  - `Prima operazione: - (non trovata nel file)` in muted, per trasparenza

---

## Controlli di coerenza (anti-valori assurdi)
### F) Sanity checks post-parse (solo per debug e prevenzione)
Dopo aver parsato gli ordini:
- verificare:
  - `avgPrice` tipicamente < 500 (configurabile)
  - `quantity` tipicamente intera e piccola
- se troviamo molti `avgPrice` interi “troppo grandi” (es. 1495), loggare un warning e forzare un percorso di parsing alternativo (HTML table oppure raw:false).

Questo serve per intercettare subito casi come lo screenshot.

---

## Test plan (da fare in preview)
1) Caricare `OrderStatus_35.xls`
2) Verificare nella tabella operazioni:
   - prezzi come `8.40`, `14.95`, `2.12` (non 84 / 1495)
3) Verificare:
   - Netto Unitario non più a 4 cifre
   - Rendimento % e Annualizzato non sono 0
4) Rimuovere 2-3 operazioni e verificare che:
   - “Prima operazione” resta corretta
   - “Annualizzato” continua a cambiare e non torna 0
5) Caricare anche `OrderStatus_33.xls` (regressione) per confermare compatibilità

---

## File coinvolti
1) `src/lib/orderFileParser.ts`
   - `sheet_to_json` con `{ raw:false, defval:'' }`
   - normalizzazione più robusta in `parseNumber`
   - export di utility per date + primo giorno
   - miglioramento `isHtmlFile` (se necessario)
2) `src/components/derivatives/CallPremiumCalculatorDialog.tsx`
   - `recalculateMetrics()` usa le utility esportate per data
   - UI: mantenere “Prima operazione” sotto rendimenti, con fallback se null

