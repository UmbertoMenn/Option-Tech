CREATE POLICY "Admins can manage all put_roll_flags"
  ON public.put_roll_flags
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));