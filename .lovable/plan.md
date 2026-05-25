Migliorare i tooltip della sezione **Dettaglio CC e DR-CC sintetiche** in `src/components/risk/EquityExposureView.tsx` (lines ~833-892), con spiegazioni teoriche e formule precise per ogni variante.

## Modifica unica

### 1) Tooltip header "Dettaglio CC e DR-CC sintetiche"
Sostituire l'attuale testo breve con una spiegazione metodologica dettagliata che copra:
- **Cos'è una posizione sintetica**: combinazione di sole opzioni che replica un'esposizione equity senza possedere il sottostante.
- **Le 4 varianti supportate** (`cc_call`, `cc_put`, `drcc_call`, `drcc_put`) con le rispettive formule di rischio (in valuta locale, poi convertite via `/exchangeRate` in EUR):
  - **CC sintetica CALL** = Long CALL ITM + Short CALL.
    - Se `spot > strike_shortCall` → la long CALL verrà esercitata: rischio = `PMC_longCall × qty × 100` (costo già pagato e perso al netto della call corta che assorbe l'upside).
    - Se `spot ≤ strike_shortCall` → rischio = `mkt_longCall × qty × 100` (valore di mercato corrente residuo).
    - Se spot non disponibile → fallback `mkt × qty × 100`.
  - **CC sintetica PUT** = Short PUT ITM + Short CALL. Formula: `strike_PUT × |qty_PUT| × 100` (rischio di assegnazione al prezzo dello strike).
  - **DR-CC sintetica CALL** = Long CALL ITM + Short CALL (+ Protezione PUT ininfluente). Stessa formula della CC sintetica CALL: la protezione PUT non riduce il rischio perché la long CALL ITM funge da sottostante effettivo.
  - **DR-CC sintetica PUT** = Short PUT ITM + Short CALL + Protezione PUT. Formula: `max(0, strike_synPut − strike_protPut) × contracts × 100` (lo spread tra strike sintetica e protezione = perdita massima).
- **Conversione finale**: `riskEUR = riskOriginal / exchangeRate`.

### 2) Tooltip per ogni riga di posizione (accanto a `Rischio: {formatEUR(s.riskEUR)}`)
Costruire un testo tooltip dinamico in base a `s.syntheticType`. Per ogni variante mostrare:
1. **Titolo**: tipo (CC/DR-CC) + variante (CALL/PUT) + sottostante.
2. **Composizione** (`s.composition`, già contiene strike, PMC/mkt, spot, eventuale protezione).
3. **Teoria**: spiegazione di una riga sul perché il rischio è così definito (es. per `cc_call`: "il rischio è il capitale impiegato nella long CALL ITM, che diventa PMC o mkt a seconda della relazione spot vs strike call venduta").
4. **Formula simbolica** specifica della variante.
5. **Calcolo numerico**: `riskOriginal` in valuta originale (s.currency + numero) + conversione `÷ exchangeRate` → `riskEUR`.

Le informazioni granulari (strike, PMC, mkt, spot, contracts) sono già contenute in `s.composition` (string costruita in `riskCalculator.ts`), quindi non serve passare nuovi dati: il tooltip mostra `composition` integrale + la formula generica della variante + i numeri aggregati disponibili (`riskOriginal`, `exchangeRate`, `riskEUR`).

## Note
- Solo UI: nessun cambio a `riskCalculator.ts`, hook, RLS, backend.
- Usa `whitespace-pre-wrap` (già di default in `CalcInfo`) per mantenere la formattazione multi-riga.
- Helper locale `buildSynthTooltip(s)` per evitare JSX troppo lungo inline.
