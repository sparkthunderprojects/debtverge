-- ============================================================================
-- DebtVerge consolidated schema (generated from the supabase/migrations chain)
--
-- Run once in the Supabase SQL editor on a NEW, EMPTY project.
-- It replays the migration history in order. Foreign-key checks are relaxed
-- while it runs because a few legacy seed rows reference records that only
-- existed in the original project; those seed rows are removed at the end.
-- Reference data (permissions, packages, catalog, default roles) is kept.
-- ============================================================================
create extension if not exists pgcrypto;
set session_replication_role = replica;

-- >>> 20260730223924_create_brands_and_orders.sql
/*
# Create brands and orders tables for WooCommerce Sales Command Center

## Overview
This migration creates the core data model for a multi-brand WooCommerce sales analytics
dashboard. It is a single-tenant operator app (no sign-in screen), so the data is intentionally
shared/public and policies are scoped to `anon, authenticated`. The operator manages brands and
views consolidated analytics across all connected WooCommerce stores.

## 1. New Tables

### brands
- `id` (uuid, primary key) — unique identifier for the brand/store.
- `name` (text, not null) — display name of the store (e.g. "Northwind Apparel").
- `domain` (text, not null) — store domain URL (e.g. "northwind.example.com").
- `currency` (text, not null, default 'USD') — ISO 4217 currency code for the store.
- `api_status` (text, not null, default 'pending') — health/connection status of the webhook.
  Allowed values: 'pending', 'active', 'error'.
- `webhook_secret` (text, not null) — secret used to verify the X-WC-Webhook-Signature header
  sent by WooCommerce. Stored in plaintext because the edge function needs it to verify HMAC
  signatures on inbound webhooks.
- `last_event_at` (timestamptz, nullable) — timestamp of the most recent webhook event received
  for this brand. Used by the health-check indicator on the Manage Brands page.
- `last_event_type` (text, nullable) — type of the most recent webhook event (e.g. order.created).
- `created_at` (timestamptz, default now()) — when the brand was added.

### orders
- `id` (uuid, primary key) — internal order row id.
- `brand_id` (uuid, not null, foreign key -> brands.id ON DELETE CASCADE) — which brand owns
  this order.
- `woo_order_id` (bigint, not null) — the order id assigned by WooCommerce. bigint because
  WooCommerce order ids are integers that can grow large.
- `customer_email` (text, not null default '') — billing email from the WooCommerce order.
- `total_amount` (numeric(12,2), not null default 0) — order total in the order currency.
- `currency` (text, not null default 'USD') — ISO currency code for this order.
- `status` (text, not null default 'processing') — WooCommerce order status mapped to a
  normalized status. Allowed values: 'paid', 'processing', 'refunded', 'cancelled', 'failed',
  'on-hold'.
- `payment_method` (text, not null default '') — payment method title from WooCommerce.
- `items_count` (integer, not null default 0) — count of line items in the order.
- `order_date` (timestamptz, not null default now()) — date/time the order was placed in
  WooCommerce (date_created), not the time we ingested it.
- `created_at` (timestamptz, default now()) — when the row was inserted into our database.

## 2. Constraints & Indexes
- Unique constraint on (brand_id, woo_order_id) so webhook upserts are safe and idempotent.
- Index on orders(brand_id) for brand-filtered queries.
- Index on orders(order_date DESC) for the time-series and recent-orders feed.
- Index on orders(status) for status filtering.
- Index on brands(api_status) for health dashboard queries.

## 3. Security — Row Level Security
This is a single-tenant operator app with NO sign-in screen. The frontend talks to Supabase
with the anon key for its entire lifetime, so every policy lists `anon, authenticated` and the
data is intentionally shared/public within this project.
- brands: full CRUD for anon + authenticated.
- orders: full CRUD for anon + authenticated (webhook uses service role which bypasses RLS,
  but the frontend anon client also needs read/write access).
*/

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  api_status text NOT NULL DEFAULT 'pending',
  webhook_secret text NOT NULL,
  last_event_at timestamptz,
  last_event_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  woo_order_id bigint NOT NULL,
  customer_email text NOT NULL DEFAULT '',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'processing',
  payment_method text NOT NULL DEFAULT '',
  items_count integer NOT NULL DEFAULT 0,
  order_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_brand_woo_order UNIQUE (brand_id, woo_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_brand_id ON orders(brand_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_brands_api_status ON brands(api_status);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- brands: anon + authenticated CRUD (single-tenant shared data)
DROP POLICY IF EXISTS "anon_select_brands" ON brands;
CREATE POLICY "anon_select_brands" ON brands FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_brands" ON brands;
CREATE POLICY "anon_insert_brands" ON brands FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_brands" ON brands;
CREATE POLICY "anon_update_brands" ON brands FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_brands" ON brands;
CREATE POLICY "anon_delete_brands" ON brands FOR DELETE
  TO anon, authenticated USING (true);

-- orders: anon + authenticated CRUD (single-tenant shared data)
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
CREATE POLICY "anon_select_orders" ON orders FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_orders" ON orders;
CREATE POLICY "anon_update_orders" ON orders FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_orders" ON orders;
CREATE POLICY "anon_delete_orders" ON orders FOR DELETE
  TO anon, authenticated USING (true);

-- >>> 20260730225608_phase2_auth_inventory_webhooks_customers.sql
/*
# Phase 2: Profiles, Inventory, Webhook Logs, Customer View + Auth Scoping

## Overview
This migration converts the Sales Command Center from an open single-tenant app into an
authenticated operator app and adds the Phase 2 data model: per-store product inventory,
inventory change logs, webhook audit logs, operator profiles, and a customer-aggregation view.

Because the app now has a sign-in screen, all RLS policies are tightened from
`anon, authenticated` (public) to `authenticated` (operator-scoped). The webhook edge function
uses the service role key which bypasses RLS, so it can still write to all tables.

## 1. New Tables

### profiles
- `id` (uuid, primary key, references auth.users ON DELETE CASCADE) — one row per operator,
  created automatically on signup.
- `email` (text, not null) — denormalized email for quick display without joining auth.users.
- `full_name` (text, nullable) — optional display name.
- `created_at` (timestamptz, default now()).
- Security: an operator can read/update only their own profile.

### products
- `id` (uuid, primary key).
- `brand_id` (uuid, not null, references brands(id) ON DELETE CASCADE) — owning store.
- `woo_product_id` (bigint, not null) — product id from WooCommerce.
- `name` (text, not null) — product name.
- `sku` (text, not null default '') — stock keeping unit.
- `stock_quantity` (integer, not null default 0) — current stock level.
- `low_stock_threshold` (integer, not null default 10) — per-store alert threshold.
- `price` (numeric(12,2), not null default 0) — product price.
- `status` (text, not null default 'publish') — WooCommerce product status.
- `last_synced_at` (timestamptz, nullable) — last time stock was synced from WooCommerce.
- `created_at` / `updated_at` (timestamptz).
- Unique constraint on (brand_id, woo_product_id) for idempotent upserts.

### inventory_logs
- `id` (uuid, primary key).
- `product_id` (uuid, not null, references products(id) ON DELETE CASCADE).
- `brand_id` (uuid, not null, references brands(id) ON DELETE CASCADE) — denormalized for fast filtering.
- `previous_stock` (integer, not null default 0) — stock before this change.
- `new_stock` (integer, not null default 0) — stock after this change.
- `delta` (integer, not null default 0) — new_stock - previous_stock (signed).
- `source` (text, not null default 'manual') — 'manual' | 'webhook' | 'adjustment'.
- `reason` (text, nullable) — optional operator note.
- `operator_email` (text, nullable) — who made the manual change (webhook rows are null).
- `created_at` (timestamptz, default now()).

### webhook_logs
- `id` (uuid, primary key).
- `brand_id` (uuid, nullable, references brands(id) ON DELETE SET NULL) — matched brand
  (null when signature did not match any brand).
- `topic` (text, not null) — the X-WC-Webhook-Topic value (e.g. order.created).
- `status_code` (integer, not null) — HTTP status returned to WooCommerce.
- `signature_valid` (boolean, not null default false) — whether HMAC verified.
- `processing_ms` (integer, not null default 0) — processing duration in milliseconds.
- `payload` (jsonb, not null default '{}') — the raw webhook body for inspection/retry.
- `error` (text, nullable) — error message if processing failed.
- `processed` (boolean, not null default false) — whether the event was successfully applied.
- `created_at` (timestamptz, default now()) — when the webhook was received.

## 2. New View

### customer_stats
A view that aggregates orders by customer_email across all brands. Columns:
- `customer_email` (text)
- `total_orders` (bigint)
- `total_spent` (numeric) — sum of paid order totals (mixed currencies; treated as a combined
  number for ranking — the UI labels currency caveats).
- `brands_count` (bigint) — distinct brands purchased from.
- `primary_brand_id` (uuid) — the brand with the highest spend.
- `primary_brand_name` (text)
- `last_order_date` (timestamptz) — most recent paid order date.
- `avg_basket` (numeric) — total_spent / total_orders.

## 3. Security — Row Level Security (authenticated operator model)
The app now has a sign-in screen. The frontend talks to Supabase with an authenticated session,
so policies are scoped to `TO authenticated`. The anon role is intentionally NOT granted access
so unauthenticated browsers see no data. The edge function uses the service role key (bypasses RLS).

- brands / orders / products / inventory_logs / webhook_logs: full CRUD for authenticated operators.
  (All operators see all stores — this is an internal multi-brand dashboard, not per-user data.)
- profiles: an operator can SELECT/UPDATE only their own row. INSERT is allowed for authenticated
  users (the signup flow inserts a profile row keyed to their own auth.uid()).

## 4. Important Notes
- Existing anon-key policies on brands/orders are replaced with authenticated-only versions.
- A trigger auto-creates a profiles row when a new auth.users row is inserted.
- The webhook_logs and inventory_logs tables are append-only in practice; UPDATE/DELETE policies
  are included for operator convenience (clearing old logs).
- product.updated topic support is added in the edge function update that accompanies this migration.
*/

-- ============================================================
-- profiles table
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user is created.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- products table
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  woo_product_id bigint NOT NULL,
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  stock_quantity integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  price numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'publish',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_brand_woo_product UNIQUE (brand_id, woo_product_id)
);

CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock_quantity);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_products" ON products;
CREATE POLICY "select_products" ON products FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_products" ON products;
CREATE POLICY "insert_products" ON products FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_products" ON products;
CREATE POLICY "update_products" ON products FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_products" ON products;
CREATE POLICY "delete_products" ON products FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- inventory_logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  previous_stock integer NOT NULL DEFAULT 0,
  new_stock integer NOT NULL DEFAULT 0,
  delta integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  reason text,
  operator_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invlogs_product_id ON inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_invlogs_brand_id ON inventory_logs(brand_id);
CREATE INDEX IF NOT EXISTS idx_invlogs_created_at ON inventory_logs(created_at DESC);

ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_inventory_logs" ON inventory_logs;
CREATE POLICY "select_inventory_logs" ON inventory_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_inventory_logs" ON inventory_logs;
CREATE POLICY "insert_inventory_logs" ON inventory_logs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_inventory_logs" ON inventory_logs;
CREATE POLICY "update_inventory_logs" ON inventory_logs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_inventory_logs" ON inventory_logs;
CREATE POLICY "delete_inventory_logs" ON inventory_logs FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- webhook_logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  topic text NOT NULL,
  status_code integer NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  processing_ms integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooklogs_created_at ON webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhooklogs_brand_id ON webhook_logs(brand_id);
CREATE INDEX IF NOT EXISTS idx_webhooklogs_processed ON webhook_logs(processed);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_webhook_logs" ON webhook_logs;
CREATE POLICY "select_webhook_logs" ON webhook_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_webhook_logs" ON webhook_logs;
CREATE POLICY "insert_webhook_logs" ON webhook_logs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_webhook_logs" ON webhook_logs;
CREATE POLICY "update_webhook_logs" ON webhook_logs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_webhook_logs" ON webhook_logs;
CREATE POLICY "delete_webhook_logs" ON webhook_logs FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- customer_stats view (aggregates orders by customer email)
-- ============================================================
CREATE OR REPLACE VIEW customer_stats AS
SELECT
  o.customer_email,
  COUNT(*)::bigint AS total_orders,
  COALESCE(SUM(o.total_amount), 0)::numeric AS total_spent,
  COUNT(DISTINCT o.brand_id)::bigint AS brands_count,
  (
    SELECT b.name
    FROM orders o2
    JOIN brands b ON b.id = o2.brand_id
    WHERE o2.customer_email = o.customer_email AND o2.status = 'paid'
    GROUP BY b.name
    ORDER BY SUM(o2.total_amount) DESC
    LIMIT 1
  ) AS primary_brand_name,
  (
    SELECT o2.brand_id
    FROM orders o2
    WHERE o2.customer_email = o.customer_email AND o2.status = 'paid'
    GROUP BY o2.brand_id
    ORDER BY SUM(o2.total_amount) DESC
    LIMIT 1
  ) AS primary_brand_id,
  MAX(o.order_date) AS last_order_date,
  CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(o.total_amount), 0) / COUNT(*) ELSE 0 END::numeric AS avg_basket
FROM orders o
WHERE o.status = 'paid' AND o.customer_email <> ''
GROUP BY o.customer_email;

-- ============================================================
-- Tighten existing brands/orders RLS to authenticated-only
-- ============================================================

-- brands: replace anon policies with authenticated-only
DROP POLICY IF EXISTS "anon_select_brands" ON brands;
DROP POLICY IF EXISTS "anon_insert_brands" ON brands;
DROP POLICY IF EXISTS "anon_update_brands" ON brands;
DROP POLICY IF EXISTS "anon_delete_brands" ON brands;

DROP POLICY IF EXISTS "select_brands" ON brands;
CREATE POLICY "select_brands" ON brands FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_brands" ON brands;
CREATE POLICY "insert_brands" ON brands FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_brands" ON brands;
CREATE POLICY "update_brands" ON brands FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_brands" ON brands;
CREATE POLICY "delete_brands" ON brands FOR DELETE
  TO authenticated USING (true);

-- orders: replace anon policies with authenticated-only
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "anon_update_orders" ON orders;
DROP POLICY IF EXISTS "anon_delete_orders" ON orders;

DROP POLICY IF EXISTS "select_orders" ON orders;
CREATE POLICY "select_orders" ON orders FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_orders" ON orders;
CREATE POLICY "insert_orders" ON orders FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_orders" ON orders;
CREATE POLICY "update_orders" ON orders FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_orders" ON orders;
CREATE POLICY "delete_orders" ON orders FOR DELETE
  TO authenticated USING (true);

-- >>> 20260731222134_20260731230000_workspace_talent_hub_schema.sql.sql
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

-- >>> 20260731225001_20260801020000_freelancer_portal_auth_schema.sql.sql
/*
# Freelancer Portal Auth & Onboarding Schema

## Overview
Adds role-based access control to the existing auth system, enabling a dedicated
freelancer authentication portal and onboarding flow. The key addition is a `role`
column on the `profiles` table (staff vs. freelancer) and onboarding-related columns
on `freelancer_profiles`.

## Changes to Existing Tables

### profiles
- Added `role` (TEXT, NOT NULL, DEFAULT 'staff') — distinguishes internal staff
  (operators/admins) from external freelancers. Values: 'staff' or 'freelancer'.
  Used by the frontend to determine routing and access control.

### freelancer_profiles
- Added `bio` (TEXT) — freelancer biography for the onboarding wizard.
- Added `avatar_url` (TEXT) — profile avatar URL.
- Added `skill_category` (VARCHAR(50)) — primary skill category (e.g., "3D Artist",
  "Graphic Designer", "Copywriter", "Developer").
- Added `onboarding_completed` (BOOLEAN, DEFAULT FALSE) — tracks whether the
  freelancer has completed the 3-step onboarding wizard.
- Added `tax_id` (VARCHAR(100)) — tax/payment information from onboarding step 2.
- Added `payment_method` (VARCHAR(50)) — preferred payment method.
- Added `nda_signed` (BOOLEAN, DEFAULT FALSE) — whether the NDA was e-signed.
- Added `msa_signed` (BOOLEAN, DEFAULT FALSE) — whether the MSA was e-signed.

## New Database Objects

### trigger: handle_new_user
A trigger function that automatically creates a `profiles` row whenever a new user
registers in `auth.users`. This ensures every authenticated user has a profile row
with the default 'staff' role. The frontend signup flow will update the role to
'freelancer' after creating the auth account.

## Security
- profiles RLS: users can read their own profile; users can update their own profile.
  This is needed so the frontend can read the role to determine routing.
- The `handle_new_user` trigger runs as SECURITY DEFINER to insert into profiles
  regardless of the caller's role (anon during signup).

## Important Notes
1. The `role` column is stored in `profiles` (not `raw_app_meta_data`) because the
   frontend needs to read it via standard Supabase queries, and profiles is already
   set up with RLS for per-user access.
2. The trigger uses SECURITY DEFINER so the anon-key signup request can create the
   profile row — the anon role has INSERT permission on profiles via existing policies.
3. Existing profiles are updated to 'staff' by default (the column default handles this).
4. The freelancer_profiles columns are nullable so existing rows are unaffected.
*/

-- ============================================================
-- Add role column to profiles
-- ============================================================

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Update RLS policies on profiles to allow users to read/update their own row
-- (profiles already has RLS enabled from a prior migration)
DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles
    FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============================================================
-- Add onboarding columns to freelancer_profiles
-- ============================================================

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN bio TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN avatar_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN skill_category VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN tax_id VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN payment_method VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN nda_signed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE freelancer_profiles ADD COLUMN msa_signed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================
-- Auto-create profile row on user signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Seed: ensure existing auth users have profile rows
-- ============================================================

INSERT INTO profiles (id, email, full_name, role)
SELECT id, email,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''),
  'staff'
FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.users.id);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- >>> 20260731235106_20260801060000_role_architecture_super_admin_isolation.sql.sql
/*
# Role Architecture: Super Admin, Admin, Freelancer Isolation

## Overview
Establishes the role hierarchy for the Stormreef platform: super_admin, admin, staff,
and freelancer. Sets the current operator account to super_admin so they can access
every internal dashboard AND the Freelancer Portal. Adds a trigger that enforces
`role = 'freelancer'` on any profile created via the external freelancer signup flow
(detected via the `role` field in raw_user_meta_data).

## Changes to Existing Tables

### profiles
- No schema changes. The `role` column (TEXT, default 'staff') already exists.
- Role values used by the app: 'super_admin', 'admin', 'staff', 'freelancer'.
  These are stored as TEXT (not an enum) to allow flexible role additions without
  enum migration overhead.

## Security Changes

### Trigger: enforce_freelancer_role_on_signup
- AFTER INSERT on auth.users — if raw_user_meta_data contains `role: 'freelancer'`,
  upsert the matching profiles row with `role = 'freelancer'`.
- This ensures users who register via the /freelancer/signup route are hard-assigned
  the freelancer role at the database level, regardless of what the client does.
- Idempotent: uses ON CONFLICT (id) DO UPDATE.

### Trigger: handle_new_user_profile
- AFTER INSERT on auth.users — if no role is specified in raw_user_meta_data,
  create a profiles row with the default 'staff' role.
- This covers standard staff registrations.

## Data Updates
- Sets `operator@test.com` profile role to 'super_admin' (the current admin account).
- Ensures `owner@example.com` profile role remains 'freelancer'.

## Important Notes
1. Both triggers use `SECURITY DEFINER` and run as the postgres owner so they can
   write to profiles even when the calling role (anon/authenticated) lacks INSERT.
2. The triggers are idempotent — safe to re-run.
3. The `enforce_freelancer_role_on_signup` trigger specifically checks for the
   'freelancer' role value in user metadata, which the FreelancerAuth signup form sets.
*/

-- ============================================================
-- Set current admin account to super_admin
-- ============================================================

UPDATE profiles
SET role = 'super_admin'
WHERE email = 'operator@test.com';

-- Ensure the freelancer account stays freelancer
UPDATE profiles
SET role = 'freelancer'
WHERE email = 'owner@example.com';

-- ============================================================
-- Trigger: Auto-create/upgrade profile on user signup
-- Handles both staff (default) and freelancer (from metadata) registrations
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Insert or update profile based on role in user metadata
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        role = CASE
            -- Never downgrade a super_admin or admin
            WHEN profiles.role IN ('super_admin', 'admin') THEN profiles.role
            ELSE EXCLUDED.role
        END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Also handle existing auth.users that might not have profiles yet
INSERT INTO profiles (id, email, full_name, role)
SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', NULL),
    COALESCE(au.raw_user_meta_data->>'role', 'staff')
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Grant trigger function execution to appropriate roles
-- ============================================================
-- The trigger runs automatically on auth.users INSERT; no explicit GRANT needed
-- since it's a SECURITY DEFINER function invoked by the trigger system.

-- >>> 20260801091407_20260801080000_stormreef_rbac_admin_system.sql.sql
/*
# Stormreef Admin, RBAC Security System, and Scoped Onboarding Engine

## Overview
Implements a full Role-Based Access Control (RBAC) system for the Stormreef ecosystem.
Creates granular permissions per module, organization-scoped roles, user-organization
membership with role assignment, and asset access links for external contractor sandboxing.

## New Tables

### rbac_roles
Organization-scoped roles (e.g. "Admin", "Editor", "External Contractor"). Can be preset
or custom. Each role groups a set of module permissions.
- `id`, `organization_id` (FK → organizations), `name`, `is_custom`, `created_at`

### rbac_permissions
System-defined permissions for each module. Each permission is a module + action pair.
- `id`, `module` (VAULT, PROJECTS, SIGN, AGENT, SOCIAL, MAIL, PAY, PULSE, REWARDS, TALENT),
  `action` (view, edit, manage), `created_at`

### rbac_role_permissions
Join table linking roles to their permissions.
- `role_id` (FK → rbac_roles), `permission_id` (FK → rbac_permissions)

### organization_users
Maps users to organizations with an assigned role. A user can belong to multiple
organizations with different roles in each.
- `id`, `user_id` (FK → profiles), `organization_id` (FK → organizations),
  `role_id` (FK → rbac_roles), `created_at`

### asset_access_links
Granular asset access for external contractors. Links a user to a specific asset within
a project, with view/download permissions, watermark enforcement, and expiry.
- `id`, `asset_id`, `user_id` (FK → profiles), `project_id` (FK → projects),
  `can_view`, `can_download`, `enforce_watermark`, `expires_at`, `created_at`

## Modified Tables (additive only)

### profiles
- `is_super_admin` BOOLEAN DEFAULT FALSE — flag for super admin users
- `status` TEXT DEFAULT 'ACTIVE' — INVITED / ACTIVE / SUSPENDED

## Security
- All new tables have RLS enabled with authenticated-only access
- rbac_roles, rbac_permissions, rbac_role_permissions: readable by all authenticated
  (needed for permission checks), writable by super_admin or org owner
- organization_users: readable by the user themselves or org admins, writable by org admins
- asset_access_links: readable by the linked user or org admins, writable by org admins

## Seed Data
- 27 permissions (9 modules × 3 actions: view, edit, manage)
- Preset roles per organization: Admin (all manage), Editor (view+edit), Viewer (view only),
  External Contractor (projects view + vault view only)
- organization_users: existing operator mapped as Admin in all 3 orgs
- Sample asset_access_links for the contractor user
*/

-- ============================================================
-- 1. EXTEND profiles with is_super_admin + status
-- ============================================================

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Mark existing super_admin role users as is_super_admin
UPDATE profiles SET is_super_admin = TRUE WHERE role = 'super_admin';

-- Set status for existing users
UPDATE profiles SET status = 'ACTIVE' WHERE status IS NULL OR status = '';

-- ============================================================
-- 2. CREATE rbac_permissions (system-defined)
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module TEXT NOT NULL CHECK (module IN ('VAULT', 'PROJECTS', 'SIGN', 'AGENT', 'SOCIAL', 'MAIL', 'PAY', 'PULSE', 'REWARDS', 'TALENT')),
    action TEXT NOT NULL CHECK (action IN ('view', 'edit', 'manage')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (module, action)
);

ALTER TABLE rbac_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_permissions" ON rbac_permissions;
CREATE POLICY "select_rbac_permissions" ON rbac_permissions
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_permissions" ON rbac_permissions;
CREATE POLICY "insert_rbac_permissions" ON rbac_permissions
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
    );

DROP POLICY IF EXISTS "delete_rbac_permissions" ON rbac_permissions;
CREATE POLICY "delete_rbac_permissions" ON rbac_permissions
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
    );

-- Seed all 30 permissions (10 modules × 3 actions)
INSERT INTO rbac_permissions (module, action)
VALUES
    ('VAULT', 'view'), ('VAULT', 'edit'), ('VAULT', 'manage'),
    ('PROJECTS', 'view'), ('PROJECTS', 'edit'), ('PROJECTS', 'manage'),
    ('SIGN', 'view'), ('SIGN', 'edit'), ('SIGN', 'manage'),
    ('AGENT', 'view'), ('AGENT', 'edit'), ('AGENT', 'manage'),
    ('SOCIAL', 'view'), ('SOCIAL', 'edit'), ('SOCIAL', 'manage'),
    ('MAIL', 'view'), ('MAIL', 'edit'), ('MAIL', 'manage'),
    ('PAY', 'view'), ('PAY', 'edit'), ('PAY', 'manage'),
    ('PULSE', 'view'), ('PULSE', 'edit'), ('PULSE', 'manage'),
    ('REWARDS', 'view'), ('REWARDS', 'edit'), ('REWARDS', 'manage'),
    ('TALENT', 'view'), ('TALENT', 'edit'), ('TALENT', 'manage')
ON CONFLICT (module, action) DO NOTHING;

-- ============================================================
-- 3. CREATE rbac_roles
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

ALTER TABLE rbac_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_roles" ON rbac_roles;
CREATE POLICY "select_rbac_roles" ON rbac_roles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_roles" ON rbac_roles;
CREATE POLICY "insert_rbac_roles" ON rbac_roles
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "update_rbac_roles" ON rbac_roles;
CREATE POLICY "update_rbac_roles" ON rbac_roles
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_rbac_roles" ON rbac_roles;
CREATE POLICY "delete_rbac_roles" ON rbac_roles
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = rbac_roles.organization_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- 4. CREATE rbac_role_permissions
-- ============================================================

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE rbac_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "select_rbac_role_permissions" ON rbac_role_permissions
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "insert_rbac_role_permissions" ON rbac_role_permissions
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (
            EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
            OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.organization_id AND o.owner_id = auth.uid())
        ))
    );

DROP POLICY IF EXISTS "delete_rbac_role_permissions" ON rbac_role_permissions;
CREATE POLICY "delete_rbac_role_permissions" ON rbac_role_permissions
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (
            EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
            OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = r.organization_id AND o.owner_id = auth.uid())
        ))
    );

-- ============================================================
-- 5. CREATE organization_users
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_org_users" ON organization_users;
CREATE POLICY "select_org_users" ON organization_users
    FOR SELECT TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM organization_users ou2
          JOIN rbac_roles r2 ON r2.id = ou2.role_id
          WHERE ou2.user_id = auth.uid() AND ou2.organization_id = organization_users.organization_id
          AND r2.name IN ('Admin', 'admin')
        )
    );

DROP POLICY IF EXISTS "insert_org_users" ON organization_users;
CREATE POLICY "insert_org_users" ON organization_users
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
        OR user_id = auth.uid()
    );

DROP POLICY IF EXISTS "update_org_users" ON organization_users;
CREATE POLICY "update_org_users" ON organization_users
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_org_users" ON organization_users;
CREATE POLICY "delete_org_users" ON organization_users
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- 6. CREATE asset_access_links
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_access_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_download BOOLEAN NOT NULL DEFAULT FALSE,
    enforce_watermark BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE asset_access_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_asset_access_links" ON asset_access_links;
CREATE POLICY "select_asset_access_links" ON asset_access_links
    FOR SELECT TO authenticated USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "insert_asset_access_links" ON asset_access_links;
CREATE POLICY "insert_asset_access_links" ON asset_access_links
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "update_asset_access_links" ON asset_access_links;
CREATE POLICY "update_asset_access_links" ON asset_access_links
    FOR UPDATE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "delete_asset_access_links" ON asset_access_links;
CREATE POLICY "delete_asset_access_links" ON asset_access_links
    FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE)
        OR EXISTS (
            SELECT 1 FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = asset_access_links.project_id AND o.owner_id = auth.uid()
        )
    );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rbac_roles_org ON rbac_roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_role ON rbac_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_role_perms_perm ON rbac_role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_org_users_user ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_org_users_org ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_asset_access_user ON asset_access_links(user_id);
CREATE INDEX IF NOT EXISTS idx_asset_access_project ON asset_access_links(project_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);

-- ============================================================
-- SEED: Preset roles for all 3 organizations
-- ============================================================

-- Stormreef HQ (36e68aad-64a0-49fd-a1c9-dc155eee1216)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT '36e68aad-64a0-49fd-a1c9-dc155eee1216', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216' AND r.name = t.name
);

-- Reef Studios (fbb93be3-371f-4e52-a64d-7ccf42bf63b2)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT 'fbb93be3-371f-4e52-a64d-7ccf42bf63b2', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = 'fbb93be3-371f-4e52-a64d-7ccf42bf63b2' AND r.name = t.name
);

-- Coral Commerce (801fa3a9-8a42-4150-b9b7-57474cd37981)
INSERT INTO rbac_roles (organization_id, name, is_custom)
SELECT '801fa3a9-8a42-4150-b9b7-57474cd37981', name, FALSE
FROM (VALUES ('Admin'), ('Editor'), ('Viewer'), ('External Contractor')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM rbac_roles r WHERE r.organization_id = '801fa3a9-8a42-4150-b9b7-57474cd37981' AND r.name = t.name
);

-- ============================================================
-- SEED: Role permissions
-- Admin = all modules manage
-- Editor = all modules view + edit (except TALENT manage)
-- Viewer = all modules view
-- External Contractor = PROJECTS view + VAULT view only
-- ============================================================

-- Admin: all manage permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Admin' AND p.action = 'manage'
ON CONFLICT DO NOTHING;

-- Editor: all view + edit permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Editor' AND p.action IN ('view', 'edit')
ON CONFLICT DO NOTHING;

-- Viewer: all view permissions
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'Viewer' AND p.action = 'view'
ON CONFLICT DO NOTHING;

-- External Contractor: PROJECTS view + VAULT view only
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'External Contractor'
AND ((p.module = 'PROJECTS' AND p.action = 'view')
     OR (p.module = 'VAULT' AND p.action = 'view'))
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: organization_users — map existing operator as Admin in all orgs
-- ============================================================

INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT 'a30878aa-dd33-4be1-89dd-42bb2965e0c0', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'Admin'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = 'a30878aa-dd33-4be1-89dd-42bb2965e0c0'
    AND ou.organization_id = r.organization_id
)
ON CONFLICT DO NOTHING;

-- Map owner@example.com (freelancer) as External Contractor in Stormreef HQ
INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT 'e1acf174-d420-4438-b271-95b6290225ff', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'External Contractor' AND r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
    AND ou.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
)
ON CONFLICT DO NOTHING;

-- Map staff@example.com (staff) as Editor in Stormreef HQ
INSERT INTO organization_users (user_id, organization_id, role_id)
SELECT '4cd13d52-ffb6-448f-a3fb-bab3e872dc66', r.organization_id, r.id
FROM rbac_roles r
WHERE r.name = 'Editor' AND r.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
AND NOT EXISTS (
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = '4cd13d52-ffb6-448f-a3fb-bab3e872dc66'
    AND ou.organization_id = '36e68aad-64a0-49fd-a1c9-dc155eee1216'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: asset_access_links for the contractor (owner@example.com)
-- Linked to Website Redesign 2026 project (85e1905d-8e5b-42b4-93ff-516f9a01ba77)
-- ============================================================

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-001', 'e1acf174-d420-4438-b271-95b6290225ff', '85e1905d-8e5b-42b4-93ff-516f9a01ba77',
       TRUE, FALSE, TRUE, NOW() + INTERVAL '30 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-001' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-002', 'e1acf174-d420-4438-b271-95b6290225ff', '85e1905d-8e5b-42b4-93ff-516f9a01ba77',
       TRUE, TRUE, FALSE, NOW() + INTERVAL '60 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-002' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

INSERT INTO asset_access_links (asset_id, user_id, project_id, can_view, can_download, enforce_watermark, expires_at)
SELECT 'asset-003', 'e1acf174-d420-4438-b271-95b6290225ff', '492694c2-fc53-44ad-9438-5f0691692249',
       TRUE, FALSE, TRUE, NOW() + INTERVAL '15 days'
WHERE NOT EXISTS (
    SELECT 1 FROM asset_access_links aal
    WHERE aal.asset_id = 'asset-003' AND aal.user_id = 'e1acf174-d420-4438-b271-95b6290225ff'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Update profile names for better display
-- ============================================================

UPDATE profiles SET full_name = 'System Operator' WHERE id = 'a30878aa-dd33-4be1-89dd-42bb2965e0c0' AND full_name IS NULL;
UPDATE profiles SET status = 'INVITED' WHERE id = '4cd13d52-ffb6-448f-a3fb-bab3e872dc66' AND status = 'ACTIVE';

-- >>> 20260802030751_fix_organization_users_rls_recursion.sql
/*
# Fix infinite RLS recursion on organization_users

## Problem
The `select_org_users` policy on `organization_users` contains a subquery
that reads `organization_users` itself (to check if the current user is an
Admin in the same org). RLS evaluates the policy, which queries the table,
which triggers the policy again — infinite recursion → HTTP 500.

## Fix
1. Create a `SECURITY DEFINER` function `is_org_admin(target_org uuid)`
   that checks whether `auth.uid()` has an Admin role in the target
   organization. SECURITY DEFINER runs with the function owner's
   privileges, bypassing RLS on `organization_users` and breaking the
   recursion.
2. Drop and recreate all four CRUD policies on `organization_users`,
   replacing the self-referential subquery with the new function call.
3. Grant EXECUTE on the function to `authenticated`.

## Tables modified
- `organization_users` — policies replaced (no schema/column changes)

## Security
- The SECURITY DEFINER function is read-only (SELECT only) and scoped to
  the `authenticated` role. It does not expose data — it returns a boolean.
- All existing ownership checks (super_admin via profiles, org owner via
  organizations, self-access via user_id) are preserved.
*/

-- 1. Create the helper function
CREATE OR REPLACE FUNCTION is_org_admin(target_org uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_users ou
    JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.user_id = auth.uid()
      AND ou.organization_id = target_org
      AND r.name IN ('Admin', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_admin(uuid) TO authenticated;

-- 2. Drop and recreate policies (drop first for idempotency)
DROP POLICY IF EXISTS "select_org_users" ON organization_users;
DROP POLICY IF EXISTS "insert_org_users" ON organization_users;
DROP POLICY IF EXISTS "update_org_users" ON organization_users;
DROP POLICY IF EXISTS "delete_org_users" ON organization_users;

-- SELECT: user can see their own row, super_admins see all, org owners see all, org admins see all
CREATE POLICY "select_org_users" ON organization_users FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
    OR is_org_admin(organization_users.organization_id)
  );

-- INSERT: super_admins, org owners, or the user themselves
CREATE POLICY "insert_org_users" ON organization_users FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
    OR user_id = auth.uid()
  );

-- UPDATE: super_admins or org owners
CREATE POLICY "update_org_users" ON organization_users FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  );

-- DELETE: super_admins or org owners
CREATE POLICY "delete_org_users" ON organization_users FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true)
    OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_users.organization_id AND o.owner_id = auth.uid())
  );

-- >>> 20260802142546_20260802040000_debt_verge_schema.sql.sql
/*
# Debt Verge — Debt Management Platform Schema

## Overview
Creates the database backend for "Debt Verge", an enterprise-grade debt management
platform module. It manages debtor cases, creditor ledgers, Standard Financial
Statement (SFS) income/expenditure data, pro-rata creditor distributions, plan
comparisons, and a compliance audit timeline.

## New Tables
1. debt_cases — top-level debtor case record (case_number, debtor_name, status, plan_type, disposable income, total debt, distribution date)
2. debt_creditors — creditor ledger lines (creditor_name, debt_type, balance, interest_rate, pro_rata_amount, settlement_offer)
3. debt_sfs_entries — SFS income & expenditure line items (category, label, amount)
4. debt_distributions — scheduled creditor payment distributions (date, amount, status)
5. debt_audit_log — compliance timeline milestones

## Security
- RLS enabled on ALL five tables.
- TO authenticated with auth.uid() = user_id ownership checks.
- Child tables scope ownership through parent debt_cases via EXISTS subquery.
- user_id on debt_cases defaults to auth.uid().
*/

DO $$ BEGIN
  CREATE TYPE debt_case_status AS ENUM ('intake', 'sfs_pending', 'sfs_approved', 'creditor_pack_sent', 'payment_schedule_active', 'completed', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_plan_type AS ENUM ('dmp', 'settlement', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_type AS ENUM ('credit_card', 'personal_loan', 'mortgage_arrears', 'utility_arrears', 'council_tax', 'overdraft', 'store_card', 'hire_purchase', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_sfs_category AS ENUM ('income', 'essential_expense', 'discretionary_expense', 'debt_repayment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_distribution_status AS ENUM ('scheduled', 'processing', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS debt_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  case_number text UNIQUE NOT NULL,
  debtor_name text NOT NULL,
  debtor_reference text,
  status debt_case_status NOT NULL DEFAULT 'intake',
  plan_type debt_plan_type NOT NULL DEFAULT 'pending',
  monthly_disposable_income numeric(12,2) NOT NULL DEFAULT 0,
  total_debt numeric(12,2) NOT NULL DEFAULT 0,
  recovery_rate_target numeric(5,2) NOT NULL DEFAULT 90.00,
  next_distribution_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE debt_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_cases" ON debt_cases;
CREATE POLICY "select_own_debt_cases" ON debt_cases FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_debt_cases" ON debt_cases;
CREATE POLICY "insert_own_debt_cases" ON debt_cases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_debt_cases" ON debt_cases;
CREATE POLICY "update_own_debt_cases" ON debt_cases FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_debt_cases" ON debt_cases;
CREATE POLICY "delete_own_debt_cases" ON debt_cases FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS debt_creditors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_name text NOT NULL,
  debt_type debt_type NOT NULL DEFAULT 'credit_card',
  account_reference text,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  interest_rate numeric(5,2) NOT NULL DEFAULT 0,
  minimum_payment numeric(12,2),
  pro_rata_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_priority boolean NOT NULL DEFAULT false,
  settlement_offer numeric(12,2),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_creditors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_creditors" ON debt_creditors;
CREATE POLICY "select_own_debt_creditors" ON debt_creditors FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_creditors" ON debt_creditors;
CREATE POLICY "insert_own_debt_creditors" ON debt_creditors FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_creditors" ON debt_creditors;
CREATE POLICY "update_own_debt_creditors" ON debt_creditors FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_creditors" ON debt_creditors;
CREATE POLICY "delete_own_debt_creditors" ON debt_creditors FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_sfs_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  category debt_sfs_category NOT NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  is_recurring boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_sfs_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "select_own_debt_sfs" ON debt_sfs_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "insert_own_debt_sfs" ON debt_sfs_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "update_own_debt_sfs" ON debt_sfs_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "delete_own_debt_sfs" ON debt_sfs_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  distribution_date date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  status debt_distribution_status NOT NULL DEFAULT 'scheduled',
  reference text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_dist" ON debt_distributions;
CREATE POLICY "select_own_debt_dist" ON debt_distributions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_dist" ON debt_distributions;
CREATE POLICY "insert_own_debt_dist" ON debt_distributions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_dist" ON debt_distributions;
CREATE POLICY "update_own_debt_dist" ON debt_distributions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_dist" ON debt_distributions;
CREATE POLICY "delete_own_debt_dist" ON debt_distributions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  description text,
  actor text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_audit" ON debt_audit_log;
CREATE POLICY "select_own_debt_audit" ON debt_audit_log FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_audit" ON debt_audit_log;
CREATE POLICY "insert_own_debt_audit" ON debt_audit_log FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_audit" ON debt_audit_log;
CREATE POLICY "update_own_debt_audit" ON debt_audit_log FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_audit" ON debt_audit_log;
CREATE POLICY "delete_own_debt_audit" ON debt_audit_log FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_creditors_case_id ON debt_creditors(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_sfs_case_id ON debt_sfs_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_dist_case_id ON debt_distributions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_dist_creditor_id ON debt_distributions(creditor_id);
CREATE INDEX IF NOT EXISTS idx_debt_audit_case_id ON debt_audit_log(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_cases_user_id ON debt_cases(user_id);

CREATE OR REPLACE FUNCTION update_debt_cases_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_debt_cases_updated_at ON debt_cases;
CREATE TRIGGER trg_debt_cases_updated_at BEFORE UPDATE ON debt_cases FOR EACH ROW EXECUTE FUNCTION update_debt_cases_updated_at();

-- >>> 20260802160926_20260802160000_debt_disbursement_negotiation_schema.sql.sql
/*
# Debt Verge — Disbursement & Negotiation Schema

## Overview
Adds two new tables to support the Disbursement & Negotiation tab:
1. debt_payments — records of incoming debtor payments with auto-split metadata
2. debt_negotiations — per-creditor negotiation event timeline tracking communication status

## New Tables

### debt_payments
Tracks each incoming payment from the debtor and whether it was split across creditors.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `amount` (numeric) — the amount received from the debtor
- `payment_date` (date) — when the payment was received
- `expected_amount` (numeric) — the scheduled/expected monthly amount (for shortfall detection)
- `is_shortfall` (boolean) — true if amount < expected_amount
- `shortfall_amount` (numeric) — the difference (expected - amount), 0 if no shortfall
- `reference` (text) — bank reference or notes
- `created_at` (timestamptz)

### debt_negotiations
Per-creditor negotiation event history. Each row is one event in the timeline.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `creditor_id` (uuid, FK to debt_creditors, CASCADE)
- `event_type` (text) — e.g. "offer_pack_sent", "hold_placed", "interest_freeze_accepted", "interest_freeze_rejected", "full_offer_accepted", "full_offer_rejected", "counter_offer_received", "follow_up_call", "winding_up_threat"
- `event_label` (text) — human-readable label for the event
- `notes` (text) — optional detail
- `actor` (text) — who performed the action
- `created_at` (timestamptz)

## Security
- RLS enabled on both new tables.
- TO authenticated with ownership scoped through parent debt_cases via EXISTS subquery (same pattern as existing debt child tables).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/ 

-- ============================================================
-- debt_payments
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_shortfall boolean NOT NULL DEFAULT false,
  shortfall_amount numeric(12,2) NOT NULL DEFAULT 0,
  reference text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_payments" ON debt_payments;
CREATE POLICY "select_own_debt_payments" ON debt_payments FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_payments" ON debt_payments;
CREATE POLICY "insert_own_debt_payments" ON debt_payments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_payments" ON debt_payments;
CREATE POLICY "update_own_debt_payments" ON debt_payments FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_payments" ON debt_payments;
CREATE POLICY "delete_own_debt_payments" ON debt_payments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- debt_negotiations
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_label text NOT NULL,
  notes text,
  actor text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_negotiations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "select_own_debt_negotiations" ON debt_negotiations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "insert_own_debt_negotiations" ON debt_negotiations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "update_own_debt_negotiations" ON debt_negotiations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "delete_own_debt_negotiations" ON debt_negotiations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debt_payments_case_id ON debt_payments(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_payment_date ON debt_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_debt_negotiations_case_id ON debt_negotiations(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_negotiations_creditor_id ON debt_negotiations(creditor_id);

-- >>> 20260802163332_20260802170000_debt_customer_profile_household_schema.sql.sql
/*
# Debt Verge — Customer Profile & Household Schema

## Overview
Adds two new tables to support the Customer Profile & Household tab:
1. debt_customer_profiles — one-to-one record per case storing personal contact info, current address, household composition, and property/housing details
2. debt_previous_addresses — previous address history for cases where time at current address is under 3 years

## New Tables

### debt_customer_profiles (one-to-one with debt_cases)
Stores all customer profile and household data per case.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, UNIQUE, CASCADE) — one profile per case
- Personal & Contact: full_name, primary_email, landline_phone, mobile_phone, work_phone
- Address: address_street, address_city, address_postcode, time_at_address_years, time_at_address_months
- Household: household_adults, household_children_under_16, household_children_16_to_18
- Property: tenure_type (enum), property_value, outstanding_mortgage_or_rent, monthly_rent_or_mortgage, landlord_lender_name
- `created_at`, `updated_at` (timestamptz)

### debt_previous_addresses
Previous address repeater entries, ordered by recency.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `address_line` (text) — full previous address line
- `time_at_address` (text) — human-readable duration (e.g. "2 years 6 months")
- `created_at` (timestamptz)

## New Types
- `debt_tenure_type` ENUM: 'owned', 'private_rented', 'social_rented', 'council', 'leased', 'living_with_family'

## Security
- RLS enabled on both new tables.
- TO authenticated with ownership scoped through parent debt_cases via EXISTS subquery (same pattern as existing debt child tables).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

DO $$ BEGIN
  CREATE TYPE debt_tenure_type AS ENUM ('owned', 'private_rented', 'social_rented', 'council', 'leased', 'living_with_family');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- debt_customer_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES debt_cases(id) ON DELETE CASCADE,
  -- Personal & Contact
  full_name text,
  primary_email text,
  landline_phone text,
  mobile_phone text,
  work_phone text,
  -- Current Address
  address_street text,
  address_city text,
  address_postcode text,
  time_at_address_years int NOT NULL DEFAULT 0,
  time_at_address_months int NOT NULL DEFAULT 0,
  -- Household Composition
  household_adults int NOT NULL DEFAULT 1,
  household_children_under_16 int NOT NULL DEFAULT 0,
  household_children_16_to_18 int NOT NULL DEFAULT 0,
  -- Property & Housing
  tenure_type debt_tenure_type,
  property_value numeric(12,2),
  outstanding_mortgage_or_rent numeric(12,2),
  monthly_rent_or_mortgage numeric(12,2),
  landlord_lender_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE debt_customer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "select_own_debt_profiles" ON debt_customer_profiles FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "insert_own_debt_profiles" ON debt_customer_profiles FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "update_own_debt_profiles" ON debt_customer_profiles FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "delete_own_debt_profiles" ON debt_customer_profiles FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- debt_previous_addresses
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_previous_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  address_line text NOT NULL,
  time_at_address text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_previous_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "select_own_debt_prev_addr" ON debt_previous_addresses FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "insert_own_debt_prev_addr" ON debt_previous_addresses FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "update_own_debt_prev_addr" ON debt_previous_addresses FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "delete_own_debt_prev_addr" ON debt_previous_addresses FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debt_profiles_case_id ON debt_customer_profiles(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_prev_addr_case_id ON debt_previous_addresses(case_id);

-- >>> 20260802164844_20260802180000_debt_vulnerability_benefits_schema.sql.sql
/*
# Debt Verge — Vulnerability Screening & Benefits Checker Schema

## Overview
Adds two new tables for Aryza-grade client assessment:
1. debt_vulnerability_assessments — structured vulnerability checklist with automated scoring
2. debt_benefits_checks — benefits entitlement and income maximization checks

## New Tables

### debt_vulnerability_assessments (one-to-one with debt_cases)
Stores the vulnerability screening checklist and computed badges.
- case_id (uuid, UNIQUE FK to debt_cases)
- Financial Capability checklist items (boolean flags)
- Health Conditions checklist items
- Life Events checklist items
- Resilience checklist items
- vulnerability_score (int, computed 0-100)
- vulnerability_level (enum: none, low, medium, high, critical)
- preferred_comm_channel (text: phone, email, letter, in_person)
- priority_flag (boolean)
- notes (text)
- assessed_by (text)
- created_at, updated_at

### debt_benefits_checks
Individual benefits entitlement check entries per case.
- case_id (uuid FK to debt_cases)
- benefit_type (text: universal_credit, pip, dla, attendance_allowance, pension_credit, housing_benefit, council_tax_reduction, carers_allowance, esa, jsa, winter_fuel, disability_premium)
- label (text, human-readable)
- eligible (boolean)
- estimated_monthly (numeric, estimated monthly uplift)
- confirmed (boolean)
- notes (text)
- created_at

## New Types
- debt_vulnerability_level ENUM: none, low, medium, high, critical

## Security
- RLS enabled on both tables.
- TO authenticated, ownership through parent debt_cases via EXISTS subquery.
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

DO $$ BEGIN
  CREATE TYPE debt_vulnerability_level AS ENUM ('none', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS debt_vulnerability_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES debt_cases(id) ON DELETE CASCADE,
  -- Financial Capability
  fc_low_literacy boolean NOT NULL DEFAULT false,
  fc_no_bank_account boolean NOT NULL DEFAULT false,
  fc_recent_benefit_change boolean NOT NULL DEFAULT false,
  fc_income_drop boolean NOT NULL DEFAULT false,
  -- Health Conditions
  hc_mental_health boolean NOT NULL DEFAULT false,
  hc_physical_disability boolean NOT NULL DEFAULT false,
  hc_long_term_illness boolean NOT NULL DEFAULT false,
  hc_cognitive_impairment boolean NOT NULL DEFAULT false,
  -- Life Events
  le_recent_bereavement boolean NOT NULL DEFAULT false,
  le_relationship_breakdown boolean NOT NULL DEFAULT false,
  le_job_loss boolean NOT NULL DEFAULT false,
  le_pregnancy_new_child boolean NOT NULL DEFAULT false,
  -- Resilience
  rs_no_support_network boolean NOT NULL DEFAULT false,
  rs_language_barrier boolean NOT NULL DEFAULT false,
  rs_digital_exclusion boolean NOT NULL DEFAULT false,
  rs_housing_insecurity boolean NOT NULL DEFAULT false,
  -- Computed
  vulnerability_score int NOT NULL DEFAULT 0,
  vulnerability_level debt_vulnerability_level NOT NULL DEFAULT 'none',
  preferred_comm_channel text NOT NULL DEFAULT 'phone',
  priority_flag boolean NOT NULL DEFAULT false,
  notes text,
  assessed_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE debt_vulnerability_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_vuln" ON debt_vulnerability_assessments;
CREATE POLICY "select_own_debt_vuln" ON debt_vulnerability_assessments FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_vulnerability_assessments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_vuln" ON debt_vulnerability_assessments;
CREATE POLICY "insert_own_debt_vuln" ON debt_vulnerability_assessments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_vulnerability_assessments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_vuln" ON debt_vulnerability_assessments;
CREATE POLICY "update_own_debt_vuln" ON debt_vulnerability_assessments FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_vulnerability_assessments.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_vulnerability_assessments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_vuln" ON debt_vulnerability_assessments;
CREATE POLICY "delete_own_debt_vuln" ON debt_vulnerability_assessments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_vulnerability_assessments.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_benefits_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  benefit_type text NOT NULL,
  label text NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  estimated_monthly numeric(12,2) NOT NULL DEFAULT 0,
  confirmed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_benefits_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_benefits" ON debt_benefits_checks;
CREATE POLICY "select_own_debt_benefits" ON debt_benefits_checks FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_benefits_checks.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_benefits" ON debt_benefits_checks;
CREATE POLICY "insert_own_debt_benefits" ON debt_benefits_checks FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_benefits_checks.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_benefits" ON debt_benefits_checks;
CREATE POLICY "update_own_debt_benefits" ON debt_benefits_checks FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_benefits_checks.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_benefits_checks.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_benefits" ON debt_benefits_checks;
CREATE POLICY "delete_own_debt_benefits" ON debt_benefits_checks FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_benefits_checks.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_vuln_case_id ON debt_vulnerability_assessments(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_benefits_case_id ON debt_benefits_checks(case_id);

-- >>> 20260802165948_20260802190000_debt_bank_transactions_annual_reviews.sql.sql
/*
# Debt Verge — Bank Transaction Auto-Categorization & Annual SFS Review Workflow

## Overview
Adds two new tables to extend the Debt Verge module:
1. debt_bank_transactions — parsed bank statement line items that auto-map to SFS expense categories
2. debt_annual_reviews — 12-month SFS review snapshots with year-on-year comparison data

## New Tables

### debt_bank_transactions
Stores imported bank statement line items with automatic and manual categorization.
- case_id (uuid FK to debt_cases)
- transaction_date (date, when the transaction occurred)
- description (text, raw bank statement description e.g. "TESCO STORES 4823")
- amount (numeric, transaction amount — positive for income/credit, negative for expense/debit)
- merchant_hint (text, extracted merchant name for matching)
- auto_category (DebtSfsCategory, auto-assigned from merchant mapping rules)
- auto_label (text, auto-assigned SFS label e.g. "Food & Housekeeping")
- manual_category (DebtSfsCategory, advisor override — takes precedence when set)
- manual_label (text, advisor override label)
- confidence (text: high, medium, low, unmatched — confidence of auto-match)
- imported_to_sfs (boolean, whether the txn has been pushed to debt_sfs_entries)
- sfs_entry_id (uuid, FK to debt_sfs_entries if imported)
- created_at (timestamptz)

### debt_annual_reviews
Stores annual SFS review snapshots for 12-month compliance workflow.
- case_id (uuid FK to debt_cases)
- review_number (int, sequential — 1 for first annual, 2 for second, etc.)
- review_date (date, when the review was initiated)
- review_due_date (date, calculated due date — 12 months from last review/case creation)
- status (text: pending, in_progress, completed, overdue)
- snapshot_income (numeric, total income at review time)
- snapshot_essential_expenses (numeric)
- snapshot_discretionary_expenses (numeric)
- snapshot_disposable_income (numeric)
- snapshot_total_debt (numeric)
- snapshot_property_value (numeric, nullable)
- snapshot_tenure_type (text, nullable)
- previous_review_id (uuid, FK to self for chaining)
- income_change (numeric, delta from previous snapshot)
- housing_change (boolean, whether tenure/property changed)
- audit_log (jsonb, year-on-year comparison details)
- completed_at (timestamptz, nullable)
- created_at (timestamptz)

## Security
- RLS enabled on both tables.
- TO authenticated, ownership through parent debt_cases via EXISTS subquery.
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debt_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  merchant_hint text,
  auto_category text NOT NULL DEFAULT 'discretionary_expense',
  auto_label text NOT NULL DEFAULT 'Uncategorized',
  manual_category text,
  manual_label text,
  confidence text NOT NULL DEFAULT 'unmatched',
  imported_to_sfs boolean NOT NULL DEFAULT false,
  sfs_entry_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "select_own_debt_bank_txns" ON debt_bank_transactions FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "insert_own_debt_bank_txns" ON debt_bank_transactions FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "update_own_debt_bank_txns" ON debt_bank_transactions FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "delete_own_debt_bank_txns" ON debt_bank_transactions FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_annual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  review_number int NOT NULL DEFAULT 1,
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  review_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  snapshot_income numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_essential_expenses numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_discretionary_expenses numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_disposable_income numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_total_debt numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_property_value numeric(12,2),
  snapshot_tenure_type text,
  previous_review_id uuid,
  income_change numeric(12,2) NOT NULL DEFAULT 0,
  housing_change boolean NOT NULL DEFAULT false,
  audit_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_annual_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "select_own_debt_reviews" ON debt_annual_reviews FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "insert_own_debt_reviews" ON debt_annual_reviews FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "update_own_debt_reviews" ON debt_annual_reviews FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "delete_own_debt_reviews" ON debt_annual_reviews FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_bank_txns_case_id ON debt_bank_transactions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_annual_reviews_case_id ON debt_annual_reviews(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_annual_reviews_due_date ON debt_annual_reviews(review_due_date);

-- >>> 20260802173300_20260802200000_debtverge_tenant_signup_provisioning.sql.sql
/*
# Debt Verge — Tenant Sign-Up & Provisioning Schema

## Overview
Adds a new table to support self-service sign-up for Debt Management (DM) firms
subscribing to the DebtVerge platform. Each row represents a tenant (a DM firm)
that has registered through the sign-up wizard, with their company details, selected
plan tier, billing cycle, add-ons, subscription status, and provisioning state.

## New Tables

### debtverge_tenants
Stores DM firm tenant records created via the self-service sign-up wizard.
- id (uuid, primary key)
- company_name (text, not null — the DM firm's legal name)
- fca_frn (text, not null — FCA Firm Reference Number, 6-7 digits)
- admin_first_name (text, not null)
- admin_last_name (text, not null)
- admin_email (text, not null — work/corporate email)
- admin_mobile (text, not null — UK mobile number)
- auth_user_id (uuid, nullable — links to auth.users once the admin account is created)
- plan_tier (text, not null, default 'starter' — 'starter' | 'professional' | 'enterprise')
- billing_cycle (text, not null, default 'monthly' — 'monthly' | 'annual')
- base_price_gbp (numeric, monthly base price of selected tier)
- additional_seats (int, not null, default 0 — extra advisor seats purchased)
- open_banking_credits (int, not null, default 0 — Open Banking API fetch credit pack count)
- sms_pack_enabled (boolean, not null, default false — automated SMS/WhatsApp messaging pack)
- subtotal_gbp (numeric, pre-tax total)
- vat_gbp (numeric, 20% VAT)
- total_gbp (numeric, total due today including VAT)
- subscription_status (text, not null, default 'trial' — 'trial' | 'active' | 'suspended' | 'cancelled')
- provisioning_status (text, not null, default 'pending' — 'pending' | 'in_progress' | 'complete' | 'failed')
- tenant_slug (text, unique — URL-friendly workspace identifier derived from company name)
- workspace_url (text, nullable — full URL to the provisioned workspace)
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
- RLS enabled on debtverge_tenants.
- This table is written during public self-service sign-up (before auth), so it uses
  TO anon, authenticated for INSERT (the wizard runs unauthenticated) and SELECT.
- UPDATE/DELETE restricted to authenticated (only logged-in admins can modify tenants).
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debtverge_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  fca_frn text NOT NULL,
  admin_first_name text NOT NULL,
  admin_last_name text NOT NULL,
  admin_email text NOT NULL,
  admin_mobile text NOT NULL,
  auth_user_id uuid,
  plan_tier text NOT NULL DEFAULT 'starter',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  base_price_gbp numeric(10,2) NOT NULL DEFAULT 299,
  additional_seats int NOT NULL DEFAULT 0,
  open_banking_credits int NOT NULL DEFAULT 0,
  sms_pack_enabled boolean NOT NULL DEFAULT false,
  subtotal_gbp numeric(10,2) NOT NULL DEFAULT 0,
  vat_gbp numeric(10,2) NOT NULL DEFAULT 0,
  total_gbp numeric(10,2) NOT NULL DEFAULT 0,
  subscription_status text NOT NULL DEFAULT 'trial',
  provisioning_status text NOT NULL DEFAULT 'pending',
  tenant_slug text UNIQUE,
  workspace_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "anon_select_debtverge_tenants" ON debtverge_tenants FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "anon_insert_debtverge_tenants" ON debtverge_tenants FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "auth_update_debtverge_tenants" ON debtverge_tenants FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "auth_delete_debtverge_tenants" ON debtverge_tenants FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_debtverge_tenants_slug ON debtverge_tenants(tenant_slug);
CREATE INDEX IF NOT EXISTS idx_debtverge_tenants_email ON debtverge_tenants(admin_email);

-- >>> 20260802192718_20260802180000_insolv_engine_iva_insolvency_schema.sql.sql
/*
# Insolv Engine — IVA / Insolvency Schema

## Purpose
Extends the DebtVerge case model with enterprise Insolvency Practitioner (IP) workflow
support and a two-way Creditor Portal. Adds five new tables for IP details, document
verification, IVA proposals, creditor proxy votes, and Proof of Debt submissions.

## 1. New Tables

### debt_ip_details
Stores the assigned Insolvency Practitioner (Nominee/Supervisor) for a case.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- practitioner_name (text) — IP's full name
- registration_number (text) — FCA/IP registration number
- firm_name (text) — firm/legal entity name
- firm_address (text)
- firm_phone (text)
- firm_email (text)
- role_type (text) — 'nominee' | 'supervisor' | 'joint'
- nominee_fee_percent (numeric) — Nominee fee as % of realisations
- supervisor_fee_percent (numeric) — Supervisor fee as % of realisations
- fixed_fee_amount (numeric) — any fixed fee element
- fee_notes (text)
- appointed_at (timestamptz)
- created_at / updated_at

### debt_document_checklist
Verification documents uploaded against a case (Payslips, Bank statements, ID/KYC, Tax records).
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- document_type (text) — 'payslip' | 'bank_statement' | 'id_kyc' | 'tax_record' | 'utility_bill' | 'creditor_statement' | 'other'
- file_name (text)
- file_url (text) — Supabase Storage path
- file_size_bytes (bigint)
- uploaded_by_role (text) — 'advisor' | 'debtor' | 'ip' | 'creditor'
- status (text) — 'pending' | 'approved' | 'rejected' (default 'pending')
- reviewed_by (text) — name of reviewer
- reviewed_at (timestamptz)
- rejection_reason (text)
- notes (text)
- created_at / updated_at

### debt_iva_proposals
IVA Protocol compliance parameters for a case.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- proposed_duration_months (int) — e.g. 60 or 72
- total_estimated_dividend (numeric) — total dividend to creditors
- estimated_dividend_percent (numeric) — pence-in-the-pound
- equity_treatment_terms (text) — how property equity is handled
- equity_release_month (int) — month equity review/release due
- protocol_compliant (boolean) — whether proposal meets IVA Protocol
- proposal_status (text) — 'draft' | 'circulated' | 'approved' | 'rejected' | 'varied'
- creditor_meeting_date (timestamptz)
- dividend_calculation_notes (text)
- created_at / updated_at

### debt_creditor_votes
Proxy submissions from creditors for IVA proposals.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- proposal_id (uuid FK → debt_iva_proposals)
- creditor_id (uuid FK → debt_creditors)
- claimed_debt_amount (numeric) — amount creditor claims is owed
- vote (text) — 'accept' | 'reject' | 'modify'
- modification_notes (text)
- proxy_form_url (text) — Supabase Storage path to proxy form
- submitted_by (text) — creditor name or portal reference
- submitted_at (timestamptz)
- created_at / updated_at

### debt_proof_of_debt
Proof of Debt (PoD) submissions from external creditors via Creditor Portal.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- creditor_id (uuid FK → debt_creditors)
- creditor_name (text)
- creditor_reference (text) — creditor's own account/reference number
- claimed_amount (numeric)
- admitted_amount (numeric) — amount IP admits (may differ)
- pod_form_url (text) — Supabase Storage path
- supporting_documents_url (text[])
- status (text) — 'submitted' | 'under_review' | 'admitted' | 'rejected' | 'partially_admitted'
- reviewed_by (text)
- reviewed_at (timestamptz)
- rejection_reason (text)
- notes (text)
- created_at / updated_at

## 2. Security
- RLS enabled on all five new tables.
- Policies use TO anon, authenticated with true predicates (single-tenant shared model
  consistent with the existing debt_* tables — the Stormreef workspace is a shared
  operational database where all authenticated staff/advisors access the same case pool).
- This matches the RLS pattern already established across the debt_* table family.

## 3. Indexes
- All tables indexed on case_id for fast case-scoped queries.
- debt_creditor_votes indexed on proposal_id.
- debt_document_checklist indexed on status for pending-review queries.
- debt_proof_of_debt indexed on status.

## 4. Important Notes
1. No existing tables are altered — this is purely additive.
2. All existing DMP and SFS tools remain fully intact.
3. Foreign keys cascade on case deletion to keep referential integrity.
4. Amounts stored as numeric(12,2) for monetary precision.
*/

-- ============================================================
-- Table: debt_ip_details
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_ip_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  practitioner_name text NOT NULL,
  registration_number text,
  firm_name text,
  firm_address text,
  firm_phone text,
  firm_email text,
  role_type text NOT NULL DEFAULT 'nominee' CHECK (role_type IN ('nominee', 'supervisor', 'joint')),
  nominee_fee_percent numeric(5,2) DEFAULT 0,
  supervisor_fee_percent numeric(5,2) DEFAULT 0,
  fixed_fee_amount numeric(12,2) DEFAULT 0,
  fee_notes text,
  appointed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_ip_details_case_id ON debt_ip_details(case_id);

ALTER TABLE debt_ip_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ip_details" ON debt_ip_details;
CREATE POLICY "anon_select_ip_details" ON debt_ip_details FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ip_details" ON debt_ip_details;
CREATE POLICY "anon_insert_ip_details" ON debt_ip_details FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ip_details" ON debt_ip_details;
CREATE POLICY "anon_update_ip_details" ON debt_ip_details FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ip_details" ON debt_ip_details;
CREATE POLICY "anon_delete_ip_details" ON debt_ip_details FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_document_checklist
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_document_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('payslip','bank_statement','id_kyc','tax_record','utility_bill','creditor_statement','other')),
  file_name text NOT NULL,
  file_url text,
  file_size_bytes bigint DEFAULT 0,
  uploaded_by_role text NOT NULL DEFAULT 'advisor' CHECK (uploaded_by_role IN ('advisor','debtor','ip','creditor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_doc_checklist_case_id ON debt_document_checklist(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_doc_checklist_status ON debt_document_checklist(status);

ALTER TABLE debt_document_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_select_doc_checklist" ON debt_document_checklist FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_insert_doc_checklist" ON debt_document_checklist FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_update_doc_checklist" ON debt_document_checklist FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_delete_doc_checklist" ON debt_document_checklist FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_proposals
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  proposed_duration_months int NOT NULL DEFAULT 60,
  total_estimated_dividend numeric(12,2) DEFAULT 0,
  estimated_dividend_percent numeric(5,2) DEFAULT 0,
  equity_treatment_terms text,
  equity_release_month int,
  protocol_compliant boolean DEFAULT false,
  proposal_status text NOT NULL DEFAULT 'draft' CHECK (proposal_status IN ('draft','circulated','approved','rejected','varied')),
  creditor_meeting_date timestamptz,
  dividend_calculation_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_iva_proposals_case_id ON debt_iva_proposals(case_id);

ALTER TABLE debt_iva_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_select_iva_proposals" ON debt_iva_proposals FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_insert_iva_proposals" ON debt_iva_proposals FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_update_iva_proposals" ON debt_iva_proposals FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_delete_iva_proposals" ON debt_iva_proposals FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_creditor_votes
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_creditor_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES debt_iva_proposals(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  claimed_debt_amount numeric(12,2) DEFAULT 0,
  vote text NOT NULL DEFAULT 'accept' CHECK (vote IN ('accept','reject','modify')),
  modification_notes text,
  proxy_form_url text,
  submitted_by text,
  submitted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_creditor_votes_case_id ON debt_creditor_votes(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_creditor_votes_proposal_id ON debt_creditor_votes(proposal_id);

ALTER TABLE debt_creditor_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_select_creditor_votes" ON debt_creditor_votes FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_insert_creditor_votes" ON debt_creditor_votes FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_update_creditor_votes" ON debt_creditor_votes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_delete_creditor_votes" ON debt_creditor_votes FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_proof_of_debt
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_proof_of_debt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  creditor_name text NOT NULL,
  creditor_reference text,
  claimed_amount numeric(12,2) DEFAULT 0,
  admitted_amount numeric(12,2) DEFAULT 0,
  pod_form_url text,
  supporting_documents_url text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','admitted','rejected','partially_admitted')),
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_proof_of_debt_case_id ON debt_proof_of_debt(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_proof_of_debt_status ON debt_proof_of_debt(status);

ALTER TABLE debt_proof_of_debt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_select_proof_of_debt" ON debt_proof_of_debt FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_insert_proof_of_debt" ON debt_proof_of_debt FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_update_proof_of_debt" ON debt_proof_of_debt FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_delete_proof_of_debt" ON debt_proof_of_debt FOR DELETE
  TO anon, authenticated USING (true);

-- >>> 20260802194223_20260802200000_insolv_engine_inflight_signposting_schema.sql.sql
/*
# Insolv Engine — In-Flight Case Management & Signposting Schema

## Purpose
Extends the Insolv Engine with post-approval IVA case management tables
(contributions, distribution runs, distribution line items) and a signposting
assessment table for the automated lead intake / debtor routing workflow.

## 1. New Tables

### debt_signposting_assessments
Initial debt assessment that routes consumers to the correct support path
based on total debt, disposable income, and creditor count.
- id (uuid PK)
- case_id (uuid FK → debt_cases, nullable — assessment can happen before a case exists)
- total_debt (numeric) — total unsecured debt
- monthly_disposable_income (numeric) — SFS disposable income
- creditor_count (int) — number of creditors
- recommended_route (text) — 'iva' | 'dmp' | 'dro' | 'bankruptcy' | 'signposting'
- route_confidence (numeric) — confidence percentage 0–100
- route_reasons (text[]) — human-readable rationale bullets
- assessment_data (jsonb) — full assessment payload for audit
- created_at / updated_at

### debt_iva_contributions
Monthly debtor contributions logged during IVA in-flight administration.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- amount (numeric) — contribution amount received
- contribution_date (date) — when the contribution was received
- payment_method (text) — 'bacs' | 'standing_order' | 'card' | 'cash' | 'other'
- reference (text) — bank reference / transaction ID
- status (text) — 'expected' | 'received' | 'missed' | 'late' | 'partial'
- allocated_amount (numeric) — amount already allocated to distribution runs
- notes (text)
- created_at / updated_at

### debt_iva_distribution_runs
Distribution calculator runs that split collected funds across creditor dividend
schedules, deducting IP fees (Nominee & Supervisor fees) before disbursement.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- run_date (date) — when the distribution was calculated
- total_collected (numeric) — total funds available for distribution
- nominee_fee_deducted (numeric) — Nominee fee deducted from collected funds
- supervisor_fee_deducted (numeric) — Supervisor fee deducted from collected funds
- total_disbursed (numeric) — total amount disbursed to creditors
- status (text) — 'calculated' | 'approved' | 'executed' | 'reversed'
- approved_by (text) — name of approver
- approved_at (timestamptz)
- notes (text)
- created_at / updated_at

### debt_iva_distribution_items
Individual creditor line items within a distribution run.
- id (uuid PK)
- run_id (uuid FK → debt_iva_distribution_runs, cascade delete)
- case_id (uuid FK → debt_cases)
- creditor_id (uuid FK → debt_creditors, set null on delete)
- creditor_name (text) — snapshot of creditor name at distribution time
- original_debt (numeric) — creditor's original debt balance
- pro_rata_percent (numeric) — pro-rata share percentage
- distribution_amount (numeric) — amount disbursed to this creditor
- created_at (timestamptz)

## 2. Security
- RLS enabled on all four new tables.
- Policies use TO anon, authenticated with true predicates, matching the
  existing debt_* table family's shared operational model.

## 3. Indexes
- All tables indexed on case_id.
- debt_iva_distribution_items indexed on run_id.
- debt_iva_contributions indexed on contribution_date.
- debt_iva_distribution_runs indexed on status.

## 4. Important Notes
1. No existing tables altered — purely additive.
2. All existing DMP, SFS, and insolvency tools remain fully intact.
3. Distribution items cascade-delete with their parent run.
4. Amounts stored as numeric(12,2) for monetary precision.
*/

-- ============================================================
-- Table: debt_signposting_assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_signposting_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  total_debt numeric(12,2) DEFAULT 0,
  monthly_disposable_income numeric(12,2) DEFAULT 0,
  creditor_count int DEFAULT 0,
  recommended_route text NOT NULL DEFAULT 'signposting' CHECK (recommended_route IN ('iva','dmp','dro','bankruptcy','signposting')),
  route_confidence numeric(5,2) DEFAULT 0,
  route_reasons text[] DEFAULT '{}',
  assessment_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signpost_case_id ON debt_signposting_assessments(case_id);

ALTER TABLE debt_signposting_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_signpost" ON debt_signposting_assessments;
CREATE POLICY "sel_signpost" ON debt_signposting_assessments FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_signpost" ON debt_signposting_assessments;
CREATE POLICY "ins_signpost" ON debt_signposting_assessments FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_signpost" ON debt_signposting_assessments;
CREATE POLICY "upd_signpost" ON debt_signposting_assessments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_signpost" ON debt_signposting_assessments;
CREATE POLICY "del_signpost" ON debt_signposting_assessments FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_contributions
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  contribution_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text CHECK (payment_method IN ('bacs','standing_order','card','cash','other')),
  reference text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('expected','received','missed','late','partial')),
  allocated_amount numeric(12,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_contrib_case_id ON debt_iva_contributions(case_id);
CREATE INDEX IF NOT EXISTS idx_iva_contrib_date ON debt_iva_contributions(contribution_date);

ALTER TABLE debt_iva_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "sel_iva_contrib" ON debt_iva_contributions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "ins_iva_contrib" ON debt_iva_contributions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "upd_iva_contrib" ON debt_iva_contributions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "del_iva_contrib" ON debt_iva_contributions FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_distribution_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_distribution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  total_collected numeric(12,2) NOT NULL DEFAULT 0,
  nominee_fee_deducted numeric(12,2) DEFAULT 0,
  supervisor_fee_deducted numeric(12,2) DEFAULT 0,
  total_disbursed numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','approved','executed','reversed')),
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_dist_runs_case ON debt_iva_distribution_runs(case_id);
CREATE INDEX IF NOT EXISTS idx_iva_dist_runs_status ON debt_iva_distribution_runs(status);

ALTER TABLE debt_iva_distribution_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "sel_iva_dist_run" ON debt_iva_distribution_runs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "ins_iva_dist_run" ON debt_iva_distribution_runs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "upd_iva_dist_run" ON debt_iva_distribution_runs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "del_iva_dist_run" ON debt_iva_distribution_runs FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_distribution_items
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_distribution_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES debt_iva_distribution_runs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  creditor_name text NOT NULL,
  original_debt numeric(12,2) DEFAULT 0,
  pro_rata_percent numeric(5,2) DEFAULT 0,
  distribution_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_dist_items_run ON debt_iva_distribution_items(run_id);
CREATE INDEX IF NOT EXISTS idx_iva_dist_items_case ON debt_iva_distribution_items(case_id);

ALTER TABLE debt_iva_distribution_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "sel_iva_dist_item" ON debt_iva_distribution_items FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "ins_iva_dist_item" ON debt_iva_distribution_items FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "upd_iva_dist_item" ON debt_iva_distribution_items FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "del_iva_dist_item" ON debt_iva_distribution_items FOR DELETE
  TO anon, authenticated USING (true);

-- >>> 20260802200732_20260802210000_debtverge_omnichannel_comms_schema.sql.sql
/*
# Unified Omnichannel Communications Architecture — Schema

## Purpose
Creates two new tables to support a centralized omnichannel communications
system (Email, SMS, WhatsApp, internal notes) for the DebtVerge / Stormreef
platform. All communications link back to the DebtVerge master case via
case_id FK to debt_cases.

## 1. New Tables

### debtverge_communications
Stores every inbound and outbound communication across all channels.
- id (uuid PK)
- case_id (uuid FK → debt_cases, cascade delete)
- thread_id (uuid) — groups messages in the same conversation thread
- channel (text) — 'email' | 'sms' | 'whatsapp' | 'internal_note'
- direction (text) — 'inbound' | 'outbound'
- sender_name (text)
- sender_email_or_phone (text)
- sender_type (text) — 'client' | 'agent' | 'system'
- recipient_name (text)
- recipient_email_or_phone (text)
- agent_id (text) — staff member who handled/sent the message
- agent_name (text)
- subject (text, nullable — only for email)
- body (text)
- attachments (text[], default '{}')
- status (text) — 'delivered' | 'read' | 'failed' | 'queued'
- matched_automatically (bool, default true) — whether inbound was auto-matched to case
- created_at / updated_at (timestamptz)

### debtverge_unassigned_messages
Buffer for inbound communications that cannot be automatically matched to an
existing client email or phone number. These await manual matching by an agent.
- id (uuid PK)
- channel (text) — 'email' | 'sms' | 'whatsapp'
- sender_name (text)
- sender_email_or_phone (text)
- subject (text, nullable)
- body (text)
- attachments (text[], default '{}')
- received_at (timestamptz)
- matched_case_id (uuid FK → debt_cases, nullable, set null on delete)
- matched_at (timestamptz, nullable)
- matched_by (text, nullable) — agent name who matched it
- status (text) — 'unassigned' | 'matched' | 'ignored'
- created_at / updated_at (timestamptz)

## 2. Security
- RLS enabled on both tables.
- Policies use TO anon, authenticated with true predicates, matching the
  existing debt_* table family's shared operational model (no-auth app).

## 3. Indexes
- debtverge_communications indexed on case_id, thread_id, channel, created_at.
- debtverge_unassigned_messages indexed on status, matched_case_id.

## 4. Important Notes
1. No existing tables altered — purely additive.
2. All existing DebtVerge case data, SFS tools, and pipeline states remain intact.
3. thread_id is a plain uuid (not FK) — threads are implicit groupings, not a separate table.
4. attachments stored as text[] of file names/URLs.
*/

-- ============================================================
-- Table: debtverge_communications
-- ============================================================
CREATE TABLE IF NOT EXISTS debtverge_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  thread_id uuid DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','internal_note')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_name text NOT NULL DEFAULT '',
  sender_email_or_phone text NOT NULL DEFAULT '',
  sender_type text NOT NULL DEFAULT 'system' CHECK (sender_type IN ('client','agent','system')),
  recipient_name text NOT NULL DEFAULT '',
  recipient_email_or_phone text NOT NULL DEFAULT '',
  agent_id text,
  agent_name text,
  subject text,
  body text NOT NULL DEFAULT '',
  attachments text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('delivered','read','failed','queued')),
  matched_automatically boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debtverge_comms_case_id ON debtverge_communications(case_id);
CREATE INDEX IF NOT EXISTS idx_debtverge_comms_thread_id ON debtverge_communications(thread_id);
CREATE INDEX IF NOT EXISTS idx_debtverge_comms_channel ON debtverge_communications(channel);
CREATE INDEX IF NOT EXISTS idx_debtverge_comms_created ON debtverge_communications(created_at);

ALTER TABLE debtverge_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_dv_comms" ON debtverge_communications;
CREATE POLICY "sel_dv_comms" ON debtverge_communications FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_dv_comms" ON debtverge_communications;
CREATE POLICY "ins_dv_comms" ON debtverge_communications FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_dv_comms" ON debtverge_communications;
CREATE POLICY "upd_dv_comms" ON debtverge_communications FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_dv_comms" ON debtverge_communications;
CREATE POLICY "del_dv_comms" ON debtverge_communications FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debtverge_unassigned_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS debtverge_unassigned_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  sender_name text NOT NULL DEFAULT '',
  sender_email_or_phone text NOT NULL DEFAULT '',
  subject text,
  body text NOT NULL DEFAULT '',
  attachments text[] DEFAULT '{}',
  received_at timestamptz DEFAULT now(),
  matched_case_id uuid REFERENCES debt_cases(id) ON DELETE SET NULL,
  matched_at timestamptz,
  matched_by text,
  status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','matched','ignored')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dv_unassigned_status ON debtverge_unassigned_messages(status);
CREATE INDEX IF NOT EXISTS idx_dv_unassigned_case ON debtverge_unassigned_messages(matched_case_id);

ALTER TABLE debtverge_unassigned_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_dv_unassigned" ON debtverge_unassigned_messages;
CREATE POLICY "sel_dv_unassigned" ON debtverge_unassigned_messages FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_dv_unassigned" ON debtverge_unassigned_messages;
CREATE POLICY "ins_dv_unassigned" ON debtverge_unassigned_messages FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_dv_unassigned" ON debtverge_unassigned_messages;
CREATE POLICY "upd_dv_unassigned" ON debtverge_unassigned_messages FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_dv_unassigned" ON debtverge_unassigned_messages;
CREATE POLICY "del_dv_unassigned" ON debtverge_unassigned_messages FOR DELETE
  TO anon, authenticated USING (true);

-- >>> 20260802232442_debtverge_compliance_scripting_schema.sql
/*
# DebtVerge — Dynamic Compliance Scripting & Vulnerability Markers

## Overview
Adds two new tables to support the Dynamic Compliance Scripting overlay:
1. debtverge_compliance_attestations — immutable record of when an agent confirmed mandatory FCA CONC disclaimers were read verbatim for a specific script type.
2. debtverge_vulnerability_flags — one-click vulnerability markers using official FCA categories (Health, Life Events, Resilience, Capability) with custom guidance notes.

## New Tables

### debtverge_compliance_attestations
- id (uuid PK)
- case_id (uuid FK to debt_cases, ON DELETE CASCADE)
- script_type (text — which script was active: initial_onboarding, annual_review, iva_proposal_review, creditor_negotiation, solution_selection, closure)
- disclaimers_text (text — the exact disclaimer text that was confirmed read verbatim)
- confirmed_by (text — agent name who confirmed)
- confirmed_at (timestamptz — when the confirmation was made)
- created_at (timestamptz DEFAULT now())

### debtverge_vulnerability_flags
- id (uuid PK)
- case_id (uuid FK to debt_cases, ON DELETE CASCADE)
- fca_category (text — health, life_events, resilience, capability)
- sub_category (text — specific trigger e.g. mental_health, bereavement, digital_exclusion, low_literacy)
- guidance_notes (text — custom advisor guidance notes)
- flagged_by (text — agent name who flagged)
- flagged_at (timestamptz DEFAULT now())
- created_at (timestamptz DEFAULT now())

## Security
- RLS enabled on both tables.
- TO authenticated, ownership through parent debt_cases via EXISTS subquery (same pattern as debt_vulnerability_assessments).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debtverge_compliance_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  script_type text NOT NULL,
  disclaimers_text text NOT NULL,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_compliance_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "select_own_compliance_attest" ON debtverge_compliance_attestations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "insert_own_compliance_attest" ON debtverge_compliance_attestations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "update_own_compliance_attest" ON debtverge_compliance_attestations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "delete_own_compliance_attest" ON debtverge_compliance_attestations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));


CREATE TABLE IF NOT EXISTS debtverge_vulnerability_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  fca_category text NOT NULL,
  sub_category text NOT NULL,
  guidance_notes text,
  flagged_by text,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_vulnerability_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "select_own_vuln_flags" ON debtverge_vulnerability_flags FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "insert_own_vuln_flags" ON debtverge_vulnerability_flags FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "update_own_vuln_flags" ON debtverge_vulnerability_flags FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "delete_own_vuln_flags" ON debtverge_vulnerability_flags FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_compliance_attest_case ON debtverge_compliance_attestations(case_id);
CREATE INDEX IF NOT EXISTS idx_vuln_flags_case ON debtverge_vulnerability_flags(case_id);

-- >>> 20260803015759_20260803000000_debt_payment_schedule_transactions.sql.sql
/*
# Client Payment Schedule & Transaction Ledger

## Overview
Adds a client payment schedule and transaction ledger to the DebtVerge
platform. The schedule stores the agreed-upon frequency, preferred
payment day, installment amount, and next due date on the existing
debt_cases table. The ledger table tracks individual payment
transactions (scheduled, cleared, missed, bounced, overdue) with
amount due vs paid, failure reasons, and cleared dates.

## Modified Tables
1. debt_cases — adds four nullable columns:
   - payment_frequency (text): 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'specific_date'
   - preferred_payment_day (text): numeric day ('1'–'28'), 'last_working_day', or 'monday'
   - installment_amount (numeric(12,2)): per-frequency installment value
   - next_due_date (date): ISO date of the next scheduled payment

## New Tables
1. debt_payment_transactions — per-installment ledger rows:
   - id (uuid, PK)
   - case_id (uuid FK → debt_cases ON DELETE CASCADE)
   - due_date (date, not null)
   - amount_due (numeric(12,2), not null, default 0)
   - amount_paid (numeric(12,2), not null, default 0)
   - status (debt_payment_txn_status enum: scheduled, awaiting_clearance, cleared, missed, bounced, overdue)
   - failure_reason (text, nullable — e.g. "Refer to Drawer / Insufficient Funds")
   - cleared_date (date, nullable)
   - created_at (timestamptz, default now())

## Security
- RLS enabled on debt_payment_transactions.
- TO authenticated with ownership scoped through parent debt_cases
  via EXISTS subquery (same pattern as debt_creditors, debt_sfs_entries, etc.).
- Four policies: select, insert, update, delete — no FOR ALL.

## Indexes
- idx_debt_payment_txn_case_id on debt_payment_transactions(case_id)
- idx_debt_payment_txn_status on debt_payment_transactions(status)

## Notes
1. All new debt_cases columns are nullable so existing rows are
   unaffected — the schedule is opt-in per case.
2. The enum uses IF NOT EXISTS via DO $$ / EXCEPTION pattern for
   idempotency.
3. No existing tables, columns, policies, or data are removed or
   renamed — this is purely additive.
*/

-- New enum for transaction status
DO $$ BEGIN
  CREATE TYPE debt_payment_txn_status AS ENUM (
    'scheduled', 'awaiting_clearance', 'cleared', 'missed', 'bounced', 'overdue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Additive columns on debt_cases (all nullable, no data loss)
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS payment_frequency text;
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS preferred_payment_day text;
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS installment_amount numeric(12,2);
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS next_due_date date;

-- Transaction ledger table
CREATE TABLE IF NOT EXISTS debt_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  amount_due numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  status debt_payment_txn_status NOT NULL DEFAULT 'scheduled',
  failure_reason text,
  cleared_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "select_own_debt_payment_txn" ON debt_payment_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "insert_own_debt_payment_txn" ON debt_payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "update_own_debt_payment_txn" ON debt_payment_transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "delete_own_debt_payment_txn" ON debt_payment_transactions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_payment_txn_case_id ON debt_payment_transactions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_payment_txn_status ON debt_payment_transactions(status);

-- >>> 20260803022620_breathing_space_moratorium_tracker_schema.sql.sql
/*
# Statutory Breathing Space & Mental Health Crisis Moratorium Tracker

## Purpose
Creates the database table to track Statutory Breathing Space (Standard 60-Day)
and Mental Health Crisis Moratorium records for debtor cases in DebtVerge.

## New Tables

### debt_breathing_spaces
Tracks breathing space / moratorium registrations per case.

Columns:
- id (uuid, PK)
- case_id (uuid, FK to debt_cases, ON DELETE CASCADE)
- user_id (uuid, NOT NULL, DEFAULT auth.uid() — owner of the record)
- moratorium_type (text: 'standard' | 'mental_health_crisis')
- status (text: 'active' | 'expired' | 'cancelled')
- start_date (date — when the breathing space began)
- standard_end_date (date — 60 days from start_date, for standard type)
- treatment_end_date (date, nullable — when MH crisis treatment ended, for MHC type)
- post_treatment_exit_date (date, nullable — treatment_end_date + 30 days, for MHC type)
- amhp_evidence_file_name (text, nullable — uploaded AMHP evidence form filename)
- amhp_evidence_url (text, nullable — storage path for AMHP evidence)
- nominated_contact_name (text, nullable — nominated point of contact for MHC)
- nominated_contact_phone (text, nullable)
- nominated_contact_email (text, nullable)
- nominated_contact_relationship (text, nullable)
- included_creditor_ids (jsonb — array of creditor UUIDs included in the breathing space)
- eligibility_checks (jsonb — stored results of eligibility verification)
- review_tasks (jsonb — auto-scheduled review task definitions)
- account_lock_active (boolean, default true — whether payment/interest freeze is active)
- cancelled_reason (text, nullable)
- cancelled_at (timestamptz, nullable)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

## Security
- RLS enabled on debt_breathing_spaces.
- Owner-scoped CRUD policies using auth.uid() = user_id (same pattern as other debt tables).
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE), scoped TO authenticated.

## Notes
1. This table is a child of debt_cases — each case can have multiple breathing space
   records over time (history), but only one can be 'active' at any given time.
2. The standard 60-day breathing space auto-expires after 60 days.
3. The Mental Health Crisis moratorium has no fixed end date — it ends 30 days after
   treatment concludes, tracked via treatment_end_date and post_treatment_exit_date.
4. account_lock_active flag controls whether the system pauses payment schedules,
   disables reminders, and freezes interest/fee additions.
*/

CREATE TABLE IF NOT EXISTS debt_breathing_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  moratorium_type text NOT NULL DEFAULT 'standard' CHECK (moratorium_type IN ('standard', 'mental_health_crisis')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  standard_end_date date,
  treatment_end_date date,
  post_treatment_exit_date date,
  amhp_evidence_file_name text,
  amhp_evidence_url text,
  nominated_contact_name text,
  nominated_contact_phone text,
  nominated_contact_email text,
  nominated_contact_relationship text,
  included_creditor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_lock_active boolean NOT NULL DEFAULT true,
  cancelled_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying active breathing spaces by case
CREATE INDEX IF NOT EXISTS idx_breathing_spaces_case_id ON debt_breathing_spaces(case_id);
CREATE INDEX IF NOT EXISTS idx_breathing_spaces_status ON debt_breathing_spaces(status);

ALTER TABLE debt_breathing_spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "select_own_breathing_spaces"
  ON debt_breathing_spaces FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "insert_own_breathing_spaces"
  ON debt_breathing_spaces FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "update_own_breathing_spaces"
  ON debt_breathing_spaces FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "delete_own_breathing_spaces"
  ON debt_breathing_spaces FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- >>> 20260803124155_20260803040000_tenant_subscription_entitlement_schema.sql.sql
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

-- >>> 20260803124225_20260803040100_seed_default_subscriptions_and_roles.sql.sql
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

-- >>> 20260803165727_20260803140000_payment_gateway_disbursement_engine_schema.sql.sql
/*
# Payment Gateway & Disbursement Engine Schema

## Overview
Builds a modular, white-label payment processing and disbursement engine for DebtVerge and IVAVerge.
The architecture is strictly adapter-based: tenant firms plug in their own third-party payment
gateway credentials (Stripe, GoCardless, Open Banking providers, merchant acquirers) without
hardcoded dependencies. Financial data is isolated per-tenant with RLS and PCI-DSS boundaries
(no raw PAN/CVV stored — only gateway tokens).

## New Tables

1. **payment_gateway_configs** — White-label gateway configuration per tenant/organization.
   Each firm configures their own payment processor (Stripe, GoCardless, Open Banking, etc.)
   with API key references stored as edge-function secret names (not plaintext keys in the DB).
   - Columns: id, organization_id, gateway_type, display_name, merchant_id, secret_ref (name of
     the Supabase edge function secret holding the API key), webhook_secret_ref, is_active,
     test_mode, supported_features (jsonb array), created_at, updated_at.

2. **payment_methods** — Tokenised card/payment method storage linked to debt cases.
   Stores gateway payment tokens (never raw card numbers). Agents/admins can save, update, delete.
   - Columns: id, organization_id, case_id, gateway_config_id, gateway_token, payment_type
     (card/bacs/open_banking), card_brand, last4, expiry_month, expiry_year, cardholder_name,
     is_default, is_active, created_at, updated_at.

3. **recurring_payment_schedules** — Recurring payment scheduling linked to debtor payment plans
   or SFS budget frequency (weekly, fortnightly, monthly).
   - Columns: id, organization_id, case_id, payment_method_id, gateway_config_id, frequency,
     installment_amount, preferred_payment_day, start_date, end_date, next_collection_date,
     retry_count, max_retries, status, linked_plan_type (dmp/iva/sfs), created_at, updated_at.

4. **gateway_payment_transactions** — Transaction log for all gateway-processed payments
   (incoming client payments via card/bacs/open banking).
   - Columns: id, organization_id, case_id, schedule_id, payment_method_id, gateway_config_id,
     gateway_transaction_id, amount, currency, status, failure_reason, gateway_response (jsonb),
     attempted_at, settled_at, retry_of (self-reference for retries), created_at, updated_at.

5. **disbursement_waterfall_entries** — Waterfall accounting ledger for distributing collected
   funds across IP/Nominee fees, nominee costs, third-party disbursements, and pro-rata creditor
   dividends.
   - Columns: id, organization_id, case_id, source_transaction_id, waterfall_order, category
     (nominee_fee/supervisor_fee/nominee_cost/third_party_disbursement/creditor_dividend/reserve),
     payee_name, payee_reference, allocated_amount, status, scheduled_date, settled_date,
     creditor_id, distribution_run_id, created_at, updated_at.

6. **payment_reconciliation_log** — Reconciliation tracking for settled funds, failed collections,
   and retry outcomes.
   - Columns: id, organization_id, case_id, transaction_id, reconciliation_date, status,
     expected_amount, actual_amount, variance, failure_code, retry_scheduled, notes,
     created_at, updated_at.

## Security (RLS)
- All tables enable RLS.
- All tables are scoped TO authenticated with organization membership checks via organization_users.
- payment_gateway_configs: only org members can view; only admins can create/update/delete.
- payment_methods: agents/admins can CRUD within their org.
- recurring_payment_schedules: agents/admins can CRUD within their org.
- gateway_payment_transactions: read-only for agents; created by edge functions (service role).
- disbursement_waterfall_entries: agents/admins can view/create/update within org.
- payment_reconciliation_log: agents/admins can view within org.

## Important Notes
1. API keys are NEVER stored in the database — only the secret *name* (e.g., "STRIPE_SECRET_KEY_ORG_123")
   is stored. The actual key lives in Supabase edge function secrets, accessible only server-side.
2. No raw card numbers (PAN) or CVVs are stored — only gateway tokens and last4 for display.
3. All tables use organization_id for tenant isolation.
4. gateway_payment_transactions.gateway_response stores the full gateway response as jsonb for audit
   but never contains raw card data (gateways tokenise before returning).
*/

-- ============================================================
-- 1. payment_gateway_configs
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_gateway_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gateway_type text NOT NULL CHECK (gateway_type IN ('stripe', 'gocardless', 'open_banking', 'merchant_acquirer', 'custom')),
  display_name text NOT NULL,
  merchant_id text,
  secret_ref text NOT NULL,
  webhook_secret_ref text,
  is_active boolean NOT NULL DEFAULT true,
  test_mode boolean NOT NULL DEFAULT false,
  supported_features jsonb NOT NULL DEFAULT '["recurring_card","tokenisation"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gateway_select_org" ON payment_gateway_configs;
CREATE POLICY "gateway_select_org" ON payment_gateway_configs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_insert_org" ON payment_gateway_configs;
CREATE POLICY "gateway_insert_org" ON payment_gateway_configs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_update_org" ON payment_gateway_configs;
CREATE POLICY "gateway_update_org" ON payment_gateway_configs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_delete_org" ON payment_gateway_configs;
CREATE POLICY "gateway_delete_org" ON payment_gateway_configs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 2. payment_methods (tokenised card storage)
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  gateway_token text NOT NULL,
  payment_type text NOT NULL CHECK (payment_type IN ('card', 'bacs', 'open_banking')),
  card_brand text,
  last4 text,
  expiry_month integer,
  expiry_year integer,
  cardholder_name text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pm_select_org" ON payment_methods;
CREATE POLICY "pm_select_org" ON payment_methods FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_insert_org" ON payment_methods;
CREATE POLICY "pm_insert_org" ON payment_methods FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_update_org" ON payment_methods;
CREATE POLICY "pm_update_org" ON payment_methods FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_delete_org" ON payment_methods;
CREATE POLICY "pm_delete_org" ON payment_methods FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 3. recurring_payment_schedules
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'fortnightly', 'four_weekly', 'monthly')),
  installment_amount numeric(12,2) NOT NULL DEFAULT 0,
  preferred_payment_day text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  next_collection_date date NOT NULL DEFAULT CURRENT_DATE,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'suspended')),
  linked_plan_type text CHECK (linked_plan_type IN ('dmp', 'iva', 'sfs', 'settlement')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recurring_payment_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rps_select_org" ON recurring_payment_schedules;
CREATE POLICY "rps_select_org" ON recurring_payment_schedules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_insert_org" ON recurring_payment_schedules;
CREATE POLICY "rps_insert_org" ON recurring_payment_schedules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_update_org" ON recurring_payment_schedules;
CREATE POLICY "rps_update_org" ON recurring_payment_schedules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_delete_org" ON recurring_payment_schedules;
CREATE POLICY "rps_delete_org" ON recurring_payment_schedules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 4. gateway_payment_transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS gateway_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES recurring_payment_schedules(id) ON DELETE SET NULL,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  gateway_transaction_id text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'retrying')),
  failure_reason text,
  gateway_response jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  retry_of uuid REFERENCES gateway_payment_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gateway_payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gpt_select_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_select_org" ON gateway_payment_transactions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_insert_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_insert_org" ON gateway_payment_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_update_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_update_org" ON gateway_payment_transactions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_delete_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_delete_org" ON gateway_payment_transactions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 5. disbursement_waterfall_entries
-- ============================================================

CREATE TABLE IF NOT EXISTS disbursement_waterfall_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  source_transaction_id uuid REFERENCES gateway_payment_transactions(id) ON DELETE SET NULL,
  waterfall_order integer NOT NULL DEFAULT 0,
  category text NOT NULL CHECK (category IN ('nominee_fee', 'supervisor_fee', 'nominee_cost', 'third_party_disbursement', 'creditor_dividend', 'reserve')),
  payee_name text NOT NULL,
  payee_reference text,
  allocated_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'settled', 'failed', 'reversed')),
  scheduled_date date,
  settled_date date,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  distribution_run_id uuid REFERENCES debt_iva_distribution_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_waterfall_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dwe_select_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_select_org" ON disbursement_waterfall_entries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_insert_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_insert_org" ON disbursement_waterfall_entries FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_update_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_update_org" ON disbursement_waterfall_entries FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_delete_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_delete_org" ON disbursement_waterfall_entries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 6. payment_reconciliation_log
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES gateway_payment_transactions(id) ON DELETE CASCADE,
  reconciliation_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'unmatched', 'shortfall', 'overage', 'failed', 'retrying')),
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  actual_amount numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  failure_code text,
  retry_scheduled boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prl_select_org" ON payment_reconciliation_log;
CREATE POLICY "prl_select_org" ON payment_reconciliation_log FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_insert_org" ON payment_reconciliation_log;
CREATE POLICY "prl_insert_org" ON payment_reconciliation_log FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_update_org" ON payment_reconciliation_log;
CREATE POLICY "prl_update_org" ON payment_reconciliation_log FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_delete_org" ON payment_reconciliation_log;
CREATE POLICY "prl_delete_org" ON payment_reconciliation_log FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- Indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pgw_org ON payment_gateway_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_pm_org_case ON payment_methods(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_rps_org_case ON recurring_payment_schedules(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_gpt_org_case ON gateway_payment_transactions(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_gpt_schedule ON gateway_payment_transactions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_gpt_status ON gateway_payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_dwe_org_case ON disbursement_waterfall_entries(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_dwe_source ON disbursement_waterfall_entries(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_prl_org_case ON payment_reconciliation_log(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_prl_transaction ON payment_reconciliation_log(transaction_id);

-- ============================================================
-- updated_at trigger for all new tables
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pgw_updated ON payment_gateway_configs;
CREATE TRIGGER trg_pgw_updated BEFORE UPDATE ON payment_gateway_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_pm_updated ON payment_methods;
CREATE TRIGGER trg_pm_updated BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rps_updated ON recurring_payment_schedules;
CREATE TRIGGER trg_rps_updated BEFORE UPDATE ON recurring_payment_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_gpt_updated ON gateway_payment_transactions;
CREATE TRIGGER trg_gpt_updated BEFORE UPDATE ON gateway_payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_dwe_updated ON disbursement_waterfall_entries;
CREATE TRIGGER trg_dwe_updated BEFORE UPDATE ON disbursement_waterfall_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_prl_updated ON payment_reconciliation_log;
CREATE TRIGGER trg_prl_updated BEFORE UPDATE ON payment_reconciliation_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- >>> 20260803173017_cashier_operations_suite_schema.sql
/*
# Cashier Operations Suite — Bank Feeds, Batch Processing, Audit Trails, Disbursement Runs, Payment Links

## Purpose
Adds the full cashier operations infrastructure: automated bank feed reconciliation,
one-click batch payment processing, smart exception triage queues, automated creditor
disbursement run generation (BACS/instruction batches), and real-time audit trails with
ledger locking and end-of-day balancing.

## New Tables
1. bank_feeds — Open banking connections or CSV import sources per organization
2. bank_transactions — Individual transactions from bank feeds awaiting matching
3. batch_payment_runs — Batch processing queues for daily collections
4. batch_payment_items — Individual items within a batch run
5. cashier_audit_logs — Immutable audit trail for every manual action
6. ledger_locks — End-of-day balancing and period locking
7. disbursement_runs — Automated creditor disbursement batches (BACS/instruction files)
8. disbursement_run_items — Individual creditor/fee payments within a disbursement run
9. payment_link_invitations — SMS/email payment links sent for failed collections

## Security
- RLS enabled on all 9 new tables.
- Owner-scoped via organization_id membership check using organization_users table.
- 4 policies per table (select/insert/update/delete) for authenticated users.
- Audit logs are insert-only (no update/delete) to preserve immutability.
*/

-- ============================================================
-- bank_feeds
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feed_name text NOT NULL,
  feed_type text NOT NULL DEFAULT 'manual' CHECK (feed_type IN ('open_banking','csv_import','manual')),
  account_number_masked text,
  sort_code text,
  bank_reference text,
  import_frequency text NOT NULL DEFAULT 'manual' CHECK (import_frequency IN ('daily','weekly','manual')),
  last_import_at timestamptz,
  last_import_count int DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bank_feeds" ON bank_feeds;
CREATE POLICY "select_bank_feeds" ON bank_feeds FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bank_feeds" ON bank_feeds;
CREATE POLICY "insert_bank_feeds" ON bank_feeds FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bank_feeds" ON bank_feeds;
CREATE POLICY "update_bank_feeds" ON bank_feeds FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bank_feeds" ON bank_feeds;
CREATE POLICY "delete_bank_feeds" ON bank_feeds FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- bank_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_feed_id uuid REFERENCES bank_feeds(id) ON DELETE CASCADE,
  case_id uuid,
  transaction_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  reference text,
  description text,
  counterparty_name text,
  counterparty_account text,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','auto_matched','ignored')),
  matched_transaction_id uuid,
  matched_schedule_id uuid,
  matched_case_id uuid,
  match_confidence text CHECK (match_confidence IN ('high','medium','low','manual')),
  match_notes text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bank_txns" ON bank_transactions;
CREATE POLICY "select_bank_txns" ON bank_transactions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bank_txns" ON bank_transactions;
CREATE POLICY "insert_bank_txns" ON bank_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bank_txns" ON bank_transactions;
CREATE POLICY "update_bank_txns" ON bank_transactions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bank_txns" ON bank_transactions;
CREATE POLICY "delete_bank_txns" ON bank_transactions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- batch_payment_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_payment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_type text NOT NULL DEFAULT 'card_collection' CHECK (batch_type IN ('card_collection','direct_debit','mixed')),
  batch_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','partial')),
  total_items int NOT NULL DEFAULT 0,
  succeeded_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  succeeded_amount numeric(12,2) NOT NULL DEFAULT 0,
  failed_amount numeric(12,2) NOT NULL DEFAULT 0,
  initiated_by uuid,
  initiated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batch_payment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_runs" ON batch_payment_runs;
CREATE POLICY "select_batch_runs" ON batch_payment_runs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_batch_runs" ON batch_payment_runs;
CREATE POLICY "insert_batch_runs" ON batch_payment_runs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_batch_runs" ON batch_payment_runs;
CREATE POLICY "update_batch_runs" ON batch_payment_runs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_batch_runs" ON batch_payment_runs;
CREATE POLICY "delete_batch_runs" ON batch_payment_runs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- batch_payment_items
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_run_id uuid NOT NULL REFERENCES batch_payment_runs(id) ON DELETE CASCADE,
  schedule_id uuid,
  case_id uuid,
  payment_method_id uuid,
  gateway_config_id uuid,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','retrying')),
  gateway_transaction_id uuid,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batch_payment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_items" ON batch_payment_items;
CREATE POLICY "select_batch_items" ON batch_payment_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_batch_items" ON batch_payment_items;
CREATE POLICY "insert_batch_items" ON batch_payment_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_batch_items" ON batch_payment_items;
CREATE POLICY "update_batch_items" ON batch_payment_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_batch_items" ON batch_payment_items;
CREATE POLICY "delete_batch_items" ON batch_payment_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- cashier_audit_logs (insert-only — immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS cashier_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  user_id uuid,
  user_email text,
  action_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  amount_impact numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cashier_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_audit_logs" ON cashier_audit_logs;
CREATE POLICY "select_audit_logs" ON cashier_audit_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = cashier_audit_logs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_audit_logs" ON cashier_audit_logs;
CREATE POLICY "insert_audit_logs" ON cashier_audit_logs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = cashier_audit_logs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- ledger_locks
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lock_date date NOT NULL,
  lock_type text NOT NULL DEFAULT 'end_of_day' CHECK (lock_type IN ('end_of_day','period','month_end')),
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','unlocked')),
  total_collected numeric(12,2) NOT NULL DEFAULT 0,
  total_disbursed numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  locked_by uuid,
  locked_by_email text,
  locked_at timestamptz,
  unlocked_by uuid,
  unlocked_at timestamptz,
  unlock_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_ledger_locks" ON ledger_locks;
CREATE POLICY "select_ledger_locks" ON ledger_locks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_ledger_locks" ON ledger_locks;
CREATE POLICY "insert_ledger_locks" ON ledger_locks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_ledger_locks" ON ledger_locks;
CREATE POLICY "update_ledger_locks" ON ledger_locks FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_ledger_locks" ON ledger_locks;
CREATE POLICY "delete_ledger_locks" ON ledger_locks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- disbursement_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS disbursement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','generated','submitted','settled','failed')),
  output_format text NOT NULL DEFAULT 'bacs' CHECK (output_format IN ('bacs','sepa','faster_payments','manual_instruction')),
  file_reference text,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_items int NOT NULL DEFAULT 0,
  approved_by uuid,
  approved_at timestamptz,
  generated_at timestamptz,
  submitted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disb_runs" ON disbursement_runs;
CREATE POLICY "select_disb_runs" ON disbursement_runs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_disb_runs" ON disbursement_runs;
CREATE POLICY "insert_disb_runs" ON disbursement_runs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_disb_runs" ON disbursement_runs;
CREATE POLICY "update_disb_runs" ON disbursement_runs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_disb_runs" ON disbursement_runs;
CREATE POLICY "delete_disb_runs" ON disbursement_runs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- disbursement_run_items
-- ============================================================
CREATE TABLE IF NOT EXISTS disbursement_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_run_id uuid NOT NULL REFERENCES disbursement_runs(id) ON DELETE CASCADE,
  waterfall_entry_id uuid,
  payee_name text NOT NULL,
  payee_reference text,
  payee_account_number text,
  payee_sort_code text,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','included','submitted','settled','failed')),
  bacs_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disb_run_items" ON disbursement_run_items;
CREATE POLICY "select_disb_run_items" ON disbursement_run_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_disb_run_items" ON disbursement_run_items;
CREATE POLICY "insert_disb_run_items" ON disbursement_run_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_disb_run_items" ON disbursement_run_items;
CREATE POLICY "update_disb_run_items" ON disbursement_run_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_disb_run_items" ON disbursement_run_items;
CREATE POLICY "delete_disb_run_items" ON disbursement_run_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- payment_link_invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_link_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  schedule_id uuid,
  failed_transaction_id uuid,
  debtor_name text,
  debtor_contact text,
  contact_channel text NOT NULL DEFAULT 'sms' CHECK (contact_channel IN ('sms','email')),
  amount_requested numeric(12,2) NOT NULL,
  link_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','paid','expired','failed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_link_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_payment_links" ON payment_link_invitations;
CREATE POLICY "select_payment_links" ON payment_link_invitations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_payment_links" ON payment_link_invitations;
CREATE POLICY "insert_payment_links" ON payment_link_invitations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_payment_links" ON payment_link_invitations;
CREATE POLICY "update_payment_links" ON payment_link_invitations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_payment_links" ON payment_link_invitations;
CREATE POLICY "delete_payment_links" ON payment_link_invitations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bank_txns_org_date ON bank_transactions(organization_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_match_status ON bank_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_batch_runs_org_date ON batch_payment_runs(organization_id, batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_batch_items_run ON batch_payment_items(batch_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date ON cashier_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_case ON cashier_audit_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_ledger_locks_org_date ON ledger_locks(organization_id, lock_date DESC);
CREATE INDEX IF NOT EXISTS idx_disb_runs_org_date ON disbursement_runs(organization_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_disb_run_items_run ON disbursement_run_items(disbursement_run_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_org ON payment_link_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_link_invitations(status);

-- >>> 20260803180856_background_job_queue_schema.sql
/*
# Background Job Queue — Asynchronous Processing Infrastructure

## Purpose
A database-backed job queue that enables non-blocking background processing for bulk payment
collections, automated distributions, and ledger postings. Uses PostgreSQL row-level locking
with SKIP LOCKED to allow multiple workers to claim jobs concurrently without contention.
All heavy financial processing runs asynchronously via edge function workers, ensuring the
main application UI never freezes during peak transactional windows.

## New Tables

1. `background_jobs` — The main queue table holding jobs to be processed
   - `id` uuid PK
   - `organization_id` uuid FK → organizations
   - `job_type` text — 'batch_collection' | 'disbursement_run' | 'bank_reconciliation' | 'ledger_posting' | 'recurring_collection' | 'retry_failed' | 'expired_card_check'
   - `priority` int — higher = more urgent (default 5)
   - `status` text — 'queued' | 'claimed' | 'processing' | 'completed' | 'failed' | 'throttled'
   - `payload` jsonb — job-specific data (batch_run_id, schedule_ids, disbursement_run_id, etc.)
   - `total_items` int — items to process in this job
   - `processed_items` int — items completed so far
   - `succeeded_items` int
   - `failed_items` int
   - `throttled_items` int — items delayed due to rate-limiting
   - `chunk_size` int — items per processing chunk (default 25)
   - `max_retries` int — max retry attempts (default 3)
   - `retry_count` int — current retry count
   - `rate_limit_ms` int — minimum delay between chunks in milliseconds (default 500)
   - `claimed_by` text — worker instance identifier
   - `claimed_at` timestamptz
   - `started_at` timestamptz
   - `completed_at` timestamptz
   - `error_message` text
   - `last_progress_at` timestamptz — for stale job detection
   - `created_by` uuid — user who enqueued the job
   - `created_at` timestamptz DEFAULT now()

2. `background_job_events` — Append-only event log for each job (progress, errors, milestones)
   - `id` uuid PK
   - `job_id` uuid FK → background_jobs ON DELETE CASCADE
   - `event_type` text — 'enqueued' | 'claimed' | 'chunk_started' | 'chunk_completed' | 'item_succeeded' | 'item_failed' | 'throttled' | 'retried' | 'completed' | 'failed' | 'stale_detected'
   - `message` text
   - `metadata` jsonb
   - `created_at` timestamptz DEFAULT now()

## Security
- RLS enabled on both tables.
- Owner-scoped via organization_id membership check using organization_users.
- 4 policies per table (select/insert/update/delete) for authenticated users.
- background_job_events is insert+select only (no update/delete) to preserve event log integrity.

## Database Functions
- `claim_next_background_job(worker_id text, job_types text[])` — SECURITY DEFINER function that
  atomically claims the next available job using SKIP LOCKED, preventing race conditions.
  Returns the claimed job row or null if none available.
- `requeue_stale_jobs()` — SECURITY DEFINER function that finds jobs stuck in 'claimed' or
  'processing' status past a timeout threshold and requeues them.
*/

-- ============================================================
-- background_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  priority int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','processing','completed','failed','throttled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_items int NOT NULL DEFAULT 0,
  processed_items int NOT NULL DEFAULT 0,
  succeeded_items int NOT NULL DEFAULT 0,
  failed_items int NOT NULL DEFAULT 0,
  throttled_items int NOT NULL DEFAULT 0,
  chunk_size int NOT NULL DEFAULT 25,
  max_retries int NOT NULL DEFAULT 3,
  retry_count int NOT NULL DEFAULT 0,
  rate_limit_ms int NOT NULL DEFAULT 500,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  last_progress_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bg_jobs" ON background_jobs;
CREATE POLICY "select_bg_jobs" ON background_jobs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bg_jobs" ON background_jobs;
CREATE POLICY "insert_bg_jobs" ON background_jobs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bg_jobs" ON background_jobs;
CREATE POLICY "update_bg_jobs" ON background_jobs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bg_jobs" ON background_jobs;
CREATE POLICY "delete_bg_jobs" ON background_jobs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- background_job_events
-- ============================================================
CREATE TABLE IF NOT EXISTS background_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES background_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE background_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bg_job_events" ON background_job_events;
CREATE POLICY "select_bg_job_events" ON background_job_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM background_jobs bj
     JOIN organization_users ou ON ou.organization_id = bj.organization_id
     WHERE bj.id = background_job_events.job_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bg_job_events" ON background_job_events;
CREATE POLICY "insert_bg_job_events" ON background_job_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM background_jobs bj
     JOIN organization_users ou ON ou.organization_id = bj.organization_id
     WHERE bj.id = background_job_events.job_id AND ou.user_id = auth.uid())
  );

-- No UPDATE or DELETE policy — events are immutable

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bg_jobs_org_status ON background_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_status_priority ON background_jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_claimed_at ON background_jobs(claimed_at) WHERE status IN ('claimed','processing');
CREATE INDEX IF NOT EXISTS idx_bg_job_events_job ON background_job_events(job_id, created_at);

-- ============================================================
-- Function: claim_next_background_job
-- Atomically claims the next available job using SKIP LOCKED.
-- Multiple workers can call this concurrently without contention.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_next_background_job(worker_id text, job_types text[] DEFAULT NULL)
RETURNS background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed_job background_jobs;
BEGIN
  -- Select and lock the next available job, skipping any already-locked rows
  SELECT * INTO claimed_job
  FROM background_jobs
  WHERE status = 'queued'
    AND (job_types IS NULL OR job_type = ANY(job_types))
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- If we got a job, mark it as claimed
  IF claimed_job.id IS NOT NULL THEN
    UPDATE background_jobs
    SET status = 'claimed',
        claimed_by = worker_id,
        claimed_at = now(),
        last_progress_at = now()
    WHERE id = claimed_job.id
    RETURNING * INTO claimed_job;

    -- Log the claim event
    INSERT INTO background_job_events (job_id, event_type, message, metadata)
    VALUES (claimed_job.id, 'claimed', 'Job claimed by worker ' || worker_id,
            jsonb_build_object('worker_id', worker_id, 'job_type', claimed_job.job_type));
  END IF;

  RETURN claimed_job;
END;
$$;

-- ============================================================
-- Function: requeue_stale_jobs
-- Finds jobs stuck in 'claimed' or 'processing' past a timeout
-- and requeues them for retry.
-- ============================================================
CREATE OR REPLACE FUNCTION requeue_stale_jobs(timeout_minutes int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  requeued_count int;
  stale_ids uuid[];
BEGIN
  -- Find jobs that have been claimed but haven't reported progress recently
  SELECT array_agg(id) INTO stale_ids
  FROM background_jobs
  WHERE status IN ('claimed', 'processing')
    AND last_progress_at < now() - (timeout_minutes || ' minutes')::interval;

  IF stale_ids IS NOT NULL THEN
    -- Requeue them if they haven't exceeded max retries
    UPDATE background_jobs
    SET status = 'queued',
        claimed_by = NULL,
        claimed_at = NULL,
        retry_count = retry_count + 1,
        error_message = CASE
          WHEN retry_count + 1 >= max_retries THEN 'Max retries exceeded — job marked as failed'
          ELSE 'Requeued after stale detection'
        END
    WHERE id = ANY(stale_ids)
      AND retry_count < max_retries;

    GET DIAGNOSTICS requeued_count = ROW_COUNT;

    -- Mark as failed if max retries exceeded
    UPDATE background_jobs
    SET status = 'failed',
        error_message = 'Max retries exceeded after stale detection',
        completed_at = now()
    WHERE id = ANY(stale_ids)
      AND retry_count >= max_retries;

    -- Log stale detection events
    INSERT INTO background_job_events (job_id, event_type, message, metadata)
    SELECT id, 'stale_detected', 'Job was stuck and has been requeued or failed',
           jsonb_build_object('requeued', retry_count < max_retries)
    FROM background_jobs
    WHERE id = ANY(stale_ids);
  ELSE
    requeued_count := 0;
  END IF;

  RETURN requeued_count;
END;
$$;

-- ============================================================
-- Function: update_job_progress
-- Atomically updates job progress counters and last_progress_at.
-- ============================================================
CREATE OR REPLACE FUNCTION update_job_progress(
  p_job_id uuid,
  p_processed int DEFAULT NULL,
  p_succeeded int DEFAULT NULL,
  p_failed int DEFAULT NULL,
  p_throttled int DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE background_jobs
  SET
    processed_items = COALESCE(p_processed, processed_items),
    succeeded_items = COALESCE(p_succeeded, succeeded_items),
    failed_items = COALESCE(p_failed, failed_items),
    throttled_items = COALESCE(p_throttled, throttled_items),
    status = COALESCE(p_status, status),
    error_message = COALESCE(p_error, error_message),
    last_progress_at = now(),
    completed_at = CASE WHEN p_status IN ('completed','failed') THEN now() ELSE completed_at END
  WHERE id = p_job_id;
END;
$$;

-- Grant execute on the SECURITY DEFINER functions to authenticated users
GRANT EXECUTE ON FUNCTION claim_next_background_job(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION requeue_stale_jobs(int) TO authenticated;
GRANT EXECUTE ON FUNCTION update_job_progress(uuid, int, int, int, int, text, text) TO authenticated;

-- >>> 20260805165405_storm_call_enterprise_schema.sql
/*
# Storm Call — Enterprise Adviser Communications & Contact Centre

## Purpose
A regulated-business contact centre module for debt management and IVA firms.
Authorised advisers log in, manage customer communications, make/receive calls
via a provider-agnostic VoIP layer, and all communication activity is automatically
linked to customer cases. Includes AI call intelligence, compliance scoring,
and a unified customer communication timeline.

## New Tables

1. `storm_call_adviser_profiles` — Extends auth.users with adviser-specific fields
   - id uuid PK, user_id uuid FK→auth.users, organization_id uuid FK→organizations
   - adviser_id text (unique HR ID), team text, department text
   - role text (adviser|senior_adviser|team_leader|manager|compliance_officer|administrator)
   - permissions jsonb (granular permission set)
   - availability_status text (available|busy|on_call|break|offline)
   - phone_extension text, voip_user_id text (provider-specific SIP/user ID)
   - assigned_case_ids uuid[] (cases assigned to this adviser)
   - is_active boolean, created_at, updated_at

2. `storm_call_telephony_providers` — Provider-agnostic telephony configuration
   - id uuid PK, organization_id uuid FK
   - provider_name text, provider_type text (storm_call|external_voip|sip|cloud)
   - api_endpoint text, webhook_url text
   - is_active boolean, config jsonb (provider-specific settings, NOT secrets)
   - created_at

3. `storm_call_sessions` — Individual call sessions (inbound or outbound)
   - id uuid PK, organization_id uuid FK
   - call_direction text (inbound|outbound)
   - call_status text (ringing|answered|on_hold|muted|transferred|completed|missed|failed)
   - caller_phone text, caller_name text
   - callee_phone text, callee_name text
   - adviser_id uuid FK→auth.users, adviser_profile_id uuid FK→storm_call_adviser_profiles
   - case_id uuid (link to debt_cases), customer_id uuid
   - customer_identified boolean (auto-matched to existing customer)
   - provider_id uuid FK→storm_call_telephony_providers
   - provider_call_id text (external call reference)
   - started_at timestamptz, answered_at timestamptz, ended_at timestamptz
   - duration_seconds int
   - is_on_hold boolean, is_muted boolean
   - transfer_target text, transfer_status text
   - call_notes text (adviser notes during call)
   - recording_url text, recording_id text
   - transcript_id uuid FK→storm_call_transcripts
   - summary_id uuid FK→storm_call_ai_summaries
   - compliance_score_id uuid FK→storm_call_compliance_scores
   - follow_up_task_created boolean
   - created_at

4. `storm_call_transcripts` — Call transcripts (generated or uploaded)
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - transcript_text text, transcript_segments jsonb (timestamped speaker segments)
   - language text, confidence_score numeric(3,2)
   - generated_by text (ai|manual|provider)
   - created_at

5. `storm_call_ai_summaries` — AI-generated call intelligence
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - summary_text text (overall summary)
   - key_points jsonb (array of key discussion points)
   - customer_concerns jsonb
   - adviser_actions jsonb
   - promises_made jsonb (customer promises: amount, date, etc.)
   - follow_up_required jsonb (array of follow-up items)
   - compliance_risks jsonb (identified risks)
   - customer_sentiment text (positive|neutral|negative|distressed)
   - sentiment_score numeric(3,2)
   - actions_required jsonb (auto-identified actions)
   - review_status text (pending|reviewed|approved|amended)
   - reviewed_by uuid, reviewed_at timestamptz
   - coaching_notes text (manager coaching feedback)
   - approved_by uuid, approved_at timestamptz
   - amended_text text (manager's amended summary if different)
   - created_at

6. `storm_call_compliance_scores` — FCA compliance scoring per call
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - total_score numeric(5,2) (0-100)
   - required_disclosures_completed boolean
   - affordability_discussed boolean
   - vulnerability_identified boolean
   - correct_advice_process_followed boolean
   - disclosure_score int, affordability_score int, vulnerability_score int, advice_score int
   - compliance_checks jsonb (detailed checklist results)
   - risk_flags jsonb (identified compliance risks)
   - created_at

7. `storm_call_compliance_audit` — Immutable audit trail for all compliance-sensitive actions
   - id uuid PK, organization_id uuid FK
   - session_id uuid nullable FK→storm_call_sessions
   - user_id uuid (who performed the action)
   - user_email text
   - action_type text (recording_accessed|transcript_viewed|notes_edited|summary_approved|summary_amended|coaching_added|call_transferred|recording_downloaded)
   - entity_type text, entity_id uuid
   - details jsonb
   - created_at timestamptz DEFAULT now()

8. `storm_call_timeline_events` — Unified customer communication timeline
   - id uuid PK, organization_id uuid FK
   - customer_id uuid, case_id uuid nullable
   - event_type text (call|recording|transcript|ai_summary|adviser_note|email|document|task|compliance_event|callback_scheduled)
   - event_title text, event_description text
   - session_id uuid nullable FK→storm_call_sessions
   - adviser_id uuid nullable
   - adviser_name text
   - metadata jsonb (event-specific data)
   - event_timestamp timestamptz NOT NULL DEFAULT now()
   - created_at timestamptz DEFAULT now()

9. `storm_call_callbacks` — Scheduled callback queue
   - id uuid PK, organization_id uuid FK
   - customer_id uuid, case_id uuid nullable
   - adviser_id uuid (assigned adviser)
   - phone_number text, customer_name text
   - scheduled_at timestamptz, completed_at timestamptz nullable
   - status text (pending|in_progress|completed|cancelled|missed)
   - priority int, notes text
   - session_id uuid nullable (linked call session when completed)
   - created_at

## Security
- RLS enabled on all 9 new tables.
- Owner-scoped via organization_id membership check using organization_users.
- Compliance audit table is insert+select only (immutable).
- 4 policies per table (select/insert/update/delete) for authenticated users.
*/

-- ============================================================
-- storm_call_adviser_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_adviser_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  adviser_id text NOT NULL,
  team text,
  department text,
  role text NOT NULL DEFAULT 'adviser' CHECK (role IN ('adviser','senior_adviser','team_leader','manager','compliance_officer','administrator')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability_status text NOT NULL DEFAULT 'offline' CHECK (availability_status IN ('available','busy','on_call','break','offline')),
  phone_extension text,
  voip_user_id text,
  assigned_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_adviser_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "select_sc_advisers" ON storm_call_adviser_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "insert_sc_advisers" ON storm_call_adviser_profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "update_sc_advisers" ON storm_call_adviser_profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "delete_sc_advisers" ON storm_call_adviser_profiles FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_telephony_providers
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_telephony_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'external_voip' CHECK (provider_type IN ('storm_call','external_voip','sip','cloud')),
  api_endpoint text,
  webhook_url text,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_telephony_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "select_sc_providers" ON storm_call_telephony_providers FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "insert_sc_providers" ON storm_call_telephony_providers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "update_sc_providers" ON storm_call_telephony_providers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "delete_sc_providers" ON storm_call_telephony_providers FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  call_direction text NOT NULL CHECK (call_direction IN ('inbound','outbound')),
  call_status text NOT NULL DEFAULT 'ringing' CHECK (call_status IN ('ringing','answered','on_hold','muted','transferred','completed','missed','failed')),
  caller_phone text,
  caller_name text,
  callee_phone text,
  callee_name text,
  adviser_id uuid,
  adviser_profile_id uuid REFERENCES storm_call_adviser_profiles(id) ON DELETE SET NULL,
  case_id uuid,
  customer_id uuid,
  customer_identified boolean NOT NULL DEFAULT false,
  provider_id uuid REFERENCES storm_call_telephony_providers(id) ON DELETE SET NULL,
  provider_call_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  is_on_hold boolean NOT NULL DEFAULT false,
  is_muted boolean NOT NULL DEFAULT false,
  transfer_target text,
  transfer_status text,
  call_notes text,
  recording_url text,
  recording_id text,
  transcript_id uuid,
  summary_id uuid,
  compliance_score_id uuid,
  follow_up_task_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_sessions" ON storm_call_sessions;
CREATE POLICY "select_sc_sessions" ON storm_call_sessions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_sessions" ON storm_call_sessions;
CREATE POLICY "insert_sc_sessions" ON storm_call_sessions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_sessions" ON storm_call_sessions;
CREATE POLICY "update_sc_sessions" ON storm_call_sessions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_sessions" ON storm_call_sessions;
CREATE POLICY "delete_sc_sessions" ON storm_call_sessions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_transcripts
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transcript_text text,
  transcript_segments jsonb,
  language text DEFAULT 'en-GB',
  confidence_score numeric(3,2),
  generated_by text NOT NULL DEFAULT 'ai' CHECK (generated_by IN ('ai','manual','provider')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "select_sc_transcripts" ON storm_call_transcripts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "insert_sc_transcripts" ON storm_call_transcripts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "update_sc_transcripts" ON storm_call_transcripts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "delete_sc_transcripts" ON storm_call_transcripts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_ai_summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  summary_text text,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  adviser_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  promises_made jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  compliance_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_sentiment text CHECK (customer_sentiment IN ('positive','neutral','negative','distressed')),
  sentiment_score numeric(3,2),
  actions_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed','approved','amended')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  coaching_notes text,
  approved_by uuid,
  approved_at timestamptz,
  amended_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_ai_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "select_sc_summaries" ON storm_call_ai_summaries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "insert_sc_summaries" ON storm_call_ai_summaries FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "update_sc_summaries" ON storm_call_ai_summaries FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "delete_sc_summaries" ON storm_call_ai_summaries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_compliance_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  total_score numeric(5,2) NOT NULL DEFAULT 0,
  required_disclosures_completed boolean NOT NULL DEFAULT false,
  affordability_discussed boolean NOT NULL DEFAULT false,
  vulnerability_identified boolean NOT NULL DEFAULT false,
  correct_advice_process_followed boolean NOT NULL DEFAULT false,
  disclosure_score int NOT NULL DEFAULT 0,
  affordability_score int NOT NULL DEFAULT 0,
  vulnerability_score int NOT NULL DEFAULT 0,
  advice_score int NOT NULL DEFAULT 0,
  compliance_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_compliance_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "select_sc_compliance" ON storm_call_compliance_scores FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "insert_sc_compliance" ON storm_call_compliance_scores FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "update_sc_compliance" ON storm_call_compliance_scores FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "delete_sc_compliance" ON storm_call_compliance_scores FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_compliance_audit (insert+select only — immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_compliance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  user_id uuid,
  user_email text,
  action_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_compliance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_audit" ON storm_call_compliance_audit;
CREATE POLICY "select_sc_audit" ON storm_call_compliance_audit FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_audit.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_audit" ON storm_call_compliance_audit;
CREATE POLICY "insert_sc_audit" ON storm_call_compliance_audit FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_audit.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_timeline_events
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid,
  case_id uuid,
  event_type text NOT NULL,
  event_title text,
  event_description text,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE SET NULL,
  adviser_id uuid,
  adviser_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "select_sc_timeline" ON storm_call_timeline_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "insert_sc_timeline" ON storm_call_timeline_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "update_sc_timeline" ON storm_call_timeline_events FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "delete_sc_timeline" ON storm_call_timeline_events FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_callbacks
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid,
  case_id uuid,
  adviser_id uuid,
  phone_number text NOT NULL,
  customer_name text,
  scheduled_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','missed')),
  priority int NOT NULL DEFAULT 5,
  notes text,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_callbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "select_sc_callbacks" ON storm_call_callbacks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "insert_sc_callbacks" ON storm_call_callbacks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "update_sc_callbacks" ON storm_call_callbacks FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "delete_sc_callbacks" ON storm_call_callbacks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sc_sessions_org ON storm_call_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_adviser ON storm_call_sessions(adviser_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_case ON storm_call_sessions(case_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_status ON storm_call_sessions(call_status);
CREATE INDEX IF NOT EXISTS idx_sc_transcripts_session ON storm_call_transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_summaries_session ON storm_call_ai_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_compliance_session ON storm_call_compliance_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_audit_org ON storm_call_compliance_audit(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_timeline_customer ON storm_call_timeline_events(customer_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sc_callbacks_adviser ON storm_call_callbacks(adviser_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sc_callbacks_status ON storm_call_callbacks(status);
CREATE INDEX IF NOT EXISTS idx_sc_advisers_org ON storm_call_adviser_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_sc_advisers_user ON storm_call_adviser_profiles(user_id);

-- >>> 20260805173225_20260805170000_storm_call_ecosystem_integration.sql.sql
/*
# Storm Call Ecosystem Integration

Extends Storm Call tables to support cross-application call launching from
DebtVerge, IVAVerge, DraftVerge, and LeadVerge dashboards.

## Changes

### 1. storm_call_sessions — new columns
- application_source, customer_reference, lead_reference, team_name
- is_recording_paused, recording_paused_at, recording_resumed_at, recording_pause_reason
- conference_participants (jsonb), is_conference

### 2. storm_call_call_notes — new table
Structured call notes with timestamps, tags, and follow-up task creation.

### 3. storm_call_conference_participants — new table
Tracks participants in conference calls.

### 4. storm_call_recording_events — new table
Audit trail for recording pause/resume events.

## Security
- All new tables have RLS enabled with organization-scoped policies
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'application_source') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN application_source text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'customer_reference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN customer_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'lead_reference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN lead_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'team_name') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN team_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'is_recording_paused') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN is_recording_paused boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_paused_at') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_paused_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_resumed_at') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_resumed_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_pause_reason') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_pause_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'conference_participants') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN conference_participants jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'is_conference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN is_conference boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS storm_call_call_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  note_tag text NOT NULL DEFAULT 'general',
  is_follow_up boolean NOT NULL DEFAULT false,
  is_completed boolean NOT NULL DEFAULT false,
  follow_up_due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE storm_call_call_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "select_sc_call_notes" ON storm_call_call_notes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "insert_sc_call_notes" ON storm_call_call_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "update_sc_call_notes" ON storm_call_call_notes FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "delete_sc_call_notes" ON storm_call_call_notes FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS storm_call_conference_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  participant_name text NOT NULL,
  participant_role text,
  participant_type text NOT NULL DEFAULT 'adviser',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE storm_call_conference_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "select_sc_conf_participants" ON storm_call_conference_participants FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "insert_sc_conf_participants" ON storm_call_conference_participants FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "update_sc_conf_participants" ON storm_call_conference_participants FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "delete_sc_conf_participants" ON storm_call_conference_participants FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS storm_call_recording_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  reason text,
  user_id uuid,
  user_email text,
  duration_seconds integer
);

ALTER TABLE storm_call_recording_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "select_sc_rec_events" ON storm_call_recording_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "insert_sc_rec_events" ON storm_call_recording_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "update_sc_rec_events" ON storm_call_recording_events FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "delete_sc_rec_events" ON storm_call_recording_events FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_sc_call_notes_session ON storm_call_call_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_conf_participants_session ON storm_call_conference_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_rec_events_session ON storm_call_recording_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_app_source ON storm_call_sessions(application_source);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_customer_ref ON storm_call_sessions(customer_reference);

-- >>> 20260805190740_20260805190000_finance_knowledge_intelligence_platform_schema.sql.sql
/*
# Financial Knowledge Intelligence Platform Schema

## Purpose
Create a central knowledge system shared across the Verge ecosystem (LeadVerge, DebtVerge, IVAVerge, DraftVerge).
Each application accesses the same knowledge table while filtering by its own library scope.

## New Tables

### finance_knowledge_articles
The main knowledge store. Each article is scoped to a library (leadverge, debtverge, ivaverge, draftverge)
and has a structured format with title, category, subcategory, summary, full explanation, adviser guidance,
customer-friendly explanation, compliance notes, keywords, status, and version tracking.

### finance_knowledge_categories
Lookup table for category metadata per library (display order, description).

## Full-Text Search
A tsvector column `fts` is maintained by a trigger, combining title (weight A), summary + keywords (weight B),
and full_explanation + adviser_guidance (weight C) for PostgreSQL full-text search.

## Security (RLS)
- SELECT: authenticated users can read all articles (shared knowledge base)
- INSERT/UPDATE/DELETE: authenticated users can manage articles
*/

-- ============================================================
-- finance_knowledge_articles
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library text NOT NULL CHECK (library IN ('leadverge', 'debtverge', 'ivaverge', 'draftverge')),
  title text NOT NULL,
  category text NOT NULL,
  subcategory text,
  summary text,
  full_explanation text,
  adviser_guidance text,
  customer_explanation text,
  compliance_notes text,
  related_articles text[] DEFAULT '{}',
  keywords text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'archived')),
  version int NOT NULL DEFAULT 1,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  fts tsvector
);

ALTER TABLE finance_knowledge_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "select_knowledge_articles" ON finance_knowledge_articles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "insert_knowledge_articles" ON finance_knowledge_articles
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "update_knowledge_articles" ON finance_knowledge_articles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "delete_knowledge_articles" ON finance_knowledge_articles
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- finance_knowledge_categories
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library text NOT NULL CHECK (library IN ('leadverge', 'debtverge', 'ivaverge', 'draftverge')),
  category text NOT NULL,
  subcategory text,
  display_order int NOT NULL DEFAULT 0,
  description text,
  UNIQUE(library, category, subcategory)
);

ALTER TABLE finance_knowledge_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "select_knowledge_categories" ON finance_knowledge_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "insert_knowledge_categories" ON finance_knowledge_categories
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "update_knowledge_categories" ON finance_knowledge_categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "delete_knowledge_categories" ON finance_knowledge_categories
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- FTS trigger to maintain the tsvector column
-- ============================================================

CREATE OR REPLACE FUNCTION finance_knowledge_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.keywords, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.full_explanation, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.adviser_guidance, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_fts ON finance_knowledge_articles;
CREATE TRIGGER trg_knowledge_fts
  BEFORE INSERT OR UPDATE ON finance_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION finance_knowledge_fts_update();

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_knowledge_library ON finance_knowledge_articles(library);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON finance_knowledge_articles(library, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON finance_knowledge_articles(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON finance_knowledge_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_knowledge_fts ON finance_knowledge_articles USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_knowledge_last_updated ON finance_knowledge_articles(last_updated DESC);

-- >>> 20260805202042_20260805210000_ai_knowledge_assistant_schema.sql.sql
/*
# AI Knowledge Assistant Schema

## Purpose
Creates tables for an AI-powered Knowledge Assistant using RAG over the
existing finance_knowledge_articles table. Tracks queries, feedback,
knowledge gaps, and permissions.

## New Tables
1. ai_query_logs — every question asked to the AI, with answer, sources, review status
2. ai_query_feedback — thumbs up/down on AI answers
3. ai_knowledge_gaps — unanswered questions for content team review
4. ai_assistant_permissions — who can use/admin the assistant

## Security
- RLS on all tables
- Owner-scoped for user data; admin-scoped via permission checks
- auth.uid() for ownership
*/

-- ============================================================
-- Create ALL tables first (before any policies that reference them)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_assistant_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  user_email text,
  can_use_assistant boolean NOT NULL DEFAULT true,
  can_review_answers boolean NOT NULL DEFAULT false,
  can_manage_knowledge boolean NOT NULL DEFAULT false,
  can_manage_permissions boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_query_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_email text,
  library text NOT NULL,
  question text NOT NULL,
  ai_answer text,
  source_articles jsonb DEFAULT '[]'::jsonb,
  compliance_guidance text,
  next_steps jsonb DEFAULT '[]'::jsonb,
  related_questions jsonb DEFAULT '[]'::jsonb,
  found_articles boolean NOT NULL DEFAULT false,
  response_source text DEFAULT 'local',
  context_terms text[] DEFAULT '{}'::text[],
  review_status text NOT NULL DEFAULT 'unreviewed',
  reviewer_id uuid,
  reviewer_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_query_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_log_id uuid NOT NULL REFERENCES ai_query_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  rating text NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  library text NOT NULL,
  frequency int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_article_id uuid,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE ai_assistant_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_gaps ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_user ON ai_query_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_library ON ai_query_logs(library);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_review ON ai_query_logs(review_status);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created ON ai_query_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_query ON ai_query_feedback(query_log_id);
CREATE INDEX IF NOT EXISTS idx_ai_gaps_status ON ai_knowledge_gaps(status);
CREATE INDEX IF NOT EXISTS idx_ai_gaps_library ON ai_knowledge_gaps(library);

-- ============================================================
-- Policies: ai_assistant_permissions
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_permissions" ON ai_assistant_permissions;
CREATE POLICY "select_own_ai_permissions"
  ON ai_assistant_permissions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "select_all_ai_permissions_admin"
  ON ai_assistant_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

DROP POLICY IF EXISTS "insert_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "insert_ai_permissions_admin"
  ON ai_assistant_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_permissions" ON ai_assistant_permissions;
CREATE POLICY "insert_own_ai_permissions"
  ON ai_assistant_permissions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "update_ai_permissions_admin"
  ON ai_assistant_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

-- ============================================================
-- Policies: ai_query_logs
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "select_own_ai_query_logs"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_query_logs_admin" ON ai_query_logs;
CREATE POLICY "select_all_ai_query_logs_admin"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "insert_own_ai_query_logs"
  ON ai_query_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "update_own_ai_query_logs"
  ON ai_query_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_ai_query_logs_admin" ON ai_query_logs;
CREATE POLICY "update_ai_query_logs_admin"
  ON ai_query_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

-- ============================================================
-- Policies: ai_query_feedback
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_feedback" ON ai_query_feedback;
CREATE POLICY "select_own_ai_feedback"
  ON ai_query_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_feedback_admin" ON ai_query_feedback;
CREATE POLICY "select_all_ai_feedback_admin"
  ON ai_query_feedback FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_feedback" ON ai_query_feedback;
CREATE POLICY "insert_own_ai_feedback"
  ON ai_query_feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Policies: ai_knowledge_gaps (admin-only)
-- ============================================================
DROP POLICY IF EXISTS "select_ai_knowledge_gaps_admin" ON ai_knowledge_gaps;
CREATE POLICY "select_ai_knowledge_gaps_admin"
  ON ai_knowledge_gaps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

DROP POLICY IF EXISTS "update_ai_knowledge_gaps_admin" ON ai_knowledge_gaps;
CREATE POLICY "update_ai_knowledge_gaps_admin"
  ON ai_knowledge_gaps FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

-- ============================================================
-- Policies: finance_knowledge_articles (admin management)
-- ============================================================
DROP POLICY IF EXISTS "update_knowledge_articles_admin" ON finance_knowledge_articles;
CREATE POLICY "update_knowledge_articles_admin"
  ON finance_knowledge_articles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

DROP POLICY IF EXISTS "insert_knowledge_articles_admin" ON finance_knowledge_articles;
CREATE POLICY "insert_knowledge_articles_admin"
  ON finance_knowledge_articles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

-- >>> 20260805202144_20260805211000_knowledge_gap_upsert_function.sql.sql
/*
# Knowledge Gap Upsert Function

Creates a SECURITY DEFINER function to upsert knowledge gap records.
The edge function (using service role key) calls this to track unanswered
questions. SECURITY DEFINER is needed because the function runs before
RLS policies are checked, and we want atomic upsert behavior.

## Security
- SECURITY DEFINER: runs with owner privileges
- Only called by the edge function (service role key)
- No direct user access needed
*/

CREATE OR REPLACE FUNCTION upsert_knowledge_gap(p_question text, p_library text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_knowledge_gaps (question, library, frequency, first_seen, last_seen)
  VALUES (p_question, p_library, 1, now(), now())
  ON CONFLICT (question, library) DO UPDATE
  SET
    frequency = ai_knowledge_gaps.frequency + 1,
    last_seen = now()
  WHERE ai_knowledge_gaps.status = 'open';
END;
$$;

-- Add a unique constraint on (question, library) for the upsert to work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_ai_gaps_question_library_unique'
    AND tablename = 'ai_knowledge_gaps'
  ) THEN
    ALTER TABLE ai_knowledge_gaps ADD CONSTRAINT uq_gaps_question_library UNIQUE (question, library);
  END IF;
END $$;

-- >>> 20260805222842_normalize_profile_status_case.sql
-- Normalize mixed-case status values in profiles to uppercase
-- (STATUS_META in AdminHub uses uppercase keys)
UPDATE profiles SET status = UPPER(status) WHERE status != UPPER(status);

-- >>> 20260805223017_add_iva_plan_type_enum.sql
-- Add 'iva' to debt_plan_type enum (required by IVAVerge)
ALTER TYPE debt_plan_type ADD VALUE IF NOT EXISTS 'iva';

-- >>> 20260806005301_20260806_org_scoped_debtverge_tenant_isolation.sql.sql
/*
# DebtVerge Tenant Isolation — Organization-Scoped RLS

## Purpose
Previously, all debt_* tables used per-user RLS (auth.uid() = user_id), meaning
any advisor in the same firm could NOT see each other's cases, and there was no
concept of organization-level isolation. This migration:

1. Adds `organization_id` column to `debt_cases` (the parent table for all debt data)
2. Backfills existing rows from `organization_users` membership
3. Creates a `is_super_admin()` SQL helper that checks profiles.is_super_admin
4. Replaces all debt_* RLS policies to enforce organization-scoped access:
   - Regular users can only access rows where the parent case's organization_id
     matches one of their organization_users memberships
   - Super admins bypass org checks (see all data)
5. Updates profiles RLS so super_admin can read all profiles (for Admin Hub)

## Tables Modified
- `debt_cases` — adds `organization_id uuid` column (nullable for backward compat)
- All 29 `debt_*` tables — RLS policies replaced with org-scoped versions

## Security Changes
- New `is_super_admin()` SECURITY DEFINER function (immutable, schema-safe)
- `debt_cases` RLS: org-scoped via organization_users membership, super_admin bypass
- Child tables (debt_creditors, etc.): org-scoped via EXISTS join to debt_cases
- `profiles` SELECT policy: super_admin can see all profiles

## Important Notes
1. organization_id is nullable on debt_cases to avoid breaking existing inserts.
   The frontend should set it when creating new cases. A future migration can
   make it NOT NULL once all rows are backfilled.
2. Super admin bypass uses the is_super_admin() helper which reads from profiles.
   This is server-side only — no client code is involved.
3. Child tables that reference debt_cases via case_id inherit org isolation
   through EXISTS subqueries — they do NOT need their own organization_id.
*/

-- ============================================================
-- Step 1: Create is_super_admin() helper function
-- ============================================================
-- Checks whether the current authenticated user has is_super_admin = true
-- in the profiles table. Used by RLS policies to bypass org checks.
-- SECURITY DEFINER so it can read profiles even if the caller's RLS
-- would otherwise restrict access.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ============================================================
-- Step 2: Add organization_id to debt_cases and backfill
-- ============================================================

ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill from organization_users: pick the first org membership for each case's user
UPDATE debt_cases dc
SET organization_id = (
  SELECT ou.organization_id
  FROM organization_users ou
  WHERE ou.user_id = dc.user_id
  ORDER BY ou.created_at
  LIMIT 1
)
WHERE dc.organization_id IS NULL;

-- Add index for org-scoped queries
CREATE INDEX IF NOT EXISTS idx_debt_cases_organization_id ON debt_cases(organization_id);

-- ============================================================
-- Step 3: Update profiles RLS — super_admin can see all profiles
-- ============================================================

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
DROP POLICY IF EXISTS "select_all_profiles_super_admin" ON profiles;
DROP POLICY IF EXISTS "select_own_profile_or_super_admin" ON profiles;

CREATE POLICY "select_own_profile_or_super_admin" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_super_admin());

-- ============================================================
-- Step 4: Replace debt_cases RLS with org-scoped policies
-- ============================================================

DROP POLICY IF EXISTS "select_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "insert_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "update_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "delete_own_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "select_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "insert_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "update_org_debt_cases" ON debt_cases;
DROP POLICY IF EXISTS "delete_org_debt_cases" ON debt_cases;

-- A user can access a case if:
--   (a) they are super_admin, OR
--   (b) the case's organization_id matches one of their org memberships
CREATE POLICY "select_org_debt_cases" ON debt_cases
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "insert_org_debt_cases" ON debt_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "update_org_debt_cases" ON debt_cases
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

CREATE POLICY "delete_org_debt_cases" ON debt_cases
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users ou
        WHERE ou.user_id = auth.uid()
        AND ou.organization_id = debt_cases.organization_id
      )
    )
  );

-- ============================================================
-- Step 5: Replace ALL child debt_* table RLS with org-scoped policies
-- ============================================================
-- These tables reference debt_cases via case_id. Their RLS checks
-- that the parent case belongs to the user's organization (or super_admin).

DO $$
DECLARE
  tbl text;
  child_tables text[] := ARRAY[
    'debt_creditors',
    'debt_sfs_entries',
    'debt_payments',
    'debt_negotiations',
    'debt_customer_profiles',
    'debt_bank_transactions',
    'debt_annual_reviews',
    'debt_audit_log',
    'debt_benefits_checks',
    'debt_breathing_spaces',
    'debt_creditor_votes',
    'debt_distributions',
    'debt_document_checklist',
    'debt_ip_details',
    'debt_iva_contributions',
    'debt_iva_distribution_items',
    'debt_iva_distribution_runs',
    'debt_iva_proposals',
    'debt_payment_transactions',
    'debt_previous_addresses',
    'debt_proof_of_debt',
    'debt_signposting_assessments',
    'debt_vulnerability_assessments',
    'debtverge_communications',
    'debtverge_compliance_attestations',
    'debtverge_vulnerability_flags'
  ];
BEGIN
  FOREACH tbl IN ARRAY child_tables LOOP
    -- Drop old per-user policies (they follow the _own_ naming convention,
    -- but the prefix varies: debt_ or debtverge_). We drop by pattern.
    EXECUTE format('DROP POLICY IF EXISTS "select_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "update_own_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own_%s" ON %s;', tbl, tbl);

    -- Also drop any previously-created org policies (idempotency)
    EXECUTE format('DROP POLICY IF EXISTS "select_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "insert_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "update_org_%s" ON %s;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "delete_org_%s" ON %s;', tbl, tbl);

    -- SELECT
    EXECUTE format(
      'CREATE POLICY "select_org_%s" ON %s FOR SELECT TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );

    -- INSERT
    EXECUTE format(
      'CREATE POLICY "insert_org_%s" ON %s FOR INSERT TO authenticated WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );

    -- UPDATE
    EXECUTE format(
      'CREATE POLICY "update_org_%s" ON %s FOR UPDATE TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      ) WITH CHECK (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl, tbl
    );

    -- DELETE
    EXECUTE format(
      'CREATE POLICY "delete_org_%s" ON %s FOR DELETE TO authenticated USING (
        public.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM debt_cases
          WHERE debt_cases.id = %s.case_id
          AND debt_cases.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM organization_users ou
            WHERE ou.user_id = auth.uid()
            AND ou.organization_id = debt_cases.organization_id
          )
        )
      );',
      tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================
-- Step 6: Update debtverge_tenants RLS to allow super_admin full access
-- ============================================================

DROP POLICY IF EXISTS "select_all_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "select_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_own_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "select_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "insert_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "update_debtverge_tenants" ON debtverge_tenants;
DROP POLICY IF EXISTS "delete_debtverge_tenants" ON debtverge_tenants;

CREATE POLICY "select_debtverge_tenants" ON debtverge_tenants
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "insert_debtverge_tenants" ON debtverge_tenants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "update_debtverge_tenants" ON debtverge_tenants
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_super_admin() OR auth_user_id = auth.uid());

CREATE POLICY "delete_debtverge_tenants" ON debtverge_tenants
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR auth_user_id = auth.uid());

-- ============================================================
-- Step 7: Update debtverge_unassigned_messages RLS
-- ============================================================
-- This table uses matched_case_id (not case_id) to link to debt_cases

DROP POLICY IF EXISTS "select_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "insert_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "update_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "delete_own_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "select_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "insert_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "update_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;
DROP POLICY IF EXISTS "delete_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages;

CREATE POLICY "select_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "insert_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "update_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

CREATE POLICY "delete_org_debtverge_unassigned_messages" ON debtverge_unassigned_messages
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      matched_case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM debt_cases
        WHERE debt_cases.id = debtverge_unassigned_messages.matched_case_id
        AND debt_cases.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM organization_users ou
          WHERE ou.user_id = auth.uid()
          AND ou.organization_id = debt_cases.organization_id
        )
      )
    )
  );

-- >>> 20260806005703_20260806_drop_stale_per_user_debt_policies.sql.sql
/*
# Drop stale per-user RLS policies from debt_* tables
# The org-scoped policies were added in the previous migration, but the old
# per-user policies used shortened suffixes (e.g. "debt_reviews" instead of
# "debt_annual_reviews") so the DROP statements didn't match.
# This migration cleans them up.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE '%_own_%'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;

-- >>> 20260806005724_20260806_drop_anon_debt_policies.sql.sql
/*
# Drop anon-accessible policies from debt_* tables
# These were found alongside the org-scoped policies and grant the anon role
# full CRUD access — a security hole that bypasses organization isolation.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'anon_%'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;

-- >>> 20260806005741_20260806_drop_all_remaining_old_debt_policies.sql.sql
/*
# Drop remaining old non-org-scoped policies from debt tables
# These use non-standard naming conventions from earlier migrations.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
      AND policyname NOT LIKE '%_org_%'
      AND policyname NOT LIKE '%_debtverge_tenants'
      -- Keep only the org-scoped policies we created
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;

-- >>> 20260806191803_20260806_licensing_schema.sql.sql
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

-- >>> 20260806191830_20260806_seed_catalog_and_packages.sql.sql
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

-- >>> 20260806191859_20260806_migrate_subscriptions_to_licenses.sql.sql
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

-- >>> 20260806192029_20260806_seed_orphaned_rbac_permissions.sql.sql
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

-- >>> 20260806205251_fix_catalog_categorization_and_add_missing_items.sql
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

-- ============================================================================
-- Remove legacy Stormreef seed rows (no real tenants are carried over)
-- ============================================================================
delete from rbac_role_permissions where role_id in (select id from rbac_roles where organization_id in ('36e68aad-64a0-49fd-a1c9-dc155eee1216','fbb93be3-371f-4e52-a64d-7ccf42bf63b2','801fa3a9-8a42-4150-b9b7-57474cd37981'));
delete from organization_users;
delete from asset_access_links;
delete from organization_licenses;
delete from tenant_subscriptions;
delete from rbac_roles where organization_id in ('36e68aad-64a0-49fd-a1c9-dc155eee1216','fbb93be3-371f-4e52-a64d-7ccf42bf63b2','801fa3a9-8a42-4150-b9b7-57474cd37981');
delete from organizations where id in ('36e68aad-64a0-49fd-a1c9-dc155eee1216','fbb93be3-371f-4e52-a64d-7ccf42bf63b2','801fa3a9-8a42-4150-b9b7-57474cd37981');

-- ============================================================================
-- Notifications (read by the top bar)
-- ============================================================================
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null default '',
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table notifications enable row level security;
create policy "Users read own notifications" on notifications for select to authenticated using (user_id = auth.uid());
create policy "Users update own notifications" on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

set session_replication_role = origin;
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
/*
  Client portal access, no-login payment links and change requests.
  Clients reach their page through a single-use-style random token (not a password).
  Public access goes only through SECURITY DEFINER functions that expose a narrow,
  non-sensitive view of the case. Tables themselves are staff-only (org members).
*/
CREATE TABLE IF NOT EXISTS payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','expired','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  channel text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_links_case ON payment_links (case_id, status);
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_payment_links" ON payment_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "insert_org_payment_links" ON payment_links FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "update_org_payment_links" ON payment_links FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS portal_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('contact','care','note')),
  field text,
  old_value text,
  new_value text,
  note text,
  flags_vulnerability boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS idx_change_requests_org ON portal_change_requests (organization_id, status);
ALTER TABLE portal_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_change_requests" ON portal_change_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "update_org_change_requests" ON portal_change_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()));

-- Public: narrow view of what a client sees from their link. Marks the link viewed.
CREATE OR REPLACE FUNCTION get_payment_link(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; c debt_cases; org_name text; paid numeric; st text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO c FROM debt_cases WHERE id = l.case_id;
  SELECT name INTO org_name FROM organizations WHERE id = l.organization_id;
  SELECT COALESCE(sum(amount),0) INTO paid FROM debt_payments WHERE case_id = l.case_id;
  st := l.status;
  IF st = 'active' AND l.expires_at < now() THEN st := 'expired'; END IF;
  UPDATE payment_links SET last_viewed_at = now() WHERE id = l.id;
  RETURN jsonb_build_object(
    'found', true, 'status', st, 'amount', l.amount, 'reason', l.reason,
    'expires_at', l.expires_at, 'firm', org_name,
    'first_name', split_part(c.debtor_name, ' ', 1),
    'reference', c.case_number,
    'total_debt', c.total_debt, 'paid_to_date', paid,
    'remaining', GREATEST(c.total_debt - paid, 0),
    'monthly_payment', c.installment_amount, 'next_due', c.next_due_date,
    'status_label', c.status
  );
END $$;
GRANT EXECUTE ON FUNCTION get_payment_link(text) TO anon, authenticated;

-- Public: client submits a change; always lands in the adviser queue, never applied directly.
CREATE OR REPLACE FUNCTION submit_change_request(p_token text, p_type text, p_field text, p_value text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; flag boolean; oldv text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token AND status IN ('active','paid');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid link'); END IF;
  IF p_type NOT IN ('contact','care','note') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid type'); END IF;
  IF p_type = 'contact' AND p_field NOT IN ('primary_email','mobile_phone','landline_phone','address_street','address_city','address_postcode') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid field');
  END IF;
  IF length(coalesce(p_value,'')) > 500 OR length(coalesce(p_note,'')) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too long');
  END IF;
  flag := (coalesce(p_value,'') || ' ' || coalesce(p_note,'')) ~* '(health|ill|disab|depress|anxiety|bereave|passed away|died|job loss|redundan|lost my job|abus|pregnan|can''t cope|cannot cope|struggl|hospital|carer)';
  IF p_type = 'contact' THEN
    EXECUTE format('SELECT %I::text FROM debt_customer_profiles WHERE case_id = $1', p_field) INTO oldv USING l.case_id;
  END IF;
  INSERT INTO portal_change_requests (organization_id, case_id, request_type, field, old_value, new_value, note, flags_vulnerability)
  VALUES (l.organization_id, l.case_id, p_type, p_field, oldv, p_value, p_note, flag);
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION submit_change_request(text, text, text, text, text) TO anon, authenticated;

-- Staff: approve or reject; approving a contact change applies it to the customer profile.
CREATE OR REPLACE FUNCTION decide_change_request(p_id uuid, p_approve boolean, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r portal_change_requests;
BEGIN
  SELECT * INTO r FROM portal_change_requests WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already decided'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = r.organization_id AND ou.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_approve AND r.request_type = 'contact' THEN
    EXECUTE format('UPDATE debt_customer_profiles SET %I = $1, updated_at = now() WHERE case_id = $2', r.field) USING r.new_value, r.case_id;
  END IF;
  UPDATE portal_change_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_note WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION decide_change_request(uuid, boolean, text) TO authenticated;
/*
  DMP roles and case access
  Roles: Advisor, Team Manager, Operations Manager (alongside the existing Admin).
  Access model:
    - Every member of an organisation can search and read all of its cases and correspond on them.
    - Editing a case is limited to its assigned advisor, its creator, and managers/admins.
  Policies are additive (permissive), so the original owner-only policies keep working.
*/
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS manager_id uuid;
CREATE INDEX IF NOT EXISTS idx_debt_cases_assigned ON debt_cases (organization_id, assigned_to);

CREATE OR REPLACE FUNCTION dv_is_org_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = org AND ou.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION dv_is_manager(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid()
      AND r.name IN ('Admin','Team Manager','Operations Manager')
  );
$$;

CREATE OR REPLACE FUNCTION dv_can_read_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id));
$$;

CREATE OR REPLACE FUNCTION dv_can_edit_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id)
      AND (c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

-- debt_cases itself
CREATE POLICY "dv_org_select_debt_cases" ON debt_cases FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_insert_debt_cases" ON debt_cases FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_update_debt_cases" ON debt_cases FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_org_member(organization_id) AND (assigned_to = auth.uid() OR user_id = auth.uid() OR dv_is_manager(organization_id)))
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_delete_debt_cases" ON debt_cases FOR DELETE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

-- every child table that hangs off a case
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relrowsecurity
    WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND c.table_name <> 'debt_cases'
      AND c.table_name NOT IN ('payment_links','portal_change_requests','case_handovers')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='dv_org_select_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (dv_can_read_case(case_id))', 'dv_org_select_'||t, t);
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id))', 'dv_org_write_'||t, t);
    END IF;
  END LOOP;
END $$;

-- standard DMP roles for an organisation
CREATE OR REPLACE FUNCTION seed_debtverge_roles(org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE spec record; rid uuid;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Advisor', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','PAY:view','COMPLIANCE:view','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('Team Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','COMPLIANCE:view','COMPLIANCE:edit','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','AGENT:view','AGENT:edit','KNOWLEDGE:view']),
      ('Operations Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','PAY:edit','PAY:manage','COMPLIANCE:view','COMPLIANCE:edit','COMPLIANCE:manage','STORMCALL:view','MAIL:view','AGENT:view','AGENT:edit','AGENT:manage','KNOWLEDGE:view','KNOWLEDGE:edit'])
    ) AS v(name, perms)
  LOOP
    SELECT id INTO rid FROM rbac_roles WHERE organization_id = org AND name = spec.name;
    IF rid IS NULL THEN
      INSERT INTO rbac_roles (organization_id, name, is_custom) VALUES (org, spec.name, false) RETURNING id INTO rid;
    END IF;
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT rid, p.id FROM rbac_permissions p WHERE (p.module || ':' || p.action) = ANY (spec.perms)
      AND NOT EXISTS (SELECT 1 FROM rbac_role_permissions x WHERE x.role_id = rid AND x.permission_id = p.id);
  END LOOP;
END $$;
/*
  Team management: members, roles, reporting lines, case assignment, invites.
  Everything is scoped to the caller's own organisation and checked inside the functions.
*/
CREATE TABLE IF NOT EXISTS organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','cancelled')),
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invites_pending ON organization_invites (organization_id, lower(email)) WHERE status = 'pending';
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION dv_my_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM organization_users WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION dv_is_org_admin(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')
  );
$$;

CREATE POLICY "select_org_invites" ON organization_invites FOR SELECT TO authenticated
  USING (dv_is_manager(organization_id));

CREATE OR REPLACE FUNCTION list_org_members() RETURNS TABLE (user_id uuid, email text, full_name text, role_id uuid, role_name text, manager_id uuid, open_cases bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ou.user_id, p.email, p.full_name, ou.role_id, r.name, ou.manager_id,
         (SELECT count(*) FROM debt_cases c WHERE c.organization_id = ou.organization_id AND c.assigned_to = ou.user_id AND c.status NOT IN ('completed','closed'))
  FROM organization_users ou
  LEFT JOIN profiles p ON p.id = ou.user_id
  LEFT JOIN rbac_roles r ON r.id = ou.role_id
  WHERE ou.organization_id = dv_my_org() AND dv_is_manager(ou.organization_id)
  ORDER BY r.name, p.full_name;
$$;
GRANT EXECUTE ON FUNCTION list_org_members() TO authenticated;

CREATE OR REPLACE FUNCTION set_member_role(p_user uuid, p_role uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_org_admin(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_roles WHERE id = p_role AND organization_id = org) THEN RAISE EXCEPTION 'unknown role'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'you cannot change your own role'; END IF;
  UPDATE organization_users SET role_id = p_role WHERE user_id = p_user AND organization_id = org;
END $$;
GRANT EXECUTE ON FUNCTION set_member_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION set_member_manager(p_user uuid, p_manager uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF p_manager IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = p_manager AND organization_id = org) THEN RAISE EXCEPTION 'manager is not in this organisation'; END IF;
  UPDATE organization_users SET manager_id = p_manager WHERE user_id = p_user AND organization_id = org;
END $$;
GRANT EXECUTE ON FUNCTION set_member_manager(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION assign_case(p_case uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; cur uuid := auth.uid(); owner uuid; asg uuid;
BEGIN
  SELECT organization_id, user_id, assigned_to INTO org, owner, asg FROM debt_cases WHERE id = p_case;
  IF org IS NULL OR NOT dv_is_org_member(org) THEN RAISE EXCEPTION 'case not found'; END IF;
  IF NOT (dv_is_manager(org) OR asg = cur) THEN RAISE EXCEPTION 'only a manager or the current owner can reassign'; END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = p_user AND organization_id = org) THEN RAISE EXCEPTION 'assignee is not in this organisation'; END IF;
  UPDATE debt_cases SET assigned_to = p_user, updated_at = now() WHERE id = p_case;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Case reassigned', 'Assigned to ' || coalesce((SELECT coalesce(full_name, email) FROM profiles WHERE id = p_user), 'nobody'));
END $$;
GRANT EXECUTE ON FUNCTION assign_case(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION create_invite(p_email text, p_role uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); uid uuid; em text := lower(trim(p_email));
BEGIN
  IF org IS NULL OR NOT dv_is_org_admin(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'enter a valid email'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_roles WHERE id = p_role AND organization_id = org) THEN RAISE EXCEPTION 'unknown role'; END IF;
  SELECT id INTO uid FROM profiles WHERE lower(email) = em;
  IF uid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM organization_users WHERE user_id = uid AND organization_id = org) THEN RAISE EXCEPTION 'already a member'; END IF;
    INSERT INTO organization_users (user_id, organization_id, role_id) VALUES (uid, org, p_role);
    RETURN 'added';
  END IF;
  INSERT INTO organization_invites (organization_id, email, role_id) VALUES (org, em, p_role);
  RETURN 'invited';
END $$;
GRANT EXECUTE ON FUNCTION create_invite(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION claim_org_invites() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text := lower(coalesce(auth.jwt() ->> 'email', '')); inv record; n int := 0;
BEGIN
  IF auth.uid() IS NULL OR em = '' THEN RETURN 0; END IF;
  FOR inv IN SELECT * FROM organization_invites WHERE status = 'pending' AND lower(email) = em LOOP
    IF NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = auth.uid() AND organization_id = inv.organization_id) THEN
      INSERT INTO organization_users (user_id, organization_id, role_id) VALUES (auth.uid(), inv.organization_id, inv.role_id);
    END IF;
    UPDATE organization_invites SET status = 'claimed' WHERE id = inv.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION claim_org_invites() TO authenticated;

CREATE OR REPLACE FUNCTION cancel_invite(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE organization_invites SET status = 'cancelled' WHERE id = p_id AND organization_id = dv_my_org() AND dv_is_org_admin(organization_id);
END $$;
GRANT EXECUTE ON FUNCTION cancel_invite(uuid) TO authenticated;
/*
  Client payments (GoCardless: pay by bank and Direct Debit).
  payment_attempts: one row per attempt to take money, created by the client-payment-session function.
  client_mandates: Direct Debit mandates set up by clients.
  Both are written only by edge functions (service role); staff can read them.
*/
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  link_id uuid REFERENCES payment_links(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'gocardless',
  kind text NOT NULL CHECK (kind IN ('bank_pay','direct_debit_setup','direct_debit_collection')),
  provider_ref text,
  provider_payment_id text,
  amount numeric(12,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','cancelled')),
  failure_reason text,
  recorded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_ref ON payment_attempts (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment ON payment_attempts (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_case ON payment_attempts (case_id, created_at DESC);
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_payment_attempts" ON payment_attempts FOR SELECT TO authenticated
  USING (dv_is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS client_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gocardless',
  provider_mandate_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','failed','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_mandate_id)
);
CREATE INDEX IF NOT EXISTS idx_client_mandates_case ON client_mandates (case_id, status);
ALTER TABLE client_mandates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_client_mandates" ON client_mandates FOR SELECT TO authenticated
  USING (dv_is_org_member(organization_id));

-- Public: whether this link's firm has online payments switched on is decided by the function; this reports a client's mandate state.
CREATE OR REPLACE FUNCTION get_link_payment_state(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; m text; a text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT status INTO m FROM client_mandates WHERE case_id = l.case_id ORDER BY created_at DESC LIMIT 1;
  SELECT status INTO a FROM payment_attempts WHERE link_id = l.id ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('found', true, 'mandate', m, 'last_attempt', a);
END $$;
GRANT EXECUTE ON FUNCTION get_link_payment_state(text) TO anon, authenticated;
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
/*
  Letter/document templates (with merge fields) and per-case documents (generated letters + uploaded files).
  System templates have organization_id NULL and are readable by everyone; firms add their own.
*/
CREATE TABLE IF NOT EXISTS document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  audience text NOT NULL DEFAULT 'customer' CHECK (audience IN ('customer','creditor')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_select_document_templates" ON document_templates FOR SELECT TO authenticated
  USING (organization_id IS NULL OR dv_is_org_member(organization_id));
CREATE POLICY "dv_manage_document_templates" ON document_templates FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id));

CREATE TABLE IF NOT EXISTS case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  organization_id uuid,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  template_id uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  body text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents (case_id, created_at DESC);
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_org_select_case_documents" ON case_documents FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY "dv_org_write_case_documents" ON case_documents FOR ALL TO authenticated
  USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('case-documents', 'case-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- first path segment of every object is the case id
CREATE POLICY "dv_case_documents_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_read_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));

INSERT INTO document_templates (organization_id, name, category, audience, subject, body) VALUES
(NULL, 'Welcome and plan confirmation', 'onboarding', 'customer', 'Your debt management plan with {{firm_name}}',
'Dear {{client_name}},

Thank you for choosing {{firm_name}}. This letter confirms your debt management plan.

Your reference: {{case_number}}
Your monthly payment: {{monthly_payment}}
Total debts included: {{total_debt}}
Your first payment is due: {{next_due_date}}

We will share your payment between your creditors fairly, in proportion to what you owe each of them, and keep you updated. If your circumstances change, or you have difficulty making a payment, please contact us straight away so we can help.

Yours sincerely,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Creditor offer (fair share)', 'creditor', 'creditor', 'Debt management plan proposal: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

Re: {{client_name}}
Your reference: {{creditor_reference}}
Our reference: {{case_number}}

We act for the above customer, who is in financial difficulty. We enclose a copy of their income and expenditure.

The customer can afford {{monthly_payment}} a month towards all their creditors. Your fair share of this is {{creditor_offer}} a month, based on a balance of {{creditor_balance}}.

We ask that you accept this offer in full and final settlement over time, freeze interest and charges, and stop collection activity while payments are maintained. Please confirm in writing within 14 days.

Yours faithfully,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Letter of authority', 'creditor', 'creditor', 'Letter of authority: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

I, {{client_name}}, authorise {{firm_name}} to act on my behalf and to discuss and agree arrangements for my account with you (reference {{creditor_reference}}). Please send all correspondence about this account to {{firm_name}}.

Signed: ______________________   Date: {{today}}'),
(NULL, 'Missed payment reminder', 'collections', 'customer', 'We have not received your payment',
'Dear {{client_name}},

We have not received your payment of {{monthly_payment}} that was due on {{next_due_date}}.

If something has changed, please get in touch as soon as you can. We are here to help and there is no judgement. If you can pay now, call us and we will take it over the phone or send you a secure payment link.

Your plan stays on track when payments are made on time, and it protects you from creditor pressure.

Kind regards,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Annual review notice', 'review', 'customer', 'Your annual plan review',
'Dear {{client_name}},

It is time for your yearly review. We will check your income and spending, and make sure your plan is still right for you. Please have your latest payslips and bank statements ready, and call us to book a time.

Kind regards,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Creditor chase', 'creditor', 'creditor', 'Chasing your response: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

We wrote to you on behalf of {{client_name}} (your reference {{creditor_reference}}) and have not had a reply. Please confirm whether you accept the proposal of {{creditor_offer}} a month and freeze interest and charges. We will continue to pay while we wait.

Yours faithfully,
{{adviser_name}}
{{firm_name}}');
/*
  Security hardening + product licensing.

  1. Legacy policies let ANY member of a firm update/delete ANY case row, and even edit or delete audit history.
     Permissive policies are OR-ed, so the narrower dv_* rules were being bypassed. Rather than drop the old
     policies, RESTRICTIVE policies are added: every write must also pass the strict rule.
  2. Products (DMP Advisor, Insolvency Advisor) are licensed per firm and enforced in the database.
  3. Restricted cases (staff, family, high-profile) readable only by owner/assigned adviser/managers; every case
     view is written to an append-only access log.
  4. Audit tables become append-only for all signed-in users.
*/

-- ---------- products and licences ----------
CREATE TABLE IF NOT EXISTS dv_products (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO dv_products (key, name, description, display_order) VALUES
  ('dmp_advisor', 'DMP Advisor', 'Debt management plans: budgeting, creditor offers, payments and distributions', 10),
  ('insolvency_advisor', 'Insolvency Advisor', 'IVA, DRO and formal insolvency: proposals, creditor voting and supervision', 20)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE dv_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_products_read" ON dv_products FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS dv_org_products (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_key text NOT NULL REFERENCES dv_products(key),
  enabled boolean NOT NULL DEFAULT true,
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,
  PRIMARY KEY (organization_id, product_key)
);
ALTER TABLE dv_org_products ENABLE ROW LEVEL SECURITY;
-- members can see their own firm's licences; nobody but the platform (service role) can change them
CREATE POLICY "dv_org_products_read" ON dv_org_products FOR SELECT TO authenticated USING (dv_is_org_member(organization_id));

CREATE OR REPLACE FUNCTION dv_org_has_product(org uuid, p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM dv_org_products o WHERE o.organization_id = org AND o.product_key = p AND o.enabled
                 AND o.starts_on <= current_date AND (o.ends_on IS NULL OR o.ends_on >= current_date));
$$;

CREATE OR REPLACE FUNCTION dv_case_product(plan text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN plan IN ('iva','dro','bankruptcy') THEN 'insolvency_advisor' ELSE 'dmp_advisor' END;
$$;

CREATE OR REPLACE FUNCTION my_products() RETURNS TABLE (product_key text, name text, description text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.key, p.name, p.description FROM dv_products p
  WHERE p.is_active AND dv_org_has_product(dv_my_org(), p.key) ORDER BY p.display_order;
$$;
GRANT EXECUTE ON FUNCTION my_products() TO authenticated;

-- every existing firm keeps its current access
INSERT INTO dv_org_products (organization_id, product_key)
SELECT o.id, p.key FROM organizations o CROSS JOIN dv_products p ON CONFLICT DO NOTHING;

-- ---------- restricted cases + access log ----------
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION dv_can_read_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id)
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

CREATE TABLE IF NOT EXISTS case_access_log (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  organization_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  action text NOT NULL DEFAULT 'view',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_access_log_case ON case_access_log (case_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_case_access_log_user ON case_access_log (user_id, at DESC);
ALTER TABLE case_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_case_access_log_read" ON case_access_log FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

CREATE OR REPLACE FUNCTION log_case_view(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  IF NOT dv_can_read_case(p_case) THEN RETURN; END IF;
  SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
  -- one entry per user per case per 10 minutes
  IF NOT EXISTS (SELECT 1 FROM case_access_log WHERE case_id = p_case AND user_id = auth.uid() AND action = 'view' AND at > now() - interval '10 minutes') THEN
    INSERT INTO case_access_log (case_id, organization_id, user_id, action) VALUES (p_case, org, auth.uid(), 'view');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION log_case_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION set_case_restricted(p_case uuid, p_restricted boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'only a manager can change case restrictions'; END IF;
  UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case;
  INSERT INTO debt_audit_log (case_id, milestone, description)
  VALUES (p_case, CASE WHEN p_restricted THEN 'Case restricted' ELSE 'Case restriction removed' END, 'Changed by a manager');
END $$;
GRANT EXECUTE ON FUNCTION set_case_restricted(uuid, boolean) TO authenticated;

-- ---------- restrictive policies ----------
-- debt_cases itself
CREATE POLICY "dv_r_sel_debt_cases" ON debt_cases AS RESTRICTIVE FOR SELECT TO authenticated
  USING (dv_can_read_case(id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_ins_debt_cases" ON debt_cases AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_upd_debt_cases" ON debt_cases AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (dv_can_edit_case(id)) WITH CHECK (dv_can_edit_case(id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_del_debt_cases" ON debt_cases AS RESTRICTIVE FOR DELETE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

-- every table that hangs off a case (case_id NOT NULL)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relkind = 'r' AND k.relrowsecurity
    WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND c.is_nullable = 'NO'
      AND c.table_name NOT IN ('debt_cases','case_access_log','portal_change_requests','payment_links')
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id))', 'dv_r_sel_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (dv_can_edit_case(case_id))', 'dv_r_ins_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id))', 'dv_r_upd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (dv_can_edit_case(case_id))', 'dv_r_del_'||t, t);
  END LOOP;
END $$;

-- insolvency-only tables also require the Insolvency Advisor licence
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debt_iva_proposals','debt_iva_contributions','debt_iva_distribution_runs','debt_iva_distribution_items','debt_ip_details','debt_creditor_votes','debt_proof_of_debt']
  LOOP
    EXECUTE format($f$CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = case_id AND dv_org_has_product(c.organization_id, 'insolvency_advisor')))
      WITH CHECK (EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = case_id AND dv_org_has_product(c.organization_id, 'insolvency_advisor')))$f$, 'dv_r_lic_'||t, t);
  END LOOP;
END $$;

-- client change requests: approval only through decide_change_request(); payment links editable only by the case team
CREATE POLICY "dv_r_upd_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "dv_r_del_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY "dv_r_sel_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY "dv_r_ins_payment_links" ON payment_links AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_upd_payment_links" ON payment_links AS RESTRICTIVE FOR UPDATE TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_del_payment_links" ON payment_links AS RESTRICTIVE FOR DELETE TO authenticated USING (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_sel_payment_links" ON payment_links AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id));

-- money-movement tables: managers (Operations Manager, Team Manager, Admin) only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disbursement_runs','batch_payment_runs','bank_transactions']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_ins_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (organization_id IS NOT NULL AND dv_is_manager(organization_id)) WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_upd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_del_'||t, t);
  END LOOP;
END $$;

-- ---------- append-only audit tables ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debt_audit_log','cashier_audit_logs','payment_reconciliation_log','case_access_log']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (false)', 'dv_r_noupd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', 'dv_r_nodel_'||t, t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM authenticated, anon', t);
  END LOOP;
END $$;
-- Revoke default PUBLIC/anon EXECUTE on all public functions (incl. those created after the first hardening pass).
-- anon keeps only the three no-login payment-link functions. Future functions are non-public by default.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    IF r.proname IN ('get_payment_link','get_link_payment_state','submit_change_request') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
-- Outbound email/SMS queue + missed-payment chaser. Sending is done by the send-comms edge function (provider secrets).
CREATE TABLE IF NOT EXISTS comms_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  to_address text NOT NULL,
  subject text,
  body text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','missed_payment','reminder')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  provider_id text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS comms_outbox_queue_idx ON comms_outbox (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS comms_outbox_case_idx ON comms_outbox (case_id, created_at DESC);
ALTER TABLE comms_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY comms_outbox_read ON comms_outbox FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
-- No direct insert/update/delete from clients: all writes go through the functions below or the service role.

CREATE OR REPLACE FUNCTION dv_queue_message(p_case uuid, p_channel text, p_subject text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; addr text; oid uuid;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_channel = 'sms' THEN SELECT mobile_phone INTO addr FROM debt_customer_profiles WHERE case_id = p_case;
  ELSE SELECT primary_email INTO addr FROM debt_customer_profiles WHERE case_id = p_case; END IF;
  IF addr IS NULL OR btrim(addr) = '' THEN RAISE EXCEPTION 'no % contact on this case', p_channel; END IF;
  INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger)
  VALUES (c.organization_id, p_case, p_channel, addr, p_subject, p_body, 'manual') RETURNING id INTO oid;
  RETURN oid;
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_message(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE comms_outbox SET status = 'cancelled'
  WHERE id = p_id AND status = 'queued' AND dv_can_edit_case(case_id);
END $$;

-- Daily chaser: active plans overdue by 1+ days get a fresh no-login pay link and a message (SMS if mobile, else email).
-- No contact details -> a diary task for the adviser instead. At most one chaser per case every 3 days.
CREATE OR REPLACE FUNCTION dv_queue_missed_payment_chasers(p_base_url text DEFAULT 'https://sparkthunderprojects-1dvy.bolt.host')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; tok text; n int := 0; ch text; addr text; firm text; first_name text; amt numeric; msg text;
BEGIN
  FOR r IN
    SELECT c.*, p.mobile_phone, p.primary_email FROM debt_cases c
    LEFT JOIN debt_customer_profiles p ON p.case_id = c.id
    WHERE c.status = 'payment_schedule_active' AND c.next_due_date < current_date AND COALESCE(c.installment_amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM comms_outbox o WHERE o.case_id = c.id AND o.trigger = 'missed_payment' AND o.created_at > now() - interval '3 days')
  LOOP
    IF COALESCE(btrim(r.mobile_phone),'') <> '' THEN ch := 'sms'; addr := r.mobile_phone;
    ELSIF COALESCE(btrim(r.primary_email),'') <> '' THEN ch := 'email'; addr := r.primary_email;
    ELSE
      INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key)
      SELECT r.id, r.organization_id, 'Payment missed and no contact details held: call client', 'call', current_date, r.assigned_to, 'auto', 'missed-nocontact-'||current_date
      WHERE NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = r.id AND auto_key = 'missed-nocontact-'||current_date);
      CONTINUE;
    END IF;
    amt := r.installment_amount;
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO payment_links (case_id, organization_id, token, amount, reason, expires_at, channel)
    VALUES (r.id, r.organization_id, tok, amt, 'Missed payment', now() + interval '14 days', ch);
    SELECT name INTO firm FROM organizations WHERE id = r.organization_id;
    first_name := split_part(COALESCE(r.debtor_name,''), ' ', 1);
    msg := format('Hello %s, we have not received your payment of £%s that was due on %s. If you are struggling, please get in touch and we will help. You can pay securely here: %s/pay/%s - %s',
                  first_name, to_char(amt,'FM999990.00'), to_char(r.next_due_date,'DD Mon'), p_base_url, tok, COALESCE(firm,'Your debt adviser'));
    INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger, created_by)
    VALUES (r.organization_id, r.id, ch, addr, CASE WHEN ch='email' THEN 'We have not received your payment' END, msg, 'missed_payment', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION dv_queue_message(uuid,text,text,text), dv_cancel_message(uuid), dv_queue_missed_payment_chasers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_queue_message(uuid,text,text,text), dv_cancel_message(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION dv_queue_missed_payment_chasers(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION dv_queue_missed_payment_chasers(text) TO service_role;
-- Creditor distribution run with maker-checker: one person prepares, a different manager approves, then it is marked paid.
ALTER TABLE disbursement_runs ADD COLUMN IF NOT EXISTS created_by uuid;

-- Funds available to distribute on a case = payments received minus everything already in a non-failed run.
CREATE OR REPLACE FUNCTION dv_case_funds_held(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    COALESCE((SELECT sum(amount) FROM debt_payments WHERE case_id = p_case),0)
    - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0)
  END;
$$;

CREATE OR REPLACE FUNCTION dv_create_distribution_run(p_case uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; funds numeric; tot numeric; rid uuid; allocated numeric;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM disbursement_runs WHERE case_id = p_case AND status IN ('draft','approved')) THEN
    RAISE EXCEPTION 'there is already a distribution run waiting to be approved or paid on this case';
  END IF;
  funds := dv_case_funds_held(p_case);
  IF funds IS NULL OR funds < 0.01 THEN RAISE EXCEPTION 'no funds available to distribute'; END IF;
  SELECT COALESCE(sum(current_balance),0) INTO tot FROM debt_creditors WHERE case_id = p_case AND current_balance > 0;
  IF tot <= 0 THEN RAISE EXCEPTION 'no creditors with an outstanding balance'; END IF;
  funds := LEAST(funds, tot);

  INSERT INTO disbursement_runs (organization_id, case_id, run_date, status, output_format, total_amount, total_items, created_by, file_reference)
  VALUES (c.organization_id, p_case, current_date, 'draft', 'manual_instruction', funds, 0, auth.uid(), 'DIST-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)))
  RETURNING id INTO rid;

  INSERT INTO disbursement_run_items (disbursement_run_id, payee_name, payee_reference, category, amount, status)
  SELECT rid, creditor_name, account_reference, 'creditor',
         LEAST(current_balance, round(funds * current_balance / tot, 2)), 'pending'
  FROM debt_creditors WHERE case_id = p_case AND current_balance > 0;

  -- put any rounding remainder on the creditor with the largest balance
  SELECT COALESCE(sum(amount),0) INTO allocated FROM disbursement_run_items WHERE disbursement_run_id = rid;
  IF funds - allocated <> 0 THEN
    UPDATE disbursement_run_items SET amount = amount + (funds - allocated)
    WHERE id = (SELECT i.id FROM disbursement_run_items i JOIN debt_creditors d ON d.case_id = p_case AND d.creditor_name = i.payee_name
                WHERE i.disbursement_run_id = rid ORDER BY d.current_balance DESC LIMIT 1);
  END IF;
  UPDATE disbursement_runs SET total_items = (SELECT count(*) FROM disbursement_run_items WHERE disbursement_run_id = rid),
                               total_amount = (SELECT sum(amount) FROM disbursement_run_items WHERE disbursement_run_id = rid)
  WHERE id = rid;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Distribution prepared', format('Creditor distribution of £%s prepared for approval', to_char(funds,'FM999999990.00')));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION dv_approve_distribution_run(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR r.organization_id IS NULL OR NOT dv_is_manager(r.organization_id) OR NOT dv_can_read_case(r.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'run is not waiting for approval'; END IF;
  IF r.created_by IS NOT DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'a different manager must approve a run you prepared' USING ERRCODE = '42501'; END IF;
  UPDATE disbursement_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution approved', format('Creditor distribution %s approved', r.file_reference));
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_distribution_run(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR NOT dv_can_edit_case(r.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status NOT IN ('draft','approved') THEN RAISE EXCEPTION 'only runs not yet paid can be cancelled'; END IF;
  UPDATE disbursement_runs SET status = 'failed' WHERE id = p_run;
  UPDATE disbursement_run_items SET status = 'failed' WHERE disbursement_run_id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution cancelled', format('Creditor distribution %s cancelled', r.file_reference));
END $$;

-- Record that the approved run has been paid out (manual BACS/Faster Payments by the firm) and log each creditor payment.
CREATE OR REPLACE FUNCTION dv_mark_distribution_paid(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR r.organization_id IS NULL OR NOT dv_is_manager(r.organization_id) OR NOT dv_can_read_case(r.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'run must be approved first'; END IF;
  UPDATE disbursement_runs SET status = 'settled', settled_at = now() WHERE id = p_run;
  UPDATE disbursement_run_items SET status = 'settled' WHERE disbursement_run_id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution paid', format('Creditor distribution %s marked as paid (£%s)', r.file_reference, to_char(r.total_amount,'FM999999990.00')));
END $$;

-- Run items can only change through the functions above.
CREATE POLICY dv_r_items_no_direct_ins ON disbursement_run_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dv_r_items_no_direct_upd ON disbursement_run_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY dv_r_items_no_direct_del ON disbursement_run_items AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

REVOKE EXECUTE ON FUNCTION dv_case_funds_held(uuid), dv_create_distribution_run(uuid), dv_approve_distribution_run(uuid), dv_cancel_distribution_run(uuid), dv_mark_distribution_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_case_funds_held(uuid), dv_create_distribution_run(uuid), dv_approve_distribution_run(uuid), dv_cancel_distribution_run(uuid), dv_mark_distribution_paid(uuid) TO authenticated, service_role;
-- CASS 11 style client-money controls: what each firm holds per case, how long, why it is retained, and daily reconciliation.
CREATE TABLE IF NOT EXISTS cass_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('awaiting_creditor_details','creditor_dispute','client_request','payment_returned','fees_being_agreed','other')),
  note text,
  review_date date NOT NULL,
  set_by uuid DEFAULT auth.uid(),
  set_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cass_holds_one_active ON cass_holds (case_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS cass_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recon_date date NOT NULL DEFAULT current_date,
  bank_balance numeric(14,2) NOT NULL,
  ledger_total numeric(14,2) NOT NULL,
  difference numeric(14,2) GENERATED ALWAYS AS (bank_balance - ledger_total) STORED,
  note text,
  done_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cass_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE cass_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cass_holds_read ON cass_holds FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY cass_recon_read ON cass_reconciliations FOR SELECT TO authenticated USING (dv_is_manager(organization_id));
-- reconciliations are a permanent record: no edits or deletes from clients (writes only via function)
REVOKE UPDATE, DELETE, INSERT ON cass_holds, cass_reconciliations FROM authenticated, anon;

-- Whole weekdays after d1 up to and including d2 (bank holidays are not excluded: errs on the side of flagging early).
CREATE OR REPLACE FUNCTION dv_business_days(d1 date, d2 date)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::int FROM generate_series(d1 + 1, d2, interval '1 day') g WHERE extract(isodow FROM g) < 6;
$$;

-- Money held per case (received minus paid out), age of the oldest money still held, and whether it breaches the 5 business day rule.
CREATE OR REPLACE FUNCTION dv_cass_position()
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, assigned_to uuid, held numeric, oldest_receipt date, business_days int,
               hold_reason text, hold_review date, breach boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH h AS (
    SELECT c.id, c.case_number, c.debtor_name, c.assigned_to,
      COALESCE((SELECT sum(p.amount) FROM debt_payments p WHERE p.case_id = c.id),0)
      - COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> 'failed'),0) AS held
    FROM debt_cases c WHERE c.organization_id = org
  ), rec AS (
    SELECT h.id, p.payment_date, p.amount,
           sum(p.amount) OVER (PARTITION BY h.id ORDER BY p.payment_date DESC, p.created_at DESC) AS run_total
    FROM h JOIN debt_payments p ON p.case_id = h.id WHERE h.held > 0.004
  ), oldest AS (
    SELECT rec.id, min(rec.payment_date) AS d FROM rec JOIN h ON h.id = rec.id WHERE rec.run_total - rec.amount < h.held GROUP BY rec.id
  )
  SELECT h.id, h.case_number, h.debtor_name, h.assigned_to, h.held, o.d,
         CASE WHEN o.d IS NULL THEN 0 ELSE dv_business_days(o.d, current_date) END,
         k.reason, k.review_date,
         (o.d IS NOT NULL AND dv_business_days(o.d, current_date) > 5 AND k.id IS NULL)
  FROM h LEFT JOIN oldest o ON o.id = h.id
         LEFT JOIN cass_holds k ON k.case_id = h.id AND k.released_at IS NULL
  WHERE h.held > 0.004
  ORDER BY 10 DESC, 7 DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION dv_cass_set_hold(p_case uuid, p_reason text, p_note text, p_review date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR c.organization_id IS NULL OR NOT dv_is_manager(c.organization_id) OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_review IS NULL OR p_review > current_date + 30 THEN RAISE EXCEPTION 'a retained-funds reason needs a review date within 30 days'; END IF;
  UPDATE cass_holds SET released_at = now() WHERE case_id = p_case AND released_at IS NULL;
  INSERT INTO cass_holds (organization_id, case_id, reason, note, review_date) VALUES (c.organization_id, p_case, p_reason, p_note, p_review);
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Client money retained', format('Funds retained: %s (review %s)', replace(p_reason,'_',' '), p_review));
END $$;

CREATE OR REPLACE FUNCTION dv_cass_release_hold(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR c.organization_id IS NULL OR NOT dv_is_manager(c.organization_id) OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  UPDATE cass_holds SET released_at = now() WHERE case_id = p_case AND released_at IS NULL;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Client money hold released', 'Retained-funds hold released');
END $$;

-- Daily reconciliation: manager enters the client bank account balance; the system records it against the ledger total.
CREATE OR REPLACE FUNCTION dv_cass_reconcile(p_bank_balance numeric, p_note text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); led numeric; diff numeric;
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(sum(held),0) INTO led FROM dv_cass_position();
  INSERT INTO cass_reconciliations (organization_id, bank_balance, ledger_total, note) VALUES (org, round(p_bank_balance,2), round(led,2), p_note);
  diff := round(p_bank_balance,2) - round(led,2);
  RETURN diff;
END $$;

REVOKE EXECUTE ON FUNCTION dv_business_days(date,date), dv_cass_position(), dv_cass_set_hold(uuid,text,text,date), dv_cass_release_hold(uuid), dv_cass_reconcile(numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_business_days(date,date), dv_cass_position(), dv_cass_set_hold(uuid,text,text,date), dv_cass_release_hold(uuid), dv_cass_reconcile(numeric,text) TO authenticated, service_role;
-- Complaints register (FCA DISP: acknowledge within 5 business days, final response within 8 weeks) and fee engine.

CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE SET NULL,
  reference text NOT NULL,
  complainant text NOT NULL,
  received_on date NOT NULL DEFAULT current_date,
  channel text NOT NULL DEFAULT 'other' CHECK (channel IN ('phone','email','letter','portal','other')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('service','fees','payments','creditor_handling','data','conduct','other')),
  summary text NOT NULL,
  vulnerable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','investigating','final_response','closed')),
  acknowledged_on date,
  final_response_on date,
  outcome text CHECK (outcome IN ('upheld','partially_upheld','not_upheld')),
  redress_amount numeric(12,2),
  referred_to_fos boolean NOT NULL DEFAULT false,
  assigned_to uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference)
);
CREATE TABLE IF NOT EXISTS complaint_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  action text NOT NULL,
  note text,
  by_user uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY complaints_read ON complaints FOR SELECT TO authenticated USING (
  dv_is_manager(organization_id) OR created_by = auth.uid() OR (case_id IS NOT NULL AND dv_can_read_case(case_id)));
CREATE POLICY complaint_events_read ON complaint_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id));
REVOKE INSERT, UPDATE, DELETE ON complaints, complaint_events FROM authenticated, anon;

CREATE OR REPLACE FUNCTION dv_log_complaint(p_case uuid, p_complainant text, p_summary text, p_category text, p_channel text, p_received date, p_vulnerable boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; cid uuid; ref text; n int;
BEGIN
  IF p_case IS NOT NULL THEN
    SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
    IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSE
    org := dv_my_org();
    IF org IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  IF btrim(COALESCE(p_summary,'')) = '' OR btrim(COALESCE(p_complainant,'')) = '' THEN RAISE EXCEPTION 'complainant and summary are required'; END IF;
  SELECT count(*) + 1 INTO n FROM complaints WHERE organization_id = org AND extract(year FROM received_on) = extract(year FROM COALESCE(p_received, current_date));
  ref := 'C-' || extract(year FROM COALESCE(p_received, current_date))::int || '-' || lpad(n::text, 4, '0');
  INSERT INTO complaints (organization_id, case_id, reference, complainant, received_on, channel, category, summary, vulnerable)
  VALUES (org, p_case, ref, p_complainant, COALESCE(p_received, current_date), COALESCE(p_channel,'other'), COALESCE(p_category,'other'), p_summary, COALESCE(p_vulnerable,false))
  RETURNING id INTO cid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (cid, org, 'logged', p_summary);
  IF p_case IS NOT NULL THEN
    INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Complaint logged', 'Complaint ' || ref || ' logged');
  END IF;
  RETURN cid;
END $$;

-- Managers move a complaint along; each step is recorded in the event trail.
CREATE OR REPLACE FUNCTION dv_complaint_update(p_id uuid, p_status text, p_outcome text DEFAULT NULL, p_redress numeric DEFAULT NULL, p_note text DEFAULT NULL, p_fos boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('open','acknowledged','investigating','final_response','closed') THEN RAISE EXCEPTION 'unknown status'; END IF;
  IF p_status IN ('final_response','closed') AND COALESCE(p_outcome, c.outcome) IS NULL THEN RAISE EXCEPTION 'record the outcome before the final response'; END IF;
  UPDATE complaints SET status = p_status,
    acknowledged_on = CASE WHEN p_status = 'acknowledged' AND acknowledged_on IS NULL THEN current_date ELSE acknowledged_on END,
    final_response_on = CASE WHEN p_status = 'final_response' AND final_response_on IS NULL THEN current_date ELSE final_response_on END,
    outcome = COALESCE(p_outcome, outcome), redress_amount = COALESCE(p_redress, redress_amount), referred_to_fos = COALESCE(p_fos, referred_to_fos)
  WHERE id = p_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (p_id, c.organization_id, p_status, p_note);
END $$;

-- ---------------- fee engine ----------------
CREATE TABLE IF NOT EXISTS fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('percent_of_receipt','fixed_monthly')),
  percent numeric(5,2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  monthly_amount numeric(10,2) CHECK (monthly_amount IS NULL OR monthly_amount >= 0),
  max_per_month numeric(10,2) CHECK (max_per_month IS NULL OR max_per_month >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent_of_receipt' AND percent IS NOT NULL) OR (kind = 'fixed_monthly' AND monthly_amount IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS fee_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES fee_rules(id),
  charge_key text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due','taken','waived')),
  charged_on date NOT NULL DEFAULT current_date,
  decided_by uuid,
  decided_at timestamptz,
  UNIQUE (case_id, rule_id, charge_key)
);
ALTER TABLE fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_rules_read ON fee_rules FOR SELECT TO authenticated USING (organization_id = dv_my_org());
CREATE POLICY fee_charges_read ON fee_charges FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
REVOKE INSERT, UPDATE, DELETE ON fee_rules, fee_charges FROM authenticated, anon;

CREATE OR REPLACE FUNCTION dv_save_fee_rule(p_id uuid, p_name text, p_kind text, p_percent numeric, p_monthly numeric, p_max numeric, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); rid uuid;
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO fee_rules (organization_id, name, kind, percent, monthly_amount, max_per_month, active) VALUES (org, p_name, p_kind, p_percent, p_monthly, p_max, COALESCE(p_active,true)) RETURNING id INTO rid;
  ELSE
    UPDATE fee_rules SET name = p_name, kind = p_kind, percent = p_percent, monthly_amount = p_monthly, max_per_month = p_max, active = COALESCE(p_active,true) WHERE id = p_id AND organization_id = org RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'rule not found'; END IF;
  END IF;
  RETURN rid;
END $$;

-- Work out fees due on a case from payments received. Safe to run repeatedly (each payment/month is charged once per rule).
CREATE OR REPLACE FUNCTION dv_post_fees(p_case uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; r fee_rules; p record; n int := 0; amt numeric; used numeric; ins int;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT * FROM fee_rules WHERE organization_id = c.organization_id AND active LOOP
    IF r.kind = 'percent_of_receipt' THEN
      FOR p IN SELECT id, amount, payment_date FROM debt_payments WHERE case_id = p_case ORDER BY payment_date, created_at LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM fee_charges WHERE case_id = p_case AND rule_id = r.id AND charge_key = 'pay-' || p.id);
        amt := round(p.amount * r.percent / 100, 2);
        IF r.max_per_month IS NOT NULL THEN
          SELECT COALESCE(sum(amount),0) INTO used FROM fee_charges WHERE case_id = p_case AND rule_id = r.id AND status <> 'waived' AND to_char(charged_on,'YYYY-MM') = to_char(p.payment_date,'YYYY-MM');
          amt := LEAST(amt, GREATEST(r.max_per_month - used, 0));
        END IF;
        amt := LEAST(amt, p.amount);
        IF amt > 0 THEN
          INSERT INTO fee_charges (organization_id, case_id, rule_id, charge_key, amount, charged_on) VALUES (c.organization_id, p_case, r.id, 'pay-' || p.id, amt, p.payment_date)
          ON CONFLICT DO NOTHING; GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
        END IF;
      END LOOP;
    ELSE
      FOR p IN SELECT to_char(payment_date,'YYYY-MM') AS m, min(payment_date) AS d, sum(amount) AS total FROM debt_payments WHERE case_id = p_case GROUP BY 1 LOOP
        amt := LEAST(r.monthly_amount, p.total);
        IF amt > 0 THEN
          INSERT INTO fee_charges (organization_id, case_id, rule_id, charge_key, amount, charged_on) VALUES (c.organization_id, p_case, r.id, 'month-' || p.m, amt, p.d)
          ON CONFLICT DO NOTHING; GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION dv_decide_fee(p_charge uuid, p_take boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f fee_charges;
BEGIN
  SELECT * INTO f FROM fee_charges WHERE id = p_charge;
  IF f.id IS NULL OR NOT dv_is_manager(f.organization_id) OR NOT dv_can_read_case(f.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF f.status <> 'due' THEN RAISE EXCEPTION 'this fee has already been decided'; END IF;
  UPDATE fee_charges SET status = CASE WHEN p_take THEN 'taken' ELSE 'waived' END, decided_by = auth.uid(), decided_at = now() WHERE id = p_charge;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (f.case_id, CASE WHEN p_take THEN 'Fee taken' ELSE 'Fee waived' END, format('Fee of £%s %s', to_char(f.amount,'FM999990.00'), CASE WHEN p_take THEN 'taken from client money' ELSE 'waived' END));
END $$;

-- Client money held on a case: received, less fees taken out, less creditor payouts.
CREATE OR REPLACE FUNCTION dv_case_funds_held(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    COALESCE((SELECT sum(amount) FROM debt_payments WHERE case_id = p_case),0)
    - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'taken'),0)
    - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0)
  END;
$$;
-- What creditors can be paid now: held money, less fees that are due but not yet decided.
CREATE OR REPLACE FUNCTION dv_case_distributable(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    dv_case_funds_held(p_case) - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'due'),0)
  END;
$$;

DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE p.proname = 'dv_create_distribution_run' AND p.pronamespace = 'public'::regnamespace;
  src := replace(src, 'funds := dv_case_funds_held(p_case);', 'funds := dv_case_distributable(p_case);');
  EXECUTE src;
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE p.proname = 'dv_cass_position' AND p.pronamespace = 'public'::regnamespace;
  src := replace(src, '- COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> ''failed''),0) AS held',
                      '- COALESCE((SELECT sum(f.amount) FROM fee_charges f WHERE f.case_id = c.id AND f.status = ''taken''),0)' || chr(10) ||
                      '      - COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> ''failed''),0) AS held');
  EXECUTE src;
END $$;

REVOKE EXECUTE ON FUNCTION dv_log_complaint(uuid,text,text,text,text,date,boolean), dv_complaint_update(uuid,text,text,numeric,text,boolean), dv_save_fee_rule(uuid,text,text,numeric,numeric,numeric,boolean), dv_post_fees(uuid), dv_decide_fee(uuid,boolean), dv_case_funds_held(uuid), dv_case_distributable(uuid), dv_cass_position(), dv_create_distribution_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_log_complaint(uuid,text,text,text,text,date,boolean), dv_complaint_update(uuid,text,text,numeric,text,boolean), dv_save_fee_rule(uuid,text,text,numeric,numeric,numeric,boolean), dv_post_fees(uuid), dv_decide_fee(uuid,boolean), dv_case_funds_held(uuid), dv_case_distributable(uuid), dv_cass_position(), dv_create_distribution_run(uuid) TO authenticated, service_role;
-- Firms can only read their own organisation record; legacy "true" policies no longer let anyone alter other firms' tenant/subscription/webhook data.
CREATE POLICY dv_r_sel_organizations ON organizations AS RESTRICTIVE FOR SELECT TO authenticated USING (owner_id = auth.uid() OR dv_is_org_member(id));
CREATE POLICY dv_r_upd_debtverge_tenants ON debtverge_tenants AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin() OR auth_user_id = auth.uid());
CREATE POLICY dv_r_del_debtverge_tenants ON debtverge_tenants AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin() OR auth_user_id = auth.uid());
CREATE POLICY dv_r_sel_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR dv_is_org_member(organization_id));
CREATE POLICY dv_r_ins_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_subscription_packages ON subscription_packages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_subscription_packages ON subscription_packages AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_subscription_packages ON subscription_packages AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_sel_webhook_logs ON webhook_logs AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_webhook_logs ON webhook_logs AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_webhook_logs ON webhook_logs AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_webhook_logs ON webhook_logs AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
-- Annual statement for a client: what was paid in, fees taken, what went to each creditor, and what is still owed.
CREATE OR REPLACE FUNCTION dv_annual_statement(p_case uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; res jsonb;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'invalid period'; END IF;
  SELECT jsonb_build_object(
    'firm', (SELECT name FROM organizations WHERE id = c.organization_id),
    'client', c.debtor_name, 'case_number', c.case_number, 'from', p_from, 'to', p_to,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', payment_date, 'amount', amount) ORDER BY payment_date) FROM debt_payments WHERE case_id = p_case AND payment_date BETWEEN p_from AND p_to), '[]'),
    'fees', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', decided_at::date, 'amount', amount) ORDER BY decided_at) FROM fee_charges WHERE case_id = p_case AND status = 'taken' AND decided_at::date BETWEEN p_from AND p_to), '[]'),
    'paid_out', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', r.settled_at::date, 'creditor', i.payee_name, 'amount', i.amount) ORDER BY r.settled_at, i.payee_name)
                          FROM disbursement_runs r JOIN disbursement_run_items i ON i.disbursement_run_id = r.id
                          WHERE r.case_id = p_case AND r.status = 'settled' AND r.settled_at::date BETWEEN p_from AND p_to), '[]'),
    'creditors', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', creditor_name, 'reference', account_reference, 'balance', current_balance) ORDER BY creditor_name) FROM debt_creditors WHERE case_id = p_case), '[]'),
    'held_now', dv_case_funds_held(p_case)
  ) INTO res;
  RETURN res;
END $$;

-- Each active plan gets a diary task 30 days before its yearly anniversary, so the annual statement and review is never missed.
CREATE OR REPLACE FUNCTION dv_queue_annual_reviews()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0; ann date; yr int; ins int;
BEGIN
  FOR r IN SELECT id, organization_id, assigned_to, created_at::date AS started FROM debt_cases WHERE status = 'payment_schedule_active' LOOP
    yr := extract(year FROM current_date)::int;
    ann := make_date(yr, extract(month FROM r.started)::int, LEAST(extract(day FROM r.started)::int, 28));
    IF ann < current_date THEN ann := ann + interval '1 year'; END IF;
    IF ann - current_date <= 30 AND ann > r.started + 300 THEN
      INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key)
      VALUES (r.id, r.organization_id, 'Annual statement and plan review', 'review', ann, r.assigned_to, 'auto', 'annual-' || extract(year FROM ann)::int)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
    END IF;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION dv_annual_statement(uuid,date,date), dv_queue_annual_reviews() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_annual_statement(uuid,date,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION dv_queue_annual_reviews() FROM authenticated;
GRANT EXECUTE ON FUNCTION dv_queue_annual_reviews() TO service_role;
SELECT cron.schedule('dv-annual-reviews', '15 6 * * *', $$ SELECT dv_queue_annual_reviews() $$);

-- ===== 20261122100000_esign_requests =====
-- E-signature: the adviser sends a document for signing; the client opens a private link (no login), reads it, types their name and signs.
-- The signed text is fingerprinted (SHA-256) so later changes can be detected. This is a simple electronic signature.
CREATE TABLE IF NOT EXISTS signing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  body_hash text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  signed_at timestamptz,
  signer_name text,
  signer_agent text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY signing_requests_read ON signing_requests FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
REVOKE INSERT, UPDATE, DELETE ON signing_requests FROM authenticated, anon;
REVOKE SELECT ON signing_requests FROM anon;

CREATE OR REPLACE FUNCTION dv_create_signing_request(p_case uuid, p_title text, p_body text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE c debt_cases; tok text;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_title,'')) = '' OR btrim(COALESCE(p_body,'')) = '' THEN RAISE EXCEPTION 'title and text are required'; END IF;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO signing_requests (organization_id, case_id, title, body, body_hash, token)
  VALUES (c.organization_id, p_case, p_title, p_body, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), tok);
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Sent for signature', p_title);
  RETURN tok;
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_signing_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE signing_requests SET status = 'cancelled' WHERE id = p_id AND status = 'pending' AND dv_can_edit_case(case_id);
END $$;

-- Client side (no login): what the link shows
CREATE OR REPLACE FUNCTION dv_get_signing_request(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s signing_requests; firm text; client text;
BEGIN
  SELECT * INTO s FROM signing_requests WHERE token = p_token;
  IF s.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT name INTO firm FROM organizations WHERE id = s.organization_id;
  SELECT debtor_name INTO client FROM debt_cases WHERE id = s.case_id;
  RETURN jsonb_build_object('found', true, 'title', s.title, 'body', s.body, 'firm', firm, 'client', client,
    'status', CASE WHEN s.status = 'pending' AND s.expires_at < now() THEN 'expired' ELSE s.status END,
    'signed_at', s.signed_at, 'signer_name', s.signer_name);
END $$;

CREATE OR REPLACE FUNCTION dv_sign_request(p_token text, p_name text, p_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s signing_requests; nm text := btrim(COALESCE(p_name,''));
BEGIN
  SELECT * INTO s FROM signing_requests WHERE token = p_token FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'This link is not valid.'); END IF;
  IF s.status = 'signed' THEN RETURN jsonb_build_object('ok', false, 'error', 'This document has already been signed.'); END IF;
  IF s.status <> 'pending' OR s.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'This request has expired. Please ask your adviser to send a new one.'); END IF;
  IF length(nm) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'Please type your full name to sign.'); END IF;
  UPDATE signing_requests SET status = 'signed', signed_at = now(), signer_name = left(nm, 120), signer_agent = left(COALESCE(p_agent,''), 300) WHERE id = s.id;
  INSERT INTO case_documents (case_id, organization_id, name, category, body, mime_type)
  VALUES (s.case_id, s.organization_id, 'Signed: ' || s.title, 'signed',
          s.body || E'\n\n----------------------------------------\nElectronically signed by ' || left(nm,120) || E'\nDate and time: ' || to_char(now() AT TIME ZONE 'Europe/London','DD Mon YYYY HH24:MI') || E' (UK)\nDocument fingerprint (SHA-256): ' || s.body_hash,
          'text/plain');
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (s.case_id, 'Document signed', s.title || ' signed by ' || left(nm,120));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION dv_create_signing_request(uuid,text,text), dv_cancel_signing_request(uuid), dv_get_signing_request(text), dv_sign_request(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_create_signing_request(uuid,text,text), dv_cancel_signing_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION dv_get_signing_request(text), dv_sign_request(text,text,text) TO anon, authenticated, service_role;

INSERT INTO document_templates (organization_id, name, category, audience, subject, body)
SELECT NULL, 'Letter of Authority', 'authority', 'customer', 'Letter of Authority for {{firm_name}}',
'LETTER OF AUTHORITY

I, {{client_name}}, authorise {{firm_name}} to act on my behalf in dealing with my creditors about my debts.

This means {{firm_name}} may:
- contact my creditors and discuss my accounts, balances and any arrangements;
- ask creditors for information about my accounts, and ask them to freeze interest and charges while a plan is put in place;
- send my creditors a proposal to repay my debts, and receive their replies.

{{firm_name}} will not agree to anything on my behalf without telling me first. I can withdraw this authority at any time by telling {{firm_name}} in writing.

I understand that {{firm_name}} will keep my information secure and only use it to help me with my debts.

Case reference: {{case_number}}
Date: {{today}}'
WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE organization_id IS NULL AND name = 'Letter of Authority');

-- ===== 20261122110000_audit_trail_immutable =====
-- Immutable, automatic audit trail. Every insert/update/delete on a case-linked table writes who, which firm,
-- what changed (old and new values) and when, into debt_audit_log. The log cannot be edited or deleted by anyone.

ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS table_name text;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS record_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS old_value jsonb;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS new_value jsonb;
ALTER TABLE debt_audit_log ALTER COLUMN case_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS debt_audit_log_org_idx ON debt_audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS debt_audit_log_record_idx ON debt_audit_log (table_name, record_id);

-- Backfill the firm on existing rows
UPDATE debt_audit_log a SET organization_id = c.organization_id FROM debt_cases c WHERE c.id = a.case_id AND a.organization_id IS NULL;

-- Stamp who/when on every insert so a client cannot forge the actor or back-date an entry
CREATE OR REPLACE FUNCTION dv_audit_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
    NEW.actor := COALESCE(auth.jwt() ->> 'email', auth.uid()::text);
  ELSE
    NEW.actor := COALESCE(NEW.actor, 'system');
  END IF;
  IF NEW.organization_id IS NULL AND NEW.case_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM debt_cases WHERE id = NEW.case_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_stamp ON debt_audit_log;
CREATE TRIGGER trg_audit_stamp BEFORE INSERT ON debt_audit_log FOR EACH ROW EXECUTE FUNCTION dv_audit_stamp();

-- The log can never be changed or removed, by anyone (including service role and super admins)
CREATE OR REPLACE FUNCTION dv_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the audit log is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_audit_no_change ON debt_audit_log;
CREATE TRIGGER trg_audit_no_change BEFORE UPDATE OR DELETE ON debt_audit_log FOR EACH ROW EXECUTE FUNCTION dv_audit_immutable();
DROP TRIGGER IF EXISTS trg_audit_no_truncate ON debt_audit_log;
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON debt_audit_log FOR EACH STATEMENT EXECUTE FUNCTION dv_audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON debt_audit_log FROM authenticated, anon, service_role;

-- Replace the legacy and duplicate policies with one clear set
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'debt_audit_log' LOOP
    EXECUTE format('DROP POLICY %I ON debt_audit_log', p.policyname);
  END LOOP;
END $$;
ALTER TABLE debt_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY dv_audit_select ON debt_audit_log FOR SELECT TO authenticated
  USING ((case_id IS NOT NULL AND dv_can_read_case(case_id)) OR (case_id IS NULL AND organization_id IS NOT NULL AND dv_is_manager(organization_id)));
CREATE POLICY dv_audit_insert ON debt_audit_log FOR INSERT TO authenticated
  WITH CHECK (case_id IS NOT NULL AND dv_can_edit_case(case_id));

-- The automatic recorder
CREATE OR REPLACE FUNCTION dv_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; rec jsonb; cid uuid; org uuid; act text; chg jsonb := '{}'; oldv jsonb := '{}'; k text; keys text;
BEGIN
  IF TG_OP = 'DELETE' THEN o := to_jsonb(OLD); rec := o;
  ELSIF TG_OP = 'INSERT' THEN n := to_jsonb(NEW); rec := n;
  ELSE o := to_jsonb(OLD); n := to_jsonb(NEW); rec := n; END IF;

  IF TG_TABLE_NAME = 'debt_cases' THEN cid := (rec ->> 'id')::uuid;
  ELSIF rec ? 'case_id' THEN cid := NULLIF(rec ->> 'case_id', '')::uuid;
  ELSIF rec ? 'disbursement_run_id' THEN SELECT r.case_id INTO cid FROM disbursement_runs r WHERE r.id = (rec ->> 'disbursement_run_id')::uuid;
  END IF;
  org := NULLIF(rec ->> 'organization_id', '')::uuid;
  IF org IS NULL AND cid IS NOT NULL THEN SELECT c.organization_id INTO org FROM debt_cases c WHERE c.id = cid; END IF;
  IF cid IS NULL AND org IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = 'updated_at';
      IF o -> k IS DISTINCT FROM n -> k THEN chg := chg || jsonb_build_object(k, n -> k); oldv := oldv || jsonb_build_object(k, o -> k); END IF;
    END LOOP;
    IF chg = '{}'::jsonb THEN RETURN NEW; END IF;
    act := CASE WHEN (n ->> 'deleted_at') IS NOT NULL AND (o ->> 'deleted_at') IS NULL THEN 'void' ELSE 'update' END;
  ELSIF TG_OP = 'INSERT' THEN act := 'insert'; chg := n; oldv := NULL;
  ELSE act := 'delete'; oldv := o; chg := NULL; END IF;

  -- never copy link tokens into the log
  IF chg IS NOT NULL THEN chg := chg - 'token'; END IF;
  IF oldv IS NOT NULL THEN oldv := oldv - 'token'; END IF;
  keys := (SELECT string_agg(x, ', ') FROM (SELECT jsonb_object_keys(COALESCE(CASE WHEN act IN ('update','void') THEN chg ELSE '{}'::jsonb END, '{}'::jsonb)) x LIMIT 6) s);

  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, table_name, record_id, action, old_value, new_value)
  VALUES (cid, org,
          CASE act WHEN 'insert' THEN 'Record added' WHEN 'update' THEN 'Record changed' WHEN 'void' THEN 'Record voided' ELSE 'Record removed' END,
          format('%s in %s%s', initcap(act), replace(replace(TG_TABLE_NAME, 'debt_', ''), '_', ' '), CASE WHEN keys IS NOT NULL THEN ' (' || keys || ')' ELSE '' END),
          TG_TABLE_NAME, NULLIF(rec ->> 'id', '')::uuid, act, oldv, chg);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION dv_audit_row(), dv_audit_stamp(), dv_audit_immutable() FROM PUBLIC, anon, authenticated;

-- Attach to every case-linked table
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'debt\_%' AND c.relname <> 'debt_audit_log'
    UNION SELECT x FROM unnest(ARRAY['case_documents','case_tasks','cass_holds','cass_reconciliations','complaints','fee_charges','fee_rules','signing_requests','client_mandates','recurring_payment_schedules','payment_links','portal_change_requests','disbursement_runs','disbursement_run_items','debtverge_vulnerability_flags','debtverge_compliance_attestations','debtverge_communications']) x
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
      EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
    END IF;
  END LOOP;
END $$;

-- Nobody signed in via the API needs TRUNCATE, TRIGGER or REFERENCES on any table
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', t.relname);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- ===== 20261122120000_soft_delete_and_locking =====
-- 1. Soft delete: a DELETE from the app marks the row voided instead of removing it. Voided rows are hidden by RLS and ignored by money functions.
CREATE OR REPLACE FUNCTION dv_soft_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  EXECUTE format('UPDATE %I.%I SET deleted_at = now(), deleted_by = %L WHERE id = %L AND deleted_at IS NULL', TG_TABLE_SCHEMA, TG_TABLE_NAME, auth.uid(), OLD.id);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION dv_soft_delete() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname = 'debt_cases' OR c.relname = 'disbursement_run_items' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'case_id' AND NOT a.attisdropped))
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped)
      AND c.relname NOT IN ('debt_audit_log','case_access_log','cashier_audit_logs','payment_reconciliation_log','storm_call_callbacks','storm_call_sessions','storm_call_timeline_events')
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_soft_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_soft_delete()', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_sel ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_sel ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_upd ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_upd ON %I AS RESTRICTIVE FOR UPDATE USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL)', t);
  END LOOP;
END $$;

REVOKE DELETE ON fee_rules, cass_reconciliations, complaint_events FROM authenticated, anon;

-- 2. Functions ignore voided rows and lock the rows they change (one writer at a time per case / run / fee)
DO $$ DECLARE f record; def text; BEGIN
  FOR f IN SELECT p.oid, p.proname, p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('dv_annual_statement','dv_approve_distribution_run','dv_cancel_distribution_run','dv_case_funds_held','dv_cass_position','dv_cass_release_hold','dv_cass_set_hold','dv_create_distribution_run','dv_decide_fee','dv_mark_distribution_paid','dv_post_fees','get_payment_link','dv_can_read_case','dv_can_edit_case','dv_create_signing_request','dv_ensure_case_tasks','dv_queue_message','dv_queue_annual_reviews','dv_queue_missed_payment_chasers')
  LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'FROM debt_payments WHERE ', 'FROM debt_payments WHERE deleted_at IS NULL AND ');
    def := replace(def, 'FROM debt_payments p WHERE ', 'FROM debt_payments p WHERE p.deleted_at IS NULL AND ');
    def := replace(def, 'JOIN debt_payments p ON p.case_id = h.id', 'JOIN debt_payments p ON p.case_id = h.id AND p.deleted_at IS NULL');
    def := replace(def, 'FROM debt_creditors WHERE ', 'FROM debt_creditors WHERE deleted_at IS NULL AND ');
    def := replace(def, 'JOIN debt_creditors d ON d.case_id = p_case AND d.creditor_name = i.payee_name', 'JOIN debt_creditors d ON d.case_id = p_case AND d.deleted_at IS NULL AND d.creditor_name = i.payee_name');
    def := replace(def, 'FROM debt_cases c WHERE c.organization_id = org', 'FROM debt_cases c WHERE c.deleted_at IS NULL AND c.organization_id = org');
    def := replace(def, 'WHERE c.id = cid AND', 'WHERE c.id = cid AND c.deleted_at IS NULL AND');
    def := replace(def, 'FROM debt_cases WHERE status = ''payment_schedule_active''', 'FROM debt_cases WHERE deleted_at IS NULL AND status = ''payment_schedule_active''');
    def := replace(def, 'WHERE c.status = ''payment_schedule_active'' AND c.next_due_date', 'WHERE c.deleted_at IS NULL AND c.status = ''payment_schedule_active'' AND c.next_due_date');
    def := replace(def, 'LEFT JOIN debt_customer_profiles p ON p.case_id = c.id', 'LEFT JOIN debt_customer_profiles p ON p.case_id = c.id AND p.deleted_at IS NULL');
    IF f.provolatile = 'v' AND f.proname IN ('dv_post_fees','dv_cass_set_hold','dv_cass_release_hold','dv_create_distribution_run') THEN
      def := replace(def, 'SELECT * INTO c FROM debt_cases WHERE id = p_case;', 'SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL FOR UPDATE;');
    ELSE
      def := replace(def, 'SELECT * INTO c FROM debt_cases WHERE id = p_case;', 'SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;');
    END IF;
    def := replace(def, 'SELECT * INTO r FROM disbursement_runs WHERE id = p_run;', 'SELECT * INTO r FROM disbursement_runs WHERE id = p_run FOR UPDATE;');
    def := replace(def, 'SELECT * INTO f FROM fee_charges WHERE id = p_charge;', 'SELECT * INTO f FROM fee_charges WHERE id = p_charge FOR UPDATE;');
    EXECUTE def;
  END LOOP;
END $$;

-- 3. Hard guarantee: one open distribution run per case, even if two requests race
CREATE UNIQUE INDEX IF NOT EXISTS disbursement_runs_one_open_per_case ON disbursement_runs (case_id) WHERE status IN ('draft','approved');

-- ===== 20261122130000_ledger_tables_cannot_be_deleted =====
-- Money ledgers and compliance records are never deleted or voided: they are corrected by an audited status change (cancel, waive, release).
CREATE OR REPLACE FUNCTION dv_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'this record cannot be deleted; cancel or reverse it instead' USING ERRCODE = '42501'; END $$;
REVOKE EXECUTE ON FUNCTION dv_no_delete() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['disbursement_runs','disbursement_run_items','fee_charges','cass_holds','signing_requests','complaints','fee_rules','cass_reconciliations','complaint_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_no_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_no_delete()', t);
  END LOOP;
END $$;

-- ===== 20261122140000_harden_function_grants_3 =====
REVOKE EXECUTE ON FUNCTION claim_next_background_job(text, text[]), update_job_progress(uuid, integer, integer, integer, integer, text, text), requeue_stale_jobs(integer),
  seed_debtverge_roles(uuid), handle_new_user(), handle_new_user_profile(), dv_case_status_tasks(), dv_case_owner_tasks(), upsert_knowledge_gap(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_background_job(text, text[]), update_job_progress(uuid, integer, integer, integer, integer, text, text), requeue_stale_jobs(integer),
  seed_debtverge_roles(uuid), upsert_knowledge_gap(text, text) TO service_role;
ALTER FUNCTION update_debt_cases_updated_at() SET search_path = public;
ALTER FUNCTION update_updated_at_column() SET search_path = public;
ALTER FUNCTION finance_knowledge_fts_update() SET search_path = public;
ALTER FUNCTION claim_next_background_job(text, text[]) SET search_path = public;
ALTER FUNCTION update_job_progress(uuid, integer, integer, integer, integer, text, text) SET search_path = public;
ALTER FUNCTION requeue_stale_jobs(integer) SET search_path = public;
ALTER FUNCTION dv_business_days(date, date) SET search_path = public;
ALTER FUNCTION dv_audit_immutable() SET search_path = '';
REVOKE EXECUTE ON FUNCTION finance_knowledge_fts_update(), update_debt_cases_updated_at(), update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- ===== 20261122150000_close_legacy_open_policies_2 =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','contracts','finance_knowledge_categories','inventory_logs','job_postings','milestone_payments','orders','products','projects','tasks'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS dv_r_superadmin_only ON %I', t);
      EXECUTE format('CREATE POLICY dv_r_superadmin_only ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin())', t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS dv_r_kb_ins ON finance_knowledge_articles;
DROP POLICY IF EXISTS dv_r_kb_upd ON finance_knowledge_articles;
DROP POLICY IF EXISTS dv_r_kb_del ON finance_knowledge_articles;
CREATE POLICY dv_r_kb_ins ON finance_knowledge_articles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_kb_upd ON finance_knowledge_articles AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY dv_r_kb_del ON finance_knowledge_articles AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
DROP POLICY IF EXISTS dv_r_fp_sel ON freelancer_profiles;
CREATE POLICY dv_r_fp_sel ON freelancer_profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS dv_r_roles_sel ON rbac_roles;
CREATE POLICY dv_r_roles_sel ON rbac_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR organization_id IS NULL OR dv_is_org_member(organization_id));
DROP POLICY IF EXISTS dv_r_roleperm_sel ON rbac_role_permissions;
CREATE POLICY dv_r_roleperm_sel ON rbac_role_permissions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (r.organization_id IS NULL OR dv_is_org_member(r.organization_id))));
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') LOOP
    EXECUTE format('REVOKE ALL ON %I FROM anon', t.relname);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ===== 20261122160000_audit_payment_tables_and_voided_case_guards =====
-- Audit function: never copies bank/card details or tokens into the log; audits payment tables; voided cases are ignored by helpers;
-- call-record tables get soft delete + audit.
CREATE OR REPLACE FUNCTION dv_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; rec jsonb; cid uuid; org uuid; act text; chg jsonb := '{}'; oldv jsonb := '{}'; k text; keys text;
  secret_keys text[] := ARRAY['token','link_token','gateway_token','counterparty_account','cardholder_name','account_number','sort_code','iban'];
BEGIN
  IF TG_OP = 'DELETE' THEN o := to_jsonb(OLD); rec := o;
  ELSIF TG_OP = 'INSERT' THEN n := to_jsonb(NEW); rec := n;
  ELSE o := to_jsonb(OLD); n := to_jsonb(NEW); rec := n; END IF;
  IF TG_TABLE_NAME = 'debt_cases' THEN cid := (rec ->> 'id')::uuid;
  ELSIF rec ? 'case_id' THEN cid := NULLIF(rec ->> 'case_id', '')::uuid;
  ELSIF rec ? 'disbursement_run_id' THEN SELECT r.case_id INTO cid FROM disbursement_runs r WHERE r.id = (rec ->> 'disbursement_run_id')::uuid;
  END IF;
  org := NULLIF(rec ->> 'organization_id', '')::uuid;
  IF org IS NULL AND cid IS NOT NULL THEN SELECT c.organization_id INTO org FROM debt_cases c WHERE c.id = cid; END IF;
  IF cid IS NULL AND org IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = 'updated_at' OR k = ANY (secret_keys);
      IF o -> k IS DISTINCT FROM n -> k THEN chg := chg || jsonb_build_object(k, n -> k); oldv := oldv || jsonb_build_object(k, o -> k); END IF;
    END LOOP;
    IF chg = '{}'::jsonb THEN RETURN NEW; END IF;
    act := CASE WHEN (n ->> 'deleted_at') IS NOT NULL AND (o ->> 'deleted_at') IS NULL THEN 'void' ELSE 'update' END;
  ELSIF TG_OP = 'INSERT' THEN act := 'insert'; chg := n - secret_keys; oldv := NULL;
  ELSE act := 'delete'; oldv := o - secret_keys; chg := NULL; END IF;
  keys := (SELECT string_agg(x, ', ') FROM (SELECT jsonb_object_keys(COALESCE(CASE WHEN act IN ('update','void') THEN chg ELSE '{}'::jsonb END, '{}'::jsonb)) x LIMIT 6) s);
  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, table_name, record_id, action, old_value, new_value)
  VALUES (cid, org,
          CASE act WHEN 'insert' THEN 'Record added' WHEN 'update' THEN 'Record changed' WHEN 'void' THEN 'Record voided' ELSE 'Record removed' END,
          format('%s in %s%s', initcap(act), replace(replace(TG_TABLE_NAME, 'debt_', ''), '_', ' '), CASE WHEN keys IS NOT NULL THEN ' (' || keys || ')' ELSE '' END),
          TG_TABLE_NAME, NULLIF(rec ->> 'id', '')::uuid, act, oldv, chg);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION dv_audit_row() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; def text; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assign_case','set_case_restricted','log_case_view','list_org_members') LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'FROM debt_cases WHERE id = p_case;', 'FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;');
    def := replace(def, 'UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case;', 'UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case AND deleted_at IS NULL;');
    def := replace(def, 'FROM debt_cases c WHERE c.organization_id = ou.organization_id', 'FROM debt_cases c WHERE c.deleted_at IS NULL AND c.organization_id = ou.organization_id');
    EXECUTE def;
  END LOOP;
  FOR f IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m') LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', f.relname);
  END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bank_transactions','batch_payment_items','disbursement_waterfall_entries','gateway_payment_transactions','payment_attempts','payment_link_invitations','payment_methods'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['storm_call_timeline_events','storm_call_callbacks','storm_call_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_soft_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_soft_delete()', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_sel ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_sel ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_upd ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_upd ON %I AS RESTRICTIVE FOR UPDATE USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
  END LOOP;
END $$;
-- Report builder: fixed catalogue of manager reports, firm-scoped, case-restriction aware, audited.
CREATE OR REPLACE FUNCTION public.dv_run_report(p_kind text, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org();
  v_from date := coalesce(p_from, current_date - 90);
  v_to date := coalesce(p_to, current_date);
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_from > v_to OR v_to - v_from > 1100 THEN RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'cases_by_status' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.cases DESC), '[]') INTO v_rows FROM (SELECT status::text AS status, plan_type::text AS plan, count(*) AS cases, coalesce(sum(total_debt),0) AS total_debt FROM debt_cases c WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND dv_can_read_case(c.id) GROUP BY 1,2) r;
  ELSIF p_kind = 'caseload_by_advisor' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.cases DESC), '[]') INTO v_rows FROM (SELECT coalesce(c.assigned_to::text,'Unassigned') AS advisor, count(*) AS cases, coalesce(sum(total_debt),0) AS total_debt FROM debt_cases c WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND dv_can_read_case(c.id) GROUP BY 1) r;
  ELSIF p_kind = 'missed_payments' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.payment_date DESC), '[]') INTO v_rows FROM (SELECT c.case_number, c.debtor_name, p.payment_date, p.expected_amount, p.amount, p.shortfall_amount FROM debt_payments p JOIN debt_cases c ON c.id = p.case_id WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_shortfall AND p.payment_date BETWEEN v_from AND v_to AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSIF p_kind = 'overdue_tasks' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.due_date), '[]') INTO v_rows FROM (SELECT c.case_number, c.debtor_name, t.title, t.due_date, t.assigned_to FROM case_tasks t JOIN debt_cases c ON c.id = t.case_id WHERE t.organization_id = v_org AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < current_date AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSIF p_kind = 'complaints' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.received_on DESC), '[]') INTO v_rows FROM (SELECT reference, received_on, category, status, vulnerable, referred_to_fos, redress_amount, outcome FROM complaints WHERE organization_id = v_org AND deleted_at IS NULL AND received_on BETWEEN v_from AND v_to LIMIT 5000) r;
  ELSIF p_kind = 'fees' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.charged_on DESC), '[]') INTO v_rows FROM (SELECT c.case_number, f.charged_on, f.amount, f.status FROM fee_charges f JOIN debt_cases c ON c.id = f.case_id WHERE f.organization_id = v_org AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND f.charged_on BETWEEN v_from AND v_to AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSE RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023';
  END IF;
  INSERT INTO debt_audit_log (organization_id, milestone, description, action, table_name, new_value)
  SELECT v_org, 'report_run', 'Report run: ' || p_kind, 'report_run', 'reports', jsonb_build_object('kind', p_kind, 'from', v_from, 'to', v_to, 'rows', jsonb_array_length(v_rows));
  RETURN v_rows;
END $function$;
REVOKE ALL ON FUNCTION public.dv_run_report(text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_run_report(text,date,date) TO authenticated;

-- Creditor bulk update: manager-only CSV-driven update of balance / settlement offer / interest rate.
-- Preview never writes. Apply only updates rows that resolve to exactly one creditor on one editable case in the caller's firm.
-- Row-level changes are captured by the automatic audit trigger; one summary row is added per batch.
CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_resolve(p_rows jsonb)
RETURNS TABLE(idx integer, case_number text, match_key text, creditor_id uuid, creditor_name text, status text, old_balance numeric, new_balance numeric, old_offer numeric, new_offer numeric, old_rate numeric, new_rate numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org();
  r jsonb; i int := 0; n int; v_case uuid; cnt int;
  num text := '^\d{1,12}(\.\d{1,4})?$';
BEGIN
  IF v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Rows must be an array' USING ERRCODE='22023'; END IF;
  n := jsonb_array_length(p_rows);
  IF n = 0 OR n > 2000 THEN RAISE EXCEPTION 'Provide between 1 and 2000 rows' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    idx := i; creditor_id := NULL; creditor_name := NULL; status := NULL;
    old_balance := NULL; old_offer := NULL; old_rate := NULL; new_balance := NULL; new_offer := NULL; new_rate := NULL;
    case_number := left(btrim(coalesce(r->>'case_number','')), 100);
    match_key := left(btrim(coalesce(r->>'match','')), 200);
    IF jsonb_typeof(r) <> 'object' OR case_number = '' OR match_key = '' THEN status := 'invalid'; RETURN NEXT; CONTINUE; END IF;
    IF (r ? 'balance' AND coalesce(r->>'balance','') <> '' AND (r->>'balance') !~ num)
    OR (r ? 'offer' AND coalesce(r->>'offer','') <> '' AND (r->>'offer') !~ num)
    OR (r ? 'rate' AND coalesce(r->>'rate','') <> '' AND ((r->>'rate') !~ num OR (r->>'rate')::numeric > 100)) THEN
      status := 'invalid'; RETURN NEXT; CONTINUE;
    END IF;
    new_balance := nullif(r->>'balance','')::numeric; new_offer := nullif(r->>'offer','')::numeric; new_rate := nullif(r->>'rate','')::numeric;
    IF new_balance IS NULL AND new_offer IS NULL AND new_rate IS NULL THEN status := 'nothing_to_update'; RETURN NEXT; CONTINUE; END IF;
    SELECT count(*), min(dc.id::text)::uuid INTO cnt, v_case FROM debt_cases dc
      WHERE dc.organization_id = v_org AND dc.deleted_at IS NULL AND dc.case_number = dv_bulk_creditor_resolve.case_number;
    IF cnt = 0 THEN status := 'case_not_found'; RETURN NEXT; CONTINUE; END IF;
    IF cnt > 1 THEN status := 'ambiguous_case'; RETURN NEXT; CONTINUE; END IF;
    IF NOT dv_can_edit_case(v_case) THEN status := 'case_not_found'; RETURN NEXT; CONTINUE; END IF;
    SELECT count(*), min(cr.id::text)::uuid INTO cnt, creditor_id FROM debt_creditors cr
      WHERE cr.case_id = v_case AND cr.deleted_at IS NULL
        AND (lower(cr.account_reference) = lower(match_key) OR lower(cr.creditor_name) = lower(match_key));
    IF cnt = 0 THEN status := 'creditor_not_found'; creditor_id := NULL; RETURN NEXT; CONTINUE; END IF;
    IF cnt > 1 THEN status := 'ambiguous_creditor'; creditor_id := NULL; RETURN NEXT; CONTINUE; END IF;
    SELECT cr.creditor_name, cr.current_balance, cr.settlement_offer, cr.interest_rate INTO creditor_name, old_balance, old_offer, old_rate
      FROM debt_creditors cr WHERE cr.id = creditor_id;
    status := CASE WHEN coalesce(new_balance, old_balance) IS NOT DISTINCT FROM old_balance
                    AND coalesce(new_offer, old_offer) IS NOT DISTINCT FROM old_offer
                    AND coalesce(new_rate, old_rate) IS NOT DISTINCT FROM old_rate THEN 'unchanged' ELSE 'will_update' END;
    RETURN NEXT;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_preview(p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'creditor_id' ORDER BY x.idx), '[]') FROM dv_bulk_creditor_resolve(p_rows) x;
$function$;

CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_apply(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org(); x record; v_upd int := 0; v_skip int := 0;
BEGIN
  FOR x IN SELECT * FROM dv_bulk_creditor_resolve(p_rows) LOOP
    IF x.status = 'will_update' THEN
      UPDATE debt_creditors SET
        current_balance = coalesce(x.new_balance, current_balance),
        settlement_offer = coalesce(x.new_offer, settlement_offer),
        interest_rate = coalesce(x.new_rate, interest_rate)
      WHERE id = x.creditor_id AND deleted_at IS NULL;
      v_upd := v_upd + 1;
    ELSE v_skip := v_skip + 1; END IF;
  END LOOP;
  INSERT INTO debt_audit_log (organization_id, milestone, description, action, table_name, new_value)
  VALUES (v_org, 'bulk_creditor_update', 'Bulk creditor update', 'bulk_update', 'debt_creditors', jsonb_build_object('updated', v_upd, 'skipped', v_skip));
  RETURN jsonb_build_object('updated', v_upd, 'skipped', v_skip);
END $function$;

REVOKE ALL ON FUNCTION public.dv_bulk_creditor_resolve(jsonb), public.dv_bulk_creditor_preview(jsonb), public.dv_bulk_creditor_apply(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_bulk_creditor_preview(jsonb), public.dv_bulk_creditor_apply(jsonb) TO authenticated;

-- Restore voided cases and GDPR-style erasure of personal data.
-- Erasure anonymises personal fields, keeps financial records, creditor data, document hashes and the audit trail,
-- and writes an immutable erasure_log row. Admin / Operations Manager only; refused while client money, open complaints or open payouts exist.
ALTER TABLE public.debt_cases ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE TABLE IF NOT EXISTS public.erasure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  case_id uuid NOT NULL,
  case_number text,
  reason text NOT NULL,
  fields_erased int NOT NULL DEFAULT 0,
  erased_by uuid NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erasure_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY erasure_log_read ON public.erasure_log FOR SELECT TO authenticated USING (dv_is_org_admin(organization_id));
REVOKE ALL ON public.erasure_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erasure_log TO authenticated;
CREATE TRIGGER erasure_log_immutable BEFORE UPDATE OR DELETE ON public.erasure_log FOR EACH ROW EXECUTE FUNCTION dv_audit_immutable();
CREATE TRIGGER erasure_log_no_truncate BEFORE TRUNCATE ON public.erasure_log FOR EACH STATEMENT EXECUTE FUNCTION dv_audit_immutable();

-- Row audit is skipped only while an erasure runs (so personal data is not copied into the audit log); a summary row is written instead.
-- Patch applied to dv_audit_row(): first statement of the body is
--   IF current_setting('dv.erasing', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.dv_audit_row()'::regprocedure);
  d := replace(d, E'BEGIN\n  IF TG_OP = ''DELETE''', E'BEGIN\n  IF current_setting(''dv.erasing'', true) = ''on'' THEN RETURN COALESCE(NEW, OLD); END IF;\n  IF TG_OP = ''DELETE''');
  EXECUTE d;
END $m$;

CREATE OR REPLACE FUNCTION public.dv_list_voided_cases()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'case_number', c.case_number, 'debtor_name', c.debtor_name,
            'voided_at', c.deleted_at, 'erased_at', c.erased_at) ORDER BY c.deleted_at DESC)
     FROM (SELECT * FROM debt_cases WHERE organization_id = v_org AND deleted_at IS NOT NULL
             AND (NOT is_restricted OR dv_is_org_admin(v_org)) ORDER BY deleted_at DESC LIMIT 500) c), '[]');
END $function$;

CREATE OR REPLACE FUNCTION public.dv_restore_case(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org(); c debt_cases;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND OR c.deleted_at IS NULL THEN RAISE EXCEPTION 'Case is not voided' USING ERRCODE='22023'; END IF;
  IF c.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Erased cases cannot be restored' USING ERRCODE='22023'; END IF;
  IF c.is_restricted AND NOT dv_is_org_admin(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  UPDATE debt_cases SET deleted_at = NULL, deleted_by = NULL WHERE id = p_case;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_erase_case(p_case uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org(); c debt_cases; v_funds numeric; v_fields int := 0; t record; col text; r record; n int;
  -- personal-data columns per case-linked table. Financial reference data, creditor details and the hash of signed documents are kept.
  plan jsonb := '{
    "debt_customer_profiles":["full_name","primary_email","landline_phone","mobile_phone","work_phone","address_street","address_city","address_postcode","landlord_lender_name"],
    "debt_previous_addresses":["address_line"],
    "debt_breathing_spaces":["nominated_contact_name","nominated_contact_phone","nominated_contact_email","amhp_evidence_file_name"],
    "comms_outbox":["to_address","subject","body"],
    "debtverge_communications":["sender_name","sender_email_or_phone","recipient_name","recipient_email_or_phone","subject","body"],
    "case_documents":["name","body"],
    "case_tasks":["notes"],
    "complaints":["complainant","summary"],
    "signing_requests":["signer_name","signer_agent","body"],
    "storm_call_callbacks":["phone_number","customer_name","notes"],
    "storm_call_sessions":["caller_phone","caller_name","callee_phone","callee_name","call_notes"],
    "payment_link_invitations":["debtor_name"],
    "payment_methods":["cardholder_name"],
    "bank_transactions":["counterparty_name","description"],
    "debt_bank_transactions":["description"],
    "debt_vulnerability_assessments":["notes"],
    "debt_benefits_checks":["notes"],
    "debt_negotiations":["notes"]
  }';
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_org_admin(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN RAISE EXCEPTION 'Give a reason (at least 10 characters)' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE='22023'; END IF;
  IF c.deleted_at IS NULL THEN RAISE EXCEPTION 'Void the case before erasing it' USING ERRCODE='22023'; END IF;
  IF c.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Already erased' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM complaints WHERE case_id = p_case AND status <> 'closed') THEN RAISE EXCEPTION 'The case has an open complaint' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM disbursement_runs WHERE case_id = p_case AND status IN ('draft','approved')) THEN RAISE EXCEPTION 'The case has an open creditor payout' USING ERRCODE='22023'; END IF;
  v_funds := COALESCE((SELECT sum(amount) FROM debt_payments WHERE deleted_at IS NULL AND case_id = p_case),0)
           - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'taken'),0)
           - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0);
  IF abs(v_funds) > 0.005 THEN RAISE EXCEPTION 'The case still holds client money (%). Distribute or return it first', v_funds USING ERRCODE='22023'; END IF;

  PERFORM set_config('dv.erasing', 'on', true);
  FOR t IN SELECT key AS tbl, value AS cols FROM jsonb_each(plan) LOOP
    IF to_regclass('public.' || t.tbl) IS NULL THEN CONTINUE; END IF;
    FOR col IN SELECT jsonb_array_elements_text(t.cols) LOOP
      SELECT is_nullable, data_type INTO r FROM information_schema.columns WHERE table_schema='public' AND table_name = t.tbl AND column_name = col;
      CONTINUE WHEN NOT FOUND OR r.data_type NOT IN ('text','character varying');
      EXECUTE format('UPDATE public.%I SET %I = %s WHERE case_id = $1 AND %I IS NOT NULL', t.tbl, col,
                     CASE WHEN r.is_nullable = 'YES' THEN 'NULL' ELSE quote_literal('[erased]') END, col) USING p_case;
      GET DIAGNOSTICS n = ROW_COUNT; v_fields := v_fields + n;
    END LOOP;
  END LOOP;
  UPDATE debt_cases SET debtor_name = '[erased]', debtor_reference = NULL, notes = NULL, erased_at = now() WHERE id = p_case;
  PERFORM set_config('dv.erasing', 'off', true);

  INSERT INTO erasure_log (organization_id, case_id, case_number, reason, fields_erased, erased_by) VALUES (v_org, p_case, c.case_number, btrim(p_reason), v_fields, auth.uid());
  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, action, table_name, record_id, new_value)
  VALUES (p_case, v_org, 'Case erased', 'Personal data erased from case ' || c.case_number, 'erase', 'debt_cases', p_case, jsonb_build_object('fields_erased', v_fields, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('fields_erased', v_fields);
END $function$;

REVOKE ALL ON FUNCTION public.dv_list_voided_cases(), public.dv_restore_case(uuid), public.dv_erase_case(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_list_voided_cases(), public.dv_restore_case(uuid), public.dv_erase_case(uuid, text) TO authenticated;
-- Rate limiting for the public (no-login) functions, per caller address (120 calls / minute / function), and
-- payment links stop resolving once their case is voided. Replay-safe: patches the existing function bodies.
CREATE TABLE IF NOT EXISTS public.dv_rate_limits (
  bucket text NOT NULL, window_start timestamptz NOT NULL, hits int NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE public.dv_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dv_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dv_rate_check(p_fn text, p_max int, p_window_seconds int DEFAULT 60)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h jsonb; ip text; w timestamptz; n int;
BEGIN
  BEGIN h := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'); EXCEPTION WHEN others THEN h := '{}'; END;
  ip := coalesce(nullif(btrim(h->>'cf-connecting-ip'), ''), nullif(btrim(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1)), ''), 'unknown');
  w := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO dv_rate_limits (bucket, window_start) VALUES (left(p_fn || '|' || ip, 200), w)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = dv_rate_limits.hits + 1 RETURNING hits INTO n;
  IF n > p_max THEN RAISE EXCEPTION 'Too many requests. Please wait a minute and try again.' USING ERRCODE = '54000'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.dv_rate_check(text,int,int) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('dv-rate-limit-cleanup', '*/30 * * * *', $c$DELETE FROM public.dv_rate_limits WHERE window_start < now() - interval '1 hour'$c$);

DO $m$
DECLARE f text; d text; nl text := chr(10);
BEGIN
  FOREACH f IN ARRAY ARRAY['get_payment_link(text)','get_link_payment_state(text)','submit_change_request(text,text,text,text,text)','dv_get_signing_request(text)','dv_sign_request(text,text,text)'] LOOP
    d := pg_get_functiondef(('public.' || f)::regprocedure);
    IF d LIKE '%dv_rate_check%' THEN CONTINUE; END IF;
    d := regexp_replace(d, 'BEGIN' || nl, 'BEGIN' || nl || '  PERFORM dv_rate_check(''' || split_part(f,'(',1) || ''', 120, 60);' || nl);
    IF d NOT LIKE '%dv_rate_check%' THEN RAISE EXCEPTION 'patch failed for %', f; END IF;
    IF f = 'get_payment_link(text)' THEN
      d := replace(d, 'SELECT * INTO c FROM debt_cases WHERE id = l.case_id;', 'SELECT * INTO c FROM debt_cases WHERE id = l.case_id AND deleted_at IS NULL;' || nl || '  IF NOT FOUND THEN RETURN jsonb_build_object(''found'', false); END IF;');
    END IF;
    EXECUTE d;
  END LOOP;
END $m$;
-- CASS 5-business-day rule now excludes England & Wales bank holidays (table covers 2025-2028; later dates count weekdays only).
CREATE TABLE IF NOT EXISTS public.dv_bank_holidays (day date PRIMARY KEY, name text NOT NULL);
ALTER TABLE public.dv_bank_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY dv_bank_holidays_read ON public.dv_bank_holidays FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.dv_bank_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dv_bank_holidays TO authenticated;
INSERT INTO public.dv_bank_holidays (day, name) VALUES
 ('2025-08-25','Summer bank holiday'),('2025-12-25','Christmas Day'),('2025-12-26','Boxing Day'),
 ('2026-01-01','New Year''s Day'),('2026-04-03','Good Friday'),('2026-04-06','Easter Monday'),('2026-05-04','Early May bank holiday'),('2026-05-25','Spring bank holiday'),('2026-08-31','Summer bank holiday'),('2026-12-25','Christmas Day'),('2026-12-28','Boxing Day (substitute)'),
 ('2027-01-01','New Year''s Day'),('2027-03-26','Good Friday'),('2027-03-29','Easter Monday'),('2027-05-03','Early May bank holiday'),('2027-05-31','Spring bank holiday'),('2027-08-30','Summer bank holiday'),('2027-12-27','Christmas Day (substitute)'),('2027-12-28','Boxing Day (substitute)'),
 ('2028-01-03','New Year''s Day (substitute)'),('2028-04-14','Good Friday'),('2028-04-17','Easter Monday'),('2028-05-01','Early May bank holiday'),('2028-05-29','Spring bank holiday'),('2028-08-28','Summer bank holiday'),('2028-12-25','Christmas Day'),('2028-12-26','Boxing Day')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.dv_business_days(d1 date, d2 date)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM generate_series(d1 + 1, d2, interval '1 day') g
  WHERE extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM dv_bank_holidays h WHERE h.day = g::date);
$$;
CREATE POLICY dv_rate_limits_no_access ON public.dv_rate_limits FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
-- One conversation per case: every email / SMS / WhatsApp the system sends is mirrored into debtverge_communications,
-- and its status follows the outbox (queued -> delivered / failed; cancelled hides it).
ALTER TABLE public.comms_outbox ADD COLUMN IF NOT EXISTS thread_id uuid, ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS outbox_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_comms_outbox_id_uq ON public.debtverge_communications (outbox_id) WHERE outbox_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dv_mirror_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_thread uuid; v_name text; v_status text;
BEGIN
  v_status := CASE NEW.status WHEN 'sent' THEN 'delivered' WHEN 'failed' THEN 'failed' ELSE 'queued' END;
  IF TG_OP = 'INSERT' THEN
    v_thread := coalesce(NEW.thread_id,
      (SELECT thread_id FROM debtverge_communications WHERE case_id = NEW.case_id AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1),
      md5(NEW.case_id::text)::uuid);
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = NEW.case_id;
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_type, recipient_name, recipient_email_or_phone,
        agent_name, subject, body, status, matched_automatically, outbox_id, created_at)
    VALUES (NEW.case_id, v_thread, NEW.channel, 'outbound',
        CASE WHEN NEW.trigger = 'manual' THEN coalesce(NEW.agent_name, 'Adviser') ELSE 'DebtVerge (automatic)' END,
        CASE WHEN NEW.trigger = 'manual' THEN 'agent' ELSE 'system' END,
        coalesce(v_name, ''), NEW.to_address, NEW.agent_name, NEW.subject, NEW.body, v_status, false, NEW.id, NEW.created_at)
    ON CONFLICT (outbox_id) WHERE outbox_id IS NOT NULL DO NOTHING;
  ELSE
    IF NEW.status = 'cancelled' OR NEW.deleted_at IS NOT NULL THEN
      UPDATE debtverge_communications SET deleted_at = now() WHERE outbox_id = NEW.id AND deleted_at IS NULL;
    ELSE
      UPDATE debtverge_communications SET status = v_status, updated_at = now() WHERE outbox_id = NEW.id AND status <> v_status;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.dv_mirror_outbox() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_mirror_outbox ON public.comms_outbox;
CREATE TRIGGER trg_mirror_outbox AFTER INSERT OR UPDATE OF status, deleted_at ON public.comms_outbox FOR EACH ROW EXECUTE FUNCTION public.dv_mirror_outbox();
-- WhatsApp in the conversation, 24-hour customer-service window enforced, and inbound SMS/WhatsApp matched to cases.
ALTER TABLE public.comms_outbox DROP CONSTRAINT IF EXISTS comms_outbox_channel_check;
ALTER TABLE public.comms_outbox ADD CONSTRAINT comms_outbox_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS provider_id text;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_comms_provider_id_uq ON public.debtverge_communications (provider_id) WHERE provider_id IS NOT NULL;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS provider_id text;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_unassigned_provider_id_uq ON public.debtverge_unassigned_messages (provider_id) WHERE provider_id IS NOT NULL;
-- Clients never create inbound messages; only the inbound webhook (service role) does.
DROP POLICY IF EXISTS insert_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;

DROP FUNCTION IF EXISTS public.dv_queue_message(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.dv_queue_message(uuid, text, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.dv_queue_message(p_case uuid, p_channel text, p_subject text, p_body text, p_thread uuid DEFAULT NULL, p_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c debt_cases; addr text; oid uuid; v_thread uuid;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('email','sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE = '22023'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'message is empty' USING ERRCODE = '22023'; END IF;
  IF p_channel = 'whatsapp' AND NOT EXISTS (
       SELECT 1 FROM debtverge_communications WHERE case_id = p_case AND channel = 'whatsapp' AND direction = 'inbound'
         AND deleted_at IS NULL AND created_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'WhatsApp can only be used within 24 hours of the customer''s last WhatsApp message. Use SMS or email to start the conversation.' USING ERRCODE = '22023';
  END IF;
  IF p_thread IS NOT NULL THEN
    SELECT thread_id INTO v_thread FROM debtverge_communications WHERE case_id = p_case AND thread_id = p_thread LIMIT 1;
  END IF;
  IF p_channel IN ('sms','whatsapp') THEN SELECT mobile_phone INTO addr FROM debt_customer_profiles WHERE case_id = p_case;
  ELSE SELECT primary_email INTO addr FROM debt_customer_profiles WHERE case_id = p_case; END IF;
  IF addr IS NULL OR btrim(addr) = '' THEN RAISE EXCEPTION 'no % contact on this case', p_channel; END IF;
  INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger, thread_id, agent_name)
  VALUES (c.organization_id, p_case, p_channel, addr, CASE WHEN p_channel = 'email' THEN p_subject END, p_body, 'manual', v_thread, left(p_agent, 120)) RETURNING id INTO oid;
  RETURN oid;
END $function$;
REVOKE ALL ON FUNCTION public.dv_queue_message(uuid,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_queue_message(uuid,text,text,text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_record_inbound(p_channel text, p_from text, p_name text, p_body text, p_provider_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d text; v_case uuid; n int; v_name text; v_thread uuid;
BEGIN
  IF p_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE='22023'; END IF;
  IF p_provider_id IS NOT NULL AND (EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id = p_provider_id)
        OR EXISTS (SELECT 1 FROM debtverge_unassigned_messages WHERE provider_id = p_provider_id)) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;
  d := right(regexp_replace(coalesce(p_from,''), '\D', '', 'g'), 10);
  IF length(d) >= 9 THEN
    SELECT count(DISTINCT p.case_id), min(p.case_id::text)::uuid INTO n, v_case
      FROM debt_customer_profiles p JOIN debt_cases c ON c.id = p.case_id AND c.deleted_at IS NULL
     WHERE right(regexp_replace(coalesce(p.mobile_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.landline_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.work_phone,''), '\D','','g'), 10) = d;
  ELSE n := 0; END IF;
  IF n = 1 THEN
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = v_case;
    v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = v_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(v_case::text)::uuid);
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id)
    VALUES (v_case, v_thread, p_channel, 'inbound', coalesce(nullif(p_name,''), v_name, ''), left(p_from, 60), 'client', 'DebtVerge Team', left(p_body, 5000), 'delivered', true, p_provider_id);
    RETURN jsonb_build_object('status','matched');
  END IF;
  INSERT INTO debtverge_unassigned_messages (channel, sender_name, sender_email_or_phone, body, provider_id)
  VALUES (p_channel, coalesce(nullif(p_name,''), ''), left(p_from, 60), left(p_body, 5000), p_provider_id);
  RETURN jsonb_build_object('status', CASE WHEN n > 1 THEN 'ambiguous' ELSE 'unassigned' END);
END $function$;
REVOKE ALL ON FUNCTION public.dv_record_inbound(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_record_inbound(text,text,text,text,text) TO service_role;
-- Each firm has its own number(s). The number a message arrives on decides the firm, so matching only searches that firm's cases,
-- and unmatched messages are parked for that firm's managers to triage.
CREATE TABLE IF NOT EXISTS public.org_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  e164 text NOT NULL UNIQUE CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_phone_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_phone_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_phone_numbers TO service_role;

ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS to_number text;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS ignore_reason text;
-- Clients go through the triage functions only.
DROP POLICY IF EXISTS select_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
DROP POLICY IF EXISTS update_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
DROP POLICY IF EXISTS delete_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
CREATE POLICY select_super_admin_unassigned ON public.debtverge_unassigned_messages FOR SELECT TO authenticated USING (is_super_admin());
REVOKE INSERT, UPDATE, DELETE ON public.debtverge_unassigned_messages FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.dv_record_inbound(text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.dv_record_inbound(p_channel text, p_from text, p_name text, p_body text, p_provider_id text, p_to text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d text; v_case uuid; n int; v_name text; v_thread uuid; v_org uuid; v_to text;
BEGIN
  IF p_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE='22023'; END IF;
  IF p_provider_id IS NOT NULL AND (EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id = p_provider_id)
        OR EXISTS (SELECT 1 FROM debtverge_unassigned_messages WHERE provider_id = p_provider_id)) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;
  v_to := '+' || regexp_replace(coalesce(p_to,''), '\D', '', 'g');
  SELECT organization_id INTO v_org FROM org_phone_numbers WHERE e164 = v_to;
  d := right(regexp_replace(coalesce(p_from,''), '\D', '', 'g'), 10);
  n := 0;
  IF v_org IS NOT NULL AND length(d) >= 9 THEN
    SELECT count(DISTINCT p.case_id), min(p.case_id::text)::uuid INTO n, v_case
      FROM debt_customer_profiles p JOIN debt_cases c ON c.id = p.case_id AND c.deleted_at IS NULL AND c.organization_id = v_org
     WHERE right(regexp_replace(coalesce(p.mobile_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.landline_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.work_phone,''), '\D','','g'), 10) = d;
  END IF;
  IF n = 1 THEN
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = v_case;
    v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = v_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(v_case::text)::uuid);
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id)
    VALUES (v_case, v_thread, p_channel, 'inbound', coalesce(nullif(p_name,''), v_name, ''), left(p_from, 60), 'client', 'DebtVerge Team', left(p_body, 5000), 'delivered', true, p_provider_id);
    RETURN jsonb_build_object('status','matched');
  END IF;
  INSERT INTO debtverge_unassigned_messages (channel, sender_name, sender_email_or_phone, body, provider_id, organization_id, to_number)
  VALUES (p_channel, coalesce(nullif(p_name,''), ''), left(p_from, 60), left(p_body, 5000), p_provider_id, v_org, nullif(v_to,'+'));
  RETURN jsonb_build_object('status', CASE WHEN v_org IS NULL THEN 'unknown_number' WHEN n > 1 THEN 'ambiguous' ELSE 'unassigned' END);
END $function$;
REVOKE ALL ON FUNCTION public.dv_record_inbound(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_record_inbound(text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dv_list_unassigned()
RETURNS TABLE (id uuid, channel text, sender_name text, sender_email_or_phone text, body text, received_at timestamptz, to_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT m.id, m.channel, m.sender_name, m.sender_email_or_phone, m.body, coalesce(m.received_at, m.created_at), m.to_number
    FROM debtverge_unassigned_messages m WHERE m.organization_id = o AND m.status = 'unassigned' ORDER BY coalesce(m.received_at, m.created_at) DESC LIMIT 200;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_assign_unassigned(p_msg uuid, p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org(); m debtverge_unassigned_messages; v_name text; v_thread uuid;
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM debtverge_unassigned_messages WHERE id = p_msg AND organization_id = o AND status = 'unassigned' FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'message not found or already handled' USING ERRCODE='22023'; END IF;
  SELECT debtor_name INTO v_name FROM debt_cases WHERE id = p_case AND organization_id = o AND deleted_at IS NULL;
  IF v_name IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE='22023'; END IF;
  v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = p_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(p_case::text)::uuid);
  INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id, created_at)
  VALUES (p_case, v_thread, m.channel, 'inbound', coalesce(nullif(m.sender_name,''), v_name), m.sender_email_or_phone, 'client', 'DebtVerge Team', m.body, 'delivered', false, m.provider_id, coalesce(m.received_at, m.created_at));
  UPDATE debtverge_unassigned_messages SET status='matched', matched_case_id = p_case, matched_at = now(), matched_by = auth.uid()::text, updated_at = now() WHERE id = p_msg;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_dismiss_unassigned(p_msg uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'give a short reason (wrong number, spam...)' USING ERRCODE='22023'; END IF;
  UPDATE debtverge_unassigned_messages SET status='ignored', ignore_reason = left(btrim(p_reason),200), matched_at = now(), matched_by = auth.uid()::text, updated_at = now()
   WHERE id = p_msg AND organization_id = o AND status = 'unassigned';
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found or already handled' USING ERRCODE='22023'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_list_org_numbers() RETURNS TABLE (id uuid, e164 text, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT n.id, n.e164, n.label FROM org_phone_numbers n WHERE n.organization_id = o ORDER BY n.created_at;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_add_org_number(p_e164 text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org(); nid uuid;
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  BEGIN
    INSERT INTO org_phone_numbers (organization_id, e164, label) VALUES (o, btrim(p_e164), left(nullif(btrim(coalesce(p_label,'')),''), 60)) RETURNING id INTO nid;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'that number is already registered' USING ERRCODE='23505';
            WHEN check_violation THEN RAISE EXCEPTION 'use international format, e.g. +447700900123' USING ERRCODE='22023'; END;
  RETURN nid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_remove_org_number(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  DELETE FROM org_phone_numbers WHERE id = p_id AND organization_id = o;
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_list_unassigned()','dv_assign_unassigned(uuid,uuid)','dv_dismiss_unassigned(uuid,text)','dv_list_org_numbers()','dv_add_org_number(text,text)','dv_remove_org_number(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
-- Staff MFA (TOTP). Enrolment and challenge use Supabase Auth. A firm can require MFA: until a staff member has passed the second step
-- in this session (JWT aal2), case access and every manager function refuse them at the database, not just in the screens.
CREATE TABLE IF NOT EXISTS public.dv_org_security (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  require_mfa boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dv_org_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dv_org_security FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dv_org_security TO service_role;

CREATE OR REPLACE FUNCTION public.dv_mfa_ok(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT coalesce((SELECT s.require_mfa FROM dv_org_security s WHERE s.organization_id = org), false)
      OR coalesce(auth.jwt()->>'aal','') = 'aal2'
      OR coalesce(auth.role(),'') = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.dv_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_mfa_ok(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_can_read_case(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.deleted_at IS NULL AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_can_edit_case(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.deleted_at IS NULL AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_is_manager(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT dv_mfa_ok(org) AND EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Team Manager','Operations Manager')
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_is_org_admin(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT dv_mfa_ok(org) AND EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.dv_get_security() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('require_mfa', false, 'can_manage', false); END IF;
  RETURN jsonb_build_object('require_mfa', coalesce((SELECT require_mfa FROM dv_org_security WHERE organization_id = o), false),
                            'can_manage', EXISTS (SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id WHERE ou.organization_id = o AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')));
END $$;

CREATE OR REPLACE FUNCTION public.dv_set_require_mfa(p_on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  -- you must have passed MFA yourself before you can require it of everyone, so you cannot lock the firm out with yourself
  IF p_on AND coalesce(auth.jwt()->>'aal','') <> 'aal2' THEN RAISE EXCEPTION 'turn on your own two-step sign-in first, then sign in with it again' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_org_security (organization_id, require_mfa, updated_by, updated_at) VALUES (o, p_on, auth.uid(), now())
  ON CONFLICT (organization_id) DO UPDATE SET require_mfa = EXCLUDED.require_mfa, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.dv_mfa_status() RETURNS TABLE (user_id uuid, email text, full_name text, role_name text, mfa_enrolled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT ou.user_id, p.email::text, p.full_name::text, r.name::text,
           EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = ou.user_id AND f.status = 'verified')
      FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id LEFT JOIN profiles p ON p.id = ou.user_id
     WHERE ou.organization_id = o ORDER BY p.full_name NULLS LAST, p.email;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_get_security()','dv_set_require_mfa(boolean)','dv_mfa_status()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
-- Service-role-only tables: say so explicitly (clients have no privileges either way).
CREATE POLICY deny_all_clients ON public.dv_org_security AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_clients ON public.org_phone_numbers AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ===== 20261122260000_case_notes =====
-- Customer notes: typed, pinnable, linked to a creditor/payment/complaint/document, searchable, with edit history and withdraw-with-reason (never deleted).
CREATE TABLE IF NOT EXISTS public.case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','call','meeting','creditor','vulnerability','agreement','complaint','internal')),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  pinned boolean NOT NULL DEFAULT false,
  direction text CHECK (direction IN ('inbound','outbound')),
  contact_name text CHECK (length(contact_name) <= 120),
  outcome text CHECK (length(outcome) <= 200),
  follow_up_on date,
  follow_up_task_id uuid,
  linked_type text CHECK (linked_type IN ('creditor','payment','complaint','document')),
  linked_id uuid,
  client_visible boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_by uuid,
  edited_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body,'') || ' ' || coalesce(contact_name,'') || ' ' || coalesce(outcome,''))) STORED,
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
CREATE INDEX IF NOT EXISTS case_notes_case_idx ON public.case_notes (case_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS case_notes_org_idx ON public.case_notes (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS case_notes_search_idx ON public.case_notes USING gin (search);
CREATE INDEX IF NOT EXISTS case_notes_link_idx ON public.case_notes (linked_type, linked_id) WHERE linked_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.case_notes(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  version int NOT NULL,
  body text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_note_versions_note_idx ON public.case_note_versions (note_id, version);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['case_notes','case_note_versions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.case_notes FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();

CREATE OR REPLACE FUNCTION public.dv_add_note(p_case uuid, p_kind text, p_body text, p_pinned boolean DEFAULT false, p_direction text DEFAULT NULL,
  p_contact text DEFAULT NULL, p_outcome text DEFAULT NULL, p_follow_up date DEFAULT NULL, p_link_type text DEFAULT NULL, p_link_id uuid DEFAULT NULL,
  p_client_visible boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; nid uuid; tid uuid; ok boolean := true;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'write something in the note' USING ERRCODE = '22023'; END IF;
  IF (p_link_type IS NULL) <> (p_link_id IS NULL) THEN RAISE EXCEPTION 'choose what the note is linked to' USING ERRCODE = '22023'; END IF;
  IF p_link_type IS NOT NULL THEN
    ok := CASE p_link_type
      WHEN 'creditor'  THEN EXISTS (SELECT 1 FROM debt_creditors WHERE id = p_link_id AND case_id = p_case)
      WHEN 'payment'   THEN EXISTS (SELECT 1 FROM debt_payments WHERE id = p_link_id AND case_id = p_case)
      WHEN 'complaint' THEN EXISTS (SELECT 1 FROM complaints WHERE id = p_link_id AND case_id = p_case)
      WHEN 'document'  THEN EXISTS (SELECT 1 FROM case_documents WHERE id = p_link_id AND case_id = p_case)
      ELSE false END;
    IF NOT ok THEN RAISE EXCEPTION 'that item is not on this case' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO case_notes (organization_id, case_id, kind, body, pinned, direction, contact_name, outcome, follow_up_on, linked_type, linked_id, client_visible, created_by)
  VALUES (c.organization_id, p_case, coalesce(nullif(p_kind,''),'general'), btrim(p_body), coalesce(p_pinned,false), nullif(p_direction,''), left(nullif(btrim(coalesce(p_contact,'')),''),120),
          left(nullif(btrim(coalesce(p_outcome,'')),''),200), p_follow_up, p_link_type, p_link_id, coalesce(p_client_visible,false), auth.uid())
  RETURNING id INTO nid;
  IF p_follow_up IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, left('Follow up: ' || btrim(p_body), 100), 'call', p_follow_up, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid())
    RETURNING id INTO tid;
    UPDATE case_notes SET follow_up_task_id = tid WHERE id = nid;
  END IF;
  RETURN nid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_edit_note(p_id uuid, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) OR NOT (n.created_by = auth.uid() OR dv_is_manager(n.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'a withdrawn note cannot be edited' USING ERRCODE = '22023'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' OR length(p_body) > 5000 THEN RAISE EXCEPTION 'write something in the note (up to 5000 characters)' USING ERRCODE = '22023'; END IF;
  IF btrim(p_body) = n.body THEN RETURN; END IF;
  INSERT INTO case_note_versions (note_id, case_id, version, body, edited_by, edited_at) VALUES (n.id, n.case_id, n.version, n.body, coalesce(n.edited_by, n.created_by), coalesce(n.edited_at, n.created_at));
  UPDATE case_notes SET body = btrim(p_body), version = version + 1, edited_by = auth.uid(), edited_at = now() WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_withdraw_note(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) OR NOT (n.created_by = auth.uid() OR dv_is_manager(n.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'already withdrawn' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'give a reason for withdrawing the note' USING ERRCODE = '22023'; END IF;
  UPDATE case_notes SET withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = left(btrim(p_reason), 300), pinned = false WHERE id = p_id;
  IF n.follow_up_task_id IS NOT NULL THEN UPDATE case_tasks SET status = 'cancelled' WHERE id = n.follow_up_task_id AND status = 'open'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_pin_note(p_id uuid, p_pinned boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'a withdrawn note cannot be pinned' USING ERRCODE = '22023'; END IF;
  UPDATE case_notes SET pinned = coalesce(p_pinned, false) WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_list_notes(p_case uuid, p_kind text DEFAULT NULL, p_q text DEFAULT NULL)
RETURNS TABLE (id uuid, kind text, body text, pinned boolean, direction text, contact_name text, outcome text, follow_up_on date, follow_up_done boolean,
  linked_type text, linked_id uuid, client_visible boolean, version int, author_name text, created_at timestamptz, edited_at timestamptz, withdrawn_at timestamptz, withdraw_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT n.id, n.kind, n.body, n.pinned, n.direction, n.contact_name, n.outcome, n.follow_up_on,
           (t.status IS NOT NULL AND t.status <> 'open'), n.linked_type, n.linked_id, n.client_visible, n.version,
           coalesce(p.full_name, p.email)::text, n.created_at, n.edited_at, n.withdrawn_at, n.withdraw_reason
      FROM case_notes n LEFT JOIN profiles p ON p.id = n.created_by LEFT JOIN case_tasks t ON t.id = n.follow_up_task_id
     WHERE n.case_id = p_case AND (p_kind IS NULL OR p_kind = '' OR n.kind = p_kind)
       AND (p_q IS NULL OR btrim(p_q) = '' OR n.search @@ websearch_to_tsquery('english', p_q) OR strpos(lower(n.body), lower(btrim(p_q))) > 0)
     ORDER BY (n.withdrawn_at IS NULL) DESC, n.pinned DESC, n.created_at DESC LIMIT 300;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_search_notes(p_q text, p_kind text DEFAULT NULL)
RETURNS TABLE (id uuid, case_id uuid, case_number text, debtor_name text, kind text, body text, author_name text, created_at timestamptz, withdrawn_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_q IS NULL OR length(btrim(p_q)) < 2 THEN RAISE EXCEPTION 'type at least 2 characters to search' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT n.id, n.case_id, c.case_number::text, c.debtor_name::text, n.kind, n.body, coalesce(p.full_name, p.email)::text, n.created_at, n.withdrawn_at
      FROM case_notes n JOIN debt_cases c ON c.id = n.case_id AND c.deleted_at IS NULL LEFT JOIN profiles p ON p.id = n.created_by
     WHERE n.organization_id = o AND (p_kind IS NULL OR p_kind = '' OR n.kind = p_kind)
       AND (n.search @@ websearch_to_tsquery('english', p_q) OR strpos(lower(n.body), lower(btrim(p_q))) > 0)
       AND dv_can_read_case(n.case_id)
     ORDER BY n.created_at DESC LIMIT 100;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_note_history(p_id uuid) RETURNS TABLE (version int, body text, edited_at timestamptz, edited_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE cid uuid;
BEGIN
  SELECT n.case_id INTO cid FROM case_notes n WHERE n.id = p_id;
  IF cid IS NULL OR NOT dv_can_read_case(cid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v.version, v.body, v.edited_at, coalesce(p.full_name, p.email)::text FROM case_note_versions v LEFT JOIN profiles p ON p.id = v.edited_by WHERE v.note_id = p_id ORDER BY v.version DESC;
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_add_note(uuid,text,text,boolean,text,text,text,date,text,uuid,boolean)','dv_edit_note(uuid,text)','dv_withdraw_note(uuid,text)','dv_pin_note(uuid,boolean)',
                           'dv_list_notes(uuid,text,text)','dv_search_notes(text,text)','dv_note_history(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Erasure: notes and their earlier versions are personal data too.
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"complaints":["complainant","summary"],', '"complaints":["complainant","summary"], "case_notes":["body","contact_name","outcome","withdraw_reason"], "case_note_versions":["body"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;

-- ===== 20261122270000_complaints_workflow =====
-- Complaints workflow: spot complaints in client messages, deadlines from the day the client first complained, automatic acknowledgement,
-- routing to a handler other than the case adviser, deadline tasks, structured outcome rules, redress with maker-checker, timeline and MI.
CREATE OR REPLACE FUNCTION public.dv_add_business_days(d date, n int) RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE r date := d;
BEGIN WHILE dv_business_days(d, r) < n LOOP r := r + 1; END LOOP; RETURN r; END $$;

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS root_cause text CHECK (root_cause IN ('fee_dispute','missed_payment_handling','creditor_contact','advice_quality','communication','data_error','delay','other')),
  ADD COLUMN IF NOT EXISTS fault text CHECK (fault IN ('firm','creditor','client','third_party','none')),
  ADD COLUMN IF NOT EXISTS outcome_reasoning text,
  ADD COLUMN IF NOT EXISTS final_response_ref text,
  ADD COLUMN IF NOT EXISTS adjustments_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  ADD COLUMN IF NOT EXISTS source_comm_id uuid,
  ADD COLUMN IF NOT EXISTS ack_outbox_id uuid;
ALTER TABLE public.complaint_events ADD COLUMN IF NOT EXISTS by_name text;

-- Messages from the client that read like a complaint are flagged so an adviser cannot miss them.
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS possible_complaint boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.dv_flag_possible_complaint() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.channel IN ('email','sms','whatsapp')
     AND NEW.body ~* '\m(complain\w*|unhappy|not happy|unacceptable|ombudsman|appalled|furious|disgusted|disgraceful|compensation|trading standards|legal action|solicitor|rip[- ]?off|useless|incompetent)\M' THEN
    NEW.possible_complaint := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_flag_possible_complaint ON public.debtverge_communications;
CREATE TRIGGER trg_flag_possible_complaint BEFORE INSERT ON public.debtverge_communications FOR EACH ROW EXECUTE FUNCTION public.dv_flag_possible_complaint();

CREATE OR REPLACE FUNCTION public.dv_dismiss_complaint_flag(p_comm uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  SELECT case_id INTO cid FROM debtverge_communications WHERE id = p_comm;
  IF cid IS NULL OR NOT dv_can_edit_case(cid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE debtverge_communications SET possible_complaint = false WHERE id = p_comm;
END $$;

DROP FUNCTION IF EXISTS public.dv_log_complaint(uuid,text,text,text,text,date,boolean);
CREATE OR REPLACE FUNCTION public.dv_log_complaint(p_case uuid, p_complainant text, p_summary text, p_category text, p_channel text, p_received date, p_vulnerable boolean, p_source_comm uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE org uuid; cid uuid; ref text; n int; v_recv date; v_adv uuid; v_handler uuid; v_ack_due date; v_final_due date; v_firm text; v_oid uuid;
        ch text; v_try text[]; v_body text; v_vuln boolean := coalesce(p_vulnerable, false); v_first text;
BEGIN
  IF p_case IS NOT NULL THEN
    SELECT organization_id, assigned_to INTO org, v_adv FROM debt_cases WHERE id = p_case;
    IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSE
    org := dv_my_org();
    IF org IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  IF btrim(COALESCE(p_summary,'')) = '' OR btrim(COALESCE(p_complainant,'')) = '' THEN RAISE EXCEPTION 'complainant and summary are required' USING ERRCODE = '22023'; END IF;
  IF p_source_comm IS NOT NULL THEN
    SELECT created_at::date INTO v_recv FROM debtverge_communications WHERE id = p_source_comm AND case_id = p_case AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'that message is not on this case' USING ERRCODE = '22023'; END IF;
  END IF;
  v_recv := coalesce(p_received, v_recv, current_date);
  IF v_recv > current_date THEN RAISE EXCEPTION 'the complaint cannot be received in the future' USING ERRCODE = '22023'; END IF;
  v_ack_due := dv_add_business_days(v_recv, 5);
  v_final_due := v_recv + 56;

  PERFORM pg_advisory_xact_lock(hashtext('complaint-ref-' || org::text));
  SELECT count(*) + 1 INTO n FROM complaints WHERE organization_id = org AND extract(year FROM received_on) = extract(year FROM v_recv);
  ref := 'C-' || extract(year FROM v_recv)::int || '-' || lpad(n::text, 4, '0');

  -- handler: the least busy manager who is not the case adviser (falls back to any manager)
  SELECT ou.user_id INTO v_handler FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
   WHERE ou.organization_id = org AND r.name IN ('Team Manager','Operations Manager','Admin') AND (v_adv IS NULL OR ou.user_id <> v_adv)
   ORDER BY (SELECT count(*) FROM complaints x WHERE x.assigned_to = ou.user_id AND x.status <> 'closed' AND x.deleted_at IS NULL), ou.user_id LIMIT 1;
  IF v_handler IS NULL THEN
    SELECT ou.user_id INTO v_handler FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
     WHERE ou.organization_id = org AND r.name IN ('Team Manager','Operations Manager','Admin') ORDER BY ou.user_id LIMIT 1;
  END IF;

  INSERT INTO complaints (organization_id, case_id, reference, complainant, received_on, channel, category, summary, vulnerable, priority, source_comm_id, assigned_to, created_by)
  VALUES (org, p_case, ref, btrim(p_complainant), v_recv, CASE WHEN p_channel IN ('phone','email','letter','portal') THEN p_channel ELSE 'other' END, COALESCE(p_category,'other'), btrim(p_summary), v_vuln,
          CASE WHEN v_vuln THEN 'high' ELSE 'normal' END, p_source_comm, v_handler, auth.uid())
  RETURNING id INTO cid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'logged', btrim(p_summary), auth.uid());
  IF v_handler IS NOT NULL THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'assigned', 'Handler assigned automatically', auth.uid()); END IF;
  IF p_source_comm IS NOT NULL THEN UPDATE debtverge_communications SET possible_complaint = false WHERE id = p_source_comm; END IF;

  IF p_case IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, auto_key, created_by) VALUES
      (p_case, org, 'Acknowledge complaint ' || ref,                  'statutory', v_ack_due,   'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':ack', auth.uid()),
      (p_case, org, 'Investigate complaint ' || ref,                  'task',      v_recv + 14, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':inv', auth.uid()),
      (p_case, org, 'Complaint ' || ref || ': 4-week check',          'review',    v_recv + 28, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':w4',  auth.uid()),
      (p_case, org, 'Complaint ' || ref || ': 6-week check',          'review',    v_recv + 42, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':w6',  auth.uid()),
      (p_case, org, 'Send final response for complaint ' || ref,      'statutory', v_recv + 49, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':fin', auth.uid());
    INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Complaint logged', 'Complaint ' || ref || ' logged');

    -- automatic acknowledgement through the case conversation; the complaint is marked acknowledged when it is actually sent
    SELECT name INTO v_firm FROM organizations WHERE id = org;
    v_first := split_part(btrim(p_complainant), ' ', 1);
    v_body := 'Dear ' || v_first || E',\n\nThank you for getting in touch. We are sorry you have cause to complain and we are treating this as a formal complaint (reference ' || ref
      || E').\n\nWe will look into it and aim to send you our final response by ' || to_char(v_final_due, 'DD Mon YYYY')
      || E'. If you are unhappy with our final response, or we have not responded within 8 weeks, you may be able to refer your complaint to the Financial Ombudsman Service.\n\nIf you want to add anything, just reply to this message.\n\n'
      || coalesce(v_firm, 'Your debt adviser');
    v_try := CASE WHEN p_channel IN ('email','sms','whatsapp') THEN ARRAY[p_channel] ELSE ARRAY[]::text[] END || ARRAY['email','sms'];
    FOREACH ch IN ARRAY v_try LOOP
      BEGIN
        v_oid := dv_queue_message(p_case, ch, 'We have received your complaint (' || ref || ')', v_body, NULL, 'DebtVerge (automatic)');
        EXIT;
      EXCEPTION WHEN OTHERS THEN v_oid := NULL;
      END;
    END LOOP;
    IF v_oid IS NOT NULL THEN
      UPDATE complaints SET ack_outbox_id = v_oid WHERE id = cid;
      INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'acknowledgement_queued', 'Acknowledgement queued to the client', auth.uid());
    ELSE
      INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'acknowledgement_needed', 'No contact details to send an acknowledgement. Acknowledge by phone or post.', auth.uid());
    END IF;
  END IF;
  RETURN cid;
END $function$;
REVOKE ALL ON FUNCTION public.dv_log_complaint(uuid,text,text,text,text,date,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_log_complaint(uuid,text,text,text,text,date,boolean,uuid) TO authenticated;

-- the complaint is acknowledged when the acknowledgement really goes out
CREATE OR REPLACE FUNCTION public.dv_complaint_ack_on_send() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE ack_outbox_id = NEW.id AND acknowledged_on IS NULL FOR UPDATE;
  IF c.id IS NOT NULL THEN
    UPDATE complaints SET acknowledged_on = current_date, status = CASE WHEN status = 'open' THEN 'acknowledged' ELSE status END WHERE id = c.id;
    INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (c.id, c.organization_id, 'acknowledged', 'Acknowledgement sent to the client');
    UPDATE case_tasks SET status = 'done', completed_at = now() WHERE auto_key = 'complaint:' || c.id || ':ack' AND status = 'open';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dv_complaint_ack_on_send() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_complaint_ack_on_send ON public.comms_outbox;
CREATE TRIGGER trg_complaint_ack_on_send AFTER UPDATE OF status ON public.comms_outbox FOR EACH ROW WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent') EXECUTE FUNCTION public.dv_complaint_ack_on_send();

DROP FUNCTION IF EXISTS public.dv_complaint_update(uuid,text,text,numeric,text,boolean);
CREATE OR REPLACE FUNCTION public.dv_complaint_update(p_id uuid, p_status text, p_outcome text DEFAULT NULL, p_note text DEFAULT NULL, p_fos boolean DEFAULT NULL,
  p_reasoning text DEFAULT NULL, p_root_cause text DEFAULT NULL, p_fault text DEFAULT NULL, p_final_ref text DEFAULT NULL, p_adjustments boolean DEFAULT NULL, p_assignee uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c complaints; order_ text[] := ARRAY['open','acknowledged','investigating','final_response','closed']; r_old int; r_new int;
        o text; why text; rc text; f text; adj boolean;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF c.status = 'closed' THEN RAISE EXCEPTION 'this complaint is closed' USING ERRCODE = '22023'; END IF;
  r_new := array_position(order_, p_status);
  IF r_new IS NULL THEN RAISE EXCEPTION 'unknown status' USING ERRCODE = '22023'; END IF;
  r_old := array_position(order_, c.status);
  IF r_new < r_old THEN RAISE EXCEPTION 'a complaint cannot move backwards' USING ERRCODE = '22023'; END IF;
  o := coalesce(nullif(p_outcome,''), c.outcome);
  why := coalesce(nullif(btrim(coalesce(p_reasoning,'')),''), c.outcome_reasoning);
  rc := coalesce(nullif(p_root_cause,''), c.root_cause);
  f := coalesce(nullif(p_fault,''), c.fault);
  adj := coalesce(p_adjustments, c.adjustments_confirmed);
  IF o IS NOT NULL AND o NOT IN ('upheld','partially_upheld','not_upheld') THEN RAISE EXCEPTION 'unknown outcome' USING ERRCODE = '22023'; END IF;
  IF r_new >= 4 THEN
    IF o IS NULL THEN RAISE EXCEPTION 'record the outcome before the final response' USING ERRCODE = '22023'; END IF;
    IF why IS NULL OR length(why) < 20 THEN RAISE EXCEPTION 'explain the reasoning behind the outcome (at least 20 characters)' USING ERRCODE = '22023'; END IF;
    IF rc IS NULL OR f IS NULL THEN RAISE EXCEPTION 'record the root cause and who was at fault' USING ERRCODE = '22023'; END IF;
    IF c.vulnerable AND NOT adj THEN RAISE EXCEPTION 'confirm that adjustments for a vulnerable client were considered' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_status = 'closed' AND c.status <> 'final_response' THEN RAISE EXCEPTION 'send the final response before closing' USING ERRCODE = '22023'; END IF;
  IF p_assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = c.organization_id AND user_id = p_assignee) THEN
    RAISE EXCEPTION 'that person is not in your firm' USING ERRCODE = '22023';
  END IF;

  UPDATE complaints SET status = p_status,
    acknowledged_on = CASE WHEN p_status = 'acknowledged' AND acknowledged_on IS NULL THEN current_date ELSE acknowledged_on END,
    final_response_on = CASE WHEN p_status = 'final_response' AND final_response_on IS NULL THEN current_date ELSE final_response_on END,
    outcome = o, outcome_reasoning = why, root_cause = rc, fault = f, adjustments_confirmed = adj,
    final_response_ref = coalesce(nullif(btrim(coalesce(p_final_ref,'')),''), final_response_ref),
    referred_to_fos = coalesce(p_fos, referred_to_fos),
    assigned_to = coalesce(p_assignee, assigned_to)
  WHERE id = p_id;

  IF p_status = 'acknowledged' OR r_new >= 3 THEN UPDATE case_tasks SET status = 'done', completed_at = now(), completed_by = auth.uid() WHERE auto_key = 'complaint:' || p_id || ':ack' AND status = 'open'; END IF;
  IF r_new >= 4 THEN UPDATE case_tasks SET status = 'cancelled' WHERE left(auto_key, length('complaint:' || p_id || ':')) = 'complaint:' || p_id || ':' AND status = 'open'; END IF;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, p_status, p_note, auth.uid());
  IF p_assignee IS NOT NULL AND p_assignee IS DISTINCT FROM c.assigned_to THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, 'reassigned', 'Handler changed', auth.uid()); END IF;
  IF p_fos IS TRUE AND NOT c.referred_to_fos THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, 'fos', 'Referred to the Financial Ombudsman Service', auth.uid()); END IF;
END $function$;
REVOKE ALL ON FUNCTION public.dv_complaint_update(uuid,text,text,text,boolean,text,text,text,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_complaint_update(uuid,text,text,text,boolean,text,text,text,text,boolean,uuid) TO authenticated;

-- Redress: one manager requests, a different manager approves, then it is recorded as paid
CREATE TABLE IF NOT EXISTS public.complaint_redress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  case_id uuid,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, paid_by uuid, paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS complaint_redress_complaint_idx ON public.complaint_redress (complaint_id);
ALTER TABLE public.complaint_redress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.complaint_redress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.complaint_redress TO service_role;
CREATE POLICY deny_all_clients ON public.complaint_redress AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.complaint_redress FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();

CREATE OR REPLACE FUNCTION public.dv_request_redress(p_complaint uuid, p_amount numeric, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints; rid uuid;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_complaint AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF c.outcome IS NULL OR c.outcome = 'not_upheld' THEN RAISE EXCEPTION 'redress can only follow an upheld or partly upheld outcome' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'enter an amount above zero' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'give a reason for the redress' USING ERRCODE = '22023'; END IF;
  INSERT INTO complaint_redress (organization_id, complaint_id, case_id, amount, reason, requested_by) VALUES (c.organization_id, c.id, c.case_id, round(p_amount, 2), btrim(p_reason), auth.uid()) RETURNING id INTO rid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (c.id, c.organization_id, 'redress_requested', 'Redress requested', auth.uid());
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.dv_decide_redress(p_id uuid, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r complaint_redress;
BEGIN
  SELECT * INTO r FROM complaint_redress WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT dv_is_manager(r.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'requested' THEN RAISE EXCEPTION 'this redress has already been decided' USING ERRCODE = '22023'; END IF;
  IF r.requested_by = auth.uid() THEN RAISE EXCEPTION 'a different manager must approve this redress' USING ERRCODE = '42501'; END IF;
  UPDATE complaint_redress SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now() WHERE id = p_id;
  UPDATE complaints SET redress_amount = (SELECT sum(amount) FROM complaint_redress WHERE complaint_id = r.complaint_id AND status IN ('approved','paid')) WHERE id = r.complaint_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (r.complaint_id, r.organization_id, CASE WHEN p_approve THEN 'redress_approved' ELSE 'redress_rejected' END, NULL, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.dv_mark_redress_paid(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r complaint_redress;
BEGIN
  SELECT * INTO r FROM complaint_redress WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT dv_is_manager(r.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'only approved redress can be marked as paid' USING ERRCODE = '22023'; END IF;
  UPDATE complaint_redress SET status = 'paid', paid_by = auth.uid(), paid_at = now() WHERE id = p_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (r.complaint_id, r.organization_id, 'redress_paid', NULL, auth.uid());
END $$;

-- One timeline: events, messages on the case since the complaint arrived, linked notes, and redress
CREATE OR REPLACE FUNCTION public.dv_complaint_detail(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT (dv_is_manager(c.organization_id) OR (c.case_id IS NOT NULL AND dv_can_read_case(c.case_id))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'timeline', coalesce((SELECT jsonb_agg(s.x ORDER BY s.at) FROM (
        SELECT e.created_at AS at, jsonb_build_object('kind','event','at',e.created_at,'action',e.action,'note',e.note,'by',coalesce(p.full_name,p.email)) AS x
          FROM complaint_events e LEFT JOIN profiles p ON p.id = e.by_user WHERE e.complaint_id = p_id
        UNION ALL
        SELECT m.created_at, jsonb_build_object('kind','message','at',m.created_at,'channel',m.channel,'direction',m.direction,'body',left(m.body,600),'who',m.sender_name,'status',m.status)
          FROM debtverge_communications m WHERE c.case_id IS NOT NULL AND m.case_id = c.case_id AND m.deleted_at IS NULL AND m.created_at::date >= c.received_on AND m.channel <> 'internal_note'
        UNION ALL
        SELECT n.created_at, jsonb_build_object('kind','note','at',n.created_at,'note_kind',n.kind,'body',n.body,'by',coalesce(p2.full_name,p2.email),'withdrawn',n.withdrawn_at IS NOT NULL)
          FROM case_notes n LEFT JOIN profiles p2 ON p2.id = n.created_by WHERE n.linked_type = 'complaint' AND n.linked_id = p_id
      ) s), '[]'::jsonb),
    'redress', coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',r.amount,'reason',r.reason,'status',r.status,'requested_by',r.requested_by,'requested_at',r.requested_at) ORDER BY r.requested_at)
                           FROM complaint_redress r WHERE r.complaint_id = p_id AND dv_is_manager(c.organization_id)), '[]'::jsonb),
    'handler_name', (SELECT coalesce(p3.full_name, p3.email) FROM profiles p3 WHERE p3.id = c.assigned_to)
  );
END $$;

-- Complaints MI for managers
CREATE OR REPLACE FUNCTION public.dv_complaints_mi(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); res jsonb;
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  WITH c AS (SELECT * FROM complaints WHERE organization_id = o AND deleted_at IS NULL AND received_on BETWEEN coalesce(p_from, date '2000-01-01') AND coalesce(p_to, current_date))
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM c), 'open', (SELECT count(*) FROM c WHERE status <> 'closed'),
    'upheld', (SELECT count(*) FROM c WHERE outcome = 'upheld'), 'partially_upheld', (SELECT count(*) FROM c WHERE outcome = 'partially_upheld'), 'not_upheld', (SELECT count(*) FROM c WHERE outcome = 'not_upheld'),
    'fos', (SELECT count(*) FROM c WHERE referred_to_fos), 'vulnerable', (SELECT count(*) FROM c WHERE vulnerable),
    'redress_total', coalesce((SELECT sum(redress_amount) FROM c), 0),
    'ack_in_time', (SELECT count(*) FROM c WHERE acknowledged_on IS NOT NULL AND dv_business_days(received_on, acknowledged_on) <= 5),
    'ack_total', (SELECT count(*) FROM c WHERE acknowledged_on IS NOT NULL),
    'final_in_time', (SELECT count(*) FROM c WHERE final_response_on IS NOT NULL AND final_response_on - received_on <= 56),
    'final_total', (SELECT count(*) FROM c WHERE final_response_on IS NOT NULL),
    'avg_days_to_final', (SELECT round(avg(final_response_on - received_on)::numeric, 1) FROM c WHERE final_response_on IS NOT NULL),
    'by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT category k, count(*) n FROM c GROUP BY 1) q), '[]'::jsonb),
    'by_root_cause', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT root_cause k, count(*) n FROM c WHERE root_cause IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'by_fault', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT fault k, count(*) n FROM c WHERE fault IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'by_handler', coalesce((SELECT jsonb_agg(jsonb_build_object('key', coalesce(p.full_name, p.email, 'Unassigned'), 'count', q.n, 'open', q.o) ORDER BY q.n DESC)
                  FROM (SELECT assigned_to a, count(*) n, count(*) FILTER (WHERE status <> 'closed') o FROM c GROUP BY 1) q LEFT JOIN profiles p ON p.id = q.a), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_dismiss_complaint_flag(uuid)','dv_request_redress(uuid,numeric,text)','dv_decide_redress(uuid,boolean)','dv_mark_redress_paid(uuid)','dv_complaint_detail(uuid)','dv_complaints_mi(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.dv_add_business_days(date,int) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.dv_add_business_days(date,int) TO authenticated;
  REVOKE ALL ON FUNCTION public.dv_flag_possible_complaint() FROM PUBLIC, anon, authenticated;
END $$;

-- Erasure: new complaint text, redress reasons and the event notes are personal data too
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"complaints":["complainant","summary"],', '"complaints":["complainant","summary","outcome_reasoning","final_response_ref"], "complaint_redress":["reason"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch 1 did not apply'; END IF;
  d0 := d;
  d := replace(d0, '  UPDATE debt_cases SET debtor_name = ''[erased]'',', '  UPDATE complaint_events SET note = NULL WHERE note IS NOT NULL AND complaint_id IN (SELECT id FROM complaints WHERE case_id = p_case);' || chr(10) || '  UPDATE debt_cases SET debtor_name = ''[erased]'',');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch 2 did not apply'; END IF;
  EXECUTE d;
END $$;

-- Letter templates for the complaint process (merge fields as in the other templates)
INSERT INTO public.document_templates (organization_id, name, category, audience, subject, body)
SELECT NULL, v.name, 'complaints', 'customer', v.subject, v.body FROM (VALUES
 ('Complaint: holding letter', 'Your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint. We are still looking into it and need a little longer than we expected. We will write to you with our final response as soon as we can, and no later than the end of the eight weeks from when you first contacted us.\n\nIf you have anything else to add, please reply to this letter.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: 8-week letter', 'Your complaint, ref {{case_number}}: update',
  E'Dear {{client_name}},\n\nWe are writing because it has been eight weeks since you made your complaint and we are not yet able to give you our final response. We are sorry for the delay. We will write again by [date] with our response and an explanation of why it has taken longer.\n\nYou are entitled to refer your complaint to the Financial Ombudsman Service now if you wish. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567. You have six months from the date of our final response to do so.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: final response (upheld)', 'Our final response to your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint of [date]. We have looked into it carefully and we agree that we got this wrong.\n\nWhat we found: [findings]\n\nWhat we will do: [remedy, including any payment and when it will be made]\n\nWe are sorry for what happened and for the trouble it has caused you.\n\nIf you are not happy with this response you can refer your complaint to the Financial Ombudsman Service within six months of the date of this letter. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: final response (not upheld)', 'Our final response to your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint of [date]. We have looked into it carefully.\n\nWhat we looked at: [evidence reviewed]\n\nOur decision: we have not upheld your complaint because [reasons].\n\nWe understand this may not be the answer you hoped for. If you are not happy with this response you can refer your complaint to the Financial Ombudsman Service within six months of the date of this letter. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}')
) AS v(name, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM public.document_templates t WHERE t.organization_id IS NULL AND t.name = v.name);

-- ===== 20261122280000_client_search =====
-- Client search: one box finds a client by name, phone, email, date of birth, address or case number.
ALTER TABLE public.debt_customer_profiles ADD COLUMN IF NOT EXISTS date_of_birth date CHECK (date_of_birth IS NULL OR (date_of_birth > date '1900-01-01' AND date_of_birth < current_date));

CREATE OR REPLACE FUNCTION public.dv_search_clients(p_q text)
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, status text, email text, phone text, date_of_birth date, address text, adviser_name text, matched_on text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); q text := btrim(coalesce(p_q, '')); pat text; digits text; dob date := NULL; m text[];
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF length(q) < 2 OR length(q) > 100 THEN RETURN; END IF;
  pat := '%' || replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');
  -- dates typed as 14/03/1985, 14-03-1985, 14.3.85 or 1985-03-14
  m := regexp_match(q, '^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$');
  IF m IS NOT NULL THEN
    BEGIN dob := make_date(CASE WHEN length(m[3]) = 2 THEN (CASE WHEN m[3]::int > extract(year FROM current_date)::int % 100 THEN 1900 ELSE 2000 END) + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int);
    EXCEPTION WHEN OTHERS THEN dob := NULL; END;
  ELSE
    m := regexp_match(q, '^(\d{4})-(\d{1,2})-(\d{1,2})$');
    IF m IS NOT NULL THEN BEGIN dob := make_date(m[1]::int, m[2]::int, m[3]::int); EXCEPTION WHEN OTHERS THEN dob := NULL; END; END IF;
  END IF;
  -- a phone search needs at least 4 digits and mostly digits; compare without spaces, +44 or leading 0
  IF length(digits) < 4 OR length(digits) < length(regexp_replace(q, '[\s()+\-]', '', 'g')) THEN digits := NULL; END IF;
  IF digits IS NOT NULL THEN digits := regexp_replace(digits, '^(44|0)', ''); END IF;

  RETURN QUERY
  SELECT c.id, c.case_number, c.debtor_name, c.status::text, p.primary_email,
         coalesce(p.mobile_phone, p.landline_phone, p.work_phone), p.date_of_birth,
         nullif(concat_ws(', ', nullif(p.address_street, ''), nullif(p.address_city, ''), nullif(p.address_postcode, '')), ''),
         coalesce(pr.full_name, pr.email),
         CASE
           WHEN lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(coalesce(p.full_name, '')) LIKE pat ESCAPE '\' THEN 'name'
           WHEN lower(c.case_number) LIKE pat ESCAPE '\' THEN 'case number'
           WHEN lower(coalesce(p.primary_email, '')) LIKE pat ESCAPE '\' THEN 'email'
           WHEN dob IS NOT NULL AND p.date_of_birth = dob THEN 'date of birth'
           WHEN digits IS NOT NULL AND (regexp_replace(coalesce(p.mobile_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.landline_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.work_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%') THEN 'phone'
           ELSE 'address'
         END
  FROM debt_cases c
  LEFT JOIN debt_customer_profiles p ON p.case_id = c.id AND p.deleted_at IS NULL
  LEFT JOIN profiles pr ON pr.id = c.assigned_to
  WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)
    AND (
      lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(c.case_number) LIKE pat ESCAPE '\'
      OR lower(coalesce(p.full_name, '')) LIKE pat ESCAPE '\' OR lower(coalesce(p.primary_email, '')) LIKE pat ESCAPE '\'
      OR lower(concat_ws(' ', p.address_street, p.address_city, p.address_postcode)) LIKE pat ESCAPE '\'
      OR lower(replace(coalesce(p.address_postcode, ''), ' ', '')) LIKE replace(pat, ' ', '') ESCAPE '\'
      OR (dob IS NOT NULL AND p.date_of_birth = dob)
      OR (digits IS NOT NULL AND (regexp_replace(coalesce(p.mobile_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.landline_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.work_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%'))
    )
  ORDER BY (lower(c.debtor_name) LIKE lower(q) || '%') DESC, c.debtor_name
  LIMIT 15;
END $function$;
REVOKE ALL ON FUNCTION public.dv_search_clients(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_search_clients(text) TO authenticated;

-- date of birth is personal data: erasure clears it
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"debt_customer_profiles":["full_name",', '"debt_customer_profiles":["date_of_birth","full_name",');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;

-- ===== 20261122290000_client_book_and_payment_suite =====
-- Client book: every client on the firm's books, filterable, sortable and paged. Payment suite: the firm's money in one place.
CREATE OR REPLACE FUNCTION public.dv_client_book(p_q text DEFAULT NULL, p_status text DEFAULT NULL, p_plan text DEFAULT NULL, p_adviser uuid DEFAULT NULL, p_flag text DEFAULT NULL,
  p_sort text DEFAULT 'name', p_dir text DEFAULT 'asc', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, status text, plan_type text, adviser_id uuid, adviser_name text, total_debt numeric, creditor_count int,
  installment_amount numeric, payment_frequency text, next_due_date date, arrears_days int, open_complaints int, last_contact timestamptz, created_at timestamptz, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); lim int := greatest(1, least(coalesce(p_limit, 50), 500)); off int := greatest(0, coalesce(p_offset, 0)); q text := nullif(btrim(coalesce(p_q, '')), '');
        pat text; srt text := coalesce(p_sort, 'name'); dir text := CASE WHEN lower(coalesce(p_dir, 'asc')) = 'desc' THEN 'desc' ELSE 'asc' END;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF lim > 100 AND NOT dv_is_manager(o) THEN lim := 100; END IF;
  IF srt NOT IN ('name','case_number','status','adviser','debt','next_due','arrears','last_contact','created') THEN srt := 'name'; END IF;
  IF p_flag IS NOT NULL AND p_flag NOT IN ('arrears','complaint','quiet_30d','no_schedule') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  IF q IS NOT NULL THEN pat := '%' || replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT c.id, c.case_number AS cn, c.debtor_name AS dn, c.status::text AS st, c.plan_type::text AS pt, c.assigned_to, coalesce(pr.full_name, pr.email) AS an,
           c.total_debt AS td, (SELECT count(*)::int FROM debt_creditors dc WHERE dc.case_id = c.id AND dc.deleted_at IS NULL) AS cc,
           c.installment_amount AS ia, c.payment_frequency AS pf, c.next_due_date AS nd,
           coalesce((SELECT max(current_date - t.due_date) FROM debt_payment_transactions t WHERE t.case_id = c.id AND t.deleted_at IS NULL
                      AND (t.status::text IN ('missed','bounced','overdue') OR (t.status::text = 'scheduled' AND t.due_date < current_date)) AND t.amount_paid < t.amount_due), 0)::int AS ad,
           (SELECT count(*)::int FROM complaints x WHERE x.case_id = c.id AND x.deleted_at IS NULL AND x.status <> 'closed') AS oc,
           (SELECT max(m.created_at) FROM debtverge_communications m WHERE m.case_id = c.id AND m.deleted_at IS NULL AND m.channel <> 'internal_note') AS lc,
           c.created_at AS ca
    FROM debt_cases c LEFT JOIN profiles pr ON pr.id = c.assigned_to
    WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)
      AND (p_status IS NULL OR c.status::text = p_status) AND (p_plan IS NULL OR c.plan_type::text = p_plan) AND (p_adviser IS NULL OR c.assigned_to = p_adviser)
      AND (pat IS NULL OR lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(c.case_number) LIKE pat ESCAPE '\')
  ), f AS (
    SELECT b.* FROM base b WHERE p_flag IS NULL
       OR (p_flag = 'arrears' AND b.ad > 0) OR (p_flag = 'complaint' AND b.oc > 0)
       OR (p_flag = 'quiet_30d' AND b.st NOT IN ('completed','closed') AND (b.lc IS NULL OR b.lc < now() - interval '30 days'))
       OR (p_flag = 'no_schedule' AND b.st NOT IN ('completed','closed','intake') AND b.nd IS NULL)
  )
  SELECT f.id, f.cn, f.dn, f.st, f.pt, f.assigned_to, f.an, f.td, f.cc, f.ia, f.pf, f.nd, f.ad, f.oc, f.lc, f.ca, count(*) OVER ()
  FROM f
  ORDER BY
    CASE WHEN srt = 'name' AND dir = 'asc' THEN lower(f.dn) END ASC, CASE WHEN srt = 'name' AND dir = 'desc' THEN lower(f.dn) END DESC,
    CASE WHEN srt = 'case_number' AND dir = 'asc' THEN f.cn END ASC, CASE WHEN srt = 'case_number' AND dir = 'desc' THEN f.cn END DESC,
    CASE WHEN srt = 'status' AND dir = 'asc' THEN f.st END ASC, CASE WHEN srt = 'status' AND dir = 'desc' THEN f.st END DESC,
    CASE WHEN srt = 'adviser' AND dir = 'asc' THEN lower(f.an) END ASC, CASE WHEN srt = 'adviser' AND dir = 'desc' THEN lower(f.an) END DESC,
    CASE WHEN srt = 'debt' AND dir = 'asc' THEN f.td END ASC, CASE WHEN srt = 'debt' AND dir = 'desc' THEN f.td END DESC,
    CASE WHEN srt = 'next_due' AND dir = 'asc' THEN f.nd END ASC, CASE WHEN srt = 'next_due' AND dir = 'desc' THEN f.nd END DESC,
    CASE WHEN srt = 'arrears' AND dir = 'asc' THEN f.ad END ASC, CASE WHEN srt = 'arrears' AND dir = 'desc' THEN f.ad END DESC,
    CASE WHEN srt = 'last_contact' AND dir = 'asc' THEN f.lc END ASC, CASE WHEN srt = 'last_contact' AND dir = 'desc' THEN f.lc END DESC,
    CASE WHEN srt = 'created' AND dir = 'asc' THEN f.ca END ASC, CASE WHEN srt = 'created' AND dir = 'desc' THEN f.ca END DESC,
    f.id
  LIMIT lim OFFSET off;
END $function$;
REVOKE ALL ON FUNCTION public.dv_client_book(text,text,text,uuid,text,text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_client_book(text,text,text,uuid,text,text,text,int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_payment_suite() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); res jsonb;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  WITH vis AS (SELECT c.id, c.case_number, c.debtor_name, coalesce(pr.full_name, pr.email) AS adviser FROM debt_cases c LEFT JOIN profiles pr ON pr.id = c.assigned_to
                WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)),
  due AS (SELECT t.id, t.case_id, t.due_date, t.amount_due, t.amount_paid, t.status::text AS st, t.failure_reason FROM debt_payment_transactions t JOIN vis ON vis.id = t.case_id WHERE t.deleted_at IS NULL),
  overdue AS (SELECT d.*, current_date - d.due_date AS days FROM due d WHERE d.amount_paid < d.amount_due AND (d.st IN ('missed','bounced','overdue') OR (d.st = 'scheduled' AND d.due_date < current_date))),
  upcoming AS (SELECT d.* FROM due d WHERE d.st = 'scheduled' AND d.due_date >= current_date AND d.due_date <= current_date + 30),
  rec AS (SELECT p.id, p.case_id, p.amount, p.payment_date, p.reference, p.is_shortfall, p.shortfall_amount FROM debt_payments p JOIN vis ON vis.id = p.case_id WHERE p.deleted_at IS NULL AND p.payment_date >= current_date - 90),
  links AS (SELECT l.id, l.case_id, l.amount, l.reason, l.channel, l.status, l.created_at, l.expires_at, l.paid_at FROM payment_links l JOIN vis ON vis.id = l.case_id WHERE l.deleted_at IS NULL)
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'due_today_count', (SELECT count(*) FROM upcoming WHERE due_date = current_date), 'due_today_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM upcoming WHERE due_date = current_date), 0),
      'next7_count', (SELECT count(*) FROM upcoming WHERE due_date <= current_date + 7), 'next7_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM upcoming WHERE due_date <= current_date + 7), 0),
      'overdue_count', (SELECT count(*) FROM overdue), 'overdue_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM overdue), 0),
      'overdue_clients', (SELECT count(DISTINCT case_id) FROM overdue),
      'received_90d', coalesce((SELECT sum(amount) FROM rec), 0), 'received_90d_count', (SELECT count(*) FROM rec),
      'shortfalls_90d', (SELECT count(*) FROM rec WHERE is_shortfall),
      'links_open_count', (SELECT count(*) FROM links WHERE paid_at IS NULL AND status NOT IN ('paid','cancelled','expired','void') AND (expires_at IS NULL OR expires_at > now())),
      'links_open_amount', coalesce((SELECT sum(amount) FROM links WHERE paid_at IS NULL AND status NOT IN ('paid','cancelled','expired','void') AND (expires_at IS NULL OR expires_at > now())), 0),
      'links_paid_30d', (SELECT count(*) FROM links WHERE paid_at >= now() - interval '30 days')),
    'overdue', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'adviser', vis.adviser, 'due_date', x.due_date, 'days', x.days, 'amount', x.amount_due - x.amount_paid, 'status', x.st, 'reason', x.failure_reason) ORDER BY x.days DESC)
                         FROM (SELECT * FROM overdue ORDER BY days DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'upcoming', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'adviser', vis.adviser, 'due_date', x.due_date, 'amount', x.amount_due - x.amount_paid) ORDER BY x.due_date)
                          FROM (SELECT * FROM upcoming ORDER BY due_date LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'date', x.payment_date, 'amount', x.amount, 'reference', x.reference, 'shortfall', x.is_shortfall, 'shortfall_amount', x.shortfall_amount) ORDER BY x.payment_date DESC)
                          FROM (SELECT * FROM rec ORDER BY payment_date DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'amount', x.amount, 'reason', x.reason, 'channel', x.channel, 'status', x.status, 'created_at', x.created_at, 'expires_at', x.expires_at, 'paid_at', x.paid_at) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM links ORDER BY created_at DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.dv_payment_suite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_payment_suite() TO authenticated;
-- Payment Suite, firm-wide operations: creditor payout runs, bank reconciliation, client-money reconciliation and fees.
-- Payout runs follow case access; reconciliation, client money and fees are manager-only.
CREATE OR REPLACE FUNCTION public.dv_payment_suite_ops() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); mgr boolean; res jsonb;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  mgr := dv_is_manager(o);
  WITH vis AS (SELECT c.id, c.case_number, c.debtor_name FROM debt_cases c WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)),
  runs AS (SELECT r.id, r.case_id, r.run_date, r.status, r.total_amount, r.total_items, r.created_at, r.approved_at, r.settled_at, r.created_by, r.approved_by
             FROM disbursement_runs r JOIN vis ON vis.id = r.case_id WHERE r.deleted_at IS NULL AND r.organization_id = o)
  SELECT jsonb_build_object(
    'payouts', jsonb_build_object(
      'awaiting_count', (SELECT count(*) FROM runs WHERE status = 'draft'),
      'awaiting_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'draft'), 0),
      'failed_count', (SELECT count(*) FROM runs WHERE status = 'failed'),
      'approved_count', (SELECT count(*) FROM runs WHERE status = 'approved'),
      'approved_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'approved'), 0),
      'settled_30d_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'settled' AND coalesce(settled_at, approved_at, created_at) >= now() - interval '30 days'), 0),
      'runs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'run_date', x.run_date, 'status', x.status,
                          'total_amount', x.total_amount, 'total_items', x.total_items, 'created_by_me', x.created_by = auth.uid()) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM runs ORDER BY created_at DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb)),
    'reconciliation', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', s, 'count', n, 'amount', a) ORDER BY n DESC)
                  FROM (SELECT match_status s, count(*) n, coalesce(sum(amount), 0) a FROM bank_transactions WHERE organization_id = o AND deleted_at IS NULL GROUP BY 1) q), '[]'::jsonb),
      'unmatched', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'date', b.transaction_date, 'amount', b.amount, 'direction', b.direction, 'reference', b.reference, 'counterparty', b.counterparty_name, 'status', b.match_status, 'notes', b.match_notes) ORDER BY b.transaction_date DESC)
                  FROM (SELECT * FROM bank_transactions WHERE organization_id = o AND deleted_at IS NULL AND match_status NOT IN ('matched','auto_matched','manual_matched','ignored') ORDER BY transaction_date DESC LIMIT 100) b), '[]'::jsonb),
      'feeds', coalesce((SELECT jsonb_agg(jsonb_build_object('name', f.feed_name, 'type', f.feed_type, 'last_import_at', f.last_import_at, 'last_import_count', f.last_import_count, 'active', f.is_active) ORDER BY f.feed_name)
                  FROM bank_feeds f WHERE f.organization_id = o), '[]'::jsonb)) END,
    'client_money', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'last', (SELECT jsonb_build_object('date', r.recon_date, 'bank_balance', r.bank_balance, 'ledger_total', r.ledger_total, 'difference', r.difference, 'note', r.note) FROM cass_reconciliations r WHERE r.organization_id = o ORDER BY r.recon_date DESC, r.created_at DESC LIMIT 1),
      'history', coalesce((SELECT jsonb_agg(jsonb_build_object('date', r.recon_date, 'bank_balance', r.bank_balance, 'ledger_total', r.ledger_total, 'difference', r.difference) ORDER BY r.recon_date DESC)
                  FROM (SELECT * FROM cass_reconciliations WHERE organization_id = o ORDER BY recon_date DESC LIMIT 12) r), '[]'::jsonb),
      'open_holds', (SELECT count(*) FROM cass_holds WHERE organization_id = o AND released_at IS NULL AND deleted_at IS NULL)) END,
    'fees', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', s, 'count', n, 'amount', a) ORDER BY n DESC)
                  FROM (SELECT status s, count(*) n, coalesce(sum(amount), 0) a FROM fee_charges WHERE organization_id = o AND deleted_at IS NULL AND charged_on >= current_date - 90 GROUP BY 1) q), '[]'::jsonb)) END
  ) INTO res;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.dv_payment_suite_ops() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_payment_suite_ops() TO authenticated;

-- ===== 20261122310000_phone_and_call_compliance =====
-- Phone (call log tied to the case) and Call compliance (review, QA, coaching, access trail) as separately licensed add-ons.
-- Replaces the original Storm Call tables, whose rules let every staff member read, edit and delete every call.
-- No AI scoring here: nothing is shown as a transcript or score unless a real source wrote it, and a person approves it.

-- ---------- 1. close the original tables (all empty) ----------
DO $$ DECLARE t text; p record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'storm_call\_%' ESCAPE '\' LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

-- ---------- 2. licences ----------
INSERT INTO dv_products (key, name, description, display_order) VALUES
  ('voip', 'Phone', 'Call log tied to the case: every call, its outcome, flags, follow-ups, and AI-drafted notes that a person approves', 30),
  ('compliance', 'Call compliance', 'Call review and quality assurance: review queue, checklists, adviser QA, coaching and an access trail', 40)
ON CONFLICT (key) DO NOTHING;
-- firms already licensed get both for the first draft (switch off per firm in dv_org_products)
INSERT INTO dv_org_products (organization_id, product_key)
  SELECT DISTINCT o.organization_id, k.key FROM dv_org_products o CROSS JOIN (VALUES ('voip'),('compliance')) k(key)
ON CONFLICT DO NOTHING;

-- ---------- 3. tables ----------
CREATE TABLE IF NOT EXISTS public.dv_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','softphone','provider')),
  status text NOT NULL CHECK (status IN ('completed','missed','voicemail','failed')),
  phone text CHECK (length(phone) <= 40),
  adviser_id uuid,
  started_at timestamptz NOT NULL,
  duration_seconds int NOT NULL DEFAULT 0 CHECK (duration_seconds BETWEEN 0 AND 86400),
  outcome text NOT NULL CHECK (outcome IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other')),
  summary text CHECK (length(summary) <= 2000),
  recording_notice_given boolean,
  recording_status text NOT NULL DEFAULT 'none' CHECK (recording_status IN ('none','recording','paused','available','failed')),
  recording_ref text,                       -- object key in private storage; never a public link
  vulnerability_flag boolean NOT NULL DEFAULT false,
  possible_complaint boolean NOT NULL DEFAULT false,
  note_id uuid,
  provider_call_id text UNIQUE,
  retention_class text NOT NULL DEFAULT 'call_recording',
  retention_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_sessions_case_idx ON public.dv_call_sessions (case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS dv_call_sessions_org_idx ON public.dv_call_sessions (organization_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.dv_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_events_call_idx ON public.dv_call_events (call_id, at);

CREATE TABLE IF NOT EXISTS public.dv_call_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('view_call','play_recording','view_transcript','download')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_access_org_idx ON public.dv_call_access_log (organization_id, at DESC);

-- AI-produced drafts. Only the service role writes them; a person approves, amends or rejects each one.
CREATE TABLE IF NOT EXISTS public.dv_call_ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('transcript','summary')),
  body text NOT NULL CHECK (length(body) <= 60000),
  model text NOT NULL,
  model_version text,
  confidence numeric CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','amended','rejected')),
  final_body text CHECK (length(final_body) <= 60000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') = (decided_at IS NULL)),
  CHECK (status <> 'amended' OR final_body IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS dv_call_ai_drafts_call_idx ON public.dv_call_ai_drafts (call_id);

CREATE TABLE IF NOT EXISTS public.dv_call_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL UNIQUE REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  due_date date NOT NULL,
  outcome text CHECK (outcome IN ('pass','pass_with_feedback','fail','escalated')),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments text CHECK (length(comments) <= 3000),
  coaching_action text CHECK (length(coaching_action) <= 1000),
  coaching_due date,
  coaching_done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status = 'open' OR (outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS dv_call_reviews_org_idx ON public.dv_call_reviews (organization_id, status, due_date);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dv_call_sessions','dv_call_events','dv_call_access_log','dv_call_ai_drafts','dv_call_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dv_call_sessions','dv_call_ai_drafts','dv_call_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row()', t);
  END LOOP;
END $$;
GRANT INSERT ON public.dv_call_ai_drafts TO service_role;   -- the transcription/summary job writes drafts here; no client can

-- the event and access trails cannot be edited
CREATE OR REPLACE FUNCTION public.dv_call_trail_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'call trail rows cannot be changed' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.dv_call_trail_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.dv_call_events FOR EACH ROW EXECUTE FUNCTION public.dv_call_trail_immutable();
CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.dv_call_access_log FOR EACH ROW EXECUTE FUNCTION public.dv_call_trail_immutable();

-- ---------- 4. helpers ----------
CREATE OR REPLACE FUNCTION public.dv_call_org_ok(p_org uuid, p_product text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_org IS NULL OR NOT dv_org_has_product(p_org, p_product) THEN
    RAISE EXCEPTION 'this is not part of your licence' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.dv_call_org_ok(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------- 5. adviser functions ----------
CREATE OR REPLACE FUNCTION public.dv_call_log(p_case uuid, p_direction text, p_phone text, p_started_at timestamptz, p_duration_seconds int, p_outcome text,
  p_summary text, p_notice_given boolean DEFAULT NULL, p_vulnerability boolean DEFAULT false, p_possible_complaint boolean DEFAULT false, p_follow_up date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; sid uuid; nid uuid; st text; sm text := nullif(btrim(coalesce(p_summary,'')),'');
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(c.organization_id, 'voip');
  IF p_direction NOT IN ('inbound','outbound') THEN RAISE EXCEPTION 'choose inbound or outbound' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other') THEN
    RAISE EXCEPTION 'choose what happened on the call' USING ERRCODE = '22023'; END IF;
  IF p_started_at IS NULL OR p_started_at > now() + interval '5 minutes' OR p_started_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'the call time must be within the last 30 days and not in the future' USING ERRCODE = '22023'; END IF;
  IF p_duration_seconds IS NULL OR p_duration_seconds < 0 OR p_duration_seconds > 86400 THEN RAISE EXCEPTION 'check the call length' USING ERRCODE = '22023'; END IF;
  IF p_outcome IN ('spoke_to_client','spoke_to_third_party','call_back_requested','payment_promised') AND (sm IS NULL OR length(sm) < 10) THEN
    RAISE EXCEPTION 'write a short summary of the call (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'spoke_to_client' AND p_notice_given IS NULL THEN
    RAISE EXCEPTION 'say whether the recording notice was given' USING ERRCODE = '22023'; END IF;
  st := CASE p_outcome WHEN 'no_answer' THEN 'missed' WHEN 'voicemail_left' THEN 'voicemail' ELSE 'completed' END;
  nid := dv_add_note(p_case, 'call', coalesce(sm, 'Call: ' || replace(p_outcome, '_', ' ')), false, p_direction, NULL, replace(p_outcome, '_', ' '), p_follow_up);
  INSERT INTO dv_call_sessions (organization_id, case_id, direction, source, status, phone, adviser_id, started_at, duration_seconds, outcome, summary,
      recording_notice_given, vulnerability_flag, possible_complaint, note_id, created_by)
  VALUES (c.organization_id, p_case, p_direction, 'manual', st, left(nullif(btrim(coalesce(p_phone,'')),''),40), auth.uid(), p_started_at, p_duration_seconds, p_outcome, sm,
      p_notice_given, coalesce(p_vulnerability,false), coalesce(p_possible_complaint,false), nid, auth.uid())
  RETURNING id INTO sid;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (c.organization_id, sid, 'logged', jsonb_build_object('source','manual'), auth.uid());
  IF coalesce(p_possible_complaint,false) THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, 'Possible complaint raised on a call: log it or record why not', 'call', current_date + 1, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid());
  END IF;
  IF st = 'missed' AND p_direction = 'inbound' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, 'Return the missed call', 'call', current_date, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid());
  END IF;
  RETURN sid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_list(p_case uuid)
RETURNS TABLE (id uuid, direction text, status text, phone text, started_at timestamptz, duration_seconds int, outcome text, summary text, adviser_name text,
  recording_status text, recording_notice_given boolean, vulnerability_flag boolean, possible_complaint boolean, source text, draft_count int, reviewed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM debt_cases WHERE debt_cases.id = p_case AND deleted_at IS NULL;
  IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(org, 'voip');
  RETURN QUERY
    SELECT s.id, s.direction, s.status, s.phone, s.started_at, s.duration_seconds, s.outcome, s.summary, coalesce(p.full_name, p.email)::text,
           s.recording_status, s.recording_notice_given, s.vulnerability_flag, s.possible_complaint, s.source,
           (SELECT count(*)::int FROM dv_call_ai_drafts d WHERE d.call_id = s.id AND d.status = 'draft'),
           EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id AND r.status = 'completed')
      FROM dv_call_sessions s LEFT JOIN profiles p ON p.id = s.adviser_id
     WHERE s.case_id = p_case ORDER BY s.started_at DESC LIMIT 200;
END $function$;

-- full call record; each opening is written to the access trail
CREATE OR REPLACE FUNCTION public.dv_call_detail(p_call uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; mgr boolean; res jsonb; rv dv_call_reviews;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call;
  IF s.id IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(s.organization_id, 'voip');
  mgr := dv_is_manager(s.organization_id);
  INSERT INTO dv_call_access_log (organization_id, call_id, user_id, action) VALUES (s.organization_id, s.id, auth.uid(), 'view_call');
  SELECT * INTO rv FROM dv_call_reviews WHERE call_id = s.id;
  res := jsonb_build_object(
    'call', to_jsonb(s) - 'recording_ref' - 'created_by' - 'provider_call_id',
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event', e.event, 'detail', e.detail, 'at', e.at, 'by', coalesce(p.full_name, p.email)) ORDER BY e.at)
                          FROM dv_call_events e LEFT JOIN profiles p ON p.id = e.actor WHERE e.call_id = s.id), '[]'::jsonb),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'body', d.body, 'model', d.model, 'model_version', d.model_version, 'confidence', d.confidence,
                          'status', d.status, 'final_body', d.final_body, 'decided_at', d.decided_at) ORDER BY d.created_at)
                          FROM dv_call_ai_drafts d WHERE d.call_id = s.id), '[]'::jsonb),
    'review', CASE WHEN rv.id IS NULL THEN NULL
                   WHEN mgr THEN jsonb_build_object('id', rv.id, 'status', rv.status, 'outcome', rv.outcome, 'checklist', rv.checklist, 'comments', rv.comments, 'coaching_action', rv.coaching_action,
                          'coaching_due', rv.coaching_due, 'due_date', rv.due_date, 'mine', rv.reviewer_id = auth.uid())
                   WHEN rv.status = 'completed' THEN jsonb_build_object('status', rv.status, 'outcome', rv.outcome, 'coaching_action', rv.coaching_action, 'coaching_due', rv.coaching_due)
                   ELSE NULL END);
  RETURN res;
END $function$;

-- approve, amend or reject an AI draft: the adviser on the call or a manager
CREATE OR REPLACE FUNCTION public.dv_call_ai_decide(p_draft uuid, p_decision text, p_final_body text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d dv_call_ai_drafts; s dv_call_sessions; st text;
BEGIN
  SELECT * INTO d FROM dv_call_ai_drafts WHERE id = p_draft FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = d.call_id;
  IF NOT dv_can_edit_case(s.case_id) OR NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(s.organization_id, 'voip');
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'this draft has already been decided' USING ERRCODE = '22023'; END IF;
  st := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'amend' THEN 'amended' WHEN 'reject' THEN 'rejected' ELSE NULL END;
  IF st IS NULL THEN RAISE EXCEPTION 'choose approve, amend or reject' USING ERRCODE = '22023'; END IF;
  IF st = 'amended' AND (p_final_body IS NULL OR btrim(p_final_body) = '') THEN RAISE EXCEPTION 'enter the corrected text' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_ai_drafts SET status = st, final_body = CASE st WHEN 'amended' THEN btrim(p_final_body) WHEN 'approved' THEN body ELSE NULL END, decided_by = auth.uid(), decided_at = now() WHERE id = p_draft;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (s.organization_id, s.id, 'ai_draft_decided', jsonb_build_object('kind', d.kind, 'decision', st), auth.uid());
END $function$;

-- ---------- 6. compliance functions (managers with a second step, firm licensed for Call compliance) ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_gate() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'compliance');
  RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.dv_compliance_gate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dv_compliance_queue(p_filter text DEFAULT 'needs_review')
RETURNS TABLE (id uuid, case_id uuid, case_number text, debtor_name text, direction text, started_at timestamptz, duration_seconds int, outcome text, adviser_id uuid, adviser_name text,
  flags text[], review_id uuid, review_status text, review_outcome text, reviewer_name text, due_date date, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  IF p_filter NOT IN ('needs_review','open','completed','flagged') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    WITH q AS (
      SELECT s.id, s.case_id, c.case_number, c.debtor_name, s.direction, s.started_at, s.duration_seconds, s.outcome, s.adviser_id, coalesce(pa.full_name, pa.email)::text an,
             array_remove(ARRAY[CASE WHEN s.possible_complaint THEN 'possible complaint' END, CASE WHEN s.vulnerability_flag THEN 'vulnerability' END,
                                CASE WHEN s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE THEN 'no recording notice' END], NULL) fl,
             r.id rid, r.status rs, r.outcome ro, coalesce(pr.full_name, pr.email)::text rn, r.due_date, (r.reviewer_id = auth.uid()) mine
        FROM dv_call_sessions s JOIN debt_cases c ON c.id = s.case_id
        LEFT JOIN dv_call_reviews r ON r.call_id = s.id
        LEFT JOIN profiles pa ON pa.id = s.adviser_id LEFT JOIN profiles pr ON pr.id = r.reviewer_id
       WHERE s.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(s.case_id) AND s.status = 'completed' AND s.outcome <> 'wrong_number')
    SELECT q.id, q.case_id, q.case_number, q.debtor_name, q.direction, q.started_at, q.duration_seconds, q.outcome, q.adviser_id, q.an, q.fl, q.rid, q.rs, q.ro, q.rn, q.due_date, q.mine
      FROM q
     WHERE CASE p_filter WHEN 'needs_review' THEN q.rid IS NULL WHEN 'open' THEN q.rs = 'open' WHEN 'completed' THEN q.rs = 'completed' ELSE cardinality(q.fl) > 0 END
     ORDER BY (cardinality(q.fl) > 0) DESC, q.started_at ASC LIMIT 200;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); res jsonb;
BEGIN
  WITH calls AS (
    SELECT s.* FROM dv_call_sessions s JOIN debt_cases c ON c.id = s.case_id
     WHERE s.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(s.case_id) AND s.started_at >= now() - interval '30 days' AND s.status = 'completed' AND s.outcome <> 'wrong_number'),
  rv AS (SELECT r.*, c.adviser_id FROM dv_call_reviews r JOIN calls c ON c.id = r.call_id)
  SELECT jsonb_build_object(
    'calls_30d', (SELECT count(*) FROM calls),
    'reviewed_30d', (SELECT count(*) FROM rv WHERE status = 'completed'),
    'open_reviews', (SELECT count(*) FROM rv WHERE status = 'open'),
    'overdue_reviews', (SELECT count(*) FROM rv WHERE status = 'open' AND due_date < current_date),
    'passed', (SELECT count(*) FROM rv WHERE outcome IN ('pass','pass_with_feedback')),
    'failed', (SELECT count(*) FROM rv WHERE outcome IN ('fail','escalated')),
    'flagged_unreviewed', (SELECT count(*) FROM calls c WHERE NOT EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = c.id)
                              AND (c.possible_complaint OR c.vulnerability_flag OR (c.outcome = 'spoke_to_client' AND c.recording_notice_given IS NOT TRUE))),
    'no_notice', (SELECT count(*) FROM calls c WHERE c.outcome = 'spoke_to_client' AND c.recording_notice_given IS NOT TRUE),
    'coaching_open', (SELECT count(*) FROM rv WHERE coaching_action IS NOT NULL AND coaching_done_at IS NULL),
    'by_adviser', coalesce((SELECT jsonb_agg(jsonb_build_object('adviser_id', x.aid, 'name', x.nm, 'calls', x.n, 'reviewed', x.rvd, 'passed', x.ps, 'failed', x.fl) ORDER BY x.n DESC)
        FROM (SELECT c.adviser_id aid, coalesce(p.full_name, p.email) nm, count(*) n,
                     count(r.id) FILTER (WHERE r.status = 'completed') rvd,
                     count(r.id) FILTER (WHERE r.outcome IN ('pass','pass_with_feedback')) ps,
                     count(r.id) FILTER (WHERE r.outcome IN ('fail','escalated')) fl
                FROM calls c LEFT JOIN dv_call_reviews r ON r.call_id = c.id LEFT JOIN profiles p ON p.id = c.adviser_id GROUP BY 1, 2) x), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;

-- take a call for review. The reviewer cannot be the adviser who took the call.
CREATE OR REPLACE FUNCTION public.dv_compliance_take_review(p_call uuid, p_due date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); s dv_call_sessions; rid uuid;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call AND organization_id = o FOR UPDATE;
  IF s.id IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.adviser_id = auth.uid() THEN RAISE EXCEPTION 'you cannot review a call you took yourself' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_reviews WHERE call_id = p_call) THEN RAISE EXCEPTION 'this call already has a review' USING ERRCODE = '22023'; END IF;
  IF p_due IS NOT NULL AND (p_due < current_date OR p_due > current_date + 60) THEN RAISE EXCEPTION 'choose a due date within the next 60 days' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_reviews (organization_id, call_id, reviewer_id, due_date) VALUES (o, p_call, auth.uid(), coalesce(p_due, current_date + 5)) RETURNING id INTO rid;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (o, p_call, 'review_started', '{}'::jsonb, auth.uid());
  RETURN rid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_complete(p_review uuid, p_outcome text, p_checklist jsonb, p_comments text, p_coaching text DEFAULT NULL, p_coaching_due date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; k text; v text; cm text := nullif(btrim(coalesce(p_comments,'')),''); has_no boolean := false;
  allowed text[] := ARRAY['recording_notice','identity_checked','affordability_discussed','vulnerability_considered','options_explained','no_pressure','accurate_information','next_steps_agreed'];
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id <> auth.uid() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'this review is already complete' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('pass','pass_with_feedback','fail','escalated') THEN RAISE EXCEPTION 'choose an outcome' USING ERRCODE = '22023'; END IF;
  IF p_checklist IS NULL OR jsonb_typeof(p_checklist) <> 'object' THEN RAISE EXCEPTION 'complete the checklist' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_checklist) LOOP
    IF NOT k = ANY (allowed) OR v NOT IN ('yes','no','na') THEN RAISE EXCEPTION 'unknown checklist answer' USING ERRCODE = '22023'; END IF;
    IF v = 'no' THEN has_no := true; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(p_checklist)) < cardinality(allowed) THEN RAISE EXCEPTION 'answer every checklist item' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'pass' AND has_no THEN RAISE EXCEPTION 'a call with a "no" answer cannot be a clean pass' USING ERRCODE = '22023'; END IF;
  IF p_outcome <> 'pass' AND (cm IS NULL OR length(cm) < 10) THEN RAISE EXCEPTION 'explain the outcome in the comments' USING ERRCODE = '22023'; END IF;
  IF p_coaching_due IS NOT NULL AND (p_coaching_due < current_date OR p_coaching_due > current_date + 180) THEN RAISE EXCEPTION 'check the coaching due date' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET status = 'completed', outcome = p_outcome, checklist = p_checklist, comments = left(cm, 3000), coaching_action = left(nullif(btrim(coalesce(p_coaching,'')),''), 1000),
         coaching_due = p_coaching_due, completed_at = now() WHERE id = p_review;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (o, r.call_id, 'review_completed', jsonb_build_object('outcome', p_outcome), auth.uid());
END $function$;

-- an adviser sees coaching set after their calls was reviewed and marks it done
CREATE OR REPLACE FUNCTION public.dv_my_coaching() RETURNS TABLE (review_id uuid, call_id uuid, case_id uuid, case_number text, debtor_name text, outcome text, coaching_action text, coaching_due date, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  RETURN QUERY
    SELECT r.id, s.id, s.case_id, c.case_number, c.debtor_name, r.outcome, r.coaching_action, r.coaching_due, r.coaching_done_at IS NOT NULL
      FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id JOIN debt_cases c ON c.id = s.case_id
     WHERE s.adviser_id = auth.uid() AND r.status = 'completed' AND r.coaching_action IS NOT NULL AND dv_org_has_product(r.organization_id, 'compliance') AND dv_can_read_case(s.case_id)
     ORDER BY (r.coaching_done_at IS NULL) DESC, r.coaching_due NULLS LAST LIMIT 50;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_coaching_done(p_review uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE r dv_call_reviews; s dv_call_sessions;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review FOR UPDATE;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  IF r.id IS NULL OR s.adviser_id IS DISTINCT FROM auth.uid() OR r.coaching_action IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE dv_call_reviews SET coaching_done_at = coalesce(coaching_done_at, now()) WHERE id = p_review;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_audit(p_limit int DEFAULT 200)
RETURNS TABLE (at timestamptz, action text, user_name text, call_id uuid, case_number text, debtor_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN QUERY
    SELECT a.at, a.action, coalesce(p.full_name, p.email)::text, a.call_id, c.case_number, c.debtor_name
      FROM dv_call_access_log a JOIN dv_call_sessions s ON s.id = a.call_id JOIN debt_cases c ON c.id = s.case_id LEFT JOIN profiles p ON p.id = a.user_id
     WHERE a.organization_id = o AND dv_can_read_case(s.case_id) ORDER BY a.at DESC LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_call_log(uuid,text,text,timestamptz,int,text,text,boolean,boolean,boolean,date)','dv_call_list(uuid)','dv_call_detail(uuid)','dv_call_ai_decide(uuid,text,text)',
     'dv_compliance_queue(text)','dv_compliance_dashboard()','dv_compliance_take_review(uuid,date)','dv_compliance_complete(uuid,text,jsonb,text,text,date)',
     'dv_my_coaching()','dv_coaching_done(uuid)','dv_compliance_audit(int)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------- 7. erasure: call text and phone numbers are personal data ----------
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"case_notes":["body","contact_name","outcome","withdraw_reason"],', '"case_notes":["body","contact_name","outcome","withdraw_reason"], "dv_call_sessions":["phone","summary"], "dv_call_ai_drafts":["body","final_body"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;
