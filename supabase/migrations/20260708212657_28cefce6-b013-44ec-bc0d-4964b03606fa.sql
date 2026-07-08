-- Backfill profiles for pre-existing auth.users
INSERT INTO public.profiles (id, email, full_name, avatar_url, status, approved_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.raw_user_meta_data->>'avatar_url',
  CASE
    WHEN lower(split_part(u.email, '@', 2)) = 'lefil.com.br' THEN 'active'
    ELSE 'blocked'
  END,
  CASE
    WHEN lower(split_part(u.email, '@', 2)) = 'lefil.com.br' THEN now()
    ELSE NULL
  END
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url);

-- Remove role rows from any user marked blocked (non-lefil domain)
DELETE FROM public.user_roles
WHERE user_id IN (SELECT id FROM public.profiles WHERE status = 'blocked');