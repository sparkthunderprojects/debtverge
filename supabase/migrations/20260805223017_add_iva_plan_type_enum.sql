-- Add 'iva' to debt_plan_type enum (required by IVAVerge)
ALTER TYPE debt_plan_type ADD VALUE IF NOT EXISTS 'iva';