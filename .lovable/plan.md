Correggo la barra superiore della Dashboard perché il codice attuale mostra ancora la vecchia barra desktop e su mobile mostra solo “Indice”.

Piano:
1. In `src/components/dashboard/Dashboard.tsx` sostituisco la barra desktop con soli due controlli visibili:
   - tasto `Dashboard`
   - tasto `Menù`
2. Dentro `Menù` raggruppo tutte le altre voci:
   - selettore portafoglio
   - Strategie Derivati
   - Risk Analyzer
   - Risk Simulator
   - Admin, solo se utente admin
   - cambio tema
   - Esci
3. Su mobile cambio `Indice` in `Menù` e aggiungo il tasto `Dashboard` visibile fuori dal menu.
4. Mantengo invariati routing, permessi, logica dati e comportamento dei singoli pulsanti.

Risultato atteso: nella barra in alto si vedono chiaramente solo `Dashboard` e `Menù`; tutte le altre voci sono dentro `Menù`.