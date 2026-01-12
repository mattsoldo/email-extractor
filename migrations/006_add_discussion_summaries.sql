-- Migration: Add discussion_summaries table for evidence/discussion emails

CREATE TABLE IF NOT EXISTS discussion_summaries (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES emails(id),
  run_id TEXT NOT NULL REFERENCES extraction_runs(id),
  summary TEXT NOT NULL,
  related_transaction_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_summaries_email_id ON discussion_summaries(email_id);
CREATE INDEX IF NOT EXISTS idx_discussion_summaries_run_id ON discussion_summaries(run_id);
