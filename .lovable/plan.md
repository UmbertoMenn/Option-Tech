

## Obiettivo
Rimuovere la barra di scorrimento dalla legenda del grafico a torta e mostrare solo un pulsante "Mostra tutti i settori" dopo i primi 8 settori.

---

## Modifica

### File: `src/components/risk/SectorAllocationView.tsx`

Nella sezione della legenda (attorno alle righe 300-330), rimuovere `max-h-48 overflow-y-auto` dal container e lasciare che la lista si espanda naturalmente quando si clicca il pulsante.

**Prima:**
```typescript
<div className="flex-1 space-y-1.5 max-h-48 overflow-y-auto">
```

**Dopo:**
```typescript
<div className="flex-1 space-y-1.5">
```

La logica rimane identica:
- Mostra i primi 8 settori
- Pulsante "Mostra altri X settori" 
- Cliccando, la lista si espande mostrando TUTTI i settori senza scrollbar
- Cliccando "Mostra meno", torna ai primi 8

---

## Risultato atteso

1. Nessuna barra di scorrimento nella legenda
2. Primi 8 settori visibili + pulsante "Mostra altri X settori"
3. Cliccando il pulsante, la card si espande verticalmente mostrando tutti i settori
4. Nessuno scroll interno, solo espansione naturale del contenuto

