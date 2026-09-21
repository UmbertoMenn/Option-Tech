-- Run against a migrated database as a maintenance role. Uses isolated fixture
-- portfolios and rolls back every change. Requires one existing auth user.
BEGIN;
DO $$
DECLARE
  owner_id uuid := (SELECT id FROM auth.users LIMIT 1);
  pf uuid := gen_random_uuid();
  other_pf uuid := gen_random_uuid();
  stock_id uuid := gen_random_uuid();
  option_id uuid := gen_random_uuid();
  cfg_id uuid := gen_random_uuid();
  override_id uuid := gen_random_uuid();
  old_history uuid;
  current_history uuid;
  result jsonb;
  previous_snapshot jsonb;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Fixture requires an auth user'; END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  INSERT INTO public.portfolios(id, user_id, name, snapshot_date, cash_value)
    VALUES (pf, owner_id, 'snapshot deletion test', '2026-09-21', 999),
      (other_pf, owner_id, 'untouched fixture', '2026-09-21', 777);
  INSERT INTO public.positions(id, portfolio_id, description, asset_type, quantity, market_value)
    VALUES (stock_id, pf, 'Historical stock', 'stock', 100, 2000),
      (option_id, pf, 'Historical option', 'derivative', -1, -20);
  INSERT INTO public.strategy_configurations(id, portfolio_id, underlying, strategy_type,
    linked_stock_id, linked_stock_slot_ids, config_locked)
    VALUES (cfg_id, pf, 'TEST', 'covered_call', stock_id,
      jsonb_build_array(stock_id::text || ':0'), true);
  INSERT INTO public.derivative_overrides(id, portfolio_id, override_type, position_id,
    linked_stock_id, target_category)
    VALUES (override_id, pf, 'single', option_id, stock_id, 'covered_call');
  INSERT INTO public.gp_holdings(portfolio_id, asset_type, description, market_value)
    VALUES (pf, 'cash', 'GP cash', 200);
  INSERT INTO public.historical_data(portfolio_id, snapshot_date, total_value, snapshot_underlying_prices)
    VALUES (pf, '2026-09-09', 2300, '{"TEST":20}'),
      (pf, '2026-09-21', 9999, '{"TEST":99}');
  SELECT id INTO old_history FROM public.historical_data WHERE portfolio_id=pf AND snapshot_date='2026-09-09';
  SELECT id INTO current_history FROM public.historical_data WHERE portfolio_id=pf AND snapshot_date='2026-09-21';
  INSERT INTO public.portfolio_full_snapshots(portfolio_id, snapshot_date, positions,
    strategy_configurations, derivative_overrides, gp_holdings, cash_value, gp_total_value, restricted_cash_value)
    SELECT pf, '2026-09-09',
      (SELECT jsonb_agg(to_jsonb(p)) FROM public.positions p WHERE portfolio_id=pf),
      (SELECT jsonb_agg(to_jsonb(c) - 'config_locked') FROM public.strategy_configurations c WHERE portfolio_id=pf),
      (SELECT jsonb_agg(to_jsonb(o)) FROM public.derivative_overrides o WHERE portfolio_id=pf),
      (SELECT jsonb_agg(to_jsonb(g)) FROM public.gp_holdings g WHERE portfolio_id=pf), 100, 200, 50;
  SELECT to_jsonb(s) INTO previous_snapshot FROM public.portfolio_full_snapshots s WHERE portfolio_id=pf;
  INSERT INTO public.portfolio_full_snapshots(portfolio_id, snapshot_date) VALUES (pf, '2026-09-21');
  UPDATE public.positions SET quantity=999 WHERE portfolio_id=pf;

  -- Cross-portfolio IDs and anonymous/other-user requests must fail.
  BEGIN
    PERFORM public.delete_historical_snapshot(current_history, other_pf);
    RAISE EXCEPTION 'Mismatched history accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Dato storico non trovato: aggiorna la pagina' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.delete_historical_snapshot(current_history, pf);
    RAISE EXCEPTION 'Unauthorized user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.delete_historical_snapshot(current_history, pf);
    RAISE EXCEPTION 'Anonymous user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  IF has_function_privilege('authenticated', 'public.restore_latest_portfolio_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal restore helper is publicly callable';
  END IF;

  -- Corrupt references must roll back the history deletion AND position writes.
  UPDATE public.portfolio_full_snapshots SET derivative_overrides =
    jsonb_set(derivative_overrides, '{0,position_id}', to_jsonb(gen_random_uuid()::text))
    WHERE portfolio_id=pf AND snapshot_date='2026-09-09';
  BEGIN
    PERFORM public.delete_historical_snapshot(current_history, pf);
    RAISE EXCEPTION 'Corrupt snapshot accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Snapshot non valido: collegamenti derivati mancanti' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.historical_data WHERE id=current_history)
    OR (SELECT quantity FROM public.positions WHERE id=stock_id) <> 999 THEN
    RAISE EXCEPTION 'Restoration failure was not atomic';
  END IF;
  UPDATE public.portfolio_full_snapshots SET derivative_overrides = previous_snapshot->'derivative_overrides'
    WHERE portfolio_id=pf AND snapshot_date='2026-09-09';

  result := public.delete_historical_snapshot(current_history, pf);
  IF result->>'snapshot_date' <> '2026-09-09' OR NOT (result->>'restored')::boolean THEN
    RAISE EXCEPTION 'Wrong restore date: %', result;
  END IF;
  IF (SELECT quantity FROM public.positions WHERE id=stock_id) <> 100
    OR (SELECT linked_stock_id FROM public.derivative_overrides WHERE id=override_id) <> stock_id
    OR (SELECT linked_stock_id FROM public.strategy_configurations WHERE id=cfg_id) <> stock_id
    OR NOT (SELECT config_locked FROM public.strategy_configurations WHERE id=cfg_id)
    OR (SELECT cash_value FROM public.portfolios WHERE id=pf) <> 100
    OR (SELECT gp_cash_value FROM public.portfolios WHERE id=pf) <> 200
    OR (SELECT gp_total_value FROM public.portfolios WHERE id=pf) <> 200
    OR (SELECT restricted_cash_value FROM public.portfolios WHERE id=pf) <> 50
    OR (SELECT total_value FROM public.portfolios WHERE id=pf) <> 2300 THEN
    RAISE EXCEPTION 'Incomplete portfolio restoration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portfolio_full_snapshots WHERE portfolio_id=pf AND snapshot_date='2026-09-21')
    OR (SELECT to_jsonb(s) FROM public.portfolio_full_snapshots s WHERE portfolio_id=pf) IS DISTINCT FROM previous_snapshot
    OR (SELECT snapshot_underlying_prices FROM public.historical_data WHERE id=old_history) <> '{"TEST":20}'::jsonb
    OR (SELECT cash_value FROM public.portfolios WHERE id=other_pf) <> 777 THEN
    RAISE EXCEPTION 'Deleted snapshot, immutable history or portfolio isolation failed';
  END IF;

  -- Deleting an older date must preserve live edits.
  INSERT INTO public.historical_data(portfolio_id, snapshot_date) VALUES (pf, '2026-08-01') RETURNING id INTO current_history;
  INSERT INTO public.portfolio_full_snapshots(portfolio_id, snapshot_date) VALUES (pf, '2026-08-01');
  UPDATE public.positions SET quantity=123 WHERE id=stock_id;
  result := public.delete_historical_snapshot(current_history, pf);
  IF (result->>'restored')::boolean OR (SELECT quantity FROM public.positions WHERE id=stock_id) <> 123 THEN
    RAISE EXCEPTION 'Deleting older history overwrote current edits';
  END IF;

  -- No full snapshot available: retain the current date instead of half-deleting.
  INSERT INTO public.historical_data(portfolio_id, snapshot_date) VALUES (pf, '2026-08-01') RETURNING id INTO current_history;
  BEGIN
    PERFORM public.delete_historical_snapshot(old_history, pf);
    RAISE EXCEPTION 'Missing full snapshot accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Nessuno snapshot completo disponibile:%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.historical_data WHERE id=old_history) THEN
    RAISE EXCEPTION 'Missing snapshot failure was not atomic';
  END IF;
  DELETE FROM public.historical_data WHERE id=current_history;

  -- Repair the exact legacy failure: current date deleted, old full snapshot available.
  UPDATE public.portfolios SET snapshot_date='2026-09-21' WHERE id=pf;
  INSERT INTO public.portfolio_full_snapshots(portfolio_id, snapshot_date) VALUES (pf, '2026-09-21');
  IF public.restore_latest_portfolio_snapshot(pf) <> '2026-09-09' THEN
    RAISE EXCEPTION 'Legacy repair reused an orphan snapshot';
  END IF;

  result := public.delete_historical_snapshot(old_history, pf);
  IF result->>'snapshot_date' IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.positions WHERE portfolio_id=pf)
    OR EXISTS (SELECT 1 FROM public.strategy_configurations WHERE portfolio_id=pf)
    OR EXISTS (SELECT 1 FROM public.derivative_overrides WHERE portfolio_id=pf)
    OR EXISTS (SELECT 1 FROM public.gp_holdings WHERE portfolio_id=pf)
    OR (SELECT cash_value FROM public.portfolios WHERE id=pf) <> 0 THEN
    RAISE EXCEPTION 'Deleting the last snapshot did not clear live state';
  END IF;
END;
$$;
ROLLBACK;
