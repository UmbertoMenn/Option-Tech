# Piano: Funzionalità Admin Avanzate per Gestione Portafogli

## ✅ COMPLETATO

### Riepilogo Implementazione

1. **✅ Accesso Admin a tutti i portafogli** 
   - Aggiunte RLS policies admin su 7 tabelle (portfolios, positions, deposits, historical_data, derivative_overrides, covered_call_premiums, strategy_cache)
   - Nuovo tab "Portafogli" nel Pannello Admin
   - Admin può visualizzare/modificare qualsiasi portafoglio

2. **✅ Copia portafoglio admin su utente** 
   - Edge function `admin-copy-portfolio` per copia completa
   - Copia posizioni, depositi, dati storici, override, premi covered call
   - Remapping automatico degli ID per derivative_overrides

3. **✅ Vista aggregata globale**
   - Portfolio virtuale "AGGREGATED" visibile nel selector
   - Combina tutti i dati di tutti gli utenti
   - Vista read-only

---

## File Creati

| File | Descrizione |
|------|-------------|
| `supabase/functions/admin-copy-portfolio/index.ts` | Edge function per copia portfolio |
| `src/hooks/useAdminPortfolios.ts` | Fetch tutti i portfolios (admin) |
| `src/hooks/useAggregatedPortfolio.ts` | Hook per portfolio aggregato |
| `src/components/admin/PortfolioManager.tsx` | Tab admin gestione portfolios |
| `src/components/admin/CopyPortfolioDialog.tsx` | Dialog per copia su utente |

## File Modificati

| File | Modifica |
|------|----------|
| `src/contexts/PortfolioContext.tsx` | Admin mode + AGGREGATED + setAdminViewPortfolio |
| `src/components/admin/AdminPanel.tsx` | Nuovo tab "Portafogli" |
| `src/components/portfolio/PortfolioSelector.tsx` | Opzione Aggregato per admin |
| `src/hooks/usePortfolio.ts` | Gestione caso AGGREGATED + isReadOnly |

---

## RLS Policies Aggiunte

```sql
-- Portfolios
CREATE POLICY "Admins can manage all portfolios" ON portfolios FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Positions
CREATE POLICY "Admins can manage all positions" ON positions FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Deposits
CREATE POLICY "Admins can manage all deposits" ON deposits FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Historical Data
CREATE POLICY "Admins can manage all historical_data" ON historical_data FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Derivative Overrides
CREATE POLICY "Admins can manage all derivative_overrides" ON derivative_overrides FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Covered Call Premiums
CREATE POLICY "Admins can manage all covered_call_premiums" ON covered_call_premiums FOR ALL 
  USING (has_role(auth.uid(), 'admin'));

-- Strategy Cache
CREATE POLICY "Admins can manage all strategy_cache" ON strategy_cache FOR ALL 
  USING (has_role(auth.uid(), 'admin'));
```

---

## Flusso UX

### Admin accede a portafoglio utente
```
Admin → Pannello Admin → Tab "Portafogli" → Lista utenti → Click portfolio → Dashboard
```

### Admin copia il proprio portafoglio
```
Admin → Pannello Admin → Tab "Portafogli" → "I Miei Portafogli" → Copia su Utente
```

### Admin visualizza aggregato
```
Admin → Portfolio Selector → "Aggregato - Tutti gli Utenti" → Vista combinata read-only
```
