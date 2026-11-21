/*
# Seed default subscriptions + debt-suite roles

## Purpose
Assigns default subscription packages to existing organizations and creates
debt-suite-specific roles (DMP Agent, Drafter, IP Supervisor) with the correct
RBAC permissions for the new DEBTVERGE/DRAFTVERGE/IVAVERGE/LEADVERGE modules.

## Changes
1. Assigns "Debt Suite" package to Stormreef HQ (the insolvency-focused org)
2. Assigns "Enterprise" package to Coral Commerce and Reef Studios
3. Creates 3 preset roles under Stormreef HQ with appropriate permissions:
   - DMP Agent: LEADVERGE(view), DEBTVERGE(view+edit)
   - Drafter: LEADVERGE(view), DRAFTVERGE(view+edit), DEBTVERGE(view)
   - IP Supervisor: all 4 debt modules with manage

## Data Safety
- No existing roles or data are modified
- Only INSERTs into new tables and rbac_roles/rbac_role_permissions
*/

-- ============================================================
-- 1. Assign default subscriptions to existing orgs
-- ============================================================
INSERT INTO tenant_subscriptions (organization_id, package_id, status)
SELECT o.id, p.id, 'active'
FROM organizations o
CROSS JOIN subscription_packages p
WHERE p.slug = 'debt_suite' AND o.name = 'Stormreef HQ'
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO tenant_subscriptions (organization_id, package_id, status)
SELECT o.id, p.id, 'active'
FROM organizations o
CROSS JOIN subscription_packages p
WHERE p.slug = 'enterprise' AND o.name IN ('Coral Commerce', 'Reef Studios')
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================
-- 2. Create debt-suite roles for Stormreef HQ
-- ============================================================
-- Helper: get Stormreef HQ org id and debt module permission ids
DO $$
DECLARE
  org_id uuid;
  debt_view uuid;
  debt_edit uuid;
  draft_view uuid;
  draft_edit uuid;
  iva_view uuid;
  iva_manage uuid;
  lead_view uuid;
  lead_manage uuid;
  dmp_role_id uuid;
  drafter_role_id uuid;
  supervisor_role_id uuid;
BEGIN
  SELECT id INTO org_id FROM organizations WHERE name = 'Stormreef HQ';
  IF org_id IS NULL THEN RETURN; END IF;

  SELECT id INTO debt_view FROM rbac_permissions WHERE module = 'DEBTVERGE' AND action = 'view';
  SELECT id INTO debt_edit FROM rbac_permissions WHERE module = 'DEBTVERGE' AND action = 'edit';
  SELECT id INTO draft_view FROM rbac_permissions WHERE module = 'DRAFTVERGE' AND action = 'view';
  SELECT id INTO draft_edit FROM rbac_permissions WHERE module = 'DRAFTVERGE' AND action = 'edit';
  SELECT id INTO iva_view FROM rbac_permissions WHERE module = 'IVAVERGE' AND action = 'view';
  SELECT id INTO iva_manage FROM rbac_permissions WHERE module = 'IVAVERGE' AND action = 'manage';
  SELECT id INTO lead_view FROM rbac_permissions WHERE module = 'LEADVERGE' AND action = 'view';
  SELECT id INTO lead_manage FROM rbac_permissions WHERE module = 'LEADVERGE' AND action = 'manage';

  -- DMP Agent role
  INSERT INTO rbac_roles (organization_id, name, is_custom)
  VALUES (org_id, 'DMP Agent', false)
  ON CONFLICT DO NOTHING
  RETURNING id INTO dmp_role_id;

  IF dmp_role_id IS NULL THEN
    SELECT id INTO dmp_role_id FROM rbac_roles WHERE organization_id = org_id AND name = 'DMP Agent';
  END IF;

  IF dmp_role_id IS NOT NULL THEN
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT dmp_role_id, id FROM rbac_permissions
    WHERE module IN ('LEADVERGE','DEBTVERGE') AND action IN ('view','edit')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Drafter role
  INSERT INTO rbac_roles (organization_id, name, is_custom)
  VALUES (org_id, 'Drafter', false)
  ON CONFLICT DO NOTHING
  RETURNING id INTO drafter_role_id;

  IF drafter_role_id IS NULL THEN
    SELECT id INTO drafter_role_id FROM rbac_roles WHERE organization_id = org_id AND name = 'Drafter';
  END IF;

  IF drafter_role_id IS NOT NULL THEN
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT drafter_role_id, id FROM rbac_permissions
    WHERE (module = 'LEADVERGE' AND action = 'view')
       OR (module = 'DRAFTVERGE' AND action IN ('view','edit'))
       OR (module = 'DEBTVERGE' AND action = 'view')
    ON CONFLICT DO NOTHING;
  END IF;

  -- IP Supervisor role
  INSERT INTO rbac_roles (organization_id, name, is_custom)
  VALUES (org_id, 'IP Supervisor', false)
  ON CONFLICT DO NOTHING
  RETURNING id INTO supervisor_role_id;

  IF supervisor_role_id IS NULL THEN
    SELECT id INTO supervisor_role_id FROM rbac_roles WHERE organization_id = org_id AND name = 'IP Supervisor';
  END IF;

  IF supervisor_role_id IS NOT NULL THEN
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT supervisor_role_id, id FROM rbac_permissions
    WHERE module IN ('LEADVERGE','DEBTVERGE','DRAFTVERGE','IVAVERGE') AND action = 'manage'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
