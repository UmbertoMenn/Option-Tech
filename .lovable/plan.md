
# Piano: Differenziazione Icone Strategie Derivati

## Obiettivo
Cambiare le icone per Double Diagonal e Naked Put per distinguerle visivamente da Iron Condor, e modificare il colore della sezione "Altre Strategie".

---

## Stato Attuale

| Sezione | Icona | Colore |
|---------|-------|--------|
| Covered Call | Shield | text-primary |
| Protezioni - Long Put | Shield | text-primary |
| Iron Condor | Target | text-amber-500 |
| Double Diagonal | Target | text-purple-500 |
| Naked Put | Target | text-primary |
| Leap Call | TrendingUp | text-green-500 |
| Altre Strategie | TrendingDown | text-muted-foreground |

---

## Modifiche Proposte

| Sezione | Nuova Icona | Nuovo Colore | Motivazione |
|---------|-------------|--------------|-------------|
| Double Diagonal | `Layers` | text-purple-500 | Rappresenta le scadenze stratificate/diagonali |
| Naked Put | `CircleDollarSign` | text-orange-500 | Rappresenta il rischio monetario delle put scoperte |
| Altre Strategie | `Puzzle` | text-cyan-500 | Colore più vivace per strategie non classificate |

---

## Dettaglio Tecnico

### File da Modificare
`src/pages/Derivatives.tsx`

### Modifiche

1. **Import aggiuntivi** - Aggiungere le nuove icone da lucide-react:
   - `Layers` (per Double Diagonal)
   - `CircleDollarSign` (per Naked Put)
   - `Puzzle` (per Altre Strategie)

2. **Double Diagonal (linea ~247)**
   - Da: `<Target className="w-5 h-5 text-purple-500" />`
   - A: `<Layers className="w-5 h-5 text-purple-500" />`

3. **Naked Put (linea ~287)**
   - Da: `<Target className="w-5 h-5 text-primary" />`
   - A: `<CircleDollarSign className="w-5 h-5 text-orange-500" />`

4. **Altre Strategie (linea ~367)**
   - Da: `<TrendingDown className="w-5 h-5 text-muted-foreground" />`
   - A: `<Puzzle className="w-5 h-5 text-cyan-500" />`

---

## Risultato Finale

| Sezione | Icona | Colore |
|---------|-------|--------|
| Covered Call | Shield | text-primary (blu) |
| Protezioni - Long Put | Shield | text-primary (blu) |
| Iron Condor | Target | text-amber-500 (giallo/oro) |
| Double Diagonal | Layers | text-purple-500 (viola) |
| Naked Put | CircleDollarSign | text-orange-500 (arancione) |
| Leap Call | TrendingUp | text-green-500 (verde) |
| Altre Strategie | Puzzle | text-cyan-500 (ciano) |

---

## File Coinvolti

| File | Tipo Modifica |
|------|---------------|
| `src/pages/Derivatives.tsx` | Aggiornamento import e icone |
