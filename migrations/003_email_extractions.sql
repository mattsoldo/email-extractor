-- Migration: Add email_extractions table for tracking multiple extraction runs per email
-- Version: 0.3.0
-- Date: 2025-12-19

-- Create email_extractions table
CREATE TABLE IF NOT EXISTS email_extractions (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES emails(id),
  run_id TEXT NOT NULL REFERENCES extraction_runs(id),

  -- Extraction result
  status extraction_status NOT NULL,

  -- Raw AI response (full extraction data including all transactions)
  raw_extraction JSONB,

  -- Metrics
  confidence NUMERIC(3, 2),
  processing_time_ms INTEGER,

  -- Transaction IDs created from this extraction (for easy lookup)
  transaction_ids JSONB DEFAULT '[]'::jsonb,

  -- Error details if failed
  error TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_email_extractions_email_id ON email_extractions(email_id);
CREATE INDEX IF NOT EXISTS idx_email_extractions_run_id ON email_extractions(run_id);
CREATE INDEX IF NOT EXISTS idx_email_extractions_status ON email_extractions(status);

-- Add composite index for lookup by email and run
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_extractions_email_run ON email_extractions(email_id, run_id);

COMMENT ON TABLE email_extractions IS 'Tracks each extraction attempt for each email, allowing multiple runs per email for comparison';
COMMENT ON COLUMN email_extractions.raw_extraction IS 'Full AI extraction response including isTransactional, emailType, transactions array, and notes';
COMMENT ON COLUMN email_extractions.transaction_ids IS 'Array of transaction IDs created from this extraction for easy lookup';
COMMENT ON COLUMN email_extractions.processing_time_ms IS 'How long the AI extraction took in milliseconds';
