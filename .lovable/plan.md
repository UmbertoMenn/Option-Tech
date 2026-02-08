# Piano: Gestione Ticker Mapping - COMPLETATO ✅

## Obiettivo
1. ✅ Rendere la sezione "Ticker non risolti" in `AlertSettingsDialog` solo informativa (rimuovere input e pulsante Salva)
2. ✅ Aggiornare le policy RLS di `underlying_mappings` per permettere scrittura solo agli admin
3. ✅ Aggiungere una nuova tab "Ticker" nel pannello Admin per gestire i mapping non risolti

---

## Modifiche Eseguite

### Database
- ✅ Rimossa policy "Authenticated users can upsert underlying mappings"
- ✅ Creata policy "Admins can manage underlying mappings" (solo admin può scrivere)
- ✅ La policy SELECT "Anyone can read underlying mappings" rimane invariata

### Frontend

#### `AlertSettingsDialog.tsx`
- ✅ Rimosso stato `unresolvedMappings` e `savingMapping`
- ✅ Rimossa funzione `handleSaveUnresolvedMapping`
- ✅ Sezione "Ticker non risolti" trasformata in avviso read-only con Badge

#### `AdminPanel.tsx`
- ✅ Aggiunto import `TickerMappingManager`
- ✅ Aggiunta tab "Ticker" con icona Link2
- ✅ Aggiunto TabsContent con `TickerMappingManager`

#### Nuovi File
- ✅ `src/hooks/useUnderlyingMappings.ts` - Hook per CRUD mapping
- ✅ `src/components/admin/TickerMappingManager.tsx` - Componente gestione admin

---

## Risultato

### Utenti normali
- Vedono avviso "Ticker non risolti" con lista sottostanti problematici
- Messaggio che invita a contattare un amministratore
- Non possono più salvare mapping manualmente

### Admin
- Tab "Ticker" nel Pannello Admin mostra tutti i ticker non risolti
- Possono inserire il ticker corretto e salvare
- Possono vedere e gestire tutti i mapping esistenti
- Possono aggiungere nuovi mapping manualmente
- Possono eliminare mapping errati
