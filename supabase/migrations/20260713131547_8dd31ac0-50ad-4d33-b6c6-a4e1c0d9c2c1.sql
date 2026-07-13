
INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT o.id, p.id, 'analyst'::org_role, 'active'
FROM public.profiles p
CROSS JOIN public.organizations o
WHERE o.slug = 'default'
  AND p.status = 'active'
  AND lower(split_part(p.email, '@', 2)) = 'lefil.com.br'
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = o.id AND m.user_id = p.id
  );

CREATE OR REPLACE FUNCTION public.approve_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email TEXT;
  v_domain TEXT;
  v_org_id UUID;
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

  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'default' LIMIT 1;
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_org_id, _user_id, 'analyst'::org_role, 'active')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_domain TEXT;
  v_status TEXT;
  v_is_admin BOOLEAN := false;
  v_default_org UUID;
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
  END IF;

  IF v_status = 'active' AND v_domain = 'lefil.com.br' THEN
    SELECT id INTO v_default_org FROM public.organizations WHERE slug = 'default' LIMIT 1;
    IF v_default_org IS NOT NULL THEN
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (v_default_org, NEW.id, CASE WHEN v_is_admin THEN 'owner'::org_role ELSE 'analyst'::org_role END, 'active')
      ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
