
# Piano: Gestione Semi-Manuale dei Settori

## Situazione Attuale

| Titoli con Settore | Titoli Senza Settore |
|-------------------|---------------------|
| NVIDIA → Technology | ALPHABET → ? |
| APPLE → Technology | JPMORGAN → ? |
| ALIBABA → Consumer Cyclical | FIRST SOLAR → ? |
| PALANTIR → Technology | PALO ALTO → ? |
| UNITEDHEALTH → Healthcare | SUPER MICRO → ? |
| ... | ~25 altri titoli |

**Risposta alla tua domanda**: Sì, i dati sono condivisi! Una volta che viene salvato che "NVDA = Technology", **tutti gli utenti** beneficiano di questo dato perché la tabella `isin_mappings` ha policy RLS pubblica per la lettura.

---

## Soluzione Proposta

### Approccio: Pannello Admin per Gestione Settori

Creare un'interfaccia nell'Admin Panel che permette di:
1. Vedere tutti i ticker senza settore assegnato
2. Assegnare manualmente il settore da un dropdown
3. Il dato viene salvato e diventa disponibile per tutti

```
┌─────────────────────────────────────────────────────────────────┐
│  Admin Panel > Gestione Settori                                 │
├─────────────────────────────────────────────────────────────────┤
│  Titoli senza settore: 25                                       │
│                                                                 │
│  ┌─────────────┬────────────┬───────────────────┬────────────┐ │
│  │ ISIN        │ Ticker     │ Settore           │ Azione     │ │
│  ├─────────────┼────────────┼───────────────────┼────────────┤ │
│  │ US02079K... │ (ricerca)  │ [Seleziona...]  ▼ │ [Salva]    │ │
│  │ US46625H... │ JPM        │ [Financials]    ▼ │ [Salva]    │ │
│  │ US33643...  │ FSLR       │ [Energy]        ▼ │ [Salva]    │ │
│  └─────────────┴────────────┴───────────────────┴────────────┘ │
│                                                                 │
│  [Popola tutti con Yahoo Finance]                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Modifiche Tecniche

### 1. Aggiungere RLS per INSERT/UPDATE su isin_mappings (solo admin)

**File**: Migrazione SQL

```sql
-- Permettere agli admin di inserire/aggiornare i mappings
CREATE POLICY "Admins can manage isin mappings"
  ON isin_mappings
  FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
```

### 2. Creare Componente SectorMappingManager

**File**: `src/components/admin/SectorMappingManager.tsx`

Componente che mostra:
- Lista di ISIN senza settore
- Dropdown per selezione settore (Technology, Financials, Healthcare, etc.)
- Pulsante per salvare il mapping
- Pulsante per tentare auto-popolamento via Yahoo

### 3. Integrare nel Pannello Admin

**File**: `src/components/admin/AdminPanel.tsx`

Aggiungere una nuova tab "Gestione Settori"

### 4. Ottimizzare Edge Function per Auto-Detect

Migliorare `fetchYahooSectorInfo` per:
- Usare la Yahoo Quote API v7 con campo `quoteType`
- Fallback a lookup per nome azienda

---

## Vantaggi

| Aspetto | Descrizione |
|---------|-------------|
| **Condivisione** | Un settore salvato è disponibile per tutti gli utenti |
| **Controllo** | L'admin può correggere manualmente mappature errate |
| **Flessibilità** | Mix di auto-popolamento + correzione manuale |
| **Scalabilità** | I nuovi titoli vengono gestiti man mano che servono |

---

## File da Creare/Modificare

| File | Azione |
|------|--------|
| Migrazione SQL | Crea | Policy RLS per admin |
| `src/components/admin/SectorMappingManager.tsx` | Crea | UI gestione settori |
| `src/components/admin/AdminPanel.tsx` | Modifica | Aggiungere tab settori |
| `supabase/functions/update-prices-cron/index.ts` | Modifica | Migliorare auto-detect |

---

## Flusso Operativo

1. **Admin** accede al pannello e vede i titoli senza settore
2. **Admin** assegna manualmente il settore (es. ALPHABET → Technology)
3. **Sistema** salva in `isin_mappings`
4. **Tutti gli utenti** vedono automaticamente il settore corretto nella vista Sector Allocation

---

## Settori Standard (GICS)

- Technology
- Financials
- Healthcare
- Consumer Discretionary (Consumer Cyclical)
- Consumer Staples (Consumer Defensive)
- Industrials
- Energy
- Materials
- Utilities
- Real Estate
- Communication Services
