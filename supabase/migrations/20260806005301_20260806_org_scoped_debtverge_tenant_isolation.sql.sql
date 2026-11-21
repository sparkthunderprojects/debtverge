/*
# DebtVerge Tenant Isolation — Organization-Scoped RLS

## Purpose
Previously, all debt_* tables used per-user RLS (auth.uid() = user_id), meaning
any advisor in the same firm could NOT see each other's cases, and there was no
concept of organization-level isolation. This migration:

1. Adds `organization_id` column to `debt_cases` (the parent table for all debt data)
2. Backfills existing rows from `organization_users` membership
3. Creates a `is_super_admin()` SQL helper that checks profiles.is_super_admin
4. Replaces all debt_* RLS policies to enforce organization-scoped access:
   - Regular users can only access rows where the parent case's organization_id
     matches one of their organization_users memberships
   - Super admins bypass org checks (see all data)
5. Updates profiles RLS so super_admin can read all profiles (for Admin Hub)

## Tables Modified
- `debt_cases` — adds `organization_id uuid` column (nullable for backward compat)
- All 29 `debt_*` tables — RLS policies replaced with org-scoped versions

## Security Changes
- New `is_super_admin()` SECURITY DEFINER function (immutable, schema-safe)
- `debt_cases` RLS: org-scoped via organization_users membership, super_admin bypass
- Child tables (debt_creditors, etc.): org-scoped via EXISTS join to debt_cases
- `profiles` SELECT policy: super_admin can see all profiles

## Important Notes
1. organization_id is nullable on debt_cases to avoid breaking existing inserts.
   The frontend should set it when creating new cases. A future migration can
   make it NOT NULL once all rows are backfilled.
2. Super admin bypass uses the is_super_admin() helper which reads from profiles.
   This is server-side only — no client code is involved.
3. Child tables that reference debt_cases via case_id inherit org isolation
   through EXISTS subqueries — they do NOT need their own organization_id.
*/

-- ============================================================
-- Step 1: Create is_super_admin() helper function
-- ============================================================
-- Checks whether the current authenticated user has is_super_admin = true
-- in the profiles table. Used by RLS policies to bypass org checks.
-- SECURITY DEFINER so it can read profiles even if the caller's RLS
-- would otherwise restrict access.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ============================================================
-- Step 2: Add organization_id to debt_cases and backfill
-- ============================================================

ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill from organization_users: pick the first org membership for each case's user
UPDATE debt_cases dc
SET organization_id = (
  SELECT ou.organization_id
  FROM organization_users ou
  WHERE ou.user_id = dc.user_id
  ORDER BY ou.created_at
  LIMIT 1
)
WHERE dc.organization_id IS NULL;

-- Add index for org-scoped queries
CREATE INDEX IF NOT EXISTS idx_debt_cases_organization_id ON debt_cases(organization_id);

-- ============================================================
-- Step 3: Update profiles RLS — super_admin can see all profiles
-- ============================================================

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
DROP POLICY IF EXISTS "select_all_profiles_super_admin" ON profiles;
DROP POLICY IF EXISTS "select_own_profile_or_super_admin" ON profiles;

CREATE POLICY "select_own_profile_or_super_admin" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_super_admin());

-- ============================================================
-- Step 4: Replace debt_cases RLS with org-scoped policies
-- ============================================================

DROP POLICY IF EXISTS "select_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "insert_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "update_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "delete_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "select_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "insert_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "update_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "delete_org_debt_cases" ON debt_cases;

-- A user can access a case if:
--   (a) they are super_admin, OR
--   (b) the case's organization_id matches one of their org memberships
CREATE POLICY "select_org_debt_cases" ON debt_cases
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "insert_org_debt_cases" ON debt_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "update_org_debt_cases" ON debt_cases
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "delete_org_debt_cases" ON debt_cases
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

-- ============================================================
-- Step 5: Replace ALL child debt_* table RLS with org-scoped policies
-- ============================================================
-- These tables reference debt_cases via case_id. Their RLS checks
-- that the parent case belongs to the user's organization (or super_admin).

DO $$
DECLARE
  tbl text;
  child_tables text[] := ARRAY[
    'debt_creditors',
    'debt_sfs_entries',
    'debt_payments',
    'debt_negotiations',
    'debt_customer_profiles',
    'debt_bank_transactions',
    'debt_annual_reviews',
    'debt_audit_log',
    'debt_benefits_checks',
    'debt_breathing_spaces',
    'debt_creditor_votes',
    'debt_distributions',
    'debt_document_checklist',
    'debt_ip_details',
    'debt_iva_contributions',
    'debt_iva_distribution_items',
    'debt_iva_distribution_runs',
    'debt_iva_proposals',
    'debt_payment_transactions',
    'debt_previous_addresses',
    'debt_proof_of_debt',
    'debt_signposting_assessments',
    'debt_vulnerability_assessments',
    'debtverge_communications',
    'debtverge_compliance_attestations',
    'debtverge_vulnerability_flags'
  ];
BEGIN
  FOREACH tbl IN ARRAY child_tables LOOP
    -- Drop old per-user policies (they follow the _own_ naming convention,
    -- but the prefix varies: debt_ or debtverge_). We drop by pattern.
    EXECUTE format('DROP POLICY IF EXISTS "select_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "update_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own_%s" ON %s;', tbl, tbl);

    -- Also drop any previously-created org policies (idempotency)
    EXECUTE format('DROP POLICY IF EXISTS "select_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "insert_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "update_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "delete_org_%s" ON %s;', tbl, tbl);

    -- SELECT
    EXECUTE format(
      'CREATE POLICY "select_org_%s" ON %s FOR SELECT TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );

    -- INSERT
    EXECUTE format(
      'CREATE POLICY "insert_org_%s" ON %s FOR INSERT TO authenticated WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );

    -- UPDATE
    EXECUTE format(
      'CREATE POLICY "update_org_%s" ON %s FOR UPDATE TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      ) WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl, tbl
    );

    -- DELETE
    EXECUTE format(
      'CREATE POLICY "delete_org_%s" ON %s FOR DELETE TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================
-- Step 6: Update debtverge_tenants RLS to allow super_admin full access
-- ============================================================

DROP POLICY IF EXISTS "select_all_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "select_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "select_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_debtverge_tenants" ON debtverge_tenants;

CREATE POLICY "select_debtverge_tenants" ON debtverge_tenants
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "insert_debtverge_tenants" ON debtverge_tenants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "update_debtverge_tenants" ON debtverge_tenants
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "delete_debtverge_tenants" ON debtverge_tenants
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid());

-- ============================================================
-- Step 7: Update debtverge_unassigned_messages RLS
-- ============================================================
-- This table uses matched_case_id (not case_id) to link to debt_cases

DROP POLICY IF EXISTS "select_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "insert_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "update_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "delete_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "select_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "insert_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "update_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "delete_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;

CREATE POLICY "select_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "insert_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "update_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "delete_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );