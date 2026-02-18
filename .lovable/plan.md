

## Fix Prezzi Sottostanti SAP e Ferrari: Mappature DB Errate

### Causa del Problema

I prezzi sono sbagliati perche nel database ci sono mappature vecchie e sbagliate che hanno la priorita sulle mappature statiche corrette aggiunte nella Edge Function:

| underlying (DB) | ticker attuale (SBAGLIATO) | ticker corretto |
|---|---|---|
| `SAP` | `SAP` (US, $201 USD) | `SAP.DE` (EUR, 171 EUR) |
| `SAP SE` | `SAP` (US) | `SAP.DE` (EUR) |
| `FERRARI` | `RACE` (US, $375 USD) | `RACE.MI` (EUR, 312 EUR) |
| `Ferrari - Stock` | `RACE` (US) | `RACE.MI` (EUR) |
| `FERRARI - STOCK` | `RACE` (US) | `RACE.MI` (EUR) |

Il flusso e: hook `useUnderlyingPrices` -> query DB `underlying_mappings` -> trova `SAP -> SAP` (US) -> usa quel ticker senza mai arrivare alle mappature statiche corrette nella Edge Function.

### Soluzione in 2 passi

#### Passo 1: Correggere le mappature errate nel DB

Aggiornare le righe nella tabella `underlying_mappings` per puntare ai ticker europei corretti:

- `SAP` -> `SAP.DE`
- `SAP SE` -> `SAP.DE`  
- `FERRARI` -> `RACE.MI`
- `Ferrari - Stock` -> `RACE.MI`
- `FERRARI - STOCK` -> `RACE.MI`

#### Passo 2: Proteggere la Edge Function dal ri-creare mappature errate

Nel file `supabase/functions/fetch-underlying-prices/index.ts`, le mappature statiche (`SPECIAL_MAPPINGS`) devono essere controllate **PRIMA** della cache DB, non dopo. In questo modo, se un underlying ha una mappatura statica nota (es. `SAP` -> `SAP.DE`), viene usata quella senza consultare il DB (che potrebbe avere dati obsoleti o errati).

Ordine attuale (sbagliato):
1. Check se input sembra un ticker -> valida su Yahoo
2. Check cache DB (`underlying_mappings`)
3. Check mappature statiche
4. AI inference

Nuovo ordine (corretto):
1. Check se input sembra un ticker -> valida su Yahoo
2. **Check mappature statiche PRIMA** (SPECIAL_MAPPINGS)
3. Check cache DB (`underlying_mappings`)
4. AI inference

### File modificati

| File | Modifica |
|---|---|
| Migrazione SQL | UPDATE `underlying_mappings` per correggere i 5 ticker errati |
| `supabase/functions/fetch-underlying-prices/index.ts` | Spostare il check delle mappature statiche (Step 2) PRIMA della cache DB (Step 1), invertendo l'ordine attuale |

### Risultato atteso

- SAP mostrera il prezzo di SAP.DE (~171 EUR) invece di SAP US (~201 USD)
- Ferrari mostrera il prezzo di RACE.MI (~312 EUR) invece di RACE US (~375 USD)
- Nuovi upload non potranno sovrascrivere le mappature statiche con ticker errati
