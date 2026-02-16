

## Briefing giornaliero suddiviso per portafoglio

### Situazione attuale

Il briefing raggruppa tutte le sezioni (Naked Call, CC ITM, ecc.) di tutti i portafogli dell'utente in un unico blocco, senza distinzione. Un utente con piu' portafogli (es. "Portfolio Principale" e "CASB") riceve un messaggio piatto dove non si capisce quale posizione appartiene a quale portafoglio.

### Soluzione

Modificare il flusso nel main handler per iterare **per portafoglio** anziche' aggregare tutto. Ogni portafoglio produce le sue sezioni, e il messaggio finale e' organizzato con intestazioni per portafoglio.

### Struttura del messaggio risultante

**Telegram:**
```text
📋 Briefing Pre-Apertura
📅 16 feb 2026

📁 Portfolio Principale

🔴 Covered Call ITM
  AAPL strike 220

🟢 Leap Call in Gain
  MSFT strike 300 (+15%)

📁 CASB

🔴 Iron Condor OOR
  TSLA
```

**Email:** stessa struttura con header visivo per ogni portafoglio.

### Dettaglio tecnico

**File: `supabase/functions/daily-briefing/index.ts`**

1. **Nuova interfaccia** `PortfolioBriefing`:
```text
interface PortfolioBriefing {
  portfolioName: string;
  sections: BriefingSection[];
}
```

2. **Main handler** — nel loop utente, iterare per portafoglio:
   - Selezionare `portfolios` con `id, name` (aggiungere `name`)
   - Per ogni portafoglio, filtrare `strategiesCache` e `positions` per `portfolio_id`
   - Chiamare `buildBriefingSections` per ogni portafoglio
   - Raccogliere i risultati in un array `PortfolioBriefing[]`
   - Saltare l'utente solo se tutti i portafogli hanno 0 sezioni

3. **Funzioni di formattazione** — aggiornare per accettare `PortfolioBriefing[]`:
   - `buildTelegramMessage(portfolioBriefings, userName?)` — aggiunge `📁 *NomePortafoglio*` come separatore
   - `buildEmailHTML(portfolioBriefings, userName?)` — aggiunge header colorato per ogni portafoglio
   - Per utenti con un solo portafoglio, il nome viene comunque mostrato per coerenza

### File da modificare

| File | Modifica |
|---|---|
| `supabase/functions/daily-briefing/index.ts` | Aggiungere interfaccia `PortfolioBriefing`, iterare per portafoglio nel main handler, aggiornare `buildTelegramMessage` e `buildEmailHTML` per accettare array di briefing per portafoglio |

