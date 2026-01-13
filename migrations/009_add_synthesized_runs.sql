-- Migration: Add support for synthesized runs
-- Synthesized runs are created by combining/transforming data from other runs

-- Add synthesized run fields to extraction_runs (idempotent)
ALTER TABLE extraction_runs
ADD COLUMN IF NOT EXISTS is_synthesized BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS synthesis_type TEXT, -- 'comparison_winners', 'data_flatten'
ADD COLUMN IF NOT EXISTS source_run_ids JSONB DEFAULT '[]'; -- Array of run IDs this was synthesized from

-- Note: primary_run_id is stored in the config JSON, not as a separate column
-- (it's always one of the source_run_ids, so a dedicated column is redundant)

-- Add column to track which source transaction a synthesized transaction came from
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS source_transaction_id TEXT REFERENCES transactions(id);

-- Index for efficient lookup of synthesized runs (idempotent)
CREATE INDEX IF NOT EXISTS idx_extraction_runs_is_synthesized ON extraction_runs(is_synthesized) WHERE is_synthesized = TRUE;

-- Index for looking up transactions by source (idempotent)
CREATE INDEX IF NOT EXISTS idx_transactions_source_transaction ON transactions(source_transaction_id) WHERE source_transaction_id IS NOT NULL;

-- Drop primary_run_id if it exists (redundant - stored in config instead)
ALTER TABLE extraction_runs DROP COLUMN IF EXISTS primary_run_id;

COMMENT ON COLUMN extraction_runs.is_synthesized IS 'Whether this run was synthesized from other runs';
COMMENT ON COLUMN extraction_runs.synthesis_type IS 'Type of synthesis: comparison_winners (from A/B comparison), data_flatten (from flattening JSON data)';
COMMENT ON COLUMN extraction_runs.source_run_ids IS 'Array of run IDs this was synthesized from';
COMMENT ON COLUMN transactions.source_transaction_id IS 'For synthesized runs, the original transaction this was copied from';
