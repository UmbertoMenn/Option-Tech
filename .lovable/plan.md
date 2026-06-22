## Obiettivo
Sostituire i carousel "Vista: ..." nella Dashboard e nel Risk Analyzer con una riga di card cliccabili — una card per ciascuna vista, evidenziata quando attiva.

## Modifiche

### 1. `src/components/dashboard/ViewModeSelector.tsx`
Sostituire il blocco con frecce + pallini con 3 card affiancate (flex-wrap, gap-3), ciascuna con il nome della vista:
- Base
- Netting ex. Covered Call e Naked Put OTM
- Netting Totale

Comportamento card:
- Click → `onViewModeChange(mode)`
- Stato attivo: bordo `border-primary`, sfondo `bg-primary/10`, testo `text-primary`
- Stato inattivo: `border-border`, hover `bg-muted/50`
- Padding `px-4 py-3`, `rounded-lg`, `text-sm font-medium`, cursor pointer, transizione colori
- Responsive: su mobile le card vanno a capo (flex-wrap), su desktop su una riga centrata

### 2. `src/components/risk/RiskViewModeSelector.tsx`
Stessa identica struttura, con le 3 viste:
- Equity Exposure
- Currency Exposure
- Sector Allocation

## Note
- Le API dei componenti (`viewMode`, `onViewModeChange`) restano invariate → nessuna modifica nei consumer.
- Rimuovo gli import non più usati (`ChevronLeft`, `ChevronRight`).
- Mantengo il margin-bottom `mb-4` per non alterare la spaziatura delle pagine.