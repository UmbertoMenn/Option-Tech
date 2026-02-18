

## Fix Opzioni Europee (EUREX/IDEM): Strike, Expiry e Prezzo Sottostante

### Problemi Identificati

Ci sono 3 problemi distinti ma correlati per le opzioni europee:

#### Problema 1: SAP e tutte le opzioni EUREX -- Strike e Expiry mancanti
Le opzioni EUREX hanno un formato diverso dalle americane. La descrizione e:

```
EUREX, SAP, MAR26, 182, CALL, PHYSICAL, AMER, SINGLE STOCK OPTIONS
```

Ma il parser cerca il pattern `OPTION CALL 200` (formato americano). Risultato: `strike_price = null`, `expiry_date = null`, e `underlying` contiene l'intera stringa grezza.

#### Problema 2: Ferrari -- Prezzo sottostante sbagliato (NYSE vs Milan)
L'underlying "Ferrari - Stock" e mappato al ticker `RACE` (NYSE, ~375 USD) invece di `RACE.MI` (Milano, ~312 EUR). Poiche le opzioni sono in EUR (Euronext Derivatives Milan / IDEM), il prezzo deve essere quello italiano.

#### Problema 3: Underlying non pulito
Per EUREX, il campo `underlying` contiene l'intera stringa `"EUREX, SAP, MAR26, 182, CALL..."` invece del semplice `"SAP"`. Questo rompe il matching con le azioni in portafoglio.

---

### Soluzione

#### 1. Excel Parser: Riconoscere il formato EUREX/IDEM (`src/lib/excelParser.ts`)

Aggiungere nella funzione `parseDerivativeRow` (e `parsePositionRow` per i derivati) una logica per riconoscere il formato comma-separated europeo:

```text
Pattern EUREX: "EUREX, COMPANY, MMMyy, STRIKE, CALL/PUT, ..."
Pattern IDEM:  "IDEM, COMPANY, MMMyy, STRIKE, CALL/PUT, ..."

Estrazione:
- underlying = secondo campo (es. "SAP", "MERCEDES-BENZ GROUP")
- expiry = terzo campo (es. "MAR26" -> 2026-03-20)
- strike = quarto campo (es. "182")
- option_type = quinto campo (es. "CALL" o "PUT")
```

Se il primo campo (dopo split per virgola) e "EUREX" o "IDEM", applicare il parsing specifico INVECE della regex americana.

Per il formato "Ferrari - Stock Option PUT 300 20/03/2026":
- Il parser attuale gestisce gia `OPTION PUT 300` (strike OK)
- Manca il parsing della data nel formato `DD/MM/YYYY` per `expiry_date`
- L'underlying "Ferrari - Stock" va pulito togliendo " - Stock"

#### 2. Prezzo sottostante europeo: Priorita ticker europeo (`supabase/functions/fetch-underlying-prices/index.ts`)

Quando il sistema risolve un ticker per un'opzione europea (currency EUR), deve prioritizzare il ticker europeo. Due approcci combinati:

- Aggiungere mapping statici per le aziende italiane/europee note:
  - `FERRARI` -> `RACE.MI`
  - `FERRARI - STOCK` -> `RACE.MI`
  - `SAP` -> `SAP.DE` (gia presente, ma solo per EUREX prefix)
  
- Nel hook `useUnderlyingPrices`, quando l'underlying proviene da un'opzione con currency EUR, passare un hint all'edge function per prioritizzare il ticker europeo

#### 3. Cleanup underlying nelle posizioni gia salvate

Per i dati gia in DB con underlying sporco, il fix al parser impedira nuovi upload errati. Per i dati esistenti, la pulizia avverra al prossimo upload Excel.

---

### File modificati

| File | Modifica |
|------|----------|
| `src/lib/excelParser.ts` | In `parseDerivativeRow`: aggiungere parsing formato EUREX/IDEM (comma-separated) per strike, expiry, underlying, option_type. Aggiungere parsing data DD/MM/YYYY per expiry. Pulire underlying togliendo suffissi come " - Stock" |
| `supabase/functions/fetch-underlying-prices/index.ts` | Aggiungere mapping statici: FERRARI -> RACE.MI, e gestire hint di exchange per opzioni EUR |

### Risultato atteso

- Opzioni SAP/Mercedes/DHL su EUREX: strike, expiry e underlying correttamente estratti
- Opzioni Ferrari su IDEM: prezzo sottostante in EUR (RACE.MI, ~312 EUR) invece di USD (RACE, ~375 USD)
- Matching con le azioni in portafoglio funzionante grazie all'underlying pulito
