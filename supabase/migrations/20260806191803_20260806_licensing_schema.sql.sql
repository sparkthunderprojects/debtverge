/*
# Licensing Schema — Catalog Items, Packages, Organization Licenses

## Purpose
Replaces the old subscription-per-org model (tenant_subscriptions + subscription_packages + subscription_package_apps)
with a granular licensing model. Each organization holds zero or more licences for individual catalogue items
(applications, services, modules). Packages bundle catalogue items but are just a convenience for granting
multiple licences at once.

This migration ONLY creates new tables. It does NOT touch or drop the existing
subscription_packages / subscription_package_apps / tenant_subscriptions tables.
Those remain in place so the old read path continues to work until the frontend
is switched over.

## New Tables

1. **catalog_items** — The catalogue of licensable products.
   - id (uuid PK)
   - key (text UNIQUE NOT NULL) — e.g. "debtverge", "stormcall"
   - name (text NOT NULL)
   - product_type (text NOT NULL) — "application" | "service" | "module"
   - category (text) — grouping label
   - icon (text) — icon identifier for UI
   - description (text)
   - is_addon (boolean DEFAULT false) — add-ons are never bundled in packages by default
   - is_active (boolean DEFAULT true)
   - display_order (int DEFAULT 0)

2. **packages** — Named bundles of catalogue items.
   - id (uuid PK)
   - name (text UNIQUE NOT NULL)
   - slug (text UNIQUE NOT NULL)
   - description (text)
   - monthly_price_pence (int NOT NULL DEFAULT 0)

3. **package_items** — Join table: which catalogue items are included in a package.
   - package_id (uuid FK → packages, ON DELETE CASCADE)
   - catalog_item_id (uuid FK → catalog_items)
   - PRIMARY KEY (package_id, catalog_item_id)

4. **organization_licenses** — One row per licence granted to an org.
   - id (uuid PK)
   - organization_id (uuid FK → organizations, ON DELETE CASCADE)
   - catalog_item_id (uuid FK → catalog_items)
   - status (text NOT NULL DEFAULT 'active') — "active" | "suspended" | "cancelled"
   - licence_source (text NOT NULL DEFAULT 'package') — "package" | "direct" | "trial" | "complimentary"
   - package_id (uuid FK → packages, nullable) — set when licence originated from a package
   - licence_type (text) — e.g. "monthly", "annual", "perpetual"
   - started_at (timestamptz DEFAULT now())
   - ends_at (timestamptz, nullable) — NULL = open-ended
   - created_at / updated_at (timestamptz)
   - No UNIQUE constraint on organization_id alone — an org can hold multiple licences.
   - UNIQUE (organization_id, catalog_item_id) — one licence per catalog item per org.

## Security
- RLS enabled on all four tables.
- catalog_items and packages are readable by all authenticated users (catalog data).
- organization_licenses scoped by org membership via organization_users, plus super_admin full access.
- Only super_admin can insert/update/delete catalog_items, packages, package_items, and organization_licenses.
*/

-- ============================================================
-- 1. catalog_items
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('application', 'service', 'module')),
  category text,
  icon text,
  description text,
  is_addon boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_catalog_items" ON catalog_items;
CREATE POLICY "read_catalog_items" ON catalog_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_catalog_items_super_admin" ON catalog_items;
CREATE POLICY "insert_catalog_items_super_admin" ON catalog_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "update_catalog_items_super_admin" ON catalog_items;
CREATE POLICY "update_catalog_items_super_admin" ON catalog_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "delete_catalog_items_super_admin" ON catalog_items;
CREATE POLICY "delete_catalog_items_super_admin" ON catalog_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

-- ============================================================
-- 2. packages
-- ============================================================
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  monthly_price_pence int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_packages" ON packages;
CREATE POLICY "read_packages" ON packages FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_packages_super_admin" ON packages;
CREATE POLICY "insert_packages_super_admin" ON packages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "update_packages_super_admin" ON packages;
CREATE POLICY "update_packages_super_admin" ON packages FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "delete_packages_super_admin" ON packages;
CREATE POLICY "delete_packages_super_admin" ON packages FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

-- ============================================================
-- 3. package_items (join table)
-- ============================================================
CREATE TABLE IF NOT EXISTS package_items (
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (package_id, catalog_item_id)
);

ALTER TABLE package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_package_items" ON package_items;
CREATE POLICY "read_package_items" ON package_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_package_items_super_admin" ON package_items;
CREATE POLICY "insert_package_items_super_admin" ON package_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "update_package_items_super_admin" ON package_items;
CREATE POLICY "update_package_items_super_admin" ON package_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "delete_package_items_super_admin" ON package_items;
CREATE POLICY "delete_package_items_super_admin" ON package_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

-- ============================================================
-- 4. organization_licenses
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  licence_source text NOT NULL DEFAULT 'package' CHECK (licence_source IN ('package', 'direct', 'trial', 'complimentary')),
  package_id uuid REFERENCES packages(id) ON DELETE SET NULL,
  licence_type text,
  started_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, catalog_item_id)
);

ALTER TABLE organization_licenses ENABLE ROW LEVEL SECURITY;

-- Users can read licenses for organizations they belong to
DROP POLICY IF EXISTS "read_own_org_licenses" ON organization_licenses;
CREATE POLICY "read_own_org_licenses" ON organization_licenses FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM organization_users ou
      WHERE ou.organization_id = organization_licenses.organization_id
      AND ou.user_id = auth.uid()
    )
  );

-- Super admins can read all licenses
DROP POLICY IF EXISTS "read_all_licenses_super_admin" ON organization_licenses;
CREATE POLICY "read_all_licenses_super_admin" ON organization_licenses FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

-- Only super admins can insert/update/delete licenses
DROP POLICY IF EXISTS "insert_licenses_super_admin" ON organization_licenses;
CREATE POLICY "insert_licenses_super_admin" ON organization_licenses FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "update_licenses_super_admin" ON organization_licenses;
CREATE POLICY "update_licenses_super_admin" ON organization_licenses FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

DROP POLICY IF EXISTS "delete_licenses_super_admin" ON organization_licenses;
CREATE POLICY "delete_licenses_super_admin" ON organization_licenses FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
  );

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_org_licenses_org_id ON organization_licenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_licenses_org_status ON organization_licenses(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_licenses_catalog_item ON organization_licenses(catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_package_items_pkg ON package_items(package_id);
CREATE INDEX IF NOT EXISTS idx_package_items_item ON package_items(catalog_item_id);
