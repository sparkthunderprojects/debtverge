/*
  Ecosystem handovers
  - ecosystem_platforms: registry of platforms in the DebtVerge ecosystem
  - case_handovers: explicit, auditable record of a case moving between platforms
  Every handover carries a snapshot payload so the receiving platform never reads
  another platform's tables directly. Scoped per organisation.
*/
CREATE TABLE IF NOT EXISTS ecosystem_platforms (
  key text PRIMARY KEY,
  name text NOT NULL,
  stage text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE ecosystem_platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_platforms" ON ecosystem_platforms FOR SELECT TO authenticated USING (true);

INSERT INTO ecosystem_platforms (key, name, stage, sort_order) VALUES
  ('leadverge','LeadVerge','Leads',1),
  ('qualifyverge','QualifyVerge','Qualifying',2),
  ('debtverge','DebtVerge','DMP',3),
  ('draftverge','DraftVerge','Drafting',4),
  ('ivaverge','IVAVerge','IVA',5)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS case_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_platform text NOT NULL REFERENCES ecosystem_platforms(key),
  target_platform text NOT NULL REFERENCES ecosystem_platforms(key),
  source_case_id uuid,
  target_case_id uuid REFERENCES debt_cases(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','completed','cancelled')),
  reason text,
  client_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  CHECK (source_platform <> target_platform)
);
CREATE INDEX IF NOT EXISTS idx_case_handovers_org_target ON case_handovers (organization_id, target_platform, status);
CREATE INDEX IF NOT EXISTS idx_case_handovers_source_case ON case_handovers (source_case_id);
ALTER TABLE case_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_org_handovers" ON case_handovers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = case_handovers.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "insert_org_handovers" ON case_handovers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = case_handovers.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "update_org_handovers" ON case_handovers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = case_handovers.organization_id AND ou.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = case_handovers.organization_id AND ou.user_id = auth.uid()));
