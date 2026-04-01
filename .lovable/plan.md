

## Archivio Sottostanti nel Wizard Configurazione Strategie

### Problema
Il Wizard propone sempre tutti i sottostanti (es. Regulus, Bio-On) anche se il cliente non li usa con derivati. Servono un meccanismo di archiviazione e una UI per gestirlo.

### Modifiche

#### 1. Nuova tabella `archived_underlyings`
Tabella per salvare i sottostanti archiviati per utente/portafoglio, con chiave univoca per evitare duplicati.

#### 2. Nuovo hook `useArchivedUnderlyings`
- Query per leggere i `underlying_key` archiviati
- Mutation per archiviare e ripristinare

#### 3. Wizard — UI archivia/ripristina
- I gruppi archiviati vengono **nascosti** dalla lista principale
- Ogni card senza strategie configurate mostra un bottone **"Archivia"** (icona Archive)
- Sezione collassabile **"Archivio"** in fondo al dialog con bottone **"Ripristina"** per ciascun sottostante
- Il conteggio "libere" esclude le posizioni archiviate

#### 4. Derivatives.tsx — Collegamento
- Importa il hook e passa le props al Wizard

### Dettaglio tecnico

```sql
CREATE TABLE public.archived_underlyings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  underlying_key text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, portfolio_id, underlying_key)
);
-- RLS: users manage own, admins manage all
```

```text
Wizard UI:
┌─────────────────────────────────────┐
│ ADOBE                    [Archivia] │
│   posizioni disponibili...          │
│   strategie configurate...          │
├─────────────────────────────────────┤
│ LULULEMON                           │  ← no archive button (has strategies)
│   CC LULU V CALL 380 GIU/25        │
├─────────────────────────────────────┤
│ ...                                 │
├─────────────────────────────────────┤
│ ▶ Archivio (3 sottostanti)          │
│   REGULUS THERAPEUTICS  [Ripristina]│
│   BIO-ON               [Ripristina]│
│   ...                               │
└─────────────────────────────────────┘
```

### File toccati
| File | Modifica |
|---|---|
| Migration SQL | Nuova tabella `archived_underlyings` con RLS |
| `src/hooks/useArchivedUnderlyings.ts` | Nuovo hook CRUD |
| `src/components/derivatives/StrategyConfigWizard.tsx` | UI archivia/ripristina, filtro gruppi |
| `src/pages/Derivatives.tsx` | Collegamento hook → Wizard |

