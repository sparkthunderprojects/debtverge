/*
# Fix infinite RLS recursion on organization_users

## Problem
The `select_org_users` policy on `organization_users` contains a subquery
that reads `organization_users` itself (to check if the current user is an
Admin in the same org). RLS evaluates the policy, which queries the table,
which triggers the policy again — infinite recursion → HTTP 500.

## Fix
1. Create a `SECURITY DEFINER` function `is_org_admin(target_org uuid)`
   that checks whether `auth.uid()` has an Admin role in the target
   organization. SECURITY DEFINER runs with the function owner's
   privileges, bypassing RLS on `organization_users` and breaking the
   recursion.
2. Drop and recreate all four CRUD policies on `organization_users`,
   replacing the self-referential subquery with the new function call.
3. Grant EXECUTE on the function to `authenticated`.

## Tables modified
- `organization_users` — policies replaced (no schema/column changes)

## Security
- The SECURITY DEFINER function is read-only (SELECT only) and scoped to
  the `authenticated` role. It does not expose data — it returns a boolean.
- All existing ownership checks (super_admin via profiles, org owner via
  organizations, self-access via user_id) are preserved.
*/

-- 1. Create the helper function
CREATE OR REPLACE FUNCTION is_org_admin(target_org uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_users ou
    JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.user_id = auth.uid()
      AND ou.organization_id = target_org
      AND r.name IN ('Admin', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_admin(uuid) TO authenticated;

-- 2. Drop and recreate policies (drop first for idempotency)
DROP POLICY IF EXISTS "select_org_users" ON organization_users;
DROP POLICY IF EXISTS "insert_org_users" ON organization_users;
DROP POLICY IF EXISTS "update_org_users" ON organization_users;
DROP POLICY IF EXISTS "delete_org_users" ON organization_users;

-- SELECT: user can see their own row, super_admins see all, org owners see all, org admins see all
CREATE POLICY "select_org_users" ON organization_users FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
    OR is_org_admin(organization_users.organization_id)
  );

-- INSERT: super_admins, org owners, or the user themselves
CREATE POLICY "insert_org_users" ON organization_users FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
    OR user_id = auth.uid()
  );

-- UPDATE: super_admins or org owners
CREATE POLICY "update_org_users" ON organization_users FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  );

-- DELETE: super_admins or org owners
CREATE POLICY "delete_org_users" ON organization_users FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  );
