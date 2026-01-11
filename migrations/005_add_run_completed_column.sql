-- Migration: Add run_completed column to transactions
-- This column tracks whether the extraction run that created this transaction completed successfully.
-- Transactions are created incrementally as emails are processed, and run_completed is set to true
-- only when the entire extraction run finishes successfully.

-- Add run_completed column with default false
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS run_completed BOOLEAN DEFAULT FALSE;

-- Create index for filtering by run completion status
CREATE INDEX IF NOT EXISTS idx_transactions_run_completed ON transactions(run_completed);

-- Create composite index for efficient queries on extraction run + completion status
CREATE INDEX IF NOT EXISTS idx_transactions_run_id_completed ON transactions(extraction_run_id, run_completed);

-- Update existing transactions from completed runs to have run_completed = true
-- (Only update transactions whose extraction_run has status = 'completed')
UPDATE transactions t
SET run_completed = TRUE
FROM extraction_runs er
WHERE t.extraction_run_id = er.id
  AND er.status = 'completed'
  AND t.run_completed = FALSE;
