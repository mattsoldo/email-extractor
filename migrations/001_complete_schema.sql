-- Complete Schema Snapshot
-- Version: 0.4.0
-- Generated: 2025-12-20
-- Source: Consolidated from schema.ts
--
-- This migration creates the complete database schema from scratch.
-- For fresh databases, this is the only migration needed initially.
-- Existing databases should continue with incremental migrations (002+).

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE extraction_status AS ENUM(
    'pending',
    'processing',
    'completed',
    'failed',
    'skipped',
    'informational'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM(
    'pending',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM(
    'dividend',
    'interest',
    'stock_trade',
    'option_trade',
    'wire_transfer_in',
    'wire_transfer_out',
    'funds_transfer',
    'deposit',
    'withdrawal',
    'rsu_vest',
    'rsu_release',
    'account_transfer',
    'fee',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE model_provider AS ENUM(
    'anthropic',
    'openai',
    'google'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- AI Models
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider model_provider NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input_cost_per_million NUMERIC(10, 4) NOT NULL,
  output_cost_per_million NUMERIC(10, 4) NOT NULL,
  context_window INTEGER NOT NULL,
  is_recommended BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Account Corpus
CREATE TABLE IF NOT EXISTS account_corpus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  institution TEXT,
  account_number TEXT,
  masked_number TEXT,
  account_type TEXT,
  corpus_id TEXT REFERENCES account_corpus(id),
  is_external BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Corpus Suggestions
CREATE TABLE IF NOT EXISTS corpus_suggestions (
  id TEXT PRIMARY KEY,
  account_id_1 TEXT NOT NULL REFERENCES accounts(id),
  account_id_2 TEXT NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  confidence NUMERIC(3, 2),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  reviewed_at TIMESTAMP
);

-- Email Sets
CREATE TABLE IF NOT EXISTS email_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  email_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Emails
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  content_hash TEXT UNIQUE,
  set_id TEXT REFERENCES email_sets(id),
  filename TEXT NOT NULL,
  subject TEXT,
  sender TEXT,
  sender_name TEXT,
  recipient TEXT,
  recipient_name TEXT,
  cc TEXT,
  reply_to TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  date TIMESTAMP,
  received_at TIMESTAMP,
  body_text TEXT,
  body_html TEXT,
  raw_content TEXT,
  headers JSONB,
  extraction_status extraction_status DEFAULT 'pending' NOT NULL,
  extraction_error TEXT,
  raw_extraction JSONB,
  skip_reason TEXT,
  informational_notes TEXT,
  winner_transaction_id TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMP
);

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status job_status DEFAULT 'pending' NOT NULL,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  skipped_items INTEGER DEFAULT 0,
  informational_items INTEGER DEFAULT 0,
  error_message TEXT,
  cancel_notes TEXT,
  metadata JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Prompts
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Extraction Runs
CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  set_id TEXT NOT NULL REFERENCES email_sets(id),
  version INTEGER NOT NULL,
  name TEXT,
  description TEXT,
  model_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  software_version TEXT NOT NULL,
  emails_processed INTEGER DEFAULT 0,
  transactions_created INTEGER DEFAULT 0,
  informational_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  config JSONB,
  stats JSONB,
  status TEXT DEFAULT 'running',
  started_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Email Extractions
CREATE TABLE IF NOT EXISTS email_extractions (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES emails(id),
  run_id TEXT NOT NULL REFERENCES extraction_runs(id),
  status extraction_status NOT NULL,
  raw_extraction JSONB,
  confidence NUMERIC(3, 2),
  processing_time_ms INTEGER,
  transaction_ids JSONB DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type transaction_type NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  date TIMESTAMP NOT NULL,
  amount NUMERIC(18, 4),
  currency TEXT DEFAULT 'USD',
  symbol TEXT,
  quantity NUMERIC(18, 6),
  price NUMERIC(18, 4),
  fees NUMERIC(18, 4),
  data JSONB,
  source_email_id TEXT REFERENCES emails(id),
  extraction_run_id TEXT,
  confidence NUMERIC(3, 2),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Field Mappings
CREATE TABLE IF NOT EXISTS field_mappings (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  aliases JSONB DEFAULT '[]'::jsonb,
  transaction_types JSONB,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Discovered Fields
CREATE TABLE IF NOT EXISTS discovered_fields (
  id TEXT PRIMARY KEY,
  field_name TEXT NOT NULL,
  sample_values JSONB DEFAULT '[]'::jsonb,
  occurrence_count INTEGER DEFAULT 0,
  transaction_types JSONB DEFAULT '[]'::jsonb,
  mapped_to TEXT REFERENCES field_mappings(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Extraction Logs
CREATE TABLE IF NOT EXISTS extraction_logs (
  id TEXT PRIMARY KEY,
  email_id TEXT REFERENCES emails(id),
  job_id TEXT REFERENCES jobs(id),
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  error_type TEXT,
  stack_trace TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_email_extractions_email_id ON email_extractions(email_id);
CREATE INDEX IF NOT EXISTS idx_email_extractions_run_id ON email_extractions(run_id);
CREATE INDEX IF NOT EXISTS idx_email_extractions_status ON email_extractions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_extractions_email_run ON email_extractions(email_id, run_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE email_extractions IS 'Tracks each extraction attempt for each email, allowing multiple runs per email for comparison';
COMMENT ON COLUMN email_extractions.raw_extraction IS 'Full AI extraction response including isTransactional, emailType, transactions array, and notes';
COMMENT ON COLUMN email_extractions.transaction_ids IS 'Array of transaction IDs created from this extraction for easy lookup';
COMMENT ON COLUMN email_extractions.processing_time_ms IS 'How long the AI extraction took in milliseconds';
