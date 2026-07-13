-- Le policy RLS di call_buybacks ammettevano solo il proprietario del
-- portafoglio (user_id = auth.uid()). Il consulente opera come admin sui
-- portafogli dei clienti, quindi non poteva inserire/modificare i riacquisti
-- (errore: "new row violates row-level security policy for table call_buybacks").
-- Aggiungo una policy ALL per il ruolo admin, come già fatto per deposits.

DROP POLICY IF EXISTS "Admins can manage all call buybacks" ON public.call_buybacks;

CREATE POLICY "Admins can manage all call buybacks"
ON public.call_buybacks
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
