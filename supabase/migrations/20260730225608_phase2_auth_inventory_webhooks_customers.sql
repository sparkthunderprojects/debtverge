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
