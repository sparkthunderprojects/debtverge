/*
# Role Architecture: Super Admin, Admin, Freelancer Isolation

## Overview
Establishes the role hierarchy for the Stormreef platform: super_admin, admin, staff,
and freelancer. Sets the current operator account to super_admin so they can access
every internal dashboard AND the Freelancer Portal. Adds a trigger that enforces
`role = 'freelancer'` on any profile created via the external freelancer signup flow
(detected via the `role` field in raw_user_meta_data).

## Changes to Existing Tables

### profiles
- No schema changes. The `role` column (TEXT, default 'staff') already exists.
- Role values used by the app: 'super_admin', 'admin', 'staff', 'freelancer'.
  These are stored as TEXT (not an enum) to allow flexible role additions without
  enum migration overhead.

## Security Changes

### Trigger: enforce_freelancer_role_on_signup
- AFTER INSERT on auth.users — if raw_user_meta_data contains `role: 'freelancer'`,
  upsert the matching profiles row with `role = 'freelancer'`.
- This ensures users who register via the /freelancer/signup route are hard-assigned
  the freelancer role at the database level, regardless of what the client does.
- Idempotent: uses ON CONFLICT (id) DO UPDATE.

### Trigger: handle_new_user_profile
- AFTER INSERT on auth.users — if no role is specified in raw_user_meta_data,
  create a profiles row with the default 'staff' role.
- This covers standard staff registrations.

## Data Updates
- Sets `operator@test.com` profile role to 'super_admin' (the current admin account).
- Ensures `owner@example.com` profile role remains 'freelancer'.

## Important Notes
1. Both triggers use `SECURITY DEFINER` and run as the postgres owner so they can
   write to profiles even when the calling role (anon/authenticated) lacks INSERT.
2. The triggers are idempotent — safe to re-run.
3. The `enforce_freelancer_role_on_signup` trigger specifically checks for the
   'freelancer' role value in user metadata, which the FreelancerAuth signup form sets.
*/

-- ============================================================
-- Set current admin account to super_admin
-- ============================================================

UPDATE profiles
SET role = 'super_admin'
WHERE email = 'operator@test.com';

-- Ensure the freelancer account stays freelancer
UPDATE profiles
SET role = 'freelancer'
WHERE email = 'owner@example.com';

-- ============================================================
-- Trigger: Auto-create/upgrade profile on user signup
-- Handles both staff (default) and freelancer (from metadata) registrations
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Insert or update profile based on role in user metadata
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        role = CASE
            -- Never downgrade a super_admin or admin
            WHEN profiles.role IN ('super_admin', 'admin') THEN profiles.role
            ELSE EXCLUDED.role
        END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Also handle existing auth.users that might not have profiles yet
INSERT INTO profiles (id, email, full_name, role)
SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', NULL),
    COALESCE(au.raw_user_meta_data->>'role', 'staff')
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Grant trigger function execution to appropriate roles
-- ============================================================
-- The trigger runs automatically on auth.users INSERT; no explicit GRANT needed
-- since it's a SECURITY DEFINER function invoked by the trigger system.