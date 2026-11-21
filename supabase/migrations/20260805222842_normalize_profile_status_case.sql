-- Normalize mixed-case status values in profiles to uppercase
-- (STATUS_META in AdminHub uses uppercase keys)
UPDATE profiles SET status = UPPER(status) WHERE status != UPPER(status);