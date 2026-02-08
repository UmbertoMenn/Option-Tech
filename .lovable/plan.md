

# Piano: Funzionalita Admin Avanzate per Gestione Portafogli

## Riepilogo Obiettivi

1. **Accesso Admin a tutti i portafogli** - L'admin puo visualizzare e modificare qualsiasi portafoglio di qualsiasi utente
2. **Copia portafoglio admin su utente** - L'admin puo copiare il PROPRIO portafoglio personale su un utente specifico (inclusi depositi, dati storici, posizioni)
3. **Vista aggregata globale** - L'admin vede un "portfolio virtuale" che aggrega tutti i dati di tutti gli utenti

---

## Architettura Attuale

| Tabella | Policy Attuali | Necessita Modifica |
|---------|----------------|-------------------|
| portfolios | Solo user_id proprio | Si - admin FOR ALL |
| positions | Solo portfolio proprio | Si - admin FOR ALL |
| deposits | Solo portfolio proprio | Si - admin FOR ALL |
| historical_data | Solo portfolio proprio | Si - admin FOR ALL |
| derivative_overrides | Solo portfolio proprio | Si - admin FOR ALL |
| covered_call_premiums | Solo portfolio proprio | Si - admin FOR ALL |
| strategy_cache | Solo portfolio proprio | Si - admin FOR ALL |

---

## Feature 1: Accesso Admin a Tutti i Portafogli

### Modifiche Database (RLS Policies)

Aggiungere policy admin a tutte le tabelle principali:

```sql
-- Portfolios
CREATE POLICY "Admins can manage all portfolios"
  ON public.portfolios FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Positions  
CREATE POLICY "Admins can manage all positions"
  ON public.positions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Deposits
CREATE POLICY "Admins can manage all deposits"
  ON public.deposits FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Historical Data
CREATE POLICY "Admins can manage all historical_data"
  ON public.historical_data FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Derivative Overrides
CREATE POLICY "Admins can manage all derivative_overrides"
  ON public.derivative_overrides FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Covered Call Premiums
CREATE POLICY "Admins can manage all covered_call_premiums"
  ON public.covered_call_premiums FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Strategy Cache
CREATE POLICY "Admins can manage all strategy_cache"
  ON public.strategy_cache FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));
```

### Modifiche Frontend

**Nuovo Tab "Portafogli" nel Pannello Admin** (`AdminPanel.tsx`)

- Lista tutti gli utenti con i loro portafogli
- Click su un portafoglio: redirect alla Dashboard con quel portfolio selezionato
- L'admin puo poi modificare tramite le normali funzionalita

**Modifica `PortfolioContext.tsx`**

- Aggiungere `adminModePortfolioId` state
- Se admin e in "admin mode", mostrare il portfolio selezionato invece del proprio
- Funzione `setAdminViewPortfolio(portfolioId, ownerUserId)`

**Nuovo hook `useAdminPortfolios.ts`**

```typescript
// Fetcha tutti i portfolios di tutti gli utenti (solo per admin)
const { data } = await supabase
  .from('portfolios')
  .select('*, profiles!user_id(email, full_name)')
  .order('created_at', { ascending: false });
```

---

## Feature 2: Copia Portafoglio Admin su Utente

### Logica

L'admin seleziona:
1. Quale dei PROPRI portafogli copiare (source)
2. Su quale utente incollarlo (target)

### Edge Function: `admin-copy-portfolio`

```typescript
// Input
{
  sourcePortfolioId: string,   // Portafoglio dell'admin
  targetUserId: string,        // Utente destinatario
  newPortfolioName?: string    // Nome opzionale (default: "Copia di X")
}

// Logica
1. Verifica che il chiamante sia admin
2. Verifica che sourcePortfolioId appartenga all'admin chiamante
3. Crea nuovo portfolio per targetUserId
4. Copia positions (con nuovi UUID, mappando vecchi->nuovi ID)
5. Copia deposits
6. Copia historical_data
7. Copia derivative_overrides (rimappando position_id!)
8. Copia covered_call_premiums
9. Ritorna il nuovo portfolio creato
```

### UI nel Pannello Admin

Nella sezione "I miei portafogli" dell'admin:
- Pulsante "Copia su utente" accanto a ogni portafoglio
- Dialog: 
  - Dropdown per selezionare utente destinatario
  - Campo opzionale per nuovo nome
  - Conferma

