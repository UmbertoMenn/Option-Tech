

## Miglioramenti al Wizard: ticker/sottostante + pool separato per tipo

### Problemi attuali
1. Le label dei derivati nel pool e nelle strategie mostrano solo "V CALL 150 MAR/25" — manca il ticker/sottostante, impossibile distinguere opzioni su titoli diversi
2. Il pool è un unico blocco flat di chips — nessuna separazione per tipo strumento
3. Nelle strategy card create, non si vede il nome del sottostante

### Modifiche a `src/components/derivatives/StrategyConfigWizard.tsx`

**1. Label derivati con ticker/underlying**

Modificare `positionLabel()` per i derivati: aggiungere il ticker o underlying all'inizio:
```
LULU V CALL 150 MAR/25
AVGO A PUT 200 GIU/25 ×2
```
Logica: usare `p.ticker || p.underlying || p.description` come prefisso.

**2. Pool separato in 3 sezioni**

Dentro la Card "Pool posizioni disponibili", invece di un unico `flex-wrap`, dividere in 3 sotto-sezioni con header:
- **Azioni** — `pool.filter(p => p.asset_type === 'stock')`
- **ETF** — `pool.filter(p => p.asset_type === 'etf')`
- **Derivati** — `pool.filter(p => p.asset_type === 'derivative')`

Ogni sezione ha un titoletto (`text-[11px] text-muted-foreground font-medium uppercase`) e i chips sotto. Sezioni vuote nascoste.

**3. Underlying nelle strategy card**

Nell'header di ogni strategy card, mostrare il nome del sottostante principale (derivato dal primo derivato nel gruppo: `underlying || description`), accanto al dropdown tipo strategia. Es: "**LULULEMON** — [Covered Call ▾]"

