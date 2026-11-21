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
