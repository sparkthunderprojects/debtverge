/*
# Migrate Existing Tenant Subscriptions into Organization Licenses

## Purpose
Migrates all existing tenant_subscriptions data into organization_licenses rows,
so no existing org loses access to any app they currently have.

## Migration Logic
For each existing tenant_subscriptions row with status='active':
  1. Look up the subscription_packages row it references
  2. Look up all app_keys from subscription_package_apps for that package
  3. For each app_key, find the corresponding catalog_items row by key
  4. Insert an organization_licenses row with:
     - status = 'active' (or 'suspended' if original was suspended/cancelled/expired)
     - licence_source = 'package'
     - package_id = a mapped new packages row (debt_suite → full_debt_iva_suite, enterprise → full_debt_iva_suite with addons, etc.)
     - started_at = original started_at

## App Key Mapping
Old app keys map directly to catalog_items keys for: debtverge, draftverge, ivaverge, leadverge.
Old keys that DON'T have catalog items (agent, dashboard, mail, social, rewards, pulse, projects,
talent, pay, sign, stormverge, stormtalk, stormtasks, stormdrive, admin, knowledge-admin, word,
compliance, knowledge, qualify, stormcall, portal) are NOT migrated as licenses — those apps are
either outside the new licensing catalogue or will be handled separately.

However, to ensure NO org loses access, we map the old "debt_suite" package's apps to the new
"full_debt_iva_suite" package plus relevant add-ons. For old packages that included apps not in
the new catalogue, we grant direct licences for catalogue items that match.

For orgs that had the old "debt_suite" package (which included debtverge, draftverge, ivaverge,
leadverge), we grant:
  - All four catalogue applications
  - Plus add-ons: stormcall, stormsign, stormpay, compliance, knowledge (as direct licences)

For orgs that had "enterprise" package (which included sign, pay, admin, all stormverge/stormtalk/
stormtasks/stormdrive), we grant:
  - Add-ons: stormsign, stormpay (the ones in our catalogue)

This ensures no org loses access to anything that's now in the catalogue.
*/

-- Map old subscription_package_apps to organization_licenses
-- For each active tenant_subscription, for each app_key in the old package,
-- if a matching catalog_item exists, insert a license.

INSERT INTO organization_licenses (organization_id, catalog_item_id, status, licence_source, package_id, licence_type, started_at)
SELECT DISTINCT
  ts.organization_id,
  ci.id,
  CASE WHEN ts.status = 'active' THEN 'active' ELSE 'suspended' END,
  'package',
  -- Map to new package: if old package was debt_suite, use full_debt_iva_suite; otherwise null (direct)
  CASE
    WHEN sp.slug = 'debt_suite' THEN (SELECT id FROM packages WHERE slug = 'full_debt_iva_suite')
    ELSE NULL
  END,
  'monthly',
  ts.started_at
FROM tenant_subscriptions ts
JOIN subscription_packages sp ON sp.id = ts.package_id
JOIN subscription_package_apps spa ON spa.package_id = sp.id
JOIN catalog_items ci ON ci.key = spa.app_key
WHERE NOT EXISTS (
  SELECT 1 FROM organization_licenses ol
  WHERE ol.organization_id = ts.organization_id
  AND ol.catalog_item_id = ci.id
)
ON CONFLICT (organization_id, catalog_item_id) DO NOTHING;

-- Additionally, for orgs that had "debt_suite" (which included sign, pay, admin, etc.),
-- grant direct licences for add-on catalogue items (stormcall, stormsign, stormpay, compliance, knowledge)
-- so they don't lose access to those features.
INSERT INTO organization_licenses (organization_id, catalog_item_id, status, licence_source, licence_type, started_at)
SELECT DISTINCT
  ts.organization_id,
  ci.id,
  CASE WHEN ts.status = 'active' THEN 'active' ELSE 'suspended' END,
  'direct',
  'monthly',
  ts.started_at
FROM tenant_subscriptions ts
JOIN subscription_packages sp ON sp.id = ts.package_id
CROSS JOIN catalog_items ci
WHERE sp.slug = 'debt_suite'
  AND ci.is_addon = true
  AND ci.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM organization_licenses ol
    WHERE ol.organization_id = ts.organization_id
    AND ol.catalog_item_id = ci.id
  )
ON CONFLICT (organization_id, catalog_item_id) DO NOTHING;

-- For orgs that had "enterprise" (which included sign + pay), grant direct licences for those add-ons
INSERT INTO organization_licenses (organization_id, catalog_item_id, status, licence_source, licence_type, started_at)
SELECT DISTINCT
  ts.organization_id,
  ci.id,
  CASE WHEN ts.status = 'active' THEN 'active' ELSE 'suspended' END,
  'direct',
  'monthly',
  ts.started_at
FROM tenant_subscriptions ts
JOIN subscription_packages sp ON sp.id = ts.package_id
CROSS JOIN catalog_items ci
WHERE sp.slug = 'enterprise'
  AND ci.key IN ('stormsign', 'stormpay')
  AND NOT EXISTS (
    SELECT 1 FROM organization_licenses ol
    WHERE ol.organization_id = ts.organization_id
    AND ol.catalog_item_id = ci.id
  )
ON CONFLICT (organization_id, catalog_item_id) DO NOTHING;
