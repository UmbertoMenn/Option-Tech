
## Obiettivo (definitivo)
Far sì che i file `.xls` come il tuo (che in realtà contengono una tabella HTML con numeri tipo `8,4`, `14,95`) vengano **sempre** letti rispettando la virgola come decimale, così:
- `8,4` → `8.40` (non `84.00`)
- `14,95` → `14.95` (non `1495.00`)
- “Prima operazione” e “Annualizzato” vengano calcolati e mostrati correttamente.

---

## Diagnosi certa (con prova dal tuo file)
Nel file `OrderStatus_35-2.xls` la prima riga dati è chiarissima:

- `Prz Medio` = `8,4` (testo)
- `Data Validità` = `'06/02/2026` (testo con apostrofo iniziale)

Il parser attuale **non riconosce** questo file come “HTML-based Excel” perché controlla solo:
- `<html...` / `<!doctype...` / `xmlns:x="urn:schemas-microsoft-com:office:excel"`

Ma il tuo file inizia con `<table ...>` (non `<html>`), quindi oggi entra nel ramo “Excel binario” (XLSX.read), e lì la libreria sta facendo coercizione “sbagliata”: `8,4` diventa `84` (comma rimossa), quindi in UI vedi `84.00`.

Questa è la causa del bug. Non è “parseNumber” (quella sarebbe ok se ricevesse la stringa `8,4`), è **il ramo di parsing scelto**.

---

## Strategia di fix (robusta e con test automatico)

### 1) Fix definitivo: riconoscimento HTML `.xls` (src/lib/orderFileParser.ts)
Modifica la detection `isHtmlFile` per includere i casi reali come il tuo:
- se `textData.trim().startsWith('<table')`
- oppure se contiene tag tipici: `<table`, `<tr`, `<td`, `</table>`
- includere anche `<frameset` (alcuni export vecchi)

In pratica: se è “HTML table” lo trattiamo come HTML **sempre**, senza farlo passare da XLSX.read(array) che rompe le virgole.

**Criterio di accettazione tecnico:**
- per `OrderStatus_35-2.xls` deve entrare nel ramo `parseHtmlTable(textData)`.

---

### 2) Guardrail anti-regressione: fallback “sanity check” (src/lib/orderFileParser.ts)
Anche se per qualche motivo la detection fallisse, aggiungiamo un secondo livello di sicurezza:
- dopo aver parsato via XLSX, controlliamo se nel set di ordini ci sono prezzi “implausibili” rispetto a un export opzioni (es: tanti `avgPrice >= 500` oppure multipli sospetti tipo 84, 128, 228, 1495)
- se `textData` contiene `<table` e i prezzi risultano “sospetti”, **rifacciamo parsing come HTML** e prendiamo quel risultato.

Questo rende il fix “a prova di export strani”.

---

### 3) Test automatico (vitest) per bloccare per sempre il bug
Aggiungiamo un test unitario nuovo (es. `src/test/orderFileParserHtmlXls.test.ts`) che:
1. Usa come input una stringa HTML presa dal file (anche solo header + 3-5 righe, includendo `8,4` e `14,95`).
2. Passa la stringa nel parsing HTML.
3. Verifica:
   - `avgPrice` della riga `BABAH6C165` è `8.4` (non `84`)
   - `avgPrice` della riga `BABAM6C180` è `14.95` (non `1495`)
4. Verifica anche la data:
   - `toIsoDateFromIT("'12/11/2025")` → `2025-11-12`

Nota: per testare senza `FileReader`, creeremo/estrarremo una funzione pura “parse da textData” (es. `parseOrdersFromTextData(textData: string)` o simile) che viene usata sia in produzione sia nei test.

**Criterio di accettazione test:**
- Il test fallisce se torna 84/1495, quindi impedisce future rotture.

---

### 4) “Controllando e testando” in preview (verifica end-to-end)
Dopo l’implementazione, facciamo un test reale in preview:
- aprire la calcolatrice
- caricare `OrderStatus_35-2.xls`
- controllare in tabella che:
  - `Prezzo` mostra `8,40` / `12,80` / `22,80` / `14,95` (non 84/128/228/1495)
  - `Valore` mostra `+840,00 $` (non `+8.400,00 $`)

---

### 5) UI: rendere evidente il formato italiano anche nella tabella operazioni (CallPremiumCalculatorDialog.tsx)
Per evitare ambiguità visive e rendere immediata la verifica, cambiamo la colonna “Prezzo” da:
- `order.avgPrice.toFixed(2)` (stile inglese `8.40`)
a:
- `formatNumber(order.avgPrice, 2)` (stile italiano `8,40`)

Così se il parsing sbaglia, lo si vede subito (84,00 vs 8,40).

---

### 6) Annualizzato + “Prima operazione” sempre visibili (piccolo sotto i rendimenti)
Oggi la data viene mostrata solo se presente (`{metrics.firstOperationDate && ...}`).
Modifica:
- mostrare sempre una riga sotto ai rendimenti:
  - se data presente: `Prima operazione: 12/11/2025`
  - se assente: `Prima operazione: - (non trovata nel file)`
- opzionale: se data assente, anche “Annualizzato” può mostrare `-` invece di `0,00%` (per distinguere “non calcolabile” da “zero vero”).

Questo evita il caso “annualizzato non carica” perché la UI renderà chiaramente se manca la data o se è un problema di calcolo.

---

## File coinvolti
1) `src/lib/orderFileParser.ts`
- allargare `isHtmlFile` (includere `<table`)
- aggiungere fallback/sanity-check
- estrarre funzione pura per test (parsing da textData)
- aggiungere/aggiornare log di debug solo in `import.meta.env.DEV` (breve e non spam)

2) `src/components/derivatives/CallPremiumCalculatorDialog.tsx`
- colonna prezzo: usare `formatNumber`
- “Prima operazione” sempre visibile con fallback
- (opzionale) annualizzato `-` se data mancante

3) `src/test/orderFileParserHtmlXls.test.ts` (nuovo)
- test regressione su `8,4` e `14,95`

---

## Done = quando consideriamo chiuso (criteri oggettivi)
- Caricando `OrderStatus_35-2.xls` la tabella mostra `8,40` e valore `+840,00 $` (non 84 / +8.400)
- “Prima operazione” appare sotto i rendimenti
- “Annualizzato” non è 0 quando la data è presente
- Test vitest verde che blocca per sempre la regressione sulle virgole
