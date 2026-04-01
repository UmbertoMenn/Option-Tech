
## Archivio Sottostanti nel Wizard Configurazione Strategie

### Problema
Il Wizard propone sempre tutti i sottostanti (es. Regulus, Bio-On) anche se il cliente non li usa con derivati. Servono un meccanismo di archiviazione e una UI per gestirlo.

### Modifiche

#### 1. Nuova tabella `archived_underlyings`
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
ALTER TABLE public.archived_underlyings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own archived underlyings" ON public.archived_underlyings
  FOR ALL TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage all" ON public.archived_underlyings
  FOR ALL TO public USING (has_role(auth.uid(), 'admin'));
```

#### 2. Nuovo hook `src/hooks/useArchivedUnderlyings.ts`
- `useArchivedUnderlyings(portfolioId)`: query che ritorna la lista di `underlying_key` archiviati
- `useArchiveUnderlying()`: mutation per inserire
- `useUnarchiveUnderlying()`: mutation per rimuovere

#### 3. `src/components/derivatives/StrategyConfigWizard.tsx`
- Riceve `archivedKeys: string[]`, `onArchive(key, displayName)`, `onUnarchive(key)` come props
- **Filtra** i gruppi archiviati dalla lista principale (non li mostra)
- Aggiunge un bottone **"Archivia"** (icona Archive) nell'header di ogni card sottostante (solo se il gruppo non ha strategie configurate)
- Aggiunge una sezione collassabile **"Archivio"** in fondo alla lista, che mostra i sottostanti archiviati con un bottone **"Ripristina"** per ognuno
- Il conteggio "libere" esclude le posizioni archiviate

#### 4. `src/pages/Derivatives.tsx`
- Importa e usa il nuovo hook
- Passa le props di archiviazione al Wizard

### File toccati
| File | Modifica |
|---|---|
| Migration SQL | Nuova tabella `archived_underlyings` |
| `src/hooks/useArchivedUnderlyings.ts` | Nuovo hook CRUD |
| `src/components/derivatives/StrategyConfigWizard.tsx` | UI archivia/ripristina, filtro gruppi |
| `src/pages/Derivatives.tsx` | Collegamento hook → Wizard |
