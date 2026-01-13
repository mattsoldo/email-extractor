-- Migration: Add field_overrides column to emails table
-- This stores user-edited field values for use during comparison synthesis

ALTER TABLE emails
ADD COLUMN IF NOT EXISTS field_overrides JSONB;

COMMENT ON COLUMN emails.field_overrides IS 'User-edited field values that override extracted values during synthesis';
