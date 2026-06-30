## Obiettivo
Unificare le due card "Avviso singolo" e "Crea avvisi massivi" nel tab **Prezzo** di `AlertSettingsDialog.tsx` in un'unica card più compatta, con un toggle per passare da una modalità all'altra.

## Modifiche

**File:** `src/components/derivatives/AlertSettingsDialog.tsx` (tab `price`)

1. **Stato locale**: aggiungere `const [priceMode, setPriceMode] = useState<'single' | 'bulk'>('single')`.

2. **Card unificata**: sostituire le due card separate con un'unica `<Card>` contenente:
   - **Header**: titolo dinamico ("Nuovo avviso di prezzo" / "Crea avvisi massivi") + descrizione breve + un **ToggleGroup** (o due `Button` pill) in alto a destra per scegliere `Singolo` / `Massivo`.
   - **Body condizionale**:
     - Se `priceMode === 'single'` → render del form attuale dell'avviso singolo (ticker, prezzo target, direzione, switch elimina su trigger, pulsante crea).
     - Se `priceMode === 'bulk'` → render del form attuale massivo (ticker, base prezzo attuale/manuale, step %, slider numero avvisi, direzione, switch elimina, anteprima badge, pulsante crea).

3. **Riuso stato**: condividere dove possibile gli stati comuni già esistenti (ticker, validazione, prezzo corrente fetchato, switch "elimina su trigger") così cambiando modalità non si perdono i dati ticker già inseriti.

4. **UI/spacing**: ridurre padding interno e gap rispetto alle due card attuali per ottenere una sezione più compatta. Mantenere l'anteprima dei prezzi target solo in modalità Massivo.

5. Nessuna modifica a hook, schema DB, o logica di creazione (`useCreatePriceAlert` e `useBatchCreatePriceAlerts` restano invariati).

## Note
- Toggle realizzato con `ToggleGroup` di shadcn già presente nel progetto, oppure due bottoni con variant `default`/`outline`.
- Nessun impatto su altri tab dell'`AlertSettingsDialog`.