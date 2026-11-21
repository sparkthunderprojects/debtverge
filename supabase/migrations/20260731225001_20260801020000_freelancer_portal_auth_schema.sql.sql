/*
# Freelancer Portal Auth & Onboarding Schema

## Overview
Adds role-based access control to the existing auth system, enabling a dedicated
freelancer authentication portal and onboarding flow. The key addition is a `role`
column on the `profiles` table (staff vs. freelancer) and onboarding-related columns
on `freelancer_profiles`.

## Changes to Existing Tables

### profiles
- Added `role` (TEXT, NOT NULL, DEFAULT 'staff') — distinguishes internal staff
  (operators/admins) from external freelancers. Values: 'staff' or 'freelancer'.
  Used by the frontend to determine routing and access control.

### freelancer_profiles
- Added `bio` (TEXT) — freelancer biography for the onboarding wizard.
- Added `avatar_url` (TEXT) — profile avatar URL.
- Added `skill_category` (VARCHAR(50)) — primary skill category (e.g., "3D Artist",
  "Graphic Designer", "Copywriter", "Developer").
- Added `onboarding_completed` (BOOLEAN, DEFAULT FALSE) — tracks whether the
  freelancer has completed the 3-step onboarding wizard.
- Added `tax_id` (VARCHAR(100)) — tax/payment information from onboarding step 2.
- Added `payment_method` (VARCHAR(50)) — preferred payment method.
- Added `nda_signed` (BOOLEAN, DEFAULT FALSE) — whether the NDA was e-signed.
- Added `msa_signed` (BOOLEAN, DEFAULT FALSE) — whether the MSA was e-signed.

## New Database Objects

### trigger: handle_new_user
A trigger function that automatically creates a `profiles` row whenever a new user
registers in `auth.users`. This ensures every authenticated user has a profile row
with the default 'staff' role. The frontend signup flow will update the role to
'freelancer' after creating the auth account.

## Security
- profiles RLS: users can read their own profile; users can update their own profile.
  This is needed so the frontend can read the role to determine routing.
- The `handle_new_user` trigger runs as SECURITY DEFINER to insert into profiles
  regardless of the caller's role (anon during signup).

## Important Notes
1. The `role` column is stored in `profiles` (not `raw_app_meta_data`) because the
   frontend needs to read it via standard Supabase queries, and profiles is already
   set up with RLS for per-user access.
2. The trigger uses SECURITY DEFINER so the anon-key signup request can create the
   profile row — the anon role has INSERT permission on profiles via existing policies.
3. Existing profiles are updated to 'staff' by default (the column default handles this).
4. The freelancer_profiles columns are nullable so existing rows are unaffected.
*/

-- ============================================================
-- Add role column to profiles
-- ============================================================

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Update RLS policies on profiles to allow users to read/update their own row
-- (profiles already has RLS enabled from a prior migration)
DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles
    FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============================================================
-- Add onboarding columns to freelancer_profiles
-- ============================================================

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN bio TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN avatar_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN skill_category VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN tax_id VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN payment_method VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN nda_signed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN msa_signed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================
-- Auto-create profile row on user signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Seed: ensure existing auth users have profile rows
-- ============================================================

INSERT INTO profiles (id, email, full_name, role)
SELECT id, email,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''),
  'staff'
FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.users.id);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);