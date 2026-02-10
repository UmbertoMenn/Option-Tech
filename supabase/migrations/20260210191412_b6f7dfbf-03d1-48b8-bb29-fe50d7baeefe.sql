ALTER TABLE public.profiles
  ADD COLUMN admin_notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN admin_notify_telegram boolean NOT NULL DEFAULT true;