---

## Feature 3: Vista Aggregata Globale

### Approccio

Creare un "portfolio virtuale" con ID speciale `AGGREGATED` che:
- Non esiste nel database
- Combina i dati di TUTTI i portfolio di TUTTI gli utenti
- E read-only

### Modifiche

**`PortfolioSelector.tsx`**

Per admin, mostrare in cima:
```
[Aggregato - Tutti gli Utenti]
---------------------------------
Portfolio 1 (Mario Rossi)
Portfolio 2 (Mario Rossi)
Portfolio Principale (Luigi Verdi)
...
```

**`PortfolioContext.tsx`**

Quando `selectedPortfolioId === 'AGGREGATED'`:
- Ritornare un portfolio "virtuale" con dati sommati

**Hooks da modificare**

| Hook | Comportamento con AGGREGATED |
|------|------------------------------|
| `usePortfolio` | Somma total_value, cash_value di tutti |
| `useDeposits` | Combina tutti i deposits |
| `useHistoricalData` | Somma valori per data |
| `useDerivativeOverrides` | Combina tutti gli override |
| `useCoveredCallPremiums` | Combina tutti i premiums |

**Pagine**

Le pagine Dashboard, Derivatives, RiskAnalyzer funzioneranno automaticamente con i dati aggregati.
Tutti i pulsanti di modifica saranno disabilitati (read-only).

---

## Nuovi File da Creare

| File | Descrizione |
|------|-------------|
| `supabase/functions/admin-copy-portfolio/index.ts` | Edge function per copia portfolio |
| `src/hooks/useAdminPortfolios.ts` | Fetch tutti i portfolios (admin) |
| `src/components/admin/PortfolioManager.tsx` | Tab admin gestione portfolios |
| `src/components/admin/CopyPortfolioDialog.tsx` | Dialog per copia su utente |

## File da Modificare

| File | Modifica |
|------|----------|
| `src/contexts/PortfolioContext.tsx` | Admin mode + AGGREGATED |
| `src/components/admin/AdminPanel.tsx` | Nuovo tab "Portafogli" |
| `src/components/portfolio/PortfolioSelector.tsx` | Opzione Aggregato per admin |
| `src/hooks/usePortfolio.ts` | Gestione caso AGGREGATED |
| `src/hooks/useDeposits.ts` | Gestione caso AGGREGATED |
| `src/hooks/useHistoricalData.ts` | Gestione caso AGGREGATED |
| `src/hooks/useDerivativeOverrides.ts` | Gestione caso AGGREGATED |
| `src/hooks/useCoveredCallPremiums.ts` | Gestione caso AGGREGATED |
| `src/pages/Derivatives.tsx` | Read-only se AGGREGATED |
| `src/pages/RiskAnalyzer.tsx` | Read-only se AGGREGATED |

---

## Flusso UX Finale

### Admin accede a portafoglio utente
```
Admin -> Pannello Admin -> Tab "Portafogli"
                        |
         Lista utenti con loro portfolios
                        |
         Click su portfolio -> Redirect a Dashboard
                        |
         Admin modifica normalmente (Excel upload, form, etc.)
```

### Admin copia il proprio portafoglio
```
Admin -> Pannello Admin -> Tab "Portafogli"
                        |
         Sezione "I Miei Portafogli"
                        |
         Click "Copia su utente"
                        |
         Dialog: Seleziona utente + nome
                        |
         Conferma -> Edge function copia tutto
```

### Admin visualizza aggregato
```
Admin -> Qualsiasi pagina (Dashboard/Derivatives/Risk)
                        |
         Portfolio Selector -> "[Aggregato - Tutti]"
                        |
         Vista combinata read-only
```

---

## Migrazione Database

Una singola migrazione SQL che aggiunge tutte le policy admin necessarie alle 7 tabelle coinvolte.

---

## Stima Complessita

| Componente | Difficolta | Tempo |
|------------|-----------|-------|
| RLS Policies Admin | Bassa | 10 min |
| Tab Portafogli Admin | Media | 25 min |
| Edge Function Copia | Media-Alta | 40 min |
| Hook AGGREGATED | Alta | 45 min |
| Integrazione UI | Media | 30 min |
| **Totale** | | ~2.5 ore |

