-- Migration: Add jsonSchema column to prompts table
-- Description: Adds a JSONB column to store JSON Schema definitions for extraction output structure
-- Version: 0.4.1
-- Dependencies: 001_complete_schema.sql

-- Add json_schema column to prompts table
ALTER TABLE prompts
ADD COLUMN IF NOT EXISTS json_schema JSONB;

-- Add comment explaining the column's purpose
COMMENT ON COLUMN prompts.json_schema IS 'JSON Schema definition for validating extraction output structure. Null uses the default TransactionExtractionSchema.';
