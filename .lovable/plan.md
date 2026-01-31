
# Piano: Supporto Multi-Portfolio per Utente

## Obiettivo
Permettere a ogni utente di creare e gestire più portfolio separati, con un selettore nell'header per passare da uno all'altro.

---

## Panoramica Architetturale

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Header                                   │
│  [Logo] [Portfolio Selector ▼] [Derivatives] [Risk] [Admin]     │
│         └── Portfolio 1                                          │
│             Portfolio 2                                          │
│             + Nuovo Portfolio                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Modifiche Previste

### 1. Nuovo Context: PortfolioContext
Creare un contesto React dedicato per gestire:
- Lista di tutti i portfolio dell'utente
- Portfolio attualmente selezionato
- Funzioni per creare/eliminare/rinominare portfolio

**File:** `src/contexts/PortfolioContext.tsx`

### 2. Refactor Hook usePortfolio
Modificare per:
- Fetchare TUTTI i portfolio dell'utente (non `.maybeSingle()`)
- Usare il portfolio selezionato dal context
- Mantenere retrocompatibilita con le pagine esistenti

**File:** `src/hooks/usePortfolio.ts`

### 3. Componente Portfolio Selector
Creare un dropdown nell'header per:
- Mostrare il portfolio attivo
- Permettere di cambiare portfolio
- Aggiungere nuovo portfolio
- Eliminare/rinominare portfolio esistenti

**File:** `src/components/portfolio/PortfolioSelector.tsx`

### 4. Aggiornamento Layout Header
Integrare il selettore portfolio nell'header della Dashboard (e altre pagine).

**File:** `src/components/dashboard/Dashboard.tsx`

### 5. Aggiornamento App.tsx
Wrappare l'app con il nuovo `PortfolioProvider`.

**File:** `src/App.tsx`

---

## Dettaglio Tecnico

### PortfolioContext

```typescript
interface PortfolioContextType {
  portfolios: Portfolio[];
  selectedPortfolio: Portfolio | null;
  selectPortfolio: (id: string) => void;
  createPortfolio: (name: string) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;
  renamePortfolio: (id: string, name: string) => Promise<void>;
  isLoading: boolean;
}
```

### usePortfolio Refactored

Il hook usePortfolio continuera a funzionare come prima, ma preletera il portfolio dal context invece di fetcharlo direttamente. Questo garantisce retrocompatibilita zero-refactor per Dashboard, Derivatives e RiskAnalyzer.

### Portfolio Selector UI

- Dropdown con lista portfolio
- Badge con valore totale per ogni portfolio  
- Pulsante "+ Nuovo" in fondo alla lista
- Menu contestuale (tasto destro o icona) per rinominare/eliminare
- Conferma prima di eliminare un portfolio

### Persistenza Selezione

Il portfolio selezionato verra salvato in `localStorage` con key `selectedPortfolioId` per ricordare la scelta tra sessioni.

---

## Flusso Utente

1. **Primo accesso**: Portfolio "Principale" gia creato (dal trigger esistente)
2. **Cambio portfolio**: Click sul selector, scegli portfolio, dati si aggiornano
3. **Nuovo portfolio**: Click su "+ Nuovo", inserisci nome, viene creato vuoto
4. **Elimina portfolio**: Menu contestuale, conferma, portfolio eliminato (cascade su positions, deposits, ecc.)
5. **Upload Excel**: I dati vengono caricati nel portfolio attualmente selezionato

---

## File da Creare

| File | Descrizione |
|------|-------------|
| `src/contexts/PortfolioContext.tsx` | Context per gestione multi-portfolio |
| `src/components/portfolio/PortfolioSelector.tsx` | Dropdown selector |
| `src/components/portfolio/CreatePortfolioDialog.tsx` | Dialog per nuovo portfolio |
| `src/components/portfolio/PortfolioMenu.tsx` | Menu contestuale rinomina/elimina |

## File da Modificare

| File | Modifiche |
|------|-----------|
| `src/App.tsx` | Aggiungere PortfolioProvider |
| `src/hooks/usePortfolio.ts` | Usare portfolio da context |
| `src/components/dashboard/Dashboard.tsx` | Aggiungere selector nell'header |
| `src/pages/Derivatives.tsx` | Aggiornare header con selector |
| `src/pages/RiskAnalyzer.tsx` | Aggiornare header con selector |

---

## Rischi e Mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Eliminazione accidentale portfolio | Dialog di conferma con nome portfolio |
| Portfolio vuoto dopo creazione | Messaggio guida "Carica un file Excel" |
| Confusione su quale portfolio e attivo | Nome portfolio ben visibile nell'header |

---

## Stima Effort

- Creazione context e selector: ~40%
- Refactor usePortfolio: ~20%
- Integrazione nelle pagine: ~30%
- Testing e polish UI: ~10%
