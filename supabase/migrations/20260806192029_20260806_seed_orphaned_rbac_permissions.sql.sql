/*
# Seed Missing RBAC Permissions for Orphaned Apps

## Purpose
The rbac_permissions table is missing view/edit/manage entries for modules that
have dashboardIdToModule mappings but no seeded permissions. This caused
non-super_admin users to never see Compliance, Knowledge, Qualify, StormCall,
StormVerge, StormTalk, StormTasks, StormDrive, or StormWord tiles even when
their org had a licence.

## Changes
1. Widens the rbac_permissions.module CHECK constraint to include all new modules
2. Seeds view/edit/manage permissions for: COMPLIANCE, KNOWLEDGE, QUALIFY,
   STORMCALL, STORMVERGE, STORMTALK, STORMTASKS, STORMDRIVE, STORMWORD

## Data Safety
- Only INSERTs, never DELETEs or ALTERs existing rows
- Constraint is widened, never narrowed
*/

-- ============================================================
-- 1. Widen the rbac_permissions module CHECK constraint
-- ============================================================
ALTER TABLE rbac_permissions DROP CONSTRAINT IF EXISTS rbac_permissions_module_check;

ALTER TABLE rbac_permissions ADD CONSTRAINT rbac_permissions_module_check
  CHECK (module IN (
    'VAULT', 'PROJECTS', 'SIGN', 'AGENT', 'SOCIAL', 'MAIL', 'PAY',
    'PULSE', 'REWARDS', 'TALENT',
    'DEBTVERGE', 'DRAFTVERGE', 'IVAVERGE', 'LEADVERGE',
    'STORMCALL', 'COMPLIANCE', 'KNOWLEDGE', 'QUALIFY',
    'STORMVERGE', 'STORMTALK', 'STORMTASKS', 'STORMDRIVE', 'STORMWORD'
  ));

-- ============================================================
-- 2. Seed permissions for previously orphaned modules
-- ============================================================
INSERT INTO rbac_permissions (module, action)
SELECT m.module, a.action
FROM (VALUES
  ('COMPLIANCE'), ('KNOWLEDGE'), ('QUALIFY'), ('STORMCALL'),
  ('STORMVERGE'), ('STORMTALK'), ('STORMTASKS'), ('STORMDRIVE'), ('STORMWORD')
) AS m(module)
CROSS JOIN (VALUES ('view'), ('edit'), ('manage')) AS a(action)
WHERE NOT EXISTS (
  SELECT 1 FROM rbac_permissions p
  WHERE p.module = m.module AND p.action = a.action
)
ON CONFLICT DO NOTHING;
