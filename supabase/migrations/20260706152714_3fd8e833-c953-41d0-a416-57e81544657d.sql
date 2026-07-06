
ALTER TABLE public.platforms
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS owner_contact_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.platforms
  DROP CONSTRAINT IF EXISTS platforms_environment_check;
ALTER TABLE public.platforms
  ADD CONSTRAINT platforms_environment_check
  CHECK (environment IN ('production','internal'));

ALTER TABLE public.platforms
  DROP CONSTRAINT IF EXISTS platforms_card_last4_check;
ALTER TABLE public.platforms
  ADD CONSTRAINT platforms_card_last4_check
  CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');

CREATE INDEX IF NOT EXISTS idx_platforms_environment ON public.platforms(environment);
CREATE INDEX IF NOT EXISTS idx_platforms_owner_contact_id ON public.platforms(owner_contact_id);
