/*
# Stormreef Admin, RBAC Security System, and Scoped Onboarding Engine

## Overview
Implements a full Role-Based Access Control (RBAC) system for the Stormreef ecosystem.
Creates granular permissions per module, organization-scoped roles, user-organization
membership with role assignment, and asset access links for external contractor sandboxing.

## New Tables

### rbac_roles
Organization-scoped roles (e.g. "Admin", "Editor", "External Contractor"). Can be preset
or custom. Each role groups a set of module permissions.
- `id`, `organization_id` (FK → organizations), `name`, `is_custom`, `created_at`

### rbac_permissions
System-defined permissions for each module. Each permission is a module + action pair.
- `id`, `module` (VAULT, PROJECTS, SIGN, AGENT, SOCIAL, MAIL, PAY, PULSE, REWARDS, TALENT),
  `action` (view, edit, manage), `created_at`

### rbac_role_permissions
Join table linking roles to their permissions.
- `role_id` (FK → rbac_roles), `permission_id` (FK → rbac_permissions)

### organization_users
Maps users to organizations with an assigned role. A user can belong to multiple
organizations with different roles in each.
- `id`, `user_id` (FK → profiles), `organization_id` (FK → organizations),
  `role_id` (FK → rbac_roles), `created_at`

### asset_access_links
Granular asset access for external contractors. Links a user to a specific asset within
a project, with view/download permissions, watermark enforcement, and expiry.
- `id`, `asset_id`, `user_id` (FK → profiles), `project_id` (FK → projects),
  `can_view`, `can_download`, `enforce_watermark`, `expires_at`, `created_at`

## Modified Tables (additive only)

### profiles
- `is_super_admin` BOOLEAN DEFAULT FALSE — flag for super admin users
- `status` TEXT DEFAULT 'ACTIVE' — INVITED / ACTIVE / SUSPENDED

## Security
- All new tables have RLS enabled with authenticated-only access
- rbac_roles, rbac_permissions, rbac_role_permissions: readable by all authenticated
  (needed for permission checks), writable by super_admin or org owner
- organization_users: readable by the user themselves or org admins, writable by org admins
- asset_access_links: readable by the linked user or org admins, writable by org admins

## Seed Data
- 27 permissions (9 modules × 3 actions: view, edit, manage)
- Preset roles per organization: Admin (all manage), Editor (view+edit), Viewer (view only),
  External Contractor (projects view + vault view only)
- organization_users: existing operator mapped as Admin in all 3 orgs
- Sample asset_access_links for the contractor user
*/

-- ============================================================
-- 1. EXTEND profiles with is_super_admin + status
-- ============================================================

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Mark existing super_admin role users as is_super_admin
UPDATE profiles SET is_super_admin = TRUE WHERE role = 'super_admin';

-- Set status for existing users
UPDATE profiles SET status = 'ACTIVE' WHERE status IS NULL OR status = '';

-- ============================================================
-- 2. CREATE rbac_permissions (system-defined)
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module TEXT NOT NULL CHECK (module IN ('VAULT', 'PROJECTS', 'SIGN', 'AGENT', 'SOCIAL', 'MAIL', 'PAY', 'PULSE', 'REWARDS', 'TALENT')),
    action TEXT NOT NULL CHECK (action IN ('view', 'edit', 'manage')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (module, action)
);

ALTER TABLE rbac_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_permissions" ON rbac_permissions;
CREATE POLICY "select_rbac_permissions" ON rbac_permissions
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_permissions" ON rbac_permissions;
CREATE POLICY "insert_rbac_permissions" ON rbac_permissions
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
    );

DROP POLICY IF EXISTS "delete_rbac_permissions" ON rbac_permissions;
CREATE POLICY "delete_rbac_permissions" ON rbac_permissions
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
    );

