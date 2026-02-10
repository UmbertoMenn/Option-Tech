

## Spostare PortfolioSelector nella barra scrollabile

### Problema
Il selettore portafoglio si trova nella sezione sinistra dell'header (insieme al logo e al titolo), che non ha scroll orizzontale. Su mobile, occupa spazio fisso e impedisce la visualizzazione dei pulsanti a destra.

### Soluzione
Ristrutturare l'header della Dashboard in modo che:
- Il logo e il titolo restino fissi a sinistra (compatti)
- Il `PortfolioSelector` e tutti i pulsanti vengano raggruppati nella stessa sezione scrollabile a destra

### Modifica

**`src/components/dashboard/Dashboard.tsx`** - header (righe 154-170):
- Rimuovere `PortfolioSelector` dalla sezione sinistra (il div con logo/titolo)
- Spostarlo come primo elemento nella sezione destra scrollabile (`overflow-x-auto flex-nowrap`), prima dei pulsanti
- Nascondere il sottotitolo "Aggiornato..." su mobile per risparmiare spazio (`hidden sm:block`)

Struttura risultante:
```
[Logo + Titolo]  |  [PortfolioSelector] [Salva] [Derivati] [Risk] [Admin] [Esci]  -->
                    ^--- tutta questa riga scorre orizzontalmente su mobile
```
