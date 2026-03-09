CREATE TABLE public.admin_notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  notify_email boolean NOT NULL DEFAULT true,
  notify_telegram boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, target_user_id)
);

ALTER TABLE public.admin_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage own notification preferences"
ON public.admin_notification_preferences FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = admin_user_id)
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND auth.uid() = admin_user_id);