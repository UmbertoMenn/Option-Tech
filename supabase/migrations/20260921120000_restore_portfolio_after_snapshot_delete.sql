-- A historical deletion must also move the live portfolio back. Keep the
-- operation atomic; never expose a mixture of positions from different dates.
ALTER TABLE public.portfolio_full_snapshots
  ADD COLUMN IF NOT EXISTS restricted_cash_value numeric;

-- Internal helper, also usable by a privileged maintenance session to repair
-- portfolios left behind by the old historical_data-only delete flow.
CREATE OR REPLACE FUNCTION public.restore_latest_portfolio_snapshot(p_portfolio_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snap public.portfolio_full_snapshots%ROWTYPE;
  restored_date date;
BEGIN
  PERFORM 1 FROM public.portfolios WHERE id = p_portfolio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portafoglio non trovato';
  END IF;

  -- A full snapshot whose history was deleted is NOT a valid restore target.
  SELECT s.* INTO snap
  FROM public.portfolio_full_snapshots s
  JOIN public.historical_data h
    ON h.portfolio_id = s.portfolio_id AND h.snapshot_date = s.snapshot_date
  WHERE s.portfolio_id = p_portfolio_id
  ORDER BY s.snapshot_date DESC LIMIT 1;
  restored_date := snap.snapshot_date;

  IF restored_date IS NULL AND EXISTS (
    SELECT 1 FROM public.historical_data WHERE portfolio_id = p_portfolio_id
  ) THEN
    RAISE EXCEPTION 'Nessuno snapshot completo disponibile: impossibile ripristinare le posizioni. Cancellazione annullata.';
  END IF;

  DELETE FROM public.derivative_overrides WHERE portfolio_id = p_portfolio_id;
  DELETE FROM public.strategy_configurations WHERE portfolio_id = p_portfolio_id;
  DELETE FROM public.positions WHERE portfolio_id = p_portfolio_id;
  DELETE FROM public.gp_holdings WHERE portfolio_id = p_portfolio_id;
  -- Derived caches must not continue reporting positions from the deleted date.
  DELETE FROM public.strategy_cache WHERE portfolio_id = p_portfolio_id;
  DELETE FROM public.monitoring_snapshot WHERE portfolio_id = p_portfolio_id;

  IF restored_date IS NOT NULL THEN
    -- Preserve position IDs: overrides and linked stock slots refer to them.
    -- Force portfolio_id rather than trusting editable snapshot JSON.
    INSERT INTO public.positions
    SELECT r.* FROM jsonb_array_elements(snap.positions) item
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.positions,
      jsonb_build_object('created_at', now(), 'updated_at', now()) || item ||
      jsonb_build_object('portfolio_id', p_portfolio_id)) r;

    INSERT INTO public.strategy_configurations
    SELECT r.* FROM jsonb_array_elements(snap.strategy_configurations) item
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.strategy_configurations,
      jsonb_build_object('sort_order', 0, 'is_synthetic', false,
        'position_signatures', '[]'::jsonb, 'linked_stock_slot_ids', '[]'::jsonb,
        'config_locked', true, 'created_at', now(), 'updated_at', now()) || item ||
      jsonb_build_object('portfolio_id', p_portfolio_id)) r;

    -- Reject foreign/corrupt links even though the function runs as definer.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(snap.derivative_overrides) item
      CROSS JOIN LATERAL jsonb_each_text(item) ref
      WHERE ref.key IN ('position_id', 'linked_stock_id', 'sold_put_id',
        'bought_put_id', 'sold_call_id', 'bought_call_id')
        AND ref.value IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.positions p
          WHERE p.id = ref.value::uuid AND p.portfolio_id = p_portfolio_id)
    ) THEN
      RAISE EXCEPTION 'Snapshot non valido: collegamenti derivati mancanti';
    END IF;

    INSERT INTO public.derivative_overrides
    SELECT r.* FROM jsonb_array_elements(snap.derivative_overrides) item
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.derivative_overrides,
      jsonb_build_object('created_at', now(), 'updated_at', now()) || item ||
      jsonb_build_object('portfolio_id', p_portfolio_id)) r;

    INSERT INTO public.gp_holdings
    SELECT r.* FROM jsonb_array_elements(snap.gp_holdings) item
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gp_holdings,
      jsonb_build_object('quantity', 0, 'market_value', 0,
        'created_at', now(), 'updated_at', now()) || item ||
      jsonb_build_object('portfolio_id', p_portfolio_id)) r;
  END IF;

  UPDATE public.portfolios SET
    snapshot_date = restored_date,
    cash_value = COALESCE(snap.cash_value, 0),
    gp_total_value = snap.gp_total_value,
    gp_cash_value = COALESCE((SELECT sum(market_value) FROM public.gp_holdings
      WHERE portfolio_id = p_portfolio_id AND asset_type = 'cash'), 0),
    -- Older full snapshots did not store restricted cash; do not retain a
    -- value from the deleted date or invent historical restricted liquidity.
    restricted_cash_value = COALESCE(snap.restricted_cash_value, 0),
    total_value = COALESCE((SELECT total_value FROM public.historical_data
      WHERE portfolio_id = p_portfolio_id AND snapshot_date = restored_date), 0),
    last_updated = now()
  WHERE id = p_portfolio_id;

  RETURN restored_date;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_latest_portfolio_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_latest_portfolio_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_historical_snapshot(p_history_id uuid, p_portfolio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pf public.portfolios%ROWTYPE;
  deleted_date date;
  restored_date date;
  restore_required boolean;
BEGIN
  -- Lock the parent first: concurrent deletes on one portfolio are serialized.
  SELECT * INTO pf FROM public.portfolios WHERE id = p_portfolio_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT (
    pf.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Accesso al portafoglio non autorizzato' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.historical_data
  WHERE id = p_history_id AND portfolio_id = p_portfolio_id
  RETURNING snapshot_date INTO deleted_date;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dato storico non trovato: aggiorna la pagina';
  END IF;

  DELETE FROM public.portfolio_full_snapshots
  WHERE portfolio_id = p_portfolio_id AND snapshot_date = deleted_date;

  -- Deleting an older entry must leave the current (possibly edited) state
  -- untouched. Also handle a stale date left by the previous delete flow.
  restore_required := pf.snapshot_date IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.historical_data
    WHERE portfolio_id = p_portfolio_id AND snapshot_date = pf.snapshot_date
  );
  restored_date := pf.snapshot_date;
  IF restore_required THEN
    restored_date := public.restore_latest_portfolio_snapshot(p_portfolio_id);
  END IF;

  RETURN jsonb_build_object('portfolio_id', p_portfolio_id,
    'deleted_date', deleted_date, 'snapshot_date', restored_date,
    'restored', restore_required);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_historical_snapshot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_historical_snapshot(uuid, uuid) TO authenticated;