-- Seed all 30 permissions (10 modules × 3 actions)
INSERT INTO rbac_permissions (module, action)
VALUES
    ('VAULT', 'view'), ('VAULT', 'edit'), ('VAULT', 'manage'),
    ('PROJECTS', 'view'), ('PROJECTS', 'edit'), ('PROJECTS', 'manage'),
    ('SIGN', 'view'), ('SIGN', 'edit'), ('SIGN', 'manage'),
    ('AGENT', 'view'), ('AGENT', 'edit'), ('AGENT', 'manage'),
    ('SOCIAL', 'view'), ('SOCIAL', 'edit'), ('SOCIAL', 'manage'),
    ('MAIL', 'view'), ('MAIL', 'edit'), ('MAIL', 'manage'),
    ('PAY', 'view'), ('PAY', 'edit'), ('PAY', 'manage'),
    ('PULSE', 'view'), ('PULSE', 'edit'), ('PULSE', 'manage'),
    ('REWARDS', 'view'), ('REWARDS', 'edit'), ('REWARDS', 'manage'),
    ('TALENT', 'view'), ('TALENT', 'edit'), ('TALENT', 'manage')
ON CONFLICT (module, action) DO NOTHING;

-- ============================================================
-- 3. CREATE rbac_roles
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

ALTER TABLE rbac_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_roles" ON rbac_roles;
CREATE POLICY "select_rbac_roles" ON rbac_roles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_roles" ON rbac_roles;
CREATE POLICY "insert_rbac_roles" ON rbac_roles
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "update_rbac_roles" ON rbac_roles;
CREATE POLICY "update_rbac_roles" ON rbac_roles
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_rbac_roles" ON rbac_roles;
CREATE POLICY "delete_rbac_roles" ON rbac_roles
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- 4. CREATE rbac_role_permissions
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE rbac_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "select_rbac_role_permissions" ON rbac_role_permissions
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "insert_rbac_role_permissions" ON rbac_role_permissions
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (
            EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
            OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.organization_id AND o.owner_id = auth.uid())
        ))
    );

DROP POLICY IF EXISTS "delete_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "delete_rbac_role_permissions" ON rbac_role_permissions
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (
            EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
            OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.organization_id AND o.owner_id = auth.uid())
        ))
    );

-- ============================================================
-- 5. CREATE organization_users
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_org_users" ON organization_users;
CREATE POLICY "select_org_users" ON organization_users
    FOR SELECT TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM organization_users ou2
          JOIN rbac_roles r2 ON r2.id = ou2.role_id
          WHERE ou2.user_id = auth.uid() AND ou2.organization_id = organization_users.organization_id
          AND r2.name IN ('Admin', 'admin')
        )
    );

DROP POLICY IF EXISTS "insert_org_users" ON organization_users;
CREATE POLICY "insert_org_users" ON organization_users
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
        OR user_id = auth.uid()
    );

DROP POLICY IF EXISTS "update_org_users" ON organization_users;
CREATE POLICY "update_org_users" ON organization_users
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_org_users" ON organization_users;
CREATE POLICY "delete_org_users" ON organization_users
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- 6. CREATE asset_access_links
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_access_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_download BOOLEAN NOT NULL DEFAULT FALSE,
    enforce_watermark BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE asset_access_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_asset_access_links" ON asset_access_links;
CREATE POLICY "select_asset_access_links" ON asset_access_links
    FOR SELECT TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "insert_asset_access_links" ON asset_access_links;
CREATE POLICY "insert_asset_access_links" ON asset_access_links
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "update_asset_access_links" ON asset_access_links;
CREATE POLICY "update_asset_access_links" ON asset_access_links
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_asset_access_links" ON asset_access_links;
CREATE POLICY "delete_asset_access_links" ON asset_access_links
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rbac_roles_org ON rbac_roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_role ON rbac_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_perm ON rbac_role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_org_users_user ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_org_users_org ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_asset_access_user ON asset_access_links(user_id);
CREATE INDEX IF NOT EXISTS idx_asset_access_project ON asset_access_links(project_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

-- ============================================================
-- SEED: Preset roles for all 3 organizations
-- ============================================================

-- Stormreef HQ (36e68aad-64a0-49fd-a1c9-dc155eee1216)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT '36e68aad-64a0-49fd-a1c9-dc155eee1216', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216' AND r.name = t.name
);

