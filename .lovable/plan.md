## Fix: consenti salvataggio strategie con sole azioni

### Problema
Nell'ultima modifica a `StrategyConfigWizard.tsx` ho aggiunto una guardia in `handleSave` che blocca il salvataggio se la strategia non ha gambe derivate (opzioni). Questo era sbagliato: l'utente può legittimamente configurare gruppi con sole azioni/ETF (es. per prepararle a future strategie o per raggrupparle logicamente).

### Soluzione
1. **Rimuovere la guardia** in `src/components/derivatives/StrategyConfigWizard.tsx` nel metodo `handleSave` che blocca strategie prive di gambe opzione. Mantenere solo i controlli logici realmente necessari (es. incompatibilità di tipo strategia).
2. **Mantenere** il `try/catch` + `toast.error` per errori Supabase e i log diagnostici — utili e non invasivi.
3. **Mantenere** il fix del filtro "Libere" con `touchedGroupKeys`.

### File toccati
- `src/components/derivatives/StrategyConfigWizard.tsx` — rimozione del blocco "no derivative legs".

Nessun'altra modifica.
