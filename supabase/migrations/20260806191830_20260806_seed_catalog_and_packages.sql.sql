/*
# Seed Catalogue Items and Packages

## Purpose
Populates the catalog_items and packages tables created in the previous migration.

## Catalogue Items Seeded

### Applications (is_addon = false)
1. debtverge — Debt Verge — DMP / Informal Debt Management
2. ivaverge — IVA Verge — Formal Insolvency & Supervision
3. leadverge — Lead Verge — Inbound Lead Gen & Speed-to-Lead
4. qualify — Qualify — Financial Assessment & Client Qualification
5. draftverge — Draft Verge — IVA Drafting, MOC & Creditor Voting

### Add-ons (is_addon = true)
6. stormcall — Storm Call — Adviser Contact Centre & VoIP (fully optional)
7. stormsign — Storm Sign — E-Signature & Audit
8. stormpay — Storm Pay — Invoicing & Payouts
9. compliance — Compliance Portal — Call Compliance, QA & Audit
10. knowledge — Knowledge Platform — Finance & Debt Knowledge Base

StormMail/StormTalk/StormTasks/StormDrive are intentionally NOT in the catalogue.

## Packages Seeded
1. debt_management_suite — "Debt Management Suite" — leadverge, qualify, debtverge
2. iva_suite — "IVA Suite" — leadverge, qualify, ivaverge
3. full_debt_iva_suite — "Full Debt & IVA Suite" — leadverge, qualify, debtverge, draftverge, ivaverge

Add-ons are never bundled in packages by default.
*/

-- ============================================================
-- Seed catalog_items (idempotent via ON CONFLICT on key)
-- ============================================================
INSERT INTO catalog_items (key, name, product_type, category, icon, description, is_addon, is_active, display_order)
VALUES
  -- Applications
  ('debtverge',  'Debt Verge',      'application', 'Debt Solutions', 'Scale',         'DMP — Informal Debt Management', false, true, 10),
  ('ivaverge',   'IVA Verge',       'application', 'Debt Solutions', 'Gavel',         'IVA — Formal Insolvency & Supervision', false, true, 20),
  ('leadverge',  'Lead Verge',      'application', 'Debt Solutions', 'Zap',           'Inbound Lead Gen & Speed-to-Lead', false, true, 30),
  ('qualify',    'Qualify',         'application', 'Debt Solutions', 'ClipboardCheck','Financial Assessment & Client Qualification', false, true, 40),
  ('draftverge', 'Draft Verge',     'application', 'Debt Solutions', 'PenSquare',     'IVA Drafting, MOC & Creditor Voting', false, true, 50),
  -- Add-ons
  ('stormcall',  'Storm Call',      'service',     'Add-ons', 'Headphones',    'Adviser Contact Centre & VoIP', true, true, 100),
  ('stormsign',  'Storm Sign',      'service',     'Add-ons', 'FileSignature', 'E-Signature & Audit', true, true, 110),
  ('stormpay',   'Storm Pay',       'service',     'Add-ons', 'Receipt',       'Invoicing & Payouts', true, true, 120),
  ('compliance', 'Compliance Portal','service',    'Add-ons', 'ShieldCheck',   'Call Compliance, QA & Audit', true, true, 130),
  ('knowledge',  'Knowledge Platform','service',   'Add-ons', 'GraduationCap', 'Finance & Debt Knowledge Base', true, true, 140)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  product_type = EXCLUDED.product_type,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  description = EXCLUDED.description,
  is_addon = EXCLUDED.is_addon,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = now();

-- ============================================================
-- Seed packages (idempotent via ON CONFLICT on slug)
-- ============================================================
INSERT INTO packages (name, slug, description, monthly_price_pence)
VALUES
  ('Debt Management Suite', 'debt_management_suite',
   'Lead gen, client qualification, and informal debt management.',
   29900),
  ('IVA Suite', 'iva_suite',
   'Lead gen, client qualification, and formal IVA insolvency.',
   39900),
  ('Full Debt & IVA Suite', 'full_debt_iva_suite',
   'Complete debt solutions: lead gen, qualification, DVP, IVA drafting, and IVA supervision.',
   59900)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_price_pence = EXCLUDED.monthly_price_pence,
  updated_at = now();

-- ============================================================
-- Seed package_items (idempotent via ON CONFLICT on composite PK)
-- ============================================================
INSERT INTO package_items (package_id, catalog_item_id)
SELECT p.id, ci.id
FROM packages p
CROSS JOIN catalog_items ci
WHERE
  (p.slug = 'debt_management_suite' AND ci.key IN ('leadverge', 'qualify', 'debtverge'))
  OR (p.slug = 'iva_suite' AND ci.key IN ('leadverge', 'qualify', 'ivaverge'))
  OR (p.slug = 'full_debt_iva_suite' AND ci.key IN ('leadverge', 'qualify', 'debtverge', 'draftverge', 'ivaverge'))
ON CONFLICT (package_id, catalog_item_id) DO NOTHING;
