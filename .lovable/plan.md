

## Obiettivo

Riorganizzare la visualizzazione delle "Altre Strategie" con un layout a colonne allineate per una migliore leggibilità.

## Problema Attuale

Attualmente tutti gli elementi sono disposti in un unico flex container con gap variabile:
- Chevron + Underlying + Badge Strategia (blu) + Badge IB/OOB + BE values + Badge gambe + conteggio Call/Put

Questo crea un layout "fluido" dove ogni riga ha posizioni diverse a seconda della lunghezza dei dati.

## Soluzione Proposta

Creare un layout a griglia/colonne fisse partendo dal badge blu della strategia:

```text
| Chevron | Underlying | Badge Strategia | Badge IB/OOB | BE Range    | Gambe | Call/Put | PS        | P/L     |
|---------|------------|-----------------|--------------|-------------|-------|----------|-----------|---------|
| >       | AAPL       | Naked Put       | IB           | BE: 150.00  | 2     | 1C • 1P  | PS: 175€  | +120€   |
| >       | MSFT       | Bull Spread     | OOB          | BE: 300-350 | 3     | 2C       | PS: 280€  | -50€    |
```

## Modifiche Tecniche

### File: `src/pages/Derivatives.tsx`

Nel componente `GroupedOtherStrategyRow` (linee 1244-1328), ristrutturare il layout con CSS Grid o flex con larghezze fisse:

**1. Container principale con grid:**
```tsx
<div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto_auto] gap-2 items-center p-3 ...">
```

**2. Struttura colonne:**
- Colonna 1 (auto): Chevron
- Colonna 2 (1fr): Underlying (nome ticker, espandibile)  
- Colonna 3 (auto): Badge Strategia (blu) - larghezza fissa ~140px
- Colonna 4 (auto): Badge IB/OOB o IR/OOR - larghezza fissa ~50px
- Colonna 5 (auto): Breakeven range - larghezza fissa ~120px
- Colonna 6 (auto): Badge gambe - larghezza fissa ~60px
- Colonna 7 (auto): Conteggio Call/Put - larghezza fissa ~100px
- Colonna 8 (auto): Prezzo Sottostante (PS) - larghezza fissa ~100px
- Colonna 9 (auto): P/L - larghezza fissa ~80px

**3. Applicare larghezze minime per allineamento:**
```tsx
// Badge strategia con larghezza minima
<div className="w-36">
  {strategyName && (
    <Badge variant="outline" className="...">
      {strategyName}
    </Badge>
  )}
</div>

// Badge IB/OOB con larghezza fissa
<div className="w-12 flex justify-center">
  {showBreakevenBadge && breakevens.length > 0 && (
    <Badge ...>...</Badge>
  )}
</div>

// BE range con larghezza fissa
<div className="w-28">
  {showBreakevenBadge && breakevens.length > 0 && (
    <span className="text-xs text-muted-foreground">BE: ...</span>
  )}
</div>
```

## Layout Finale

La nuova struttura garantirà che:
- Ogni colonna abbia una larghezza fissa o minima consistente
- Gli elementi siano sempre allineati verticalmente tra le righe
- Il badge blu della strategia sia sempre nella stessa posizione
- I dati numerici (BE, PS, P/L) siano allineati a destra per facile confronto

