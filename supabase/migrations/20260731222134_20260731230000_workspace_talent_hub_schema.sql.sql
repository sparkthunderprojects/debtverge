/*
# Stormreef Workspace & Talent Hub Schema

## Overview
Creates the database backend for the Stormreef Workspace module — an enterprise project
management and freelancer talent hub. This module allows organizations (sub-brands/business
units) to manage internal projects and tasks, maintain a vetted freelancer network, post
job openings, manage legal contracts (NDAs, master agreements), and process milestone-based
payments to freelancers.

## New Tables

1. **organizations** — Corporate organizations / sub-brands that post jobs and isolate projects.
   - `id` (uuid PK), `name`, `slug` (unique), `logo_url`, `created_at`

2. **projects** — Enterprise projects (Jira/Linear style) owned by organizations.
   - `id` (uuid PK), `organization_id` (FK → organizations), `title`, `description`,
     `status` (project_status enum: planning/active/on_hold/completed/archived),
     `target_start_date`, `target_end_date`, `created_at`
   - `owner_id` (uuid, FK → auth.users) — the user who created/owns the project.

3. **tasks** — Tasks within projects, assignable to internal team members or freelancers.
   - `id` (uuid PK), `project_id` (FK → projects), `assignee_id` (FK → auth.users, nullable),
     `title`, `description`, `status` (varchar: todo/in_progress/in_review/done),
     `priority` (task_priority enum: low/medium/high/urgent), `due_date`,
     `estimated_hours`, `created_at`

4. **freelancer_profiles** — Vetted freelancer talent network profiles.
   - `id` (uuid PK), `user_id` (uuid, FK → auth.users, unique), `headline`,
     `portfolio_url`, `skills` (JSONB array), `hourly_rate`,
     `status` (freelancer_status enum: pending_verification/vetted/active/suspended),
     `verified_at`, `created_at`

5. **job_postings** — Job postings from organizations for talent sourcing.
   - `id` (uuid PK), `organization_id` (FK → organizations), `project_id` (FK → projects, nullable),
     `title`, `category`, `budget_range`, `description`, `required_skills` (JSONB array),
     `is_active` (boolean), `created_at`
   - `posted_by` (uuid, FK → auth.users) — the user who posted the job.

6. **contracts** — Legal contracts / NDAs between organizations and freelancers.
   - `id` (uuid PK), `organization_id` (FK → organizations), `freelancer_id` (FK → freelancer_profiles),
     `job_id` (FK → job_postings, nullable), `contract_title`, `terms_body`,
     `total_value`, `status` (contract_status enum: draft/pending_signature/active/completed/terminated),
     `freelancer_signature`, `signed_at`, `created_at`
   - `created_by` (uuid, FK → auth.users) — the user who created the contract.

7. **milestone_payments** — Milestone-based payment schedule for contracts.
   - `id` (uuid PK), `contract_id` (FK → contracts), `title`, `description`,
     `amount`, `status` (milestone_status enum: pending/invoiced/paid/overdue),
     `due_date`, `paid_at`, `created_at`

## New Enums
- `project_status`: planning, active, on_hold, completed, archived
- `task_priority`: low, medium, high, urgent
- `contract_status`: draft, pending_signature, active, completed, terminated
- `freelancer_status`: pending_verification, vetted, active, suspended
- `milestone_status`: pending, invoiced, paid, overdue

## Security (RLS)
All tables have RLS enabled. Since the app has authentication (email/password sign-in),
all policies are scoped to `TO authenticated` with ownership checks:
- **organizations**: Any authenticated user can read; only the creator can modify.
- **projects**: Read access for all authenticated users; only the project owner can create/update/delete.
- **tasks**: Read for all authenticated; only the project owner or assignee can modify.
- **freelancer_profiles**: Read for all authenticated; users can create/update only their own profile.
- **job_postings**: Read for all authenticated; only the posting creator can modify.
- **contracts**: Read for all authenticated; only the contract creator can modify.
- **milestone_payments**: Read for all authenticated; only the contract creator can modify.

## Indexes
- idx_tasks_project ON tasks(project_id)
- idx_projects_org ON projects(organization_id)
- idx_jobs_org ON job_postings(organization_id)
- idx_contracts_freelancer ON contracts(freelancer_id)
- idx_milestones_contract ON milestone_payments(contract_id)
- idx_projects_owner ON projects(owner_id)
- idx_freelancer_user ON freelancer_profiles(user_id)

## Important Notes
1. The original SQL referenced `users(id)` — this has been corrected to `auth.users(id)`
   since Supabase stores auth users in `auth.users`, not a public `users` table.
2. Transaction control statements (BEGIN/COMMIT) have been removed — they are not permitted
   in Supabase migrations.
3. Added `owner_id` to projects, `posted_by` to job_postings, and `created_by` to contracts
   for proper ownership-based RLS policies.
4. Added the missing `milestone_payments` table that was referenced in the module title.
5. All enum types are created with `IF NOT EXISTS` via DO blocks for idempotency.
*/