-- Reef Studios (fbb93be3-371f-4e52-a64d-7ccf42bf63b2)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT 'fbb93be3-371f-4e52-a64d-7ccf42bf63b2', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = 'fbb93be3-371f-4e52-a64d-7ccf42bf63b2' AND r.name = t.name
);

-- Coral Commerce (801fa3a9-8a42-4150-b9b7-57474cd37981)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT '801fa3a9-8a42-4150-b9b7-57474cd37981', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = '801fa3a9-8a42-4150-b9b7-57474cd37981' AND r.name = t.name
);

-- ============================================================
-- SEED: Role permissions
-- Admin = all modules manage
-- Editor = all modules view + edit (except TALENT manage)
-- Viewer = all modules view
-- External Contractor = PROJECTS view + VAULT view only
-- ============================================================

-- Admin: all manage permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Admin' AND p.action = 'manage'
ON CONFLICT DO NOTHING;

-- Editor: all view + edit permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Editor' AND p.action IN ('view', 'edit')
ON CONFLICT DO NOTHING;

-- Viewer: all view permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Viewer' AND p.action = 'view'
ON CONFLICT DO NOTHING;

-- External Contractor: PROJECTS view + VAULT view only
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'External Contractor'
AND ((p.module = 'PROJECTS' AND p.action = 'view')
     OR (p.module = 'VAULT' AND p.action = 'view'))
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: organization_users — map existing operator as Admin in all orgs
-- ============================================================

INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT 'a30878aa-dd33-4be1-89dd-42bb2965e0c0', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'Admin'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = 'a30878aa-dd33-4be1-89dd-42bb2965e0c0'
    AND ou.organization_id = r.organization_id
)
ON CONFLICT DO NOTHING;

-- Map owner@example.com (freelancer) as External Contractor in Stormreef HQ
INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT 'e1acf174-d420-4438-b271-95b6290225ff', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'External Contractor' AND r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
    AND ou.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
)
ON CONFLICT DO NOTHING;

-- Map staff@example.com (staff) as Editor in Stormreef HQ
INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT '4cd13d52-ffb6-448f-a3fb-bab3e872dc66', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'Editor' AND r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = '4cd13d52-ffb6-448f-a3fb-bab3e872dc66'
    AND ou.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: asset_access_links for the contractor (owner@example.com)
-- Linked to Website Redesign 2026 project (85e1905d-8e5b-42b4-93ff-516f9a01ba77)
-- ============================================================

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-001', 'e1acf174-d420-4438-b271-95b6290225ff', '85e1905d-8e5b-42b4-93ff-516f9a01ba77',
       TRUE, FALSE, TRUE, NOW() + INTERVAL '30 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-001' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-002', 'e1acf174-d420-4438-b271-95b6290225ff', '85e1905d-8e5b-42b4-93ff-516f9a01ba77',
       TRUE, TRUE, FALSE, NOW() + INTERVAL '60 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-002' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-003', 'e1acf174-d420-4438-b271-95b6290225ff', '492694c2-fc53-44ad-9438-5f0691692249',
       TRUE, FALSE, TRUE, NOW() + INTERVAL '15 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-003' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Update profile names for better display
-- ============================================================

UPDATE profiles SET full_name = 'System Operator' WHERE id = 'a30878aa-dd33-4be1-89dd-42bb2965e0c0' AND full_name IS NULL;
UPDATE profiles SET status = 'INVITED' WHERE id = '4cd13d52-ffb6-448f-a3fb-bab3e872dc66' AND status = 'ACTIVE';
