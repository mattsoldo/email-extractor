-- Add is_multi_transaction column to qa_results table
-- This flags transactions from emails that contain multiple transactions

ALTER TABLE qa_results
ADD COLUMN IF NOT EXISTS is_multi_transaction BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN qa_results.is_multi_transaction IS 'Flag indicating if the source email contains multiple transactions that should be extracted separately';
