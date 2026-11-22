/*
  Case diary and tasks.
  - case_tasks: one row per to-do/diary entry on a case (manual or auto-created)
  - Auto tasks are created when a case enters a status (idempotent via auto_key)
  - Access follows the existing case rules: anyone in the org can read, assigned adviser/creator/managers can write
*/
CREATE TABLE IF NOT EXISTS case_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  organization_id uuid,
  title text NOT NULL,
  notes text,
  kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','call','statutory','review','note')),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  assigned_to uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  auto_key text,
  created_by uuid DEFAULT auth.uid(),
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_tasks_auto ON case_tasks (case_id, auto_key) WHERE auto_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_tasks_case ON case_tasks (case_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_case_tasks_assignee ON case_tasks (assigned_to, status, due_date);
ALTER TABLE case_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dv_org_select_case_tasks" ON case_tasks FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY "dv_org_write_case_tasks" ON case_tasks FOR ALL TO authenticated
  USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id));

CREATE OR REPLACE FUNCTION dv_ensure_case_tasks(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases%ROWTYPE;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF NOT FOUND THEN RETURN; END IF;
  IF c.status = 'intake' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key, created_by)
    VALUES
      (c.id, c.organization_id, 'Complete customer profile and verify ID', 'task', current_date + 2, c.assigned_to, 'auto', 'intake:profile', NULL),
      (c.id, c.organization_id, 'Collect income and expenditure (budget)', 'task', current_date + 3, c.assigned_to, 'auto', 'intake:budget', NULL),
      (c.id, c.organization_id, 'Vulnerability and care needs check', 'statutory', current_date + 2, c.assigned_to, 'auto', 'intake:vuln', NULL)
    ON CONFLICT DO NOTHING;
  ELSIF c.status = 'sfs_pending' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key, created_by)
    VALUES (c.id, c.organization_id, 'Review and sign off the budget (SFS)', 'task', current_date + 2, c.assigned_to, 'auto', 'sfs_pending:signoff', NULL)
    ON CONFLICT DO NOTHING;
  ELSIF c.status = 'sfs_approved' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key, created_by)
    VALUES (c.id, c.organization_id, 'Send creditor offer packs', 'task', current_date + 2, c.assigned_to, 'auto', 'sfs_approved:packs', NULL)
    ON CONFLICT DO NOTHING;
  ELSIF c.status = 'creditor_pack_sent' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key, created_by)
    VALUES (c.id, c.organization_id, 'Chase creditor responses', 'task', current_date + 14, c.assigned_to, 'auto', 'pack_sent:chase', NULL)
    ON CONFLICT DO NOTHING;
  ELSIF c.status = 'payment_schedule_active' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key, created_by)
    VALUES
      (c.id, c.organization_id, 'Confirm first payment received', 'task', current_date + 7, c.assigned_to, 'auto', 'active:first_payment', NULL),
      (c.id, c.organization_id, 'Annual review of budget and plan', 'review', current_date + 365, c.assigned_to, 'auto', 'active:annual_review', NULL)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION dv_case_status_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM dv_ensure_case_tasks(NEW.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_case_status_tasks AFTER INSERT OR UPDATE OF status ON debt_cases
  FOR EACH ROW EXECUTE FUNCTION dv_case_status_tasks();

-- keep open tasks with the case owner when a case is reassigned
CREATE OR REPLACE FUNCTION dv_case_owner_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    UPDATE case_tasks SET assigned_to = NEW.assigned_to WHERE case_id = NEW.id AND status = 'open' AND assigned_to IS NOT DISTINCT FROM OLD.assigned_to;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_case_owner_tasks AFTER UPDATE OF assigned_to ON debt_cases
  FOR EACH ROW EXECUTE FUNCTION dv_case_owner_tasks();

-- backfill existing cases
SELECT dv_ensure_case_tasks(id) FROM debt_cases WHERE status NOT IN ('completed','closed');
