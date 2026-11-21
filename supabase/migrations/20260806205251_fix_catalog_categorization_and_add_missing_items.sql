-- ============================================================
-- 1. Recategorize stormpay: it's an internal SparkThunder tool, not a debt-suite add-on
-- ============================================================
UPDATE catalog_items
SET category = 'Internal Tools', is_addon = false, updated_at = now()
WHERE key = 'stormpay';

-- ============================================================
-- 2. Add stormsign to all three debt-suite packages
--    (stormsign is a debt-suite add-on — e-signature for IVA/DMP docs)
-- ============================================================
INSERT INTO package_items (package_id, catalog_item_id)
SELECT p.id, ci.id
FROM packages p
CROSS JOIN catalog_items ci
WHERE ci.key = 'stormsign'
  AND p.slug IN ('debt_management_suite', 'iva_suite', 'full_debt_iva_suite')
  AND NOT EXISTS (
    SELECT 1 FROM package_items pi
    WHERE pi.package_id = p.id AND pi.catalog_item_id = ci.id
  );

-- ============================================================
-- 3. Add the 13 missing catalogue items
--    These are productivity/internal apps that exist in the catalogue
--    but must NEVER be part of any debt-suite package
-- ============================================================
INSERT INTO catalog_items (key, name, product_type, category, is_addon, is_active, display_order, description)
VALUES
  ('pulse',          'Stormreef Pulse',     'application', 'Productivity',  false, true, 200, 'Web Analytics & Conversion Tracking'),
  ('rewards',        'Stormreef Rewards',   'application', 'Productivity',  false, true, 210, 'Loyalty & VIP Programs'),
  ('projects',       'Stormreef Projects',  'application', 'Productivity',  false, true, 220, 'Project Management & Sprints'),
  ('agent',          'Stormreef Agent',     'application', 'Productivity',  false, true, 230, 'Support & Commerce Operations'),
  ('social',         'Stormreef Social',    'application', 'Productivity',  false, true, 240, 'Social Media Marketing'),
  ('mail',           'Stormreef Mail',      'application', 'Productivity',  false, true, 250, 'Email & Messaging Campaigns'),
  ('stormverge',     'StormVerge Mail',     'application', 'Productivity',  false, true, 260, 'Mail, Calendar, Contacts & Tasks'),
  ('stormtalk',      'StormTalk',           'application', 'Productivity',  false, true, 270, 'Team Messaging & Meetings'),
  ('stormtasks',     'StormTasks',          'application', 'Productivity',  false, true, 280, 'Task Management & Time Tracking'),
  ('stormdrive',     'StormDrive',          'application', 'Productivity',  false, true, 290, 'Cloud Storage & File Sharing'),
  ('talent',         'Stormreef Talent',    'application', 'Productivity',  false, true, 300, 'Freelancer & Contractor Management'),
  ('portal',         'Freelancer Portal',   'application', 'Productivity',  false, true, 310, 'Vendor Portal Access')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Verify: remove any non-debt items from debt-suite packages
--    (safety check — should be a no-op if data is clean)
-- ============================================================
DELETE FROM package_items
WHERE package_id IN (
  SELECT id FROM packages WHERE slug IN ('debt_management_suite', 'iva_suite', 'full_debt_iva_suite')
)
AND catalog_item_id IN (
  SELECT id FROM catalog_items
  WHERE key NOT IN ('debtverge', 'ivaverge', 'leadverge', 'qualify', 'draftverge', 'stormcall', 'compliance', 'knowledge', 'stormsign')
);
