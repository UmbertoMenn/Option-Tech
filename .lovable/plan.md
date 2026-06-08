Uniformo l'header su tutte le pagine usando lo stesso menù della Dashboard (solo due tasti visibili: `Dashboard` e `Menù`, con tutto il resto raggruppato).

## Cosa farò

1. Creo un nuovo componente `src/components/layout/AppHeaderMenu.tsx` che incapsula i due controlli destri dell'header:
   - tasto `Dashboard` (link a `/`)
   - dropdown `Menù` con: PortfolioSelector, Strategie Derivati, Risk Analyzer, Risk Simulator, Admin (se admin), cambio tema, Esci
   - usa `useAuth`, `useTheme`, `useNavigate` internamente, così le pagine devono solo includerlo

2. Aggiorno `src/components/dashboard/Dashboard.tsx` per usare `<AppHeaderMenu />` al posto del blocco inline attuale (nessuna variazione visiva).

3. Aggiorno l'header di:
   - `src/pages/Derivatives.tsx` (linee ~500-580): rimuovo il vecchio dropdown mobile "Indice" e la barra desktop, lascio brand a sinistra + `<AppHeaderMenu />` a destra. Il `PortfolioSelector` inline nella zona brand viene rimosso (è già dentro Menù).
   - `src/pages/RiskAnalyzer.tsx` (linee ~210-260): stessa sostituzione.
   - `src/pages/RiskSimulator.tsx`: sostituisco il singolo tasto Dashboard con `<AppHeaderMenu />`.
   - `src/pages/Simulator.tsx` (linee ~126-139): sostituisco la mini-toolbar destra con `<AppHeaderMenu />`.

4. Nessuna modifica a routing, permessi, logica dati o comportamento dei singoli pulsanti.

## Risultato

Su tutte le pagine la barra in alto mostra a destra esattamente gli stessi due tasti — `Dashboard` e `Menù` — con lo stesso contenuto del dropdown della homepage.
