

# Piano: Sistema Aggiornamento Prezzi Live con Cron Job

## Problema Identificato

### Sintomi
1. **Prezzi errati nel database**: ETF come ISHSIII-MSCI S.A.C.UE DLA mostra 403€ invece di ~5.60€ (6871% di errore)
2. **142 posizioni falliscono** ad ogni ciclo di aggiornamento
3. **Tabella `isin_mappings` vuota**: il sistema non può convertire ISIN → ticker Yahoo
4. **Cron job attivo 24/7**: invece di solo orari di mercato (lun-ven 9-23 italiane)
5. **Codice sorgente mancante**: l'edge function `update-prices-cron` è deployata ma non c'è il codice nel repository

### Causa Root
L'edge function esistente ha un bug nella risoluzione ISIN→ticker: quando non trova una corrispondenza esatta, sembra applicare un ticker sbagliato (probabilmente dal fallback della Yahoo Search API che restituisce risultati non correlati).

---

## Soluzione Proposta

### 1. Ricreare Edge Function `update-prices-cron`
Scrivere una nuova versione dell'edge function con:

- **Risoluzione ISIN intelligente**: 
  - Lookup nella tabella `isin_mappings` (cache persistente)
  - Se non trovato, usa Yahoo Finance Search API
  - Valida che il risultato sia coerente (verifica che il nome contenga keywords simili)
  - Salva il mapping per usi futuri

- **Validazione prezzi**:
  - Rifiuta prezzi che differiscono di oltre 50% dal prezzo precedente (sanity check)
  - Logga le anomalie per review manuale

- **Supporto multi-asset**:
  - Azioni USA: ticker diretto (es. AAPL, TSLA)
  - ETF europei: suffisso borsa (es. IUSS.L, IUSS.DE, IUSS.MI)
  - Commodities: ticker specifici (es. GC=F per oro)

### 2. Aggiornare Cron Job con Orario Italiano
Modificare lo schedule da `*/5 * * * *` a:
```
*/5 8-22 * * 1-5
```
Questo significa: ogni 5 minuti, dalle 8:00 alle 22:59 UTC (9:00-23:59 italiane), solo lunedì-venerdì.

### 3. Popolare `isin_mappings` con ETF Noti
Inserire i mapping corretti per gli ETF presenti nel portfolio:

| ISIN | Ticker Yahoo | Nome |
|------|--------------|------|
| IE00BYYR0489 | IUSS.DE | iShares MSCI Saudi Arabia |
| IE00B0M63623 | ITWN.L | iShares MSCI Taiwan |
| IE00BZCQB185 | NDIA.L | iShares MSCI India |
| IE00B4L5YX21 | SJPA.L | iShares Core MSCI Japan |
| IE000YYE6WK5 | DFND.DE | VanEck Defense |
| IE0006WW1TQ4 | XDWU.DE | Xtrackers MSCI World ex USA |
| IE00B9CQXS71 | GLDV.L | SPDR S&P Global Dividend |
| IE00B579F325 | SGLD.L | Invesco Physical Gold |

### 4. Correggere Prezzi Errati
Aggiornare manualmente i prezzi corrotti nel database prima di riattivare il cron.

---

## Architettura Tecnica

```text
┌─────────────────────┐     ogni 5 min      ┌───────────────────────┐
│    pg_cron Job      │ ──────────────────► │  update-prices-cron   │
│  (lun-ven 9-23 IT)  │                     │    Edge Function      │
└─────────────────────┘                     └───────────┬───────────┘
                                                        │
                              ┌─────────────────────────┼────────────────────────┐
                              │                         │                        │
                              ▼                         ▼                        ▼
                    ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
                    │  isin_mappings  │      │ Yahoo Finance   │      │    positions    │
                    │    (cache)      │      │   Search API    │      │   (update)      │
                    └─────────────────┘      └─────────────────┘      └─────────────────┘
```

### Flusso di Risoluzione Ticker

```text
1. Posizione con ISIN (es. IE00BYYR0489)
   │
   ├─► Cerca in isin_mappings → trovato? → usa ticker salvato
   │
   └─► Non trovato? → Yahoo Search API con ISIN
         │
         ├─► Risultato valido? → salva in isin_mappings → usa ticker
         │
         └─► Nessun risultato? → marca come "non aggiornabile"
```

### Validazione Prezzo
```text
nuovo_prezzo = yahoo_api_result

if (vecchio_prezzo esiste):
    variazione = |nuovo - vecchio| / vecchio * 100
    
    if (variazione > 50%):
        ⚠️ RIFIUTA aggiornamento
        📝 Log anomalia per review
    else:
        ✅ Applica aggiornamento
else:
    ✅ Applica aggiornamento (prima volta)
```

---

## Dettaglio Implementazione

### File da Creare
`supabase/functions/update-prices-cron/index.ts`

### Struttura Edge Function

```typescript
// 1. Recupera posizioni da aggiornare (azioni, ETF, commodities)
// 2. Per ogni posizione:
//    a. Risolvi ISIN → ticker (con cache)
//    b. Chiama Yahoo Finance Quote API
//    c. Valida prezzo (sanity check)
//    d. Aggiorna database
// 3. Log risultati in price_update_logs
```

### Modifiche Database

1. **Aggiornare cron job** con nuovo schedule
2. **Popolare isin_mappings** con ETF noti
3. **Correggere prezzi errati** (ISHSIII, Taiwan, ecc.)

---

## File Coinvolti

| File | Azione |
|------|--------|
| `supabase/functions/update-prices-cron/index.ts` | Creare (nuova edge function) |
| Database: `cron.job` | Aggiornare schedule |
| Database: `isin_mappings` | Popolare con mapping ETF |
| Database: `positions` | Correggere prezzi errati |

---

## Stima Effort

| Attività | Tempo |
|----------|-------|
| Creare edge function | 45 min |
| Popolare isin_mappings | 15 min |
| Aggiornare cron schedule | 5 min |
| Correggere prezzi errati | 10 min |
| Testing | 20 min |
| **Totale** | **~1.5 ore** |

