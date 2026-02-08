

## Obiettivo
1. Rendere la sezione "Ticker non risolti" in `AlertSettingsDialog` solo informativa (rimuovere input e pulsante Salva)
2. Aggiornare le policy RLS di `underlying_mappings` per permettere scrittura solo agli admin
3. Aggiungere una nuova tab "Ticker" nel pannello Admin per gestire i mapping non risolti

---

## Modifiche al Database

### 1. Aggiornare RLS Policy su `underlying_mappings`

```sql
-- Rimuovi la policy permissiva esistente
DROP POLICY IF EXISTS "Authenticated users can upsert underlying mappings" ON underlying_mappings;

-- Crea policy che permette solo agli admin di gestire i mapping
CREATE POLICY "Admins can manage underlying mappings"
  ON underlying_mappings
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
```

La policy SELECT esistente "Anyone can read underlying mappings" rimane invariata (lettura pubblica).

---

## Modifiche al Frontend

### 2. File: `src/components/derivatives/AlertSettingsDialog.tsx`

#### A. Rimuovere stato e funzioni non più necessari
- Rimuovere lo stato `unresolvedMappings` (riga 156)
- Rimuovere lo stato `savingMapping` (riga 157)
- Rimuovere la funzione `handleSaveUnresolvedMapping` (righe 351-390)

#### B. Modificare la sezione "Ticker non risolti" (righe 660-703)
Trasformare da form editabile a semplice avviso informativo:

```tsx
{unresolvedUnderlyings.length > 0 && (
  <div className="space-y-3 p-4 border rounded-lg border-amber-500/30 bg-amber-500/5">
    <div className="flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 text-amber-500" />
      <p className="text-sm font-medium">Ticker non risolti:</p>
    </div>
    <p className="text-xs text-muted-foreground">
      I seguenti sottostanti non hanno un ticker associato e non possono essere usati per gli avvisi di distanza. 
      Contatta un amministratore per risolvere questi mapping.
    </p>
    <div className="flex flex-wrap gap-2">
      {unresolvedUnderlyings.map(underlying => (
        <Badge key={underlying} variant="outline" className="text-amber-500 border-amber-500/30">
          {underlying}
        </Badge>
      ))}
    </div>
  </div>
)}
```

### 3. File: `src/components/admin/AdminPanel.tsx`

#### Aggiungere tab "Ticker" nella TabsList

```tsx
<TabsTrigger value="tickers" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
  <Link2 className="w-4 h-4 mr-2" />
  Ticker
</TabsTrigger>
```

E il contenuto corrispondente:

```tsx
<TabsContent value="tickers">
  <TickerMappingManager />
</TabsContent>
```

### 4. Nuovo file: `src/components/admin/TickerMappingManager.tsx`

Componente per gestione admin dei ticker mapping:

```text
┌────────────────────────────────────────────────────────────────┐
│ Gestione Mapping Ticker                        [Refresh]       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ⚠ Ticker Non Risolti (3)                                       │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ NVIDIA CORP      → [NVDA    ] [Salva]                    │   │
│ │ AMAZON COM INC   → [        ] [Salva]                    │   │
│ │ ORACLE CORP      → [ORCL    ] [Salva]                    │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                │
│ ────────────────────────────────────────────────────────────   │
│                                                                │
│ 📋 Mapping Esistenti (47)                    [Cerca...]        │
│ ┌────────────────────────────────────────────────────────┐     │
│ │  Underlying          │ Ticker │ Sorgente       │ 🗑    │     │
│ │ ─────────────────────┼────────┼────────────────┼───────│     │
│ │  APPLE INC           │ AAPL   │ fetch-prices   │  X    │     │
│ │  MICROSOFT CORP      │ MSFT   │ admin-override │  X    │     │
│ │  ...                 │ ...    │ ...            │       │     │
│ └────────────────────────────────────────────────────────┘     │
│                                                                │
│ ➕ Aggiungi Mapping Manuale                                     │
│ [Underlying Name     ] → [TICKER] [Aggiungi]                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Funzionalità:**
1. **Ticker non risolti**: Query che trova tutti gli `underlying` distinti dalla tabella `positions` (derivati) che non hanno corrispondenza in `underlying_mappings`
2. **Mapping esistenti**: Tabella con tutti i mapping attuali, ricercabile
3. **Aggiungi mapping**: Form per aggiungere mapping manuali (source: 'admin-override')
4. **Elimina mapping**: Possibilità di rimuovere mapping errati

### 5. Nuovo hook: `src/hooks/useUnderlyingMappings.ts`

Hook per gestire CRUD dei mapping (usato dal componente admin):

```typescript
export function useUnderlyingMappings() {
  // Query: tutti i mapping esistenti
  const allMappings = useQuery({
    queryKey: ['underlying-mappings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('underlying_mappings')
        .select('*')
        .order('underlying');
      return data;
    }
  });
  
  // Query: underlying non risolti (derivati senza mapping)
  const unresolvedQuery = useQuery({
    queryKey: ['unresolved-underlyings'],
    queryFn: async () => {
      // Fetch underlying unici dai derivati
      const { data: derivatives } = await supabase
        .from('positions')
        .select('underlying')
        .in('asset_type', ['OPTION', 'WARRANT', 'derivative'])
        .not('underlying', 'is', null);
      
      const uniqueUnderlyings = [...new Set(derivatives?.map(d => d.underlying).filter(Boolean))];
      
      // Fetch mapping esistenti
      const { data: mappings } = await supabase
        .from('underlying_mappings')
        .select('underlying');
      
      const mappedUnderlyings = new Set(mappings?.map(m => m.underlying));
      
      // Trova quelli non risolti
      return uniqueUnderlyings.filter(u => !mappedUnderlyings.has(u));
    }
  });
  
  // Mutation: crea/aggiorna mapping
  const upsertMapping = useMutation({...});
  
  // Mutation: elimina mapping
  const deleteMapping = useMutation({...});
  
  return { allMappings, unresolvedQuery, upsertMapping, deleteMapping };
}
```

---

## Riepilogo modifiche per file

| File | Azione |
|------|--------|
| **Database Migration** | Sostituire policy permissiva con policy admin-only |
| `AlertSettingsDialog.tsx` | Rimuovere stato/funzioni di salvataggio, trasformare UI in avviso read-only |
| `AdminPanel.tsx` | Aggiungere tab "Ticker" e import del nuovo componente |
| `TickerMappingManager.tsx` | **NUOVO** - Gestione completa mapping ticker per admin |
| `useUnderlyingMappings.ts` | **NUOVO** - Hook per query e mutazioni sui mapping |

---

## Sicurezza

La nuova configurazione garantisce:
- **Utenti normali**: Possono solo leggere i mapping (per le funzionalità di alert e prezzi)
- **Admin**: Possono leggere, creare, modificare ed eliminare mapping
- **Edge Functions (service_role)**: Continuano a bypassare RLS per gli aggiornamenti automatici

---

## Flusso utente finale

1. **Utente normale** in Gestione Avvisi:
   - Vede avviso "Ticker non risolti" con lista dei sottostanti problematici
   - Messaggio che invita a contattare un amministratore
   - Non può più salvare mapping manualmente

2. **Admin** nel Pannello Admin:
   - Tab "Ticker" mostra tutti i ticker non risolti
   - Può inserire il ticker corretto e salvare
   - Può vedere e gestire tutti i mapping esistenti
   - Può aggiungere nuovi mapping manualmente
   - Può eliminare mapping errati

