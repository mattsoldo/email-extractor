-- Migration: Improve discussion_summaries table
-- 1. Add unique constraint to prevent duplicate summaries per email+run
-- 2. Rename related_transaction_ids to related_reference_numbers for clarity (if old name exists)
-- 3. Add the column if it doesn't exist at all

-- Add unique constraint on (email_id, run_id) to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_discussion_summaries_email_run
  ON discussion_summaries(email_id, run_id);

-- Rename column for clarity if it exists with the old name
-- This handles the case where migration 006 created the table with the old column name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discussion_summaries'
    AND column_name = 'related_transaction_ids'
  ) THEN
    ALTER TABLE discussion_summaries
      RENAME COLUMN related_transaction_ids TO related_reference_numbers;
  END IF;
END $$;

-- Add the column if it doesn't exist at all (handles edge cases)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discussion_summaries'
    AND column_name = 'related_reference_numbers'
  ) THEN
    ALTER TABLE discussion_summaries
      ADD COLUMN related_reference_numbers JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add comment explaining the column
COMMENT ON COLUMN discussion_summaries.related_reference_numbers IS
  'External reference/confirmation numbers from the email (not database transaction IDs). Used to link evidence emails to their related transactions.';
