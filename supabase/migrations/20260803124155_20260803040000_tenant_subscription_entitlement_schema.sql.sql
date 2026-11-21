/*
# Extend RBAC module constraint + seed debt-suite permissions

## Purpose
The rbac_permissions table has a CHECK constraint limiting module values to the original 10.
This migration extends the constraint to include DEBTVERGE, DRAFTVERGE, IVAVERGE, LEADVERGE
and seeds view/edit/manage permissions for each.

## Changes
1. Drops and re-creates the CHECK constraint on rbac_permissions.module to include 4 new module values
2. Inserts 12 new permission rows (4 modules × 3 actions)
3. Creates subscription catalog tables and seed data for the tenant entitlement system

## Data Safety
- No data is lost — only the constraint is widened, never narrowed
- Existing permissions are untouched
*/

-- ============================================================
-- 1. Widen the rbac_permissions module CHECK constraint
-- ============================================================
ALTER TABLE rbac_permissions DROP CONSTRAINT IF EXISTS rbac_permissions_module_check;

ALTER TABLE rbac_permissions ADD CONSTRAINT rbac_permissions_module_check
  CHECK (module IN (
    'VAULT', 'PROJECTS', 'SIGN', 'AGENT', 'SOCIAL', 'MAIL', 'PAY',
    'PULSE', 'REWARDS', 'TALENT',
    'DEBTVERGE', 'DRAFTVERGE', 'IVAVERGE', 'LEADVERGE'
  ));

-- ============================================================
-- 2. Seed permissions for debt-suite modules
-- ============================================================
INSERT INTO rbac_permissions (module, action)
SELECT 'DEBTVERGE', a.action FROM (VALUES ('view'), ('edit'), ('manage')) AS a(action)
WHERE NOT EXISTS (SELECT 1 FROM rbac_permissions WHERE module = 'DEBTVERGE' AND action = a.action);

INSERT INTO rbac_permissions (module, action)
SELECT 'DRAFTVERGE', a.action FROM (VALUES ('view'), ('edit'), ('manage')) AS a(action)
WHERE NOT EXISTS (SELECT 1 FROM rbac_permissions WHERE module = 'DRAFTVERGE' AND action = a.action);

INSERT INTO rbac_permissions (module, action)
SELECT 'IVAVERGE', a.action FROM (VALUES ('view'), ('edit'), ('manage')) AS a(action)
WHERE NOT EXISTS (SELECT 1 FROM rbac_permissions WHERE module = 'IVAVERGE' AND action = a.action);

INSERT INTO rbac_permissions (module, action)
SELECT 'LEADVERGE', a.action FROM (VALUES ('view'), ('edit'), ('manage')) AS a(action)
WHERE NOT EXISTS (SELECT 1 FROM rbac_permissions WHERE module = 'LEADVERGE' AND action = a.action);

-- ============================================================
-- 3. Subscription Packages (catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  tier_level int NOT NULL DEFAULT 0,
  monthly_price_pence int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscription_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_subscription_packages" ON subscription_packages;
CREATE POLICY "read_subscription_packages"
ON subscription_packages FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_subscription_packages" ON subscription_packages;
CREATE POLICY "manage_subscription_packages"
ON subscription_packages FOR ALL
TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 4. Package-App mapping
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_package_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(package_id, app_key)
);

ALTER TABLE subscription_package_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_package_apps" ON subscription_package_apps;
CREATE POLICY "read_package_apps"
ON subscription_package_apps FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_package_apps" ON subscription_package_apps;
CREATE POLICY "manage_package_apps"
ON subscription_package_apps FOR ALL
TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 5. Tenant Subscriptions (org → package binding)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled','expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_tenant_subscriptions" ON tenant_subscriptions;
CREATE POLICY "read_tenant_subscriptions"
ON tenant_subscriptions FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_tenant_subscriptions" ON tenant_subscriptions;
CREATE POLICY "manage_tenant_subscriptions"
ON tenant_subscriptions FOR ALL
TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 6. Seed Package Catalog
-- ============================================================
INSERT INTO subscription_packages (name, slug, description, tier_level, monthly_price_pence) VALUES
  ('Essentials', 'essentials', 'Core CRM, social, mail and support tools for small teams.', 1, 4900),
  ('Professional', 'professional', 'Full commerce suite plus projects, talent and analytics.', 2, 9900),
  ('Enterprise', 'enterprise', 'Everything in Professional plus document signing and admin controls.', 3, 19900),
  ('Debt Suite', 'debt_suite', 'Full insolvency and debt management suite — Lead Verge, Debt Verge, Draft Verge, IVA Verge and Sign.', 4, 29900)
ON CONFLICT (slug) DO UPDATE SET
  description = EXCLUDED.description,
  tier_level = EXCLUDED.tier_level,
  monthly_price_pence = EXCLUDED.monthly_price_pence,
  updated_at = now();

-- ============================================================
-- 7. Seed Package-App Mappings
-- ============================================================
INSERT INTO subscription_package_apps (package_id, app_key)
SELECT p.id, a.app_key FROM subscription_packages p
CROSS JOIN (VALUES
  ('dashboard'), ('agent'), ('social'), ('mail'), ('rewards'), ('pulse')
) AS a(app_key)
WHERE p.slug = 'essentials'
ON CONFLICT (package_id, app_key) DO NOTHING;

INSERT INTO subscription_package_apps (package_id, app_key)
SELECT p.id, a.app_key FROM subscription_packages p
CROSS JOIN (VALUES
  ('dashboard'), ('agent'), ('social'), ('mail'), ('rewards'), ('pulse'),
  ('projects'), ('talent'), ('pay'), ('stormverge'), ('stormtalk'), ('stormtasks'), ('stormdrive')
) AS a(app_key)
WHERE p.slug = 'professional'
ON CONFLICT (package_id, app_key) DO NOTHING;

INSERT INTO subscription_package_apps (package_id, app_key)
SELECT p.id, a.app_key FROM subscription_packages p
CROSS JOIN (VALUES
  ('dashboard'), ('agent'), ('social'), ('mail'), ('rewards'), ('pulse'),
  ('projects'), ('talent'), ('pay'), ('stormverge'), ('stormtalk'), ('stormtasks'), ('stormdrive'),
  ('sign'), ('admin')
) AS a(app_key)
WHERE p.slug = 'enterprise'
ON CONFLICT (package_id, app_key) DO NOTHING;

INSERT INTO subscription_package_apps (package_id, app_key)
SELECT p.id, a.app_key FROM subscription_packages p
CROSS JOIN (VALUES
  ('dashboard'), ('agent'), ('social'), ('mail'), ('rewards'), ('pulse'),
  ('projects'), ('talent'), ('pay'), ('stormverge'), ('stormtalk'), ('stormtasks'), ('stormdrive'),
  ('sign'), ('admin'),
  ('leadverge'), ('debtverge'), ('draftverge'), ('ivaverge')
) AS a(app_key)
WHERE p.slug = 'debt_suite'
ON CONFLICT (package_id, app_key) DO NOTHING;

-- ============================================================
-- 8. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_org ON tenant_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_package_apps_package ON subscription_package_apps(package_id);
