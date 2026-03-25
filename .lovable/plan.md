

## Fix: Accenture e verifica completa posizioni derivati Mauro G

### Analisi DB completata

**Accenture** — Config salvata: `strategy_type: 'covered_call'`, `is_synthetic: true`
- Posizioni: CALL -1 @210 (APR/26), PUT +1 @160 (SEP/26), PUT -1 @380 (JUN/26)
- La PUT +1 @160 è una **protezione** (bought put), ma il codice per `covered_call` + `is_synthetic` (righe 294-308) la ignora completamente. La bought put viene consumata silenziosamente alla riga 320-322 senza apparire in nessuna sezione.

**Tutte le altre posizioni** hanno configurazioni corrispondenti. L'unica posizione con `underlying: null` è "AZ.REGULUS THERAPEUTICS INC CONTRA" che usa il fallback `d.description` per il matching e ha una config.

### Causa del bug

Nel case `covered_call` con `is_synthetic=true` (riga 294), il codice:
1. Trova la synthetic PUT venduta (deep ITM) ✓
2. Crea `syntheticCoveredCalls` con solo call + synthetic put ✓
3. **Ignora le bought PUTs** — le consuma silenziosamente senza mostrarle ✗

### Fix — 1 file

#### `src/lib/derivativeStrategies.ts` — Case `covered_call` con `is_synthetic`

Modificare il blocco `if (config.is_synthetic)` (righe 294-308) per:

1. Dopo aver trovato `synPut`, cercare bought PUTs protettive: `remaining.filter(d => d.option_type === 'put' && d.quantity > 0)`
2. Se ci sono bought PUTs → auto-promuovere a `deRiskingCoveredCalls` (come fa il case `derisking_covered_call` con `is_synthetic`):
   ```typescript
   const boughtPuts = remaining.filter(d => d.option_type === 'put' && d.quantity > 0);
   
   for (const call of calls) {
     const contracts = Math.abs(call.quantity);
     const cc: CoveredCallPosition = {
       option: call, underlying: stock, contractsCovered: contracts,
       sharesCovered: contracts * 100, isFullyCovered: true,
     };
     const protPut = boughtPuts.shift();
     if (protPut) {
       deRiskingCoveredCalls.push({
         coveredCall: cc, protectionPut: protPut,
         isSynthetic: true, syntheticPut: synPut,
       });
       usedDerivatives.add(protPut.id);
     } else {
       syntheticCoveredCalls.push({
         option: call, syntheticPut: synPut || createDummyStock(config.underlying) as any,
         contracts,
       });
     }
     usedDerivatives.add(call.id);
   }
   if (synPut) usedDerivatives.add(synPut.id);
   for (const p of boughtPuts) usedDerivatives.add(p.id);
   ```
3. Se NON ci sono bought PUTs → comportamento attuale (syntheticCoveredCalls)

Questo fa sì che Accenture (CALL -1 @210 + PUT -1 @380 sintetica + PUT +1 @160 protezione) venga correttamente classificata come **De-Risking Covered Call Sintetica**, con tutte e 3 le gambe visibili.

### File da modificare

1. `src/lib/derivativeStrategies.ts` — righe 294-308, auto-promozione a deRiskingCC quando ci sono bought PUTs

