
-- 1. Recreate put_roll_flags policies: scope to authenticated, use private.has_role
DROP POLICY IF EXISTS "Users can read own put roll flags" ON public.put_roll_flags;
DROP POLICY IF EXISTS "Users can insert own put roll flags" ON public.put_roll_flags;
DROP POLICY IF EXISTS "Users can update own put roll flags" ON public.put_roll_flags;
DROP POLICY IF EXISTS "Users can delete own put roll flags" ON public.put_roll_flags;
DROP POLICY IF EXISTS "Admins can manage all put_roll_flags" ON public.put_roll_flags;

CREATE POLICY "Users can read own put roll flags"
  ON public.put_roll_flags
  FOR SELECT
  TO authenticated
  USING (
    portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert own put roll flags"
  ON public.put_roll_flags
  FOR INSERT
  TO authenticated
  WITH CHECK (
    portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own put roll flags"
  ON public.put_roll_flags
  FOR UPDATE
  TO authenticated
  USING (
    portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid())
  )
  WITH CHECK (
    portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own put roll flags"
  ON public.put_roll_flags
  FOR DELETE
  TO authenticated
  USING (
    portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can manage all put_roll_flags"
  ON public.put_roll_flags
  FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- 2. Revoke EXECUTE on public.has_role from authenticated/anon/public
--    (private.has_role is the canonical function used by all RLS policies)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
