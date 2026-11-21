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