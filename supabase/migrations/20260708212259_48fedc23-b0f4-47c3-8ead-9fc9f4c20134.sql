-- 1) profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_status ON public.profiles(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins_update_profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) helper: is user active?
CREATE OR REPLACE FUNCTION public.has_active_access(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_active_access(UUID) TO authenticated;

-- 3) rewrite handle_new_user: domain restriction + auto-admin for founder
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain TEXT;
  v_status TEXT;
  v_is_admin BOOLEAN := false;
  v_org_id UUID;
  base_slug TEXT;
  final_slug TEXT;
  i INT := 0;
BEGIN
  v_domain := lower(split_part(NEW.email, '@', 2));

  IF lower(NEW.email) = 'samuel.muniz@lefil.com.br' THEN
    v_status := 'active';
    v_is_admin := true;
  ELSIF v_domain = 'lefil.com.br' THEN
    v_status := 'pending';
  ELSE
    v_status := 'blocked';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, status, approved_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    v_status,
    CASE WHEN v_status = 'active' THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_is_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- personal org for admin only
    base_slug := regexp_replace(lower(coalesce(split_part(NEW.email,'@',1),'user')), '[^a-z0-9]+', '-', 'g');
    final_slug := base_slug;
    WHILE EXISTS(SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
      i := i + 1;
      final_slug := base_slug || '-' || i::text;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members WHERE user_id = NEW.id AND status='active'
    ) THEN
      INSERT INTO public.organizations (name, slug, created_by)
      VALUES (COALESCE(split_part(NEW.email,'@',1),'Workspace') || '''s workspace', final_slug, NEW.id)
      RETURNING id INTO v_org_id;
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (v_org_id, NEW.id, 'owner', 'active');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) approve/block RPCs (admin-only)
CREATE OR REPLACE FUNCTION public.approve_user(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_domain TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = _user_id;
  IF v_email IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  v_domain := lower(split_part(v_email, '@', 2));
  IF v_domain <> 'lefil.com.br' THEN
    RAISE EXCEPTION 'domain_not_allowed';
  END IF;

  UPDATE public.profiles
    SET status = 'active', approved_by = auth.uid(), approved_at = now()
    WHERE id = _user_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'viewer')
    ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;

  UPDATE public.profiles SET status = 'blocked' WHERE id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated;

-- 5) backfill profiles for existing users using admin API is not available in SQL,
-- but we know the current admin exists in user_roles. Seed his profile.
INSERT INTO public.profiles (id, email, status, approved_at)
SELECT ur.user_id, 'samuel.muniz@lefil.com.br', 'active', now()
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (id) DO UPDATE SET status = 'active', approved_at = COALESCE(public.profiles.approved_at, now());