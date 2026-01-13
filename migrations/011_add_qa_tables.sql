-- Migration: Add QA (Quality Assurance) tables
-- These tables support the QA feature for verifying transaction data against source emails

-- Create enum for QA result status
DO $$ BEGIN
  CREATE TYPE qa_result_status AS ENUM ('pending_review', 'accepted', 'rejected', 'partial');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- QA Runs - tracks QA sessions that verify transaction data
CREATE TABLE IF NOT EXISTS qa_runs (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES email_sets(id),
  source_run_id TEXT NOT NULL REFERENCES extraction_runs(id),
  model_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL REFERENCES prompts(id),

  -- Progress tracking
  status TEXT DEFAULT 'pending',
  transactions_total INTEGER DEFAULT 0,
  transactions_checked INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,

  -- Configuration (filters, settings)
  config JSONB,

  -- Output - links to synthesized run created from accepted changes
  synthesized_run_id TEXT REFERENCES extraction_runs(id),

  -- Timestamps
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- QA Results - individual transaction QA findings
CREATE TABLE IF NOT EXISTS qa_results (
  id TEXT PRIMARY KEY,
  qa_run_id TEXT NOT NULL REFERENCES qa_runs(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  source_email_id TEXT NOT NULL REFERENCES emails(id),

  -- QA findings
  has_issues BOOLEAN DEFAULT FALSE,

  -- Field issues (accuracy problems) - array of {field, currentValue, suggestedValue, confidence, reason}
  field_issues JSONB DEFAULT '[]',

  -- Duplicate field detection - array of {fields, suggestedCanonical, reason}
  duplicate_fields JSONB DEFAULT '[]',

  -- Overall assessment from model
  overall_assessment TEXT,

  -- Review status and decisions
  status qa_result_status DEFAULT 'pending_review',
  accepted_fields JSONB, -- { "amount": true, "data.fees": false }
  accepted_merges JSONB, -- [{ "canonical": "amount", "merged": ["data.totalAmount"] }]

  -- Timestamps
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_qa_runs_set_id ON qa_runs(set_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_source_run_id ON qa_runs(source_run_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_status ON qa_runs(status);

CREATE INDEX IF NOT EXISTS idx_qa_results_qa_run_id ON qa_results(qa_run_id);
CREATE INDEX IF NOT EXISTS idx_qa_results_has_issues ON qa_results(has_issues);
CREATE INDEX IF NOT EXISTS idx_qa_results_status ON qa_results(status);

-- Comments
COMMENT ON TABLE qa_runs IS 'QA runs that verify transaction data against source emails';
COMMENT ON TABLE qa_results IS 'Individual transaction QA results with field-level suggestions';
COMMENT ON COLUMN qa_results.field_issues IS 'Array of {field, currentValue, suggestedValue, confidence, reason}';
COMMENT ON COLUMN qa_results.duplicate_fields IS 'Array of {fields, suggestedCanonical, reason}';
COMMENT ON COLUMN qa_results.accepted_fields IS 'Map of field name to boolean indicating acceptance';
COMMENT ON COLUMN qa_results.accepted_merges IS 'Array of accepted merge operations';