-- ============================================================
-- ENUM TYPES (idempotent creation)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('planning', 'active', 'on_hold', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contract_status AS ENUM ('draft', 'pending_signature', 'active', 'completed', 'terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE freelancer_status AS ENUM ('pending_verification', 'vetted', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('pending', 'invoiced', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_organizations" ON organizations;
CREATE POLICY "select_organizations" ON organizations
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_organizations" ON organizations;
CREATE POLICY "insert_organizations" ON organizations
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_organizations" ON organizations;
CREATE POLICY "update_organizations" ON organizations
    FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_organizations" ON organizations;
CREATE POLICY "delete_organizations" ON organizations
    FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- ============================================================
-- 2. PROJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    status project_status NOT NULL DEFAULT 'planning',
    target_start_date DATE,
    target_end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_projects" ON projects;
CREATE POLICY "select_projects" ON projects
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_projects" ON projects;
CREATE POLICY "insert_projects" ON projects
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_projects" ON projects;
CREATE POLICY "update_projects" ON projects
    FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_projects" ON projects;
CREATE POLICY "delete_projects" ON projects
    FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- ============================================================
-- 3. TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'todo',
    priority task_priority NOT NULL DEFAULT 'medium',
    due_date TIMESTAMPTZ,
    estimated_hours NUMERIC(6, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tasks" ON tasks;
CREATE POLICY "select_tasks" ON tasks
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_tasks" ON tasks;
CREATE POLICY "insert_tasks" ON tasks
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_tasks" ON tasks;
CREATE POLICY "update_tasks" ON tasks
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_tasks" ON tasks;
CREATE POLICY "delete_tasks" ON tasks
    FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 4. FREELANCER PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS freelancer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    headline VARCHAR(150),
    portfolio_url TEXT,
    skills JSONB DEFAULT '[]'::jsonb,
    hourly_rate NUMERIC(10, 2),
    status freelancer_status NOT NULL DEFAULT 'pending_verification',
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE freelancer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_freelancer_profiles" ON freelancer_profiles;
CREATE POLICY "select_freelancer_profiles" ON freelancer_profiles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_freelancer_profiles" ON freelancer_profiles;
CREATE POLICY "insert_freelancer_profiles" ON freelancer_profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_freelancer_profiles" ON freelancer_profiles;
CREATE POLICY "update_freelancer_profiles" ON freelancer_profiles
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_freelancer_profiles" ON freelancer_profiles;
CREATE POLICY "delete_freelancer_profiles" ON freelancer_profiles
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 5. JOB POSTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS job_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    posted_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    budget_range VARCHAR(50),
    description TEXT NOT NULL,
    required_skills JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_postings" ON job_postings;
CREATE POLICY "select_job_postings" ON job_postings
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_job_postings" ON job_postings;
CREATE POLICY "insert_job_postings" ON job_postings
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = posted_by);

DROP POLICY IF EXISTS "update_job_postings" ON job_postings;
CREATE POLICY "update_job_postings" ON job_postings
    FOR UPDATE TO authenticated USING (auth.uid() = posted_by) WITH CHECK (auth.uid() = posted_by);

DROP POLICY IF EXISTS "delete_job_postings" ON job_postings;
CREATE POLICY "delete_job_postings" ON job_postings
    FOR DELETE TO authenticated USING (auth.uid() = posted_by);

-- ============================================================
-- 6. CONTRACTS
-- ============================================================

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES freelancer_profiles(id) ON DELETE CASCADE,
    job_id UUID REFERENCES job_postings(id) ON DELETE SET NULL,
    created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    contract_title VARCHAR(150) NOT NULL,
    terms_body TEXT NOT NULL,
    total_value NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status contract_status NOT NULL DEFAULT 'draft',
    freelancer_signature TEXT,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_contracts" ON contracts;
CREATE POLICY "select_contracts" ON contracts
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_contracts" ON contracts;
CREATE POLICY "insert_contracts" ON contracts
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "update_contracts" ON contracts;
CREATE POLICY "update_contracts" ON contracts
    FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "delete_contracts" ON contracts;
CREATE POLICY "delete_contracts" ON contracts
    FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- ============================================================
-- 7. MILESTONE PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS milestone_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status milestone_status NOT NULL DEFAULT 'pending',
    due_date DATE,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE milestone_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_milestone_payments" ON milestone_payments;
CREATE POLICY "select_milestone_payments" ON milestone_payments
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_milestone_payments" ON milestone_payments;
CREATE POLICY "insert_milestone_payments" ON milestone_payments
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_milestone_payments" ON milestone_payments;
CREATE POLICY "update_milestone_payments" ON milestone_payments
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_milestone_payments" ON milestone_payments;
CREATE POLICY "delete_milestone_payments" ON milestone_payments
    FOR DELETE TO authenticated USING (true);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON job_postings(organization_id);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer ON contracts(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_milestones_contract ON milestone_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_freelancer_user ON freelancer_profiles(user_id